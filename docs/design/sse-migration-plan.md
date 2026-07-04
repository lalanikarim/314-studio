# Migration Plan: WebSocket → Server-Sent Events (SSE)

> **Date:** 2026-07-04  
> **Status:** Draft  
> **Authors:** 314 Studio

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current WebSocket Architecture](#current-websocket-architecture)
3. [Why Migrate to SSE?](#why-migrate-to-sse)
4. [SSE vs WebSocket Decision Matrix](#sse-vs-websocket-decision-matrix)
5. [Migration Architecture](#migration-architecture)
6. [Backend Changes](#backend-changes)
7. [Frontend Changes](#frontend-changes)
8. [Protocol Mapping](#protocol-mapping)
9. [Edge Cases & Compensations](#edge-cases--compensations)
10. [Rollout Plan](#rollout-plan)
11. [Testing Strategy](#testing-strategy)
12. [Risk Assessment](#risk-assessment)
13. [Appendix: Files Affected](#appendix-files-affected)

---

## Executive Summary

This codebase uses WebSockets exclusively as a **bidirectional relay** between the frontend and a `pi --mode rpc` subprocess. The actual data flow is overwhelmingly **server→client** (streaming text, tool calls, events) with occasional **client→server** commands (prompts, abort, compact, UI responses).

Because the dominant direction is **server→client** and client commands are infrequent, discrete, and synchronous (REST-callable), we can replace the WebSocket channel with **Server-Sent Events (SSE)** for the outbound stream and keep REST for all outbound commands. This eliminates WebSocket upgrade complexity, simplifies deployment (no reverse-proxy WebSocket configuration), and reduces reconnection logic while preserving real-time streaming semantics.

**Key design principle:** SSE carries the outbound event stream; REST handles all client→server commands. The `pi --rpc` process remains untouched.

---

## Current WebSocket Architecture

Reference: [WebSocket Loop Analysis](../kb/websocket-loop-analysis.md) for a detailed breakdown of the bidirectional relay loop, task coordination (`_outbound`/`_inbound`), and disconnect handling.

### Data Flow

```
┌─────────┐     REST (metadata)     ┌──────────┐
│ Frontend │◄──────────────────────►│  Backend  │
└────┬────┘                          └────┬─────┘
     │                                    │
     │   WebSocket (bidirectional relay)   │
     │                                    │
     ▼                                    ▼
┌─────────────────────────────────────────────┐
│         Session Manager (per session)       │
│  ┌───────────┐    ┌─────────────────────┐   │
│  │ Stdout    │───►│ Event Buffer        │   │
│  │ Reader    │    │ (asyncio.Queue)     │   │
│  └───────────┘    └─────────┬───────────┘   │
│                              │               │
│                   ┌──────────▼──────────┐    │
│                   │   WebSocket Relay   │    │
│                   │  (bidirectional)    │    │
│                   └──────────┬──────────┘    │
│                              │               │
│  ┌───────────┐    ┌──────────▼──────────┐   │
│  │ Client    │◄───│ WS → Stdin Queue    │   │
│  │ Messages  │    │ (inbound relay)     │   │
│  └───────────┘    └─────────────────────┘   │
└─────────────────────────────────────────────┘
```

### Current Message Types (all via WebSocket)

| Direction | Type | Purpose | Frequency |
|-----------|------|---------|-----------|
| S→C | `rpc_event` (streaming text) | Real-time assistant output | **Continuous** |
| S→C | `rpc_event` (tool calls) | Tool invocation events | Continuous |
| S→C | `rpc_event` (end markers) | Stream finalization | Per turn |
| S→C | `rpc_response` (get_state) | Initial state query | Once on connect |
| S→C | `rpc_response` (get_messages) | Chat history | Once on connect |
| S→C | `rpc_response` (compact) | Compact confirmation | On demand |
| S→C | `extension_ui_request` | Interactive prompts | Rare |
| S→C | `extension_ui_response` | Auto-ack relay | On fire-and-forget |
| C→S | `prompt` | User message | Per user action |
| C→S | `abort` | Cancel current turn | On demand |
| C→S | `compact` | Compact conversation | On demand |
| C→S | `set_model` | Switch AI model | On demand |
| C→S | `set_auto_compaction` | Toggle auto-compaction | On demand |
| C→S | `get_state` | Query session state | Once on connect |
| C→S | `get_messages` | Fetch chat history | Once on connect |
| C→S | `extension_ui_response` | Respond to prompts | Rare |

**Observation:** 70-80% of messages are server→client streaming events. The remaining client commands are rare and can easily be REST calls.

---

## Why Migrate to SSE?

### Problems with Current WebSocket Approach

1. **Deployment complexity:** Requires reverse proxy (nginx, Caddy, Traefik) with WebSocket upgrade support. Vite dev proxy adds another layer of WebSocket proxying that's fragile.

2. **Reconnection complexity:** WebSocket connections can drop silently. The current code has ~50 lines of reconnection logic with exponential backoff, close-code handling, and state tracking.

3. **No native browser API for streaming:** Browsers don't have a built-in API for receiving JSON-streamed events (unlike text/event-stream which SSE provides). The codebase manually parses JSON lines from WebSocket messages.

4. **Session persistence confusion:** Sessions outlive WebSocket connections, but the WS layer tracks `ws_connected`/`ws_session_id` which adds bookkeeping that SSE doesn't need.

5. **HTTP/2 compatibility:** WebSocket is a separate protocol. HTTP/2 multiplexing doesn't apply to WebSocket frames, which can lead to suboptimal connection utilization in browser environments.

### Benefits of SSE

1. **Native browser API:** `EventSource` is built into all modern browsers with automatic reconnection, retry handling, and `last-event-id` support.

2. **HTTP-compatible:** SSE works over standard HTTP, so it passes through all reverse proxies, CDNs, and load balancers without special configuration.

3. **Simpler protocol:** Unidirectional means no ping/pong, no close codes, no bidirectional coordination. The server pushes events; the client just receives them.

4. **Automatic reconnection:** `EventSource` reconnects automatically on disconnect with exponential backoff. The browser handles the retry logic.

5. **Streaming support:** `text/event-stream` is designed for streaming. `curl` can pipe it directly. `fetch` with `ReadableStream` works natively.

6. **Fewer moving parts:** No WebSocket upgrade handshake, no `WebSocketDisconnect` exception handling, no bidirectional task coordination.

---

## SSE vs WebSocket Decision Matrix

| Criterion | WebSocket | SSE | Winner |
|-----------|-----------|-----|--------|
| Streaming S→C | ✅ Full duplex | ✅ `text/event-stream` | Tie |
| Client→Server commands | ✅ Native | ❌ Must use REST/fetch | **WebSocket** (but commands are rare) |
| Browser support | ✅ 97%+ | ✅ 98%+ (no IE) | Tie |
| Auto-reconnection | ❌ Manual | ✅ Built-in | **SSE** |
| Reverse proxy friendly | ❌ Needs upgrade | ✅ Standard HTTP | **SSE** |
| HTTP/2 multiplexing | ❌ Separate connection | ✅ Same connection | **SSE** |
| Binary data | ✅ Native | ❌ Text only | WebSocket (not needed here) |
| Message framing | ✅ Binary/text frames | ✅ Text with delimiter | Tie |
| Server push only | ✅ Bidirectional | ✅ Unidirectional | **SSE** (matches our needs) |
| Deployment simplicity | ❌ Complex | ✅ Standard HTTP | **SSE** |
| Mobile connectivity | ❌ Battery drain from persistent | ✅ Can be short-lived | **SSE** |

**Verdict:** Since client commands are infrequent and can be REST calls, SSE is the better fit for this use case.

---

## Migration Architecture

### New Architecture

```
┌─────────┐     REST (metadata + commands)    ┌──────────┐
│ Frontend │◄────────────────────────────────►│  Backend  │
└────┬────┘                                  └────┬─────┘
     │                                             │
     │   SSE (server→client events only)            │
     │                                             │
     ▼                                             ▼
┌──────────────────────────────────────────────────────┐
│              Session Manager (unchanged)             │
│  ┌───────────┐    ┌──────────────────────────┐      │
│  │ Stdout    │───►│ Event Buffer             │      │
│  │ Reader    │    │ (asyncio.Queue)          │      │
│  └───────────┘    └────────────┬─────────────┘      │
│                                │                     │
│  ┌───────────┐    ┌────────────▼─────────────┐      │
│  │ Client    │───►│ REST: POST /api/.../cmd  │      │
│  │ Commands  │    │ (prompt, abort, compact)  │      │
│  └───────────┘    └──────────────────────────┘      │
└──────────────────────────────────────────────────────┘
```

### Core Changes

| Component | Before | After |
|-----------|--------|-------|
| S→C channel | WebSocket (`/api/projects/ws`) | SSE (`/api/projects/sse?session_id=...`) |
| C→S commands | WebSocket messages | REST endpoints (`POST /api/projects/{id}/cmd`) |
| Stdout reader | Routes to event_buffer + pending_requests | Same (unchanged) |
| Event delivery | WS relay task | SSE stream endpoint |
| Reconnection | Manual with backoff | `EventSource` automatic |
| Session tracking | `ws_connected`/`ws_session_id` | `sse_connected` (simpler) |
| Extensions UI | Forwarded via WS event_buffer | Forwarded via SSE stream (same buffer) |

### What Stays the Same

- `SessionManager` core logic (launch, close, delete, model switch)
- `pi --rpc` process spawning and lifecycle
- Stdout reader and event routing
- Pending requests mechanism (for commands sent via REST)
- Extension UI handling (fire-and-forget auto-ack)
- All REST endpoints (browse, files, projects, models, close, delete)

### What Changes

- **Backend:** Replace `@router.websocket("/ws")` with `@router.get("/sse")` returning `StreamingResponse`
- **Backend:** Add REST endpoint for client commands (`POST /api/projects/{id}/cmd`)
- **Backend:** Remove `connect_ws`/`disconnect_ws` from SessionManager; replace with `subscribe_sse`/`unsubscribe_sse`
- **Backend:** Remove bidirectional relay logic (`_relay_messages`, `_inbound`, `_outbound`)
- **Frontend:** Replace `WebSocket`/`EventSource` in `useWebSocket.ts` → new `useSSE.ts` hook
- **Frontend:** Replace WS-based send methods with REST calls for client commands
- **Frontend:** Simplify reconnection logic (delegate to `EventSource`)
- **Frontend:** Update `ChatPanel.tsx` to use new hook interface

---

## Protocol Mapping

### Outbound Events (Server → Client) — SSE Stream

SSE events use JSON lines with the `data:` field. Each event has an `event:` field for classification, and an optional `id:` field for `last-event-id` retry support.

Reference: [Pi RPC Events](../rpc.md#events) for the full event type catalog.

```
event: set_model
id: 0
data: {"type":"set_model","modelId":"anthropic/claude-sonnet-4","provider":"anthropic"}

event: rpc_event
data: {"kind":"rpc_event","event":{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"Hello"}}}

event: rpc_response
data: {"type":"response","command":"get_state","data":{"model":{"id":"..."},"thinkingLevel":"medium","isStreaming":false,...}}

event: extension_ui_request
data: {"kind":"extension_ui_request","id":"uuid-1","method":"confirm","title":"Clear session?","timeout":5000}

event: extension_ui_response
data: {"kind":"extension_ui_response","id":"uuid-1","value":null,"cancelled":false}

event: session_terminated
data: {"type":"session_terminated","reason":"eof"}
```

### Inbound Commands (Client → Server) — REST

Reference: [Pi RPC Commands](../rpc.md#commands) for the full command catalog with payloads and responses.

All commands map directly from the Pi RPC protocol. The `id` field for request/response correlation is handled by the backend's `pending_requests` mechanism (`_send_command_internal` in `session_manager.py`).

```
POST /api/projects/cmd?session_id=...
Content-Type: application/json

{ "command": "prompt", "message": "Explain quantum computing" }
{ "command": "prompt", "message": "...", "streamingBehavior": "steer" }
{ "command": "abort" }
{ "command": "compact" }
{ "command": "compact", "customInstructions": "Focus on code changes" }
{ "command": "set_model", "provider": "anthropic", "modelId": "claude-sonnet-4" }
{ "command": "get_state" }
{ "command": "get_messages" }
{ "command": "extension_ui_response", "id": "uuid-1", "value": true }
{ "command": "set_auto_compaction", "enabled": true }
```

**SSE field mapping:**
- The `event:` field identifies the event category (dispatched to `addEventListener` by `EventSource`)
- The `data:` field contains the JSON payload (identical structure to WebSocket relay)
- The `id:` field carries a monotonic event counter for `last-event-id` replay on reconnect

### Inbound Commands (Client → Server) — REST

```
POST /api/projects/{session_id}/cmd
Content-Type: application/json

{
  "command": "prompt",
  "message": "Explain quantum computing"
}

---

POST /api/projects/{session_id}/cmd
Content-Type: application/json

{
  "command": "abort"
}

---

POST /api/projects/{session_id}/cmd
Content-Type: application/json

{
  "command": "compact"
}

---

POST /api/projects/{session_id}/cmd
Content-Type: application/json

{
  "command": "set_model",
  "modelId": "anthropic/claude-sonnet-4",
  "provider": "anthropic"
}

---

POST /api/projects/{session_id}/cmd
Content-Type: application/json

{
  "command": "get_state"
}

---

POST /api/projects/{session_id}/cmd
Content-Type: application/json

{
  "command": "get_messages"
}

---

POST /api/projects/{session_id}/cmd
Content-Type: application/json

{
  "command": "extension_ui_response",
  "id": "req-123",
  "value": true,
  "cancelled": false
}

---

POST /api/projects/{session_id}/cmd
Content-Type: application/json

{
  "command": "set_auto_compaction",
  "enabled": true
}
```

### Event Stream Lifecycle

```
1. Client creates session → POST /api/projects/ → gets session_id

2. Client starts SSE stream → GET /api/projects/sse?session_id=...
   Server: yields set_model event, then all events from event_buffer

3. Client sends commands → POST /api/projects/{id}/cmd
   Server: writes to stdin, resolves pending_requests, events flow to SSE stream

4. SSE stream ends (process exits, session closed)
   → EventSource auto-reconnects (with last-event-id)
   → Server detects disconnect, removes subscriber
   → If session still running, reconnects to same stream (events continue)

5. Client disconnects → Session persists, can reconnect SSE later
```

---

## Backend Changes

### 5.1 Replace WebSocket Endpoint with SSE Endpoint

**File:** `backend/app/api/chat.py`

```python
# BEFORE (WebSocket):
@router.websocket("/ws")
async def ws_endpoint(websocket: WebSocket, session_id: str = Query(...)):
    # bidirectional relay

# AFTER (SSE):
@router.get("/sse")
async def sse_endpoint(session_id: str = Query(...)):
    """Server-Sent Events stream for a session.

    Yields JSON-line SSE events from the session's event_buffer.
    Supports streaming with proper text/event-stream format.
    """
```

### 5.2 SSE Endpoint Implementation

The SSE endpoint needs to:
1. Accept a session_id query parameter
2. Validate the session exists and is running
3. Send initial `set_model` event if configured
4. Stream events from `event_buffer` using `StreamingResponse`
5. Handle client disconnect gracefully

```python
from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
import asyncio
import json
from sse_starlette.sse import EventSourceResponse

router = APIRouter()

@router.get("/sse")
async def sse_endpoint(session_id: str = Query(...)) -> StreamingResponse:
    """SSE stream for session events."""
    validate_session_id(session_id)

    # Validate session exists and is running
    ok = await session_manager.subscribe_sse(session_id)
    if not ok:
        record = session_manager.get_session(session_id)
        reason = "Session not found" if not record else f"Session is {record.status}"
        return JSONResponse(status_code=400, content={"detail": reason})

    # Send set_model event on connect
    model_id = await session_manager.get_model_id(session_id)

    async def event_generator():
        if model_id:
            yield {
                "event": "set_model",
                "data": json.dumps({
                    "type": "set_model",
                    "modelId": model_id,
                    "provider": "",
                }),
            }

        while True:
            event = await session_manager.get_next_event(session_id)
            if event is None:
                # EOF — process exited or session closed
                yield {"event": "session_terminated", "data": json.dumps({"reason": "eof"})}
                break
            yield format_sse_event(event)

    return EventSourceResponse(event_generator(), ping_interval=30)
```

### 5.3 Add REST Command Endpoint

Reference: [Pi RPC Commands](../rpc.md#commands) for full command payloads, response shapes, and edge cases (e.g., `prompt` requires `streamingBehavior` during active streaming).

```python
@router.post("/cmd")
async def cmd_endpoint(session_id: str = Query(...), command: CommandRequest):
    """Send a command to a session's pi --rpc process.

    All Pi RPC commands are supported. Responses flow back through the
    SSE event stream as rpc_response events (not returned in this REST response).
    """
    validate_session_id(session_id)

    record = session_manager.get_session(session_id)
    if not record or record.status != "running":
        raise HTTPException(status_code=400, detail="Session not running")

    # Map REST command → Pi RPC command format (see rpc.md#commands)
    # abort is fire-and-forget: write directly to stdin, return immediately
    if command.command == "abort":
        await _write_stdin_raw(session_id, '{"type": "abort"}\n')
        return {"status": "ok"}

    # All other commands go through _send_command_internal which:
    # 1. Generates req_id and stores a Future in pending_requests
    # 2. Writes JSONL to stdin
    # 3. Waits for the matching response Future to resolve
    # See session_manager.py:_send_command_internal for details.
    rpc_command = _build_rpc_command(command)
    response = await session_manager.send_command(session_id, rpc_command)
    return {"status": "ok", "response": response}


def _build_rpc_command(command: CommandRequest) -> dict:
    """Convert a REST command envelope to Pi RPC command format.

    Reference: rpc.md#commands for each command's expected shape.
    """
    cmd = command.command
    if cmd == "prompt":
        # Reference: rpc.md — during streaming, prompt requires `streamingBehavior`
        # ("steer" or "followUp") or it returns an error.
        payload: dict = {"type": "prompt", "message": command.message}
        if command.streaming_behavior:
            payload["streamingBehavior"] = command.streaming_behavior  # "steer" | "followUp"
        if command.images:
            payload["images"] = command.images
    elif cmd == "steer":
        payload = {"type": "steer", "message": command.message}
    elif cmd == "follow_up":
        payload = {"type": "follow_up", "message": command.message}
    elif cmd == "compact":
        payload = {"type": "compact"}
        if command.custom_instructions:
            payload["customInstructions"] = command.custom_instructions
    elif cmd == "set_model":
        payload = {
            "type": "set_model",
            "modelId": command.modelId,
            "provider": command.provider or "",
        }
    elif cmd == "cycle_model":
        payload = {"type": "cycle_model"}
    elif cmd == "get_available_models":
        payload = {"type": "get_available_models"}
    elif cmd == "get_state":
        payload = {"type": "get_state"}
    elif cmd == "get_messages":
        payload = {"type": "get_messages"}
    elif cmd == "get_session_stats":
        payload = {"type": "get_session_stats"}
    elif cmd == "get_commands":
        payload = {"type": "get_commands"}
    elif cmd == "extension_ui_response":
        payload = {
            "type": "extension_ui_response",
            "id": command.id,
            "value": command.value,
            "cancelled": command.cancelled or False,
        }
    elif cmd == "set_auto_compaction":
        payload = {"type": "set_auto_compaction", "enabled": command.enabled}
    elif cmd == "set_thinking_level":
        payload = {"type": "set_thinking_level", "level": command.level}
    elif cmd == "cycle_thinking_level":
        payload = {"type": "cycle_thinking_level"}
    elif cmd == "set_steering_mode":
        payload = {"type": "set_steering_mode", "mode": command.mode}
    elif cmd == "set_follow_up_mode":
        payload = {"type": "set_follow_up_mode", "mode": command.mode}
    elif cmd == "bash":
        payload = {"type": "bash", "command": command.command_text}
    elif cmd == "abort_bash":
        payload = {"type": "abort_bash"}
    elif cmd == "get_entries":
        payload = {"type": "get_entries"}
        if command.since:
            payload["since"] = command.since
    elif cmd == "get_tree":
        payload = {"type": "get_tree"}
    elif cmd == "get_last_assistant_text":
        payload = {"type": "get_last_assistant_text"}
    elif cmd == "set_session_name":
        payload = {"type": "set_session_name", "name": command.name}
    elif cmd == "fork":
        payload = {"type": "fork", "entryId": command.entry_id}
    elif cmd == "clone":
        payload = {"type": "clone"}
    elif cmd == "get_fork_messages":
        payload = {"type": "get_fork_messages"}
    elif cmd == "switch_session":
        payload = {"type": "switch_session", "sessionPath": command.session_path}
    elif cmd == "new_session":
        payload = {"type": "new_session"}
    elif cmd == "export_html":
        payload = {"type": "export_html"}
        if command.output_path:
            payload["outputPath"] = command.output_path
    else:
        raise HTTPException(status_code=400, detail=f"Unknown command: {cmd}")

    return payload
```

### 5.4 SessionManager Changes

**File:** `backend/app/session_manager.py`

Replace WebSocket-specific methods:

```python
# REMOVE:
async def connect_ws(self, session_id: str, websocket_id: str) -> bool
async def disconnect_ws(self, session_id: str, websocket_id: str) -> None

# ADD:
async def subscribe_sse(self, session_id: str) -> bool:
    """Mark session as having an active SSE subscriber.
    Returns False if session not found or not running."""
    async with self._lock:
        record = self._sessions.get(session_id)
        if not record or record.status != "running":
            return False
        record.sse_connected = True
        return True

def unsubscribe_sse(self, session_id: str) -> None:
    """Clear SSE tracking."""
    async with self._lock:
        record = self._sessions.get(session_id)
        if record:
            record.sse_connected = False

async def send_command(self, session_id: str, payload: dict, timeout: float | None = None) -> dict:
    """Send a command and wait for the matching response.
    This is the new way to send commands (replaces WS relay)."""
    record = self._sessions.get(session_id)
    if not record or record.status != "running":
        raise RuntimeError(f"Session {session_id} not running")

    # Use the existing _send_command_internal mechanism
    return await self._send_command_internal(record, payload, timeout=timeout)
```

Update `SessionRecord` schema:

```python
# REMOVE:
ws_session_id: Optional[str] = None
ws_connected: bool = False

# ADD:
sse_connected: bool = False
```

### 5.5 Main.py Router Update

**File:** `backend/app/main.py`

```python
# BEFORE:
chat_router  # prefix="/api/projects"  → /api/projects/ws

# AFTER:
# Same router import, but the endpoint changes from /ws to /sse
# And a new /cmd endpoint is added to the same router
chat_router  # prefix="/api/projects"  → /api/projects/sse + /api/projects/cmd
```

### 5.6 Dependencies

Add `sse-starlette` to backend dependencies:

```toml
# backend/pyproject.toml
dependencies = [
    ...
    "sse-starlette>=2.0.0",
    ...
]
```

---

## Frontend Changes

### 6.1 Replace `useWebSocket` Hook with `useSSE` Hook

**File:** `frontend/src/hooks/useWebSocket.ts` → `frontend/src/hooks/useSSE.ts`

The new hook wraps `EventSource` for the SSE stream and exposes REST call helpers for commands.

```typescript
// useSSE.ts — conceptual outline

export function useSSE(
  session_id: string | null,
  modelRef: MutableRefObject<Model | null>,
): UseSSEReturn {
  const sourceRef = useRef<EventSource | null>(null);
  const [messages, setMessages] = useState<InboundMessage[]>([]);
  const [pendingUiRequest, setPendingUiRequest] = useState<... | null>(null);
  const [state, setState] = useState<"connecting" | "connected" | "disconnected" | "error">("disconnected");

  useEffect(() => {
    if (!session_id) return;

    const source = new EventSource(`/api/projects/sse?session_id=${encodeURIComponent(session_id)}`);
    sourceRef.current = source;

    source.addEventListener("open", () => setState("connected"));
    source.addEventListener("error", () => setState("error"));

    // All event types come through onmessage
    source.onmessage = (event) => {
      const data = JSON.parse(event.data);
      // Route: rpc_event, rpc_response, extension_ui_request, etc.
    };

    // EventSource fires different events based on the event: field
    source.addEventListener("rpc_event", (e) => { /* ... */ });
    source.addEventListener("rpc_response", (e) => { /* ... */ });
    source.addEventListener("extension_ui_request", (e) => { /* ... */ });
    source.addEventListener("stream_end", (e) => { /* ... */ });
    source.addEventListener("session_terminated", (e) => { /* ... */ });

    return () => {
      source.close();
    };
  }, [session_id]);

  // Command methods — all REST-based
  const prompt = useCallback((message: string) => {
    fetch(`/api/projects/cmd?session_id=${session_id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "prompt", message }),
    });
  }, [session_id]);

  const abort = useCallback(() => {
    fetch(`/api/projects/cmd?session_id=${session_id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "abort" }),
    });
  }, [session_id]);

  // ... compact, setAutoCompaction, respondToUi, etc.

  return { state, messages, pendingUiRequest, prompt, abort, compact, ... };
}
```

### 6.2 SSE Hook Implementation Details

#### EventSource Event Types

The SSE endpoint emits named events. `EventSource` dispatches each to a matching `addEventListener` handler:

```
EventSource events → Handler methods
─────────────────────────────────────
"set_model"        → handleSetModel()     // Initial model config
"rpc_event"        → handleRpcEvent()     // Streaming text, tool calls
"rpc_response"     → handleRpcResponse()  // Command responses
"extension_ui_request" → handleExtensionUi()  // Interactive prompts
"extension_ui_response" → handleExtensionUiAck() // Auto-ack relay
"stream_end"       → handleStreamEnd()    // Stream finalizer
"session_terminated" → handleSessionTerminated()  // Session gone
```

#### Auto-Reconnection

`EventSource` automatically reconnects on disconnect with exponential backoff (1-5 seconds by default). This is a **major simplification** over the current manual reconnection logic:

| Concern | WebSocket (current) | SSE (new) |
|---------|-------------------|-----------|
| Auto-reconnect | ❌ Manual implementation (~50 lines) | ✅ Built into `EventSource` |
| Backoff | Manual (2s → 30s) | Automatic (exponential) |
| `last-event-id` | ❌ Not implemented | ✅ Automatic retry from last event |
| Reconnection count | Manual tracking | `source.readyState` + event count |
| Disconnect detection | `onclose` + close code parsing | `onerror` (covers all disconnects) |

#### Message History Management

Same approach as current code — maintain a buffer of recent messages (max 500) to prevent unbounded growth during long sessions.

### 6.3 ChatPanel Updates

**File:** `frontend/src/components/ChatPanel.tsx`

The `ChatPanel` component needs minimal changes:

1. **Hook import change:** `useWebSocket` → `useSSE`
2. **Send method rename:** `ws.send(text)` → `ws.prompt(text)` (or keep `ws.send` for consistency)
3. **Abort method:** Already exists as `ws.abort()` — same name
4. **Compact method:** Already exists as `ws.compact()` — same name
5. **Connection state:** `ws.state` still works (same values)
6. **Reconnect:** No longer needed — `EventSource` auto-reconnects
7. **Connection indicator:** Keep, but simplify error messages

```typescript
// BEFORE:
const ws = useWebSocket(selectedFolder, modelRef, selectedSessionId);
ws.send(trimmed);  // Send prompt
ws.abort();         // Abort current turn
ws.compact();       // Compact conversation

// AFTER:
const sse = useSSE(selectedSessionId, modelRef);
sse.prompt(trimmed);   // Send prompt (REST call)
sse.abort();            // Abort current turn (REST call)
sse.compact();          // Compact conversation (REST call)
// No ws.reconnect() needed — EventSource handles it
```

### 6.4 Simplified Connection State

```typescript
// BEFORE (4 states + closeCode/closeReason):
type ConnectionState = "connecting" | "connected" | "disconnected" | "error"
closeCode: number | null
closeReason: string | null

// AFTER (3 states, no close codes):
type ConnectionState = "connecting" | "connected" | "disconnected"
// EventSource handles all disconnect/reconnect automatically
// No close codes to parse
```

---

## Edge Cases & Compensations

### E.1 Client→Server Command Latency

**Concern:** REST requests have higher latency than WebSocket messages (additional HTTP round trip).

**Mitigation:** Client commands are rare (prompt, abort, compact ≈ 1-5 times per minute during active use). The additional ~50ms latency of a REST call is imperceptible. For the `prompt` command specifically, the response comes back via the SSE stream (subsequent events), so the user sees the assistant start typing immediately.

### E.2 Extension UI Interactive Prompts

**Concern:** Extension UI prompts (confirm, input, select) need to be acknowledged. With WebSocket, the response was sent back through the same connection.

**Mitigation:** The SSE stream delivers the `extension_ui_request` event. The frontend shows a UI prompt. When the user responds, the frontend makes a REST call `POST /api/projects/{id}/cmd` with `{"command": "extension_ui_response", ...}`. This adds one extra round-trip (~50ms) but is functionally equivalent.

Reference: [Pi RPC Extension UI Protocol](../rpc.md#extension-ui-protocol) for:
- **Dialog methods** (`select`, `confirm`, `input`, `editor`): Block until `extension_ui_response` with matching `id` is received on stdin
- **Fire-and-forget methods** (`notify`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text`): Auto-ack from backend; no user response needed
- **Timeout handling**: Dialog methods with a `timeout` field auto-resolve with default value if client doesn't respond in time — no client-side timeout tracking needed
- **Response shapes**: `select`/`input`/`editor` return `value`; `confirm` returns `confirmed: true/false`

### E.3 Concurrent SSE Streams

**Concern:** Multiple tabs/browser sessions connecting to the same `session_id`.

**Current behavior (WebSocket):** SessionManager tracks `ws_session_id` to identify which WS connection is active. Only one WS can be "connected" per session.

**SSE behavior:** Each `GET /api/projects/sse` creates a new subscriber. The `event_buffer` is a queue — events flow to whichever subscriber reads first. With multiple SSE connections, events will be **distributed** across connections (first subscriber gets the event, second subscriber waits for the next one). This is a problem.

**Solution options:**

1. **Single subscriber per session (recommended):** Only allow one SSE connection per session at a time. If a new connection arrives while one is active, close the old one (or reject the new one).

```python
async def subscribe_sse(self, session_id: str) -> bool:
    async with self._lock:
        record = self._sessions.get(session_id)
        if not record or record.status != "running":
            return False
        # Close existing SSE connection if any
        if record.sse_connected:
            logger.info("Closing existing SSE connection for session %s", session_id)
            # Signal existing subscriber to stop (set a cancel flag)
            record.sse_cancelled = True
        record.sse_connected = True
        record.sse_cancelled = False
        return True
```

2. **Fan-out via broadcast queue:** Replace the single `event_buffer` queue with a broadcast mechanism that delivers to all subscribers.

**Recommendation:** Option 1 (single subscriber) is simpler and matches the current single-WS behavior. The `EventSource` auto-reconnect handles tab refresh / network blips.

### E.4 SSE Stream Timeout / Keep-Alive

**Concern:** Proxies and browsers may close idle SSE connections.

**Mitigation:** Use `sse-starlette`'s `ping_interval=30` (or lower) to send periodic keepalive comments (`:`) in the SSE stream. This prevents proxy timeout.

**Note on stream duration:** The SSE stream runs for the lifetime of the session. Per [rpc-session-shutdown.md](../kb/rpc-session-shutdown.md), session termination occurs via `close` (compact → abort → terminate) or `delete` (abort → terminate). The SSE endpoint must detect session state transitions and terminate the stream gracefully.

**Note on framing:** Per [rpc.md](../rpc.md#framing), Pi uses strict JSONL with LF (`\n`) as the only record delimiter. The backend stdout reader (`_stdout_reader_loop` in `session_manager.py`) already handles this correctly. When relaying events to SSE, each JSON line becomes one SSE event with `\n\n` as the event boundary.

### E.5 `set_model` on Connect

**Concern:** Currently, `set_model` is sent from the backend when the WS connects. With SSE, we need to send it as an initial event in the stream.

Reference: [Session Lifecycle — WebSocket Connection](../kb/test-rpc-protocol.md#3-websocket-connection) documents the current behavior: "On connect, backend automatically sends `set_model` with the session's configured `modelId`". This behavior is preserved — the SSE endpoint yields the `set_model` event as the very first event before entering the event stream loop.

**Solution:** Send a `set_model` SSE event as the very first event in the stream, before the main event loop. The frontend's `useSSE` hook handles this via `addEventListener("set_model", ...)`.

### E.6 `get_state` / `get_messages` Responses

**Concern:** These commands currently return responses via the WS relay. With SSE, the responses will flow through the SSE stream as `rpc_response` events.

**Solution:** The frontend sends these as REST commands (`POST /api/projects/{id}/cmd`). The response comes back via the SSE stream as an `rpc_response` event. This is a slight delay (REST → stdin → process → stdout → event_buffer → SSE) but is acceptable.

### E.7 `last-event-id` Retry

**Concern:** When `EventSource` reconnects, it sends `Last-Event-ID` to request missed events.

Reference: [Session Lifecycle](../kb/test-rpc-protocol.md#session-lifecycle) documents that sessions persist independently of client connections. This means a reconnect can happen minutes or hours after a disconnect, so the replay window must be large enough to cover the gap.

The `event_buffer` in `session_manager.py` is an `asyncio.Queue` — it only holds events currently being processed by a subscriber. For `last-event-id` replay, we need a separate event log.

**Current behavior:** SessionManager has no concept of event IDs or replay.

**Solution:** Each event in the SSE stream includes an `id:` field with a monotonic counter or event ID. The backend tracks the last event ID delivered per session and, on reconnect, replays from the last known event ID (within a reasonable window, e.g., last 30 seconds of events).

```python
# In session_manager.py
record.last_sse_event_id: int = 0
record.sse_event_log: deque[tuple[int, dict]] = deque(maxlen=500)  # sliding window

# In SSE endpoint
current_id = record.last_sse_event_id + 1
record.last_sse_event_id = current_id
record.sse_event_log.append((current_id, formatted_event))
yield {"id": str(current_id), "event": "rpc_event", "data": json.dumps(event)}
```

On reconnect, the SSE endpoint checks `Last-Event-ID` header and replays events from that point forward (if within the window).

### E.8 Session Close During Active SSE Stream

**Concern:** If a session is closed while the SSE stream is active, the stream should terminate gracefully.

Reference: [Session Shutdown](../kb/rpc-session-shutdown.md) and [Session Lifecycle — Close/Delete](../kb/test-rpc-protocol.md#5-session-close-compact--abort--terminate) document the shutdown sequence:
- `close`: compact (300s timeout) → abort → terminate process
- `delete`: abort → terminate process (no compact)

**Solution:** The `_stdout_reader_loop` in `session_manager.py` pushes `None` to the `event_buffer` when the process exits (EOF). The SSE endpoint detects this, yields a `session_terminated` event, then breaks. The `EventSource` receives the disconnect and auto-reconnects. The server detects the client disconnect and calls `unsubscribe_sse`.

The session state transitions (`running` → `closing` → `stopped`) are managed by the existing `close_session`/`delete_session` methods — the SSE endpoint only needs to observe `record.status` changes.

### E.9 Vite Dev Proxy

**Concern:** Vite's dev proxy needs to handle SSE correctly.

**Current setup:** Vite proxies `/api` to `localhost:8000` with `ws: true`.

**SSE compatibility:** SSE works over standard HTTP, so no `ws: true` is needed. Vite's default proxy handles `text/event-stream` responses correctly. Remove `ws: true` from the Vite config since it's no longer needed.

**Test harness note:** The integration test harness (`tests/test_utils.py`) currently has `ws_connect`, `ws_send`, `ws_receive`, `ws_collect` helpers. These need SSE equivalents (`sse_connect`, `read_sse_stream`) as shown in the Testing Strategy section.

---

## Rollout Plan

### Phase 1: Backend Preparation (1 day)

1. Add `sse-starlette` dependency
2. Create `subscribe_sse`/`unsubscribe_sse` in SessionManager
3. Replace `connect_ws`/`disconnect_ws`
4. Update `SessionRecord` schema (replace ws fields with sse fields)
5. Create SSE endpoint (`GET /api/projects/sse`)
6. Create command endpoint (`POST /api/projects/cmd`)
7. Keep old WS endpoint as a no-op stub (for testing, can be removed later)

### Phase 2: Frontend Migration (1 day)

1. Create `useSSE.ts` hook (parallel to `useWebSocket.ts`)
2. Wire it up in `ChatPanel.tsx`
3. Test with running backend
4. Remove old `useWebSocket.ts`

### Phase 3: Integration & Testing (1 day)

1. Run all 8 integration test flows against new SSE implementation
2. Fix any test failures
3. Update test documentation
4. Performance testing (streaming quality, latency)

### Phase 4: Cleanup (0.5 days)

1. Remove old WebSocket endpoint from `chat.py`
2. Remove `connect_ws`/`disconnect_ws` from `session_manager.py`
3. Remove `ws_session_id`/`ws_connected` from `SessionRecord`
4. Update Vite config (remove `ws: true`)
5. Update API documentation
6. Update `AGENTS.md` architecture docs

**Total estimated effort:** 3.5 days

---

## Testing Strategy

Reference: [Test RPC Protocol](../kb/test-rpc-protocol.md) for the complete test coverage matrix, shared test utilities, and example test flows.

### Integration Tests

All existing 8 flows (55 tests) should pass with the SSE migration. Key test changes:

| Test Flow | Changes Needed |
|-----------|---------------|
| Flow 1: Browse & Chat | Update WS connection → SSE stream + REST commands |
| Flow 2: File Browse | No change (REST only) |
| Flow 3: Multi-Session | Update to SSE; verify single-subscriber-per-session |
| Flow 4: Model Switch | Update: model switch now REST + SSE event |
| Flow 5: Close/Delete | No change (REST only) |
| Flow 6: Error Handling | Update WS close codes → SSE error handling |
| Flow 7: Shutdown Cleanup | No change (REST only) |
| Flow 8: Model Operations | Update to SSE; verify `set_model` event arrives |

### Manual Testing Checklist

- [ ] Create session → SSE stream starts → streaming text appears
- [ ] Send prompt → REST call → SSE stream receives response
- [ ] Tool calls appear correctly in chat
- [ ] Streaming text renders in real-time
- [ ] End-of-turn marker finalizes message
- [ ] Chat history loads via `get_messages` REST + SSE response
- [ ] Model switch via REST → `set_model` SSE event → UI updates
- [ ] Compact via REST → `compact` response via SSE
- [ ] Abort via REST → streaming stops
- [ ] Extension UI prompts appear and can be responded to
- [ ] Tab refresh → `EventSource` auto-reconnects → continues streaming
- [ ] Network blip → `EventSource` auto-reconnects
- [ ] Session close → SSE stream terminates → UI shows disconnected
- [ ] Multiple tabs → only one SSE connection per session

### Test Infrastructure Changes

The integration test harness will need to:
1. Start the SSE stream as a background fetch (not a WebSocket connection)
2. Parse `text/event-stream` responses (events separated by `\n\n`, fields prefixed)
3. Send commands via `POST /api/projects/cmd` instead of sending through the stream
4. Handle `EventSource` auto-reconnection transparently

```python
# Example: SSE event parser for tests (replaces ws_connect/ws_collect)
# Reference: test_utils.py — currently has ws_connect, ws_send, ws_receive, ws_collect

async def sse_connect(session_id: str) -> httpx.AsyncClient:
    """Open SSE stream and return the streaming client."""
    url = f"{API_BASE}/api/projects/sse?session_id={session_id}"
    client = httpx.AsyncClient(timeout=TIMEOUT)
    response = await client.stream("GET", url)
    return client, response


async def read_sse_events(
    response: httpx.Response,
    max_events: int = 50,
    total_timeout: float = 30.0,
) -> list[dict]:
    """Read SSE events from a streaming response.

    Reference: test-rpc-protocol.md — the current ws_collect helper
    collects events from a WebSocket. This replaces it for SSE.

    SSE wire format (per text/event-stream spec):
      - Fields: event:, id:, data:, :
      - Event boundary: \n\n (double newline)
      - Comment lines start with : and are ignored
    """
    events = []
    current_event = ""
    current_type = None
    current_id = None

    async for line in response.aiter_lines():
        if line == "":
            # Empty line = event boundary
            if current_event:
                events.append({
                    "type": current_type,
                    "id": current_id,
                    "data": json.loads(current_event),
                })
                current_event = ""
                current_type = None
                current_id = None
            if len(events) >= max_events:
                break
            continue

        if line.startswith("event:"):
            current_type = line[6:].strip()
        elif line.startswith("id:"):
            current_id = line[3:].strip()
        elif line.startswith("data:"):
            current_event += line[5:].strip() + "\n"
        elif line.startswith(":"):
            # Comment / keepalive (ping_interval) — ignore
            continue

    return events


async def send_cmd(session_id: str, command: dict) -> dict:
    """Send a REST command to the session (replaces ws_send)."""
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.post(
            f"{API_BASE}/api/projects/cmd?session_id={session_id}",
            json=command,
        )
        return resp.json()
```

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `sse-starlette` incompatibility with FastAPI/Python 3.13 | Low | High | Test early; fallback to manual `StreamingResponse` with `text/event-stream` |
| Vite dev proxy doesn't handle SSE correctly | Medium | Medium | Vite handles `text/event-stream` natively; test in dev |
| `EventSource` doesn't send `Content-Type: application/json` for commands | N/A | None | Commands use `POST` with explicit `Content-Type` |
| Multiple SSE connections per session (event distribution) | High | Medium | Enforce single subscriber per session in SessionManager |
| `last-event-id` replay window too small | Medium | Low | Use 500-event sliding window (~30s of streaming) |
| Proxy/load balancer closes SSE connections | Medium | Low | `ping_interval` keepalive; `EventSource` auto-reconnect |
| Migration breaks existing integration tests | High | Medium | All tests updated in Phase 3 |
| `pi --rpc` protocol changes | N/A | Low | Migration doesn't touch `pi --rpc` protocol |

---

## Appendix: Files Affected

### Backend (modify)

| File | Change |
|------|--------|
| `backend/app/api/chat.py` | Replace WS endpoint with SSE + cmd endpoints |
| `backend/app/session_manager.py` | Replace WS tracking with SSE tracking; add `send_command` |
| `backend/app/schemas/session.py` | Replace `ws_session_id`/`ws_connected` with `sse_connected` |
| `backend/app/main.py` | No changes (router prefix same) |
| `backend/pyproject.toml` | Add `sse-starlette` dependency |

### Backend (remove)

| File | Change |
|------|--------|
| `backend/app/api/chat.py` | Remove `WebSocket`, `WebSocketDisconnect` imports; remove `_relay_messages`, `_write_stdin`, `_write_stdin_raw` functions |

### Frontend (modify)

| File | Change |
|------|--------|
| `frontend/src/hooks/useWebSocket.ts` | **Rename** to `useSSE.ts`; rewrite to use `EventSource` + REST |
| `frontend/src/components/ChatPanel.tsx` | Import `useSSE`; update send/abort/compact calls |
| `frontend/src/services/api.ts` | Add `sendSessionCommand` helper |

### Frontend (create)

| File | Change |
|------|--------|
| `frontend/src/hooks/useSSE.ts` | New hook replacing `useWebSocket.ts` |

### Frontend (remove)

| File | Change |
|------|--------|
| `frontend/src/hooks/useWebSocket.ts` | Delete (replaced by `useSSE.ts`) |

### Config (modify)

| File | Change |
|------|--------|
| `frontend/vite.config.ts` | Remove `ws: true` from proxy config |

### Tests (modify)

| File | Change |
|------|--------|
| `tests/test_flow1_browse_chat.py` | Replace WS with SSE stream parsing |
| `tests/test_flow3_multi_session.py` | Replace WS with SSE |
| `tests/test_flow4_model_switch.py` | Update model switch verification |
| `tests/test_flow8_model_operations.py` | Update SSE-based model operations |
| `tests/test_utils.py` | Add SSE stream reader helper |
| `tests/conftest.py` | No changes expected |

### Docs (modify)

| File | Change |
|------|--------|
| `docs/design/sse-migration-plan.md` | This file |
| `AGENTS.md` | Update architecture section (WebSocket → SSE) |
| `README.backend.md` | Update API docs |
| `README.frontend.md` | Update hook documentation |

---

## Appendix: SSE Wire Format Reference

### SSE Event Structure

```
event: rpc_event
id: 42
data: {"kind":"rpc_event","event":{"assistantMessageEvent":{"type":"text_delta","delta":"Hello"}}}

event: rpc_response
id: 43
data: {"type":"response","command":"get_state","data":{"model":{"id":"...","provider":"..."}}}

event: session_terminated
id: 44
data: {"reason":"close"}
```

### SSE Field Rules

- `event:` — Event type name (dispatched to `addEventListener`)
- `id:` — Event ID (sent as `Last-Event-ID` on reconnect)
- `data:` — Event payload (JSON string)
- `:` — Comment (keepalive, ignored by client)
- Lines are separated by `\n`
- Events are separated by `\n\n` (double newline)

### `text/event-stream` Response Headers

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no          # Disable nginx buffering
Transfer-Encoding: chunked
```

---

## References

### Official Pi Documentation

| Document | Path | Contents |
|----------|------|----------|
| **RPC Mode (canonical)** | `@earendil-works/pi-coding-agent/docs/rpc.md` | Full command/event catalog, extension UI protocol, data types, Python/Node.js examples |
| Compaction | `@earendil-works/pi-coding-agent/docs/compaction.md` | Compaction behavior and settings |
| Models | `@earendil-works/pi-coding-agent/docs/models.md` | Model configuration |
| Sessions | `@earendil-works/pi-coding-agent/docs/sessions.md` | Session persistence and management |
| Providers | `@earendil-works/pi-coding-agent/docs/providers.md` | Provider configuration |

### Project Knowledge Base

| Document | Path | Contents |
|----------|------|----------|
| **Test RPC Protocol** | `docs/kb/test-rpc-protocol.md` | Test coverage matrix, session lifecycle, message routing, extension UI handling, test utilities |
| **RPC Session Shutdown** | `docs/kb/rpc-session-shutdown.md` | Session shutdown behavior, termination sequence, cleanup |
| **WebSocket Loop Analysis** | `docs/kb/websocket-loop-analysis.md` | Detailed analysis of the bidirectional relay loop, task coordination, disconnect handling |
| **WS Harness KB** | `docs/kb/ws-harness-knowledge-base.md` | Integration test harness patterns, shared constants, helper functions |
| Backend Code Review | `docs/kb/backend-code-review.md` | Backend architecture review notes |
| Frontend Code Review | `docs/kb/frontend-code-review.md` | Frontend architecture review notes |

### Design Documents

| Document | Path | Contents |
|----------|------|----------|
| Session Manager Plan | `docs/design/session-manager-plan.md` | Original session manager design, spawn/lifecycle decisions |
| Integration Test Plan | `docs/design/integration-test-plan.md` | Test flow definitions and expectations |

### Key Code References

| Component | File | Role |
|-----------|------|------|
| WS relay endpoint | `backend/app/api/chat.py` | Current bidirectional relay (to be replaced) |
| Session manager | `backend/app/session_manager.py` | Process lifecycle, stdout reader, event routing, pending_requests |
| Session schema | `backend/app/schemas/session.py` | SessionRecord with ws-related fields |
| SSE hook | `frontend/src/hooks/useWebSocket.ts` | Current WS hook (to be replaced by `useSSE.ts`) |
| Chat panel | `frontend/src/components/ChatPanel.tsx` | Message processing, streaming state, UI rendering |
| API client | `frontend/src/services/api.ts` | REST client (commands will be added here) |

---

## Appendix: Comparison of Current vs New Flow

### User Sends a Message

**Current (WebSocket):**
```
User types "hello" → ws.send("hello")
  → Backend WS receives "hello"
  → _relay_messages wraps as {"type":"prompt","message":"hello"}
  → Writes to stdin
  → Pi responds via stdout
  → stdout reader queues in event_buffer
  → _outbound reads from event_buffer
  → Sends {"kind":"rpc_event","event":{...}} via WS
  → Frontend receives, parses, renders
```

**New (SSE + REST):**
```
User types "hello" → sse.prompt("hello")
  → POST /api/projects/{id}/cmd {"command":"prompt","message":"hello"}
  → Backend writes {"type":"prompt","message":"hello"} to stdin
  → Pi responds via stdout
  → stdout reader queues in event_buffer
  → SSE endpoint yields event from event_buffer
  → Frontend EventSource receives SSE event
  → Frontend parses, renders
```

**Latency difference:** ~50ms additional (one HTTP request instead of one WS message frame). Not perceptible to users.

### Session Connect

**Current (WebSocket):**
```
Frontend creates WebSocket → handshake → accept → send set_model → start relay
Backend validates session → mark ws_connected → accept WS → send set_model event
```

**New (SSE):**
```
Frontend creates EventSource → HTTP GET → start streaming
Backend validates session → mark sse_connected → yield set_model event first → continue streaming
```

**Simplification:** No handshake, no `WebSocketDisconnect` handling, no bidirectional task coordination. `EventSource` handles the entire lifecycle.

### Message Routing (Backend Internal)

Reference: [Test RPC Protocol — WebSocket Message Routing](../kb/test-rpc-protocol.md#websocket-message-routing)

**Current routing (WebSocket relay):**
```
Pi stdout → _stdout_reader_loop → parse JSON → route by type:
  ├─ {"type":"response","id":"xxx"} → resolves pending_requests Future
  ├─ {"type":"extension_ui_request"}
  │   ├─ method in _FIRE_AND_FORGET_METHODS → auto-ack via stdin
  │   ├─ method in _INTERACTIVE_METHODS → queue in event_buffer
  │   └─ unknown method → auto-ack via stdin
  └─ everything else → queue in event_buffer

event_buffer → _outbound relay task → WebSocket.send()
```

**New routing (SSE endpoint):**
```
Pi stdout → _stdout_reader_loop → parse JSON → route by type:
  ├─ {"type":"response","id":"xxx"} → resolves pending_requests Future (unchanged)
  ├─ {"type":"extension_ui_request"}
  │   ├─ method in _FIRE_AND_FORGET_METHODS → auto-ack via stdin (unchanged)
  │   ├─ method in _INTERACTIVE_METHODS → queue in event_buffer (unchanged)
  │   └─ unknown method → auto-ack via stdin (unchanged)
  └─ everything else → queue in event_buffer (unchanged)

event_buffer → SSE endpoint yields → EventSource.onmessage()
```

The `_stdout_reader_loop` routing logic is **unchanged** — only the delivery mechanism (WS send → SSE yield) differs.
