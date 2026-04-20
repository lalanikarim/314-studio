# WebSocket Connection Loop — Root Cause Analysis

## 1. WebSocket Workflow in the Frontend

### End-to-End Flow

```
FolderSelector
  └─ user clicks "Open"
       → setSelectedFolder(path), setView('models')
       
ModelSelector
  └─ useModels(folder) kicks off
       ├─ createSession(backend) → session_id returned
       ├─ setSessionId(session_id) → persists in AppContext
       └─ poll /api/models?session_id=... → models arrive
       
ModelSelector
  └─ user clicks "Switch Model & Open"
       → switchModel(model), setCurrentModel(model), setView('workspace')
       
Workspace
  └─ ChatPanel mounts
       └─ useWebSocket(selectedFolder, modelRef, selectedSessionId)
            → WebSocket opens
            → sends get_state + set_model
            → bidirectional RPC relay
```

### Component Tree During Active WS

```
AppProvider
└── Workspace
    └── ChatPanel          ← useWebSocket() lives here
        ├── ws.messages   → displayed as streaming/finalized messages
        ├── ws.state      → connection indicator (Connected/Error/etc.)
        ├── ws.send()     → chat input, model switch, compact, abort
        └── ws.messages   → triggers re-process effect
```

### `useWebSocket` Internal Architecture

```
doConnect (useCallback):
  ├─ reads projectFolder, sessionId, modelRef from closure
  ├─ calls disconnect() to close any existing WS
  ├─ new WebSocket(`/api/projects/ws?session_id=...`)
  ├─ on open → send get_state, send set_model(modelRef.current)
  ├─ on message → route to messages state (or auto-ack extension UI)
  └─ on close → 1000=disconnected, other=reconnect after 2s

Lifecycle useEffect:
  → calls doConnect() on mount
  → cleanup → disconnect() on unmount

Dependency chain of doConnect:
  [projectFolder, sessionId, disconnect, send]
```

---

## 2. Root Cause: Cyclic Dependency in `doConnect`

### The Bug

`useWebSocket.ts` (lines ~195-225) has a cyclic dependency pattern:

```typescript
const doConnect = useCallback(() => {
    // ...
    // reads projectFolder and sessionId from closure
}, [projectFolder, sessionId, disconnect, send]);  // ← deps

// ── Effect 1: keep ref in sync ──────────────────────
useEffect(() => {
    doConnectRef.current = doConnect;
}, [doConnect]);  // ← doConnect is a dependency

// ── Effect 2: connect on mount + deps ───────────────
useEffect(() => {
    doConnect();
    return () => disconnect();
}, [doConnect, disconnect]);  // ← doConnect is a dependency ← BUG
```

### Why This Causes a Loop

When **any** dependency of `doConnect` changes, the `useCallback` produces a **new function reference**, which triggers **both** effects to re-run:

```
sessionId: null → "abc-123"  (useModels creates session)
  ↓
doConnect recreated (new ref) [projectFolder, sessionId, ...]
  ↓
Effect 2 re-runs → doConnect() called AGAIN
  ↓
doConnect() calls disconnect() → closes existing WS
  ↓
doConnect() → new WebSocket() → connects again
  ↓
(If modelRef.current also changed → doConnect recreated → LOOP)
```

### The Trigger Chain in Practice

Here's exactly what happens when the user clicks "Switch Model & Open":

```
1. handleSwitch() calls switchModel(model)
   → setCurrentModel(model) → context state change
   
2. AppContext re-renders (new context value object on every render)
   
3. ChatPanel re-renders → useWebSocket(selectedFolder, modelRef, selectedSessionId)
   
4. currentModel changed → modelRef.current changed
   
5. If projectFolder or sessionId was read by doConnect's closure,
   and React triggers a re-render where these values are checked,
   doConnect gets a new reference
   
6. Effect 2 re-runs → doConnect() → disconnect() → reconnect()
   
7. WS tears down → onclose → if code !== 1000 → reconnectTimer → doConnect again
   
8. → CYCLE: connect → close → reconnect → connect → close → ...
```

### Secondary Issue: `handleSend` Depends on `ws`

```typescript
// ChatPanel.tsx — handleSend depends on ws
const handleSend = useCallback(() => {
    // ...
    ws.send(trimmed);
}, [input, streamingContent, toolCallNames, ws]);  // ← ws is a dep
```

Every time `ws.messages` changes (new inbound event), `useWebSocket`'s `useMemo` returns a **new object** (because `messages` is in the dep array). This creates a new `ws` reference → `handleSend` is recreated → unnecessary work.

The comment in `useWebSocket.ts` even acknowledges this:
> *"Without this, a new object on every render causes ChatPanel to recreate handleSend (which depends on ws), triggering cascading re-renders that tear down and reconnect the WebSocket."*

But this only partially solves the problem. The `useMemo` prevents infinite re-render loops from state changes, but it **doesn't** fix the root cause: `doConnect` itself being recreated.

---

## 3. Proposed Resolution: Stable `doConnect` via Refs

The fix is to break the cyclic dependency by having `doConnect` read values from **refs** instead of the closure, making the callback **stable** (empty dependency array).

### The Pattern

```typescript
const projectFolderRef = useRef(projectFolder);
const sessionIdRef = useRef(sessionId);

// Keep refs in sync
useEffect(() => { projectFolderRef.current = projectFolder; }, [projectFolder]);
useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

// doConnect reads from refs → stable reference
const doConnect = useCallback(() => {
    const folder = projectFolderRef.current;
    const sid = sessionIdRef.current;
    const model = modelRef.current;
    
    if (!folder || !sid) return;
    disconnect();
    setState("connecting");
    
    const ws = new WebSocket(`/api/projects/ws?session_id=${encodeURIComponent(sid)}`);
    wsRef.current = ws;
    // ... rest unchanged
}, [disconnect, send]);  // ← only stable deps

// Effect runs ONCE on mount, doConnect never changes
useEffect(() => {
    doConnect();
    return () => { disconnect(); };
}, [doConnect]);  // ← doConnect is stable, effect runs once
```

### What Changes

| File | Change |
|------|--------|
| `useWebSocket.ts` | Add `projectFolderRef` + `sessionIdRef`, make `doConnect` depend only on `[disconnect, send]` |
| `ChatPanel.tsx` | Remove `ws` from `handleSend` deps (wrap in ref) — minor optimization |

### Why This Works

- `doConnect` has an **empty/stable** dependency array → never recreated
- The `useEffect` with `doConnect` as a dep runs **only once** on mount
- Values are read from refs at runtime → always current
- No cyclic dependency → no unexpected reconnection
- `doConnectRef` pattern still works for the reconnect timer

---

## 4. Recommended Implementation

### Option A: Minimal Fix (Recommended)

Fix only the cyclic dependency in `useWebSocket.ts`:

```diff
 export function useWebSocket(
     projectFolder: string | null,
     modelRef: MutableRefObject<Model | null>,
     sessionId: string | null,
 ): UseWebSocketReturn {
     const wsRef = useRef<WebSocket | null>(null);
     const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
     const doConnectRef = useRef<() => void>(null);
+    const projectFolderRef = useRef(projectFolder);
+    const sessionIdRef = useRef(sessionId);
     // ... rest of state
+
+    // Keep refs in sync with props
+    useEffect(() => { projectFolderRef.current = projectFolder; }, [projectFolder]);
+    useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
     // ... send, respondToUi, disconnect unchanged
     
     const doConnect = useCallback(() => {
         if (disposedRef.current) return;
+        const folder = projectFolderRef.current || "";
+        const sid = sessionIdRef.current;
+        const model = modelRef.current;
         
-        const targetProject = projectFolder || "";
-        if (!targetProject || !sessionId) return;
+        if (!folder || !sid) return;
         
         setState("connecting");
-        const wsUrl = `/api/projects/ws?session_id=${encodeURIComponent(sessionId)}`;
+        const wsUrl = `/api/projects/ws?session_id=${encodeURIComponent(sid)}`;
         const ws = new WebSocket(wsUrl);
         // ...
-        const model = modelRef.current;
-        if (model) {
+        if (model) {
             send({
                 type: "set_model",
                 provider: model.provider,
                 modelId: model.id,
             } as RpcCommand);
         }
     }, [disconnect, send]);  // ← stable deps only
     
     // Effect: runs once because doConnect is stable
     useEffect(() => {
-        doConnectRef.current = doConnect;  // ← no longer needed
         doConnect();
         return () => {
             disposedRef.current = true;
             disconnect();
         };
-    }, [doConnect, disconnect]);
+    }, [doConnect, disconnect]);
```

### Option B: Full Refactor (Larger, Cleaner Long-Term)

Separate connection management from state management:

1. **`useWebSocketConnection()`** — pure WS lifecycle (connect/disconnect, send, onmessage)
2. **`useWebSocketState()`** — processes messages into display state
3. **`useChatSession()`** — orchestrates both, provides the API surface

This would require rewriting `useWebSocket.ts` into composable hooks. Worth doing but not urgent.

---

## 5. Why This Was Hidden

The existing `useMemo` in `useWebSocket` masks the symptom:

```typescript
return useMemo(() => ({
    state, closeCode, closeReason, errorMessage,
    send, abort, compact, setAutoCompaction,
    messages, pendingUiRequest, respondToUi,
    disconnect, clearMessages, reconnect,
}), [state, closeCode, closeReason, send, abort, compact,
    setAutoCompaction, messages, pendingUiRequest, respondToUi,
    disconnect, clearMessages, reconnect]);
```

This prevents **infinite re-render loops** (the return object stays stable when values don't change), but it does **not** prevent **effect re-runs** caused by `doConnect` changing. The effect still runs, calling `disconnect()` and starting a new connection.

The comment in the code acknowledges the re-render issue but doesn't mention the effect re-run issue — because the `useMemo` was written as a band-aid, not a fix.

---

## 6. Verification Plan

After applying the fix:

1. **Stability test**: Open workspace → send 10 messages → check WS state stays `"connected"` (no reconnects)
2. **Model switch test**: Switch model from within Workspace → verify single reconnect (expected) not a loop
3. **Close/reopen test**: Close session, reopen → verify clean connect
4. **Network tab**: Monitor WS frames — should see CONNECT → 0 CLOSE events during normal chat

---

## 7. Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Breaking existing functionality | Low | Pattern is standard React (refs + stable callbacks) |
| `projectFolder`/`sessionId` not syncing | Low | Explicit `useEffect` for each ref |
| Reconnect timer still works | Low | `doConnectRef` pattern unchanged |
| Performance impact | None | Actually improves — fewer effect runs |

**Conclusion: Safe, targeted fix. ~15 lines changed.**
