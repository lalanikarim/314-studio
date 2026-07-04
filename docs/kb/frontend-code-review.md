# Frontend Code Review — Issues & Opportunities

> Date: 2026-07-03
> Scope: `frontend/src/` (React 19 + TypeScript + Vite)
> Status: Reviewed, actionable items listed

---

## Table of Contents

- [Critical Issues](#critical-issues)
- [High Priority](#high-priority)
- [Medium Priority](#medium-priority)
- [Low Priority / Nice-to-Have](#low-priority--nice-to-have)
- [Summary Matrix](#summary-matrix)
- [Recommended Actions](#recommended-actions)
- [Code Walkthrough](#code-walkthrough-by-file)

---

## Critical Issues

### C-1: `useModels` Called Redundantly in `ChatPanel` ✅ RESOLVED

**Files**: `ChatPanel.tsx`, `ModelSelector.tsx`, `AppContext.tsx`, `types/index.ts`

`ChatPanel` previously called `useModels(selectedFolder, selectedSessionId)` redundantly. The model list is now persisted into `AppContext` by `ModelSelector`, so `ChatPanel` reads it via `useApp().models` instead.

**Fix applied**:
- Added `models`, `modelsLoading`, `modelsError`, `refreshModels` to `AppState` and `AppContext`
- `ModelSelector` persists fetched models into context via `useEffect` hooks
- `ChatPanel` removed `useModels` call and `useModels` import; uses `useApp().models` for the dropdown
- All 58 integration tests pass after the change.

---

### C-2: Duplicate `deriveModelName` and `extractProvider` Functions ✅ RESOLVED

**Files**: `utils/model.ts` (new), `FolderSelector.tsx`, `ChatPanel.tsx`, `useModels.ts`

All duplicate `deriveModelName` implementations (3 copies) and `extractProvider` (1 copy) extracted to shared `frontend/src/utils/model.ts`.

**Fix applied**:
- Created `frontend/src/utils/model.ts` with exported `deriveModelName`, `extractProvider`, and `createMinimalModel`
- `useModels.ts` imports `deriveModelName` (removed local copy)
- `FolderSelector.tsx` imports both functions (removed local copies)
- `ChatPanel.tsx` imports `deriveModelName` (removed local copy)
- All 58 integration tests pass after the change.

---

### C-3: `useWebSocket` Messages Array Grows Unbounded ✅ RESOLVED

**Files**: `useWebSocket.ts`

All RPC events were accumulated indefinitely in the `messages` state array. With active streaming, this could grow to tens of thousands of items.

**Fix applied**:
- Added `MAX_MESSAGES = 500` constant
- All `setMessages` calls in `ws.onmessage` now cap the array at 500 items using `slice(next.length - MAX_MESSAGES)` when exceeded
- Prevents unbounded memory growth during long sessions
- All 58 integration tests pass after the change.

---

### C-4: `useModels` — `launchedRef` Never Reset for `existingSessionId` Changes ✅ RESOLVED

**Files**: `useModels.ts`

`launchedRef` was only reset when `projectPath` changed. Switching sessions without changing project left the hook stuck with the old session.

**Fix applied**:
- Added `prevExistingSessionRef` to track previous `existingSessionId`
- Effect dependency array expanded to `[projectPath, existingSessionId]`
- Launch guard now resets when either `projectPath` or `existingSessionId` changes
- All 58 integration tests pass after the change.

---

### C-5: `useFileContent` — No Request Cancellation on Rapid File Switches ✅ RESOLVED

**Files**: `useFileContent.ts`

Rapid file switches could cause stale responses to overwrite current content. `isMountedRef` only guards against unmount, not between rapid re-renders.

**Fix applied**:
- Added `expectedPathRef` tracking the requested `filePath`
- `setContent` and `setError` now check `expectedPathRef.current === filePath` before updating
- Stale responses from previous file switches are silently discarded
- All 58 integration tests pass after the change.

---

### C-6: `ChatPanel` — `handleSend` Closes Model Dropdown Without Switching Model ✅ VERIFIED NOT AN ISSUE

**Files**: `ChatPanel.tsx`

`setModelDropdownOpen(false)` exists only in `handleSwitchModel` (line 653), where it correctly closes the dropdown after a model switch. `handleSend` does not call `setModelDropdownOpen`. The review identified a false positive — this was likely an outdated observation from an earlier version.

---

## High Priority

### H-1: `FolderSelector` — Sessions Never Refresh After Creation/Deletion ✅ RESOLVED

**Files**: `FolderSelector.tsx`

The Sessions tab fetched sessions once on mount and never refreshed.

**Fix applied**:
- Combined fetch effect with `activeTab` dependency so sessions refresh on tab switch
- Flag resets when leaving the tab, ensuring next visit re-fetches
- Picks up sessions created/deleted from Workspace view
- All 58 integration tests pass after the change.

---

### H-2: `FolderSelector` — Silent Error Swallowing ✅ RESOLVED

**Files**: `FolderSelector.tsx`

Session fetch errors were completely swallowed with `.catch(() => {})`.

**Fix applied**:
- Added `sessionLoadError` state to track fetch failures
- `console.warn` logs the error for debugging
- Error message displayed in UI when sessions fail to load
- Users can now distinguish between "no sessions" and "backend is down"
- All 58 integration tests pass after the change.

---

### H-3: `useModels` — Complex Nested Async Flow in `useEffect`

**Files**: `useModels.ts` (lines 110-200)

The `fetchModels` function is ~90 lines of nested async/await with multiple branches (cache → server → RPC polling). This is:
- Hard to test (each branch is tightly coupled)
- Difficult to debug (no logging between steps)
- Prone to subtle bugs (abort checks scattered throughout)

```ts
// Step 0: Check localStorage cache
// Step 1: Fetch from server (no session)
// Step 2: Launch pi RPC session
// Step 3: RPC polling as final fallback
```

**Impact**: Maintenance burden; new contributors struggle to understand the flow; bugs are hard to isolate.

**Fix**: Extract each step into a separate named function:

```ts
async function loadFromCache(): Promise<Model[] | null> { ... }
async function loadFromServer(): Promise<Model[] | null> { ... }
async function launchSession(): Promise<string> { ... }
async function pollRpcModels(sessionId: string): Promise<Model[] | null> { ... }
```

Consider using a state machine (`@xstate/react`) or a simple pipeline pattern for clarity.

---

### H-4: `useWebSocket` — Reconnection Has No Exponential Backoff ✅ RESOLVED

**Files**: `useWebSocket.ts`

Fixed 2-second reconnection interval generated 30 attempts/minute during outages.

**Fix applied**:
- Added `BACKOFF_BASE_MS` (2s), `BACKOFF_MAX_MS` (30s), `BACKOFF_MAX_EXP` (4)
- Reconnection delay now uses exponential backoff: `min(2000 * 2^index, 30000)`
- `backoffIndexRef` resets on successful connection
- Backoff caps at ~32s (2^4 * 2000 = 32000, capped to 30000)
- All 58 integration tests pass after the change.

---

### H-5: `ChatPanel` — `handleCompact` Uses `setTimeout` for State Reset ✅ RESOLVED

**Files**: `ChatPanel.tsx`

`handleCompact` used `setTimeout(() => setClosingState("none"), 3000)` which could leave the UI stuck in "Compacting…" state.

**Fix applied**:
- Added `compact` response handler in the RPC message processing effect
- When `response.command === "compact"` arrives, `closingState` resets to `"none"`
- Removed the `setTimeout` hack from `handleCompact`
- All 58 integration tests pass after the change.

---

### H-6: `ChatPanel` — `continue` Drops Valid RPC Responses ✅ MITIGATED

**Files**: `ChatPanel.tsx`

```ts
if (msg.kind === "rpc_response") {
    const response = msg.response as Record<string, unknown>;
    if (response.type === "response" && response.command === "get_messages") {
        // ... process get_messages
        continue;  // ← Skips ALL remaining rpc_response messages
    }
    if (response.type === "response" && response.command === "get_state" && ...) {
        // ... process get_state
    }
    continue;  // ← Also skips set_model responses, get_state (non-first), etc.
}
```

✅ **Mitigated**: The original concern (`continue` blocking `compact` handler) was fixed in H-5. Unhandled RPC responses (`set_model`, etc.) now emit `console.debug` for visibility. The `continue` pattern is retained since each handler is mutually exclusive by command name.

**Impact**: Silent data loss; broken feedback loop for RPC commands.

**Fix applied**:
- Compact handler added before the final `continue` (H-5)
- Unhandled RPC responses now logged via `console.debug`
- Future RPC commands will be visible in devtools rather than silently dropped

---

### H-7: No CSS Variables Used in Component Stylesheets ✅ RESOLVED

**Files**: `index.css`, `components.css`, `views.css`, `common.css`

113 hardcoded hex colors across 3 CSS files instead of using CSS variables.

**Fix applied**:
- Added 15 new CSS variables to `index.css` (semantic colors: danger, warning, success, info, selected states, code bg, etc.)
- Replaced 108/113 hardcoded colors with CSS variable references across `components.css`, `views.css`, `common.css`
- 5 rare one-off semantic colors retained (unique error/success states)
- Single source of truth for the color palette; theme changes now require editing only `index.css`
- All 58 integration tests pass after the change.

---

## Medium Priority

### M-1: `useWebSocket` — `shouldDisconnectRef` Logic Is Fragile

**Files**: `useWebSocket.ts` (lines 270-295)

```ts
ws.onclose = (event) => {
    // ...
    if (!shouldDisconnectRef.current) {
        setState("error");
    } else {
        shouldDisconnectRef.current = false;
        setState("disconnected");
    }
};
```

The flag is set in cleanup, checked in `onclose`, and reset in `onclose`. If `onclose` fires twice rapidly (e.g., network blip + intentional close), the flag could be misinterpreted, causing an unintended reconnection attempt or incorrect state.

**Impact**: Race condition during disconnect sequences; potential unexpected reconnections.

**Fix**: Track disconnect intent at the call site (in `disconnect()`) rather than in a flag that survives across multiple `onclose` events. Alternatively, use a `closeReason` string that captures the intent.

---

### M-2: `ChatPanel` — `clearMessages` Races With Message Processing

**Files**: `ChatPanel.tsx` (lines 330-333)

```ts
const clearMessages = useCallback(() => {
    setMessages([]);
    send({ type: "get_messages" });
}, [send]);
```

After clearing display messages, `get_messages` is sent immediately. New streaming events may arrive between the clear and the history reload, getting merged with the freshly loaded history. The `processedCountRef` is not reset, so new events are treated as "new" and appended.

**Impact**: History reload may miss recently streamed messages or create duplicates.

**Fix**: Reset `processedCountRef.current = ws.messages.length` after clearing to prevent re-processing of pending events. Also consider pausing the message processing effect during clear.

---

### M-3: `ProjectTree` — `AbortController` Created But Never Used

**Files**: `ProjectTree.tsx` (lines 91-107)

```ts
useEffect(() => {
    const controller = new AbortController();

    const doFetch = async () => {
        // ... fetch without passing controller.signal
    };

    new Promise<void>((resolve) => {
        // ...
    }).catch(() => {});

    return () => {
        controller.abort();  // Aborts nothing
    };
}, [selectedFolder]);
```

The `AbortController` is created and aborted on cleanup, but `listFiles()` doesn't accept an `AbortSignal`. The abort is a no-op.

**Impact**: False sense of cancellation; potential memory leak if the effect unmounts mid-fetch.

**Fix**: Either pass `controller.signal` to `listFiles()` (if the API supports it) or remove the AbortController entirely and rely on the `folderRef` guard.

---

### M-4: `FolderSelector` — `expandedPaths` as `Set<string>` in State

**Files**: `FolderSelector.tsx` (lines 255-258)

```ts
const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    new Set([ROOT_PATH]),
);
```

Every `handleToggle` creates a new `Set`, triggering re-renders of the entire directory tree. React's state comparison uses reference equality for objects, so even a single node toggle causes the whole tree to re-render.

**Impact**: Unnecessary re-renders for every tree interaction.

**Fix options**:
1. Use `useSyncExternalStore` with a custom store.
2. Use a `Map<string, boolean>` with a stable reference pattern (update key, don't replace).
3. Use a flat string array (`["path1", "path2"]`) with `useMemo`-derived Set for lookup.
4. Keep the Set but use `React.memo` on tree nodes to prevent unnecessary re-renders.

---

### M-5: `useModels` — No Retry on RPC Polling Failure

**Files**: `useModels.ts` (lines 166-183)

```ts
try {
    const resp = await listModels(activeSessionId!);
    if (resp && resp.length > 0) { ... }
} catch {
    // Ignore transient errors during polling
}
```

All polling errors are silently swallowed. If the Pi RPC process is slow to start or temporarily unresponsive, the polling silently continues until timeout, providing no feedback.

**Impact**: No visibility into why model loading is stuck; transient errors are indistinguishable from permanent failures.

**Fix**: Track error count and log a warning after N consecutive failures. Consider surfacing the error in the UI after the timeout.

---

### M-6: `useModels` — `getCachedModels()`/`cacheModels()` Access `localStorage` Synchronously

**Files**: `useModels.ts` (lines 53-71)

`localStorage` is synchronous. While fast for small payloads, it runs during the render path of `useEffect`. If the cache is corrupted (rare), the `try/catch` silently fails.

**Impact**: Minor perf concern; silent failure on cache corruption.

**Fix**: Wrap in more granular error handling that logs the issue:

```ts
try {
    const cached = localStorage.getItem(MODELS_CACHE_KEY);
    // ...
} catch (e) {
    console.warn("Failed to read models cache:", e);
    return null;
}
```

---

### M-7: `ChatPanel` — `displayMessages` + `streamingContent`/`toolCalls` Split State

**Files**: `ChatPanel.tsx` (lines 248-250, 298-301)

```ts
const [displayMessages, setDisplayMessages] = useState<DisplayMessage[]>([]);
const [streamingContent, setStreamingContent] = useState("");
const [toolCalls, setToolCalls] = useState<ToolCallEntry[]>([]);
```

The streaming state is separate from the display state but they're processed together. When finalizing a stream, the code manually combines them:

```ts
const lines = [...toolLines, streamingContent.trim()].filter(Boolean);
setDisplayMessages((prev) => [...prev, { content: lines.join("\n\n"), ... }]);
setStreamingContent("");
setToolCalls([]);
```

**Impact**: Triple the state variables to manage; the combine logic is duplicated in two places (end-of-stream effect and `handleSend`).

**Fix**: Use a single `messages` array with an `isStreaming: boolean` flag, or a `streamingMessageId` that points to the current streaming message in the array.

---

### M-8: `ChatPanel` — Messages Sorted on Every Render

**Files**: `ChatPanel.tsx` (line ~512)

```ts
displayMessages.slice().sort((a, b) => a.timestamp - b.timestamp)
```

This runs on every render. Since messages are appended in order, a `useMemo` would avoid the sort when the array hasn't changed.

**Impact**: Unnecessary sort computation on every render.

**Fix**: Wrap in `useMemo`:

```ts
const sortedMessages = useMemo(
    () => [...displayMessages].sort((a, b) => a.timestamp - b.timestamp),
    [displayMessages],
);
```

---

### M-9: `useWebSocket` — `errorMessage` IIFE Runs on Every Render

**Files**: `useWebSocket.ts` (lines 329-337)

```ts
const errorMessage: string | null = (() => {
    if (state === "error") {
        if (closeCode === 4002)
            return closeReason || "Session not found or not running";
        if (closeReason) return closeReason;
        return "WebSocket connection lost";
    }
    return null;
})();
```

This is a dead IIFE — it runs on every render but doesn't depend on any React state. It should be wrapped in `useMemo` or extracted as a derived hook.

**Impact**: Wasted computation on every render.

**Fix**:

```ts
const errorMessage = useMemo(() => {
    if (state === "error") {
        if (closeCode === 4002) return closeReason || "Session not found or not running";
        if (closeReason) return closeReason;
        return "WebSocket connection lost";
    }
    return null;
}, [state, closeCode, closeReason]);
```

---

### M-10: `FilePreview` — No Virtualization for Large Files

**Files**: `FilePreview.tsx` (lines 35-46)

```ts
const lineNumberCount = displayContent.split('\n').length;
// ...
<div className="panel__line-numbers">
    {Array.from({ length: Math.min(lineNumberCount, 200) }, (_, i) => (...))}
</div>
<pre className="panel__code">{displayContent}</pre>
```

For files > 1000 lines, rendering the entire content as a single `<pre>` element is slow. The line number cap (200) is cosmetic — the content still renders all lines.

**Impact**: Slow rendering for large files; potential browser freeze for 10K+ line files.

**Fix**: Implement virtualized rendering (e.g., `react-virtuoso` or a custom windowed list) for files > 500 lines.

---

### M-11: No Error Boundaries

**Files**: All components

A crash in any component (e.g., malformed RPC event in `agentMessageToDisplay`) would unmount the entire React tree, showing a blank page.

**Impact**: Single component crash kills the whole app.

**Fix**: Wrap key views in Error Boundaries:

```tsx
<ErrorBoundary fallback={<ErrorPage />}>
    <Workspace />
</ErrorBoundary>
```

---

## Low Priority / Nice-to-Have

### L-1: `index.css` Imported Twice

**Files**: `App.tsx` (line 3), `main.tsx` (line 3)

Both files import `./index.css`. This is harmless (CSS is idempotent) but unnecessary.

**Fix**: Remove the import from `App.tsx`.

---

### L-2: `ChatPanel` — Inline Styles for Connection Indicator

**Files**: `ChatPanel.tsx` (lines 492-507)

```tsx
<span className="chat-connection-indicator" style={{
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 11,
    color: connectionColor,
}}>
```

Inline styles for what could be a CSS class. The `color: connectionColor` is dynamic (green/yellow/red), so a CSS variable approach would work better.

**Fix**: Add a CSS class with `color: var(--conn-color)` and set the CSS variable via inline style, or use three pre-defined classes.

---

### L-3: `useFileContent` — `isMountedRef` Pattern Is Outdated

**Files**: `useFileContent.ts` (lines 13, 21, 33, 43)

```ts
const isMountedRef = useRef(true);
useEffect(() => {
    isMountedRef.current = true;
    // ...
    return () => { isMountedRef.current = false; };
}, [...]);
```

The ref-based mounted check is an older pattern. React 19 supports the `use` hook and native Promise-based patterns. The ref doesn't cancel in-flight requests.

**Impact**: Minor — works but is not idiomatic for React 19.

**Fix**: Consider using `AbortController` in the promise chain:

```ts
useEffect(() => {
    const controller = new AbortController();
    readFile(projectPath, filePath, { signal: controller.signal })
        .then(...)
        .catch((e) => {
            if (e.name !== 'AbortError') setError(e.message);
        });
    return () => controller.abort();
}, [projectPath, filePath]);
```

---

### L-4: `FolderSelector` — `SessionRow` Recreates `timeStr` on Every Render

**Files**: `FolderSelector.tsx` (lines 105-108)

```ts
const time = new Date(session.created_at);
const timeStr = time.toLocaleDateString([], { ... }) + " " + time.toLocaleTimeString([], { ... });
```

This is computed fresh on every render of `SessionRow`, which re-renders whenever the parent `FolderSelector` re-renders.

**Impact**: Minor — date formatting is cheap, but unnecessary.

**Fix**: Wrap in `useMemo` or compute once in the parent and pass the formatted string as a prop.

---

### L-5: `FolderSelector` — `extractProvider` Is Hardcoded List

**Files**: `FolderSelector.tsx` (lines 25-30)

```ts
function extractProvider(modelId: string | null | undefined): string {
    // ...
    for (const p of ["anthropic", "openai", "google", "deepseek", ...]) {
        if (modelId.toLowerCase().startsWith(p)) return p;
    }
    return "anthropic";  // fallback
}
```

The provider list is hardcoded. Adding a new provider (e.g., "aws", "azure") requires editing this function. The fallback to `"anthropic"` is a guess.

**Impact**: Maintenance burden; new providers silently misclassified.

**Fix**: Either:
1. Use the `provider` field from the model config (if available).
2. Make the provider list configurable (e.g., from a constants file).
3. Parse the provider from the model_id format (e.g., `anthropic/claude-sonnet-4-20250514` → split on `/`).

---

### L-6: `useModels` — Magic Numbers for Timeout/Interval

**Files**: `useModels.ts` (lines 45-46)

```ts
const PI_INIT_TIMEOUT_MS = 15_000;  // wait up to 15s for pi to initialize
const POLL_INTERVAL_MS = 1500;     // poll every 1.5s
```

These are defined at module scope, which is fine, but they lack context for why these specific values were chosen.

**Impact**: Minor — values are reasonable but unexplained.

**Fix**: Add a comment explaining the reasoning:

```ts
const PI_INIT_TIMEOUT_MS = 15_000; // 15s: pi process startup + model enumeration
const POLL_INTERVAL_MS = 1_500;    // 1.5s: balance between responsiveness and server load
```

---

### L-7: `useWebSocket` — `WebSocket.OPEN` Constant Usage

**Files**: `useWebSocket.ts` (line ~215)

```ts
if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
```

`WebSocket.OPEN` is a static property on the `WebSocket` constructor, not the prototype. This works but is unusual. The standard pattern is `WebSocket.CONNECTING`, `WebSocket.OPEN`, etc., which is what's used here — so this is actually fine. No fix needed.

**Impact**: None — this is correct usage.

---

### L-8: No Loading Skeletons / Optimistic UI

**Files**: All views

All loading states show text ("Loading...", "Connecting..."). Skeleton screens provide a better UX, especially on slow connections.

**Impact**: UX polish — not a functional issue.

**Fix**: Add skeleton screens for the model list, file tree, and chat messages.

---

### L-9: `services/api.ts` — No Environment Configuration

**Files**: `services/api.ts` (line 8)

```ts
const API_BASE = ""; // relative to Vite dev server or behind reverse proxy
```

The API base is hardcoded as empty string. No environment variable support for different deployments.

**Impact**: Deployment rigidity — requires code changes to point at different backends.

**Fix**: Use Vite's `import.meta.env` for environment-specific configuration:

```ts
const API_BASE = import.meta.env.VITE_API_BASE || "";
```

---

### L-10: `useModels` — `getCachedModels()` Returns `null` on Any Error

**Files**: `useModels.ts` (lines 53-62)

```ts
function getCachedModels(): Model[] | null {
    try {
        const cached = localStorage.getItem(MODELS_CACHE_KEY);
        if (!cached) return null;
        const parsed: ModelsCache = JSON.parse(cached);
        if (Date.now() - parsed.timestamp > MODELS_MAX_AGE_MS) return null;
        return parsed.models;
    } catch {
        return null;  // Silent failure
    }
}
```

Any localStorage error (privacy mode, quota exceeded, corruption) silently returns null, falling through to the API call. This is functional but provides no debugging visibility.

**Impact**: Minor — works but silent on failure.

**Fix**: Add `console.warn` on cache read failure:

```ts
catch (e) {
    console.warn("Failed to read models cache:", e);
    return null;
}
```

---

## Summary Matrix

| ID | Severity | File(s) | Issue | Effort |
|----|----------|---------|-------|--------|
| C-1 | Critical | ChatPanel.tsx | `useModels` called redundantly | Low | ✅ Resolved
| C-2 | Critical | utils/model.ts | Duplicate `deriveModelName`/`extractProvider` | Low | ✅ Resolved
| C-3 | Critical | useWebSocket.ts | Messages array grows unbounded | Medium | ✅ Resolved
| C-4 | Critical | useModels.ts | `launchedRef` not reset for `existingSessionId` | Low | ✅ Resolved
| C-5 | Critical | useFileContent.ts | No request cancellation on rapid switches | Low | ✅ Resolved
| C-6 | Critical | ChatPanel.tsx | `handleSend` closes dropdown without switching | Trivial | ✅ Verified: not an issue (false positive)
| H-1 | High | FolderSelector.tsx | Sessions never refresh | Medium | ✅ Resolved
| H-2 | High | FolderSelector.tsx | Silent error swallowing | Low | ✅ Resolved
| H-3 | High | useModels.ts | Complex nested async flow | High |
| H-4 | High | useWebSocket.ts | No exponential backoff on reconnect | Low | ✅ Resolved
| H-5 | High | ChatPanel.tsx | `handleCompact` uses setTimeout hack | Medium | ✅ Resolved
| H-6 | High | ChatPanel.tsx | `continue` drops valid RPC responses | Medium | ✅ Mitigated
| H-7 | High | components.css, views.css | Hardcoded colors instead of CSS variables | Medium | ✅ Resolved
| M-1 | Medium | useWebSocket.ts | `shouldDisconnectRef` race condition | Medium |
| M-2 | Medium | ChatPanel.tsx | `clearMessages` races with processing | Low |
| M-3 | Medium | ProjectTree.tsx | AbortController created but unused | Low |
| M-4 | Medium | FolderSelector.tsx | `Set<string>` in state causes excess re-renders | Medium |
| M-5 | Medium | useModels.ts | No retry/logging on RPC polling failure | Low |
| M-6 | Medium | useModels.ts | Silent localStorage errors | Low |
| M-7 | Medium | ChatPanel.tsx | Split state (messages + streaming + toolCalls) | Medium |
| M-8 | Medium | ChatPanel.tsx | Messages sorted on every render | Low |
| M-9 | Medium | useWebSocket.ts | `errorMessage` IIFE on every render | Trivial |
| M-10 | Medium | FilePreview.tsx | No virtualization for large files | High |
| M-11 | Medium | All components | No error boundaries | Low |
| L-1 | Low | App.tsx, main.tsx | `index.css` imported twice | Trivial |
| L-2 | Low | ChatPanel.tsx | Inline styles for connection indicator | Low |
| L-3 | Low | useFileContent.ts | `isMountedRef` pattern is outdated | Low |
| L-4 | Low | FolderSelector.tsx | `timeStr` recreated every render | Low |
| L-5 | Low | FolderSelector.tsx | Hardcoded provider list in `extractProvider` | Low |
| L-6 | Low | useModels.ts | Magic numbers without context | Trivial |
| L-7 | Low | useWebSocket.ts | `WebSocket.OPEN` usage — actually correct | None |
| L-8 | Low | All views | No loading skeletons | Medium |
| L-9 | Low | services/api.ts | No env config for API base | Low |
| L-10 | Low | useModels.ts | Silent localStorage errors | Low |

**Totals**: 30 issues (6 critical, 7 high, 11 medium, 10 low)
**Resolved**: 10 fixed, 1 mitigated, 1 verified not an issue, 18 actionable

---

## Recommended Actions

Prioritized by impact vs effort:

### Phase 1: Quick Wins (Low Effort, High Impact) — Action Required

1. ~~**Remove duplicate `useModels` call from `ChatPanel`**~~ — ✅ Resolved: models persisted to AppContext, ChatPanel uses `useApp().models`. **(C-1)**
2. ~~**Extract `deriveModelName` and `extractProvider`** to shared `utils/model.ts`~~ — ✅ Resolved: `deriveModelName`, `extractProvider`, `createMinimalModel` extracted to `frontend/src/utils/model.ts`. **(C-2)**
3. ~~**Cap `useWebSocket` messages array at 500 items**~~ — ✅ Resolved: `MAX_MESSAGES` constant added, all `setMessages` calls trim overflow. **(C-3)**
4. ~~**Remove `setModelDropdownOpen(false)` from `handleSend`**~~ — ✅ Verified: not an issue (false positive). **(C-6)**
4. ~~**Add CSS variable usage** to component CSS files~~ — ✅ Resolved: 108/113 hardcoded colors replaced with CSS variables; 15 new semantic variables added. **(H-7)**
5. **Wrap `errorMessage` in `useMemo`** in `useWebSocket.ts`. **(M-9)**
6. **Add `console.warn`** to `getCachedModels()` and `cacheModels()` error paths. **(M-6, L-10)**
7. ~~**Add `console.warn` to `FolderSelector` session fetch error**~~ — ✅ Resolved: `sessionLoadError` state + `console.warn` + UI error banner. **(H-2)**
8. **Remove duplicate `index.css` import** from `App.tsx`. **(L-1)**
9. **Wrap messages sort in `useMemo`** in `ChatPanel.tsx`. **(M-8)**
10. **Fix `clearMessages`** to reset `processedCountRef.current = ws.messages.length`. **(M-2)**

### Phase 2: Core Fixes (Medium Effort) — Action Required

11. ~~**Implement message array capping** in `useWebSocket.ts` (keep last 500 messages)~~ — ✅ Resolved: `MAX_MESSAGES = 500` with automatic trimming on all `setMessages` calls. **(C-3)**
12. ~~**Add exponential backoff** to WS reconnection~~ — ✅ Resolved: `BACKOFF_BASE_MS`/`BACKOFF_MAX_MS` with `backoffIndexRef`, resets on connect. **(H-4)**
13. ~~**Fix `continue` bug** in ChatPanel RPC processing~~ — ✅ Mitigated: compact handler added (H-5), unhandled responses now logged. **(H-6)**
14. ~~**Fix `handleCompact`** to listen for RPC response~~ — ✅ Resolved: `compact` response handler added to RPC processing effect, `setTimeout` removed. **(H-5)**
15. ~~**Add request cancellation** to `useFileContent.ts`~~ — ✅ Resolved: `expectedPathRef` tracks current filePath, stale responses discarded. **(C-5)**
16. ~~**Reset `launchedRef`** when `existingSessionId` changes~~ — ✅ Resolved: effect depends on `[projectPath, existingSessionId]`, resets guard on either change. **(C-4)**
17. ~~**Add session refresh logic** to `FolderSelector`~~ — ✅ Resolved: sessions refresh on tab switch via `activeTab` dependency. **(H-1)**
18. **Add Error Boundaries** around key views (Workspace, ChatPanel). **(M-11)**
19. **Fix `AbortController`** in `ProjectTree.tsx` — either pass signal or remove. **(M-3)**
20. **Improve `shouldDisconnectRef` logic** — track intent at call site. **(M-1)**

### Phase 3: UX & Architecture (Higher Effort)

21. **Simplify `useModels` flow** — extract steps into named functions or use a state machine. **(H-3)**
22. **Consolidate ChatPanel state** — single messages array with streaming flag instead of 3 separate states. **(M-7)**
23. **Implement virtualized file preview** for files > 500 lines. **(M-10)**
24. **Add loading skeletons** to all views. **(L-8)**
25. **Add environment config** for API base URL via Vite env vars. **(L-9)**
26. **Consider `useSyncExternalStore`** for `expandedPaths` in FolderSelector. **(M-4)**
27. **Use `AbortController` pattern** in `useFileContent.ts` for React 19 idiomatic code. **(L-3)**
28. **Add logging** between steps in `useModels` flow for debugging. **(H-3)**
29. **Make `extractProvider` configurable** or parse from model_id format. **(L-5)**
30. **Add comments** explaining magic numbers (`PI_INIT_TIMEOUT_MS`, `POLL_INTERVAL_MS`). **(L-6)**

---

## Code Walkthrough by File

### `App.tsx`

| Line | Issue | Severity |
|------|-------|----------|
| 3 | `index.css` imported (also in `main.tsx`) | L-1 |

### `main.tsx`

| Line | Issue | Severity |
|------|-------|----------|
| 3 | `index.css` imported (duplicate) | L-1 |

### `store/AppContext.tsx`

| Line | Issue | Severity |
|------|-------|----------|
| 1-40 | `setSelectedSession` synchronizes `selectedFolder` from session — could cause unexpected view transitions | Low (minor) |
| 45-50 | `switchModel` updates both `currentModel` and `selectedModel` — good design | — |

### `types/index.ts`

| Line | Issue | Severity |
|------|-------|----------|
| 1-30 | Types are well-defined and consistent with backend schemas | — |
| 15-22 | `AppState.selectedSession` type is inline object — consider extracting to named type | Low |

### `services/api.ts`

| Line | Issue | Severity |
|------|-------|----------|
| 8 | `API_BASE = ""` hardcoded, no env config | L-9 |
| 12-18 | `request()` helper is solid — handles text/binary/JSON correctly | — |
| 42-44 | `listSessions()` endpoint not defined in AGENTS.md API table — verify it exists | Low |

### `hooks/useFileContent.ts`

| Line | Issue | Severity |
|------|-------|----------|
| 13 | `isMountedRef` pattern — outdated for React 19 | L-3 |
| 21-43 | `expectedPathRef` guards against stale responses | — | ✅ Fixed |
| 1 | `eslint-disable react-hooks/set-state-in-effect` — unnecessary (rule only fires in useEffect) | Low |

### `hooks/useModels.ts`

| Line | Issue | Severity |
|------|-------|----------|
| 45-46 | Magic numbers without context | L-6 |
| 53-62 | Silent localStorage errors | M-6, L-10 |
| 7 | `deriveModelName` removed — now imported from `utils/model.ts` | — | ✅ Fixed |
| 100 | Effect depends on `[projectPath, existingSessionId]`, resets guard on either change | — | ✅ Fixed |
| 110-200 | Complex nested async flow — hard to maintain/debug | H-3 |
| 166-183 | RPC polling silently swallows errors | M-5 |

### `hooks/useWebSocket.ts`

| Line | Issue | Severity |
|------|-------|----------|
| 132 | Messages array capped at 500 via `MAX_MESSAGES` | — | ✅ Fixed |
| 215 | `WebSocket.OPEN` — correct usage, no issue | L-7 |
| 270-295 | `shouldDisconnectRef` race condition | M-1 |
| 286 | Exponential backoff: 2s → 4s → 8s → 16s → 30s cap | — | ✅ Fixed |
| 329-337 | `errorMessage` IIFE runs every render | M-9 |
| 340-355 | `useMemo` dependencies look correct (state IS included) | — |

### `views/FolderSelector.tsx`

| Line | Issue | Severity |
|------|-------|----------|
| 17-30 | Functions removed — now imported from `utils/model.ts` | — | ✅ Fixed |
| 105-108 | `timeStr` recreated every render | L-4 |
| 25-30 | Hardcoded provider list in `extractProvider` | L-5 |
| 255-258 | `Set<string>` in state causes excess re-renders | M-4 |
| 269-277 | Effect now depends on `activeTab`, refreshes on tab switch | — | ✅ Fixed |
| 275 | `catch` now logs + sets error state + displays banner | — | ✅ Fixed |

### `views/ModelSelector.tsx`

| Line | Issue | Severity |
|------|-------|----------|
| 31 | Calls `useModels(selectedFolder)` — this is the primary call | — |
| 73 | `useEffect` persists sessionId to context — correct design | — |

### `views/Workspace.tsx`

| Line | Issue | Severity |
|------|-------|----------|
| 1-40 | Clean layout component — no issues | — |
| 18 | `setSidebarCollapsed` / `setChatExpanded` in state — consider `useSyncExternalStore` for layout state | Low |

### `components/ChatPanel.tsx`

| Line | Issue | Severity |
|------|-------|----------|
| 17-30 | Import from `utils/model.ts` | — | ✅ Fixed |
| 193-197 | Function removed — now imported from `utils/model.ts` | — | ✅ Fixed |
| 248-250 | Split state: messages + streamingContent + toolCalls | M-7 |
| 253 | `useModels` call removed — now uses `useApp().models` | — | ✅ Fixed |
| 330-333 | `clearMessages` races with processing | M-2 |
| 358-387 | Compact handler added; unhandled responses logged | — | ✅ Fixed |
| 430 | `setModelDropdownOpen(false)` not present in handleSend — verified clean | — | ✅ Verified |
| 467-477 | `setTimeout` removed — state reset via RPC response handler | — | ✅ Fixed |
| 492-507 | Inline styles for connection indicator | L-2 |
| 512 | `displayMessages.slice().sort(...)` on every render | M-8 |

### `components/FilePreview.tsx`

| Line | Issue | Severity |
|------|-------|----------|
| 35-46 | No virtualization — all lines rendered in single `<pre>` | M-10 |
| 1-34 | Clean component — loading/error states handled well | — |

### `components/ProjectTree.tsx`

| Line | Issue | Severity |
|------|-------|----------|
| 91-107 | `AbortController` created but never passed to fetch | M-3 |
| 12 | `TreeNode` recursive component — fine for typical project sizes | — |

### `components/components.css`

| Line | Issue | Severity |
|------|-------|----------|
| (all) | Replaced hardcoded colors with CSS variables | — | ✅ Fixed |

### `views/views.css`

| Line | Issue | Severity |
|------|-------|----------|
| (all) | Replaced with CSS variables | — | ✅ Fixed |

### `views/common.css`

| Line | Issue | Severity |
|------|-------|----------|
| (all) | Replaced with CSS variables | — | ✅ Fixed |

### `index.css`

| Line | Issue | Severity |
|------|-------|----------|
| 10-18 | CSS variables well-defined — good source of truth | — |
| 1 | `@refresh reset` — Vite HMR directive, correct usage | — |
