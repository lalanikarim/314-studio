# Session Manager — Implementation Plan

> **STATUS: Fully implemented as of commit 83bd05a.** All phases complete.

> One `pi --mode rpc` process per **session**. Sessions persist independently of WebSocket connections. Users create multiple sessions per project, choose the model at creation, and explicitly close/delete when done.

---

## Architecture

### Core Principles

1. **One RPC process per session** — each session gets its own `pi --mode rpc`
2. **Session outlives WebSocket** — disconnect/reconnect doesn't affect the process
3. **Explicit close/delete** — `close` = compact + abort + terminate; `delete` = abort + terminate (no compact)
4. **Model selection at creation** — user picks model when creating a new session
5. **One WS per client** — multiple clients can connect to the same session (reconnect); latest WS wins for event relay

### Session Lifecycle

```
                    creating ──RPC ready──→ running
                       │                      │
                       │                      ├── WS disconnect → running (ws disconnected)
                       │                      │         │
                       │                      │         └── WS reconnect → running (ws reconnected)
                       │                      │
                       │                      ├── client sends message → forwarded to process stdin
                       │                      └── process sends events → event buffer → WS relay
                       │
   close(compact) ──→ stopped (process terminated, record removed)
   delete(abort)  ──→ stopped (process terminated, record removed)
```

### Process Diagram

```
Project: ~/Projects/ai-chatbot

Instance A (pi --rpc, PID 1234) ── session_1 ── ws_client_1
Instance B (pi --rpc, PID 5678) ── session_2 ── ws_client_2
Instance C (pi --rpc, PID 9012) ── session_3 ── ws_client_3 (reconnecting)
```

### Data Model

```python
SessionRecord:
    session_id: str          # "sess_<hex>"
    project_path: str        # absolute path to project
    name: str                # "My Session"
    model_id: str            # "claude-sonnet-4"
    status: str              # "running" | "closing" | "stopped"
    pid: int | None
    process: asyncio.Process | None
    stdin: StreamWriter | None
    stdout: StreamReader | None
    created_at: datetime
    ws_session_id: str | None    # FastAPI WebSocket ID (last connected)
    ws_connected: bool
    pending_requests: dict       # request_uuid → asyncio.Future
    event_buffer: asyncio.Queue  # events queued for WS relay
    stdout_task: asyncio.Task | None

SessionManager (singleton):
    sessions: dict[str, SessionRecord]
    lock: asyncio.Lock
    initialized: bool
```

---

## REST API

### Project Endpoints

| Method | Endpoint | Query Params | Body | Description |
|--------|----------|-------------|------|-------------|
| `GET` | `/api/projects` | — | — | List project folder names under `~/Projects` |
| `GET` | `/api/projects/info` | `project_path` | — | Project details + all sessions |
| `POST` | `/api/projects/` | `project_path` | `{model_id, name?}` | Create new session |

### Session Endpoints

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| `POST` | `/api/sessions/{id}/close` | — | Compact → abort → terminate → remove |
| `POST` | `/api/sessions/{id}/delete` | — | Abort → terminate → remove (no compact) |
| `POST` | `/api/sessions/{id}/model` | `{model_id, provider?}` | Switch model on running session |

### WebSocket

| Endpoint | Description |
|----------|-------------|
| `WS /api/projects/ws?session_id=...` | One WS per client per session. Bidirectional JSON over the session's RPC process. |

### Response Types

```python
# SessionRecord (full)
{
    "session_id": "sess_abc123",
    "project_path": "/Users/karim/Projects/ai-chatbot",
    "name": "My Session",
    "model_id": "claude-sonnet-4",
    "status": "running",
    "pid": 1234,
    "created_at": "2026-04-18T10:00:00Z",
    "ws_session_id": "ws-456",
    "ws_connected": true
}

# ProjectInfo (list of sessions)
{
    "path": "/Users/karim/Projects/ai-chatbot",
    "sessions": [...],
    "running_count": 2
}

# SessionCloseResponse
{
    "session_id": "sess_abc123",
    "compacted": true
}
```

---

## Step-by-Step Tasks

---

### Phase 1: Session Manager (`session_manager.py`)

**File:** `backend/app/session_manager.py` (new)

#### T1.1 — Class skeleton & singleton

- Create `SessionManager` class
- Module-level singleton: `session_manager = SessionManager()`
- Private `sessions: dict[str, SessionRecord]`
- `asyncio.Lock` for all mutations
- `async def initialize() → None` — no-op, called on app startup
- `async def shutdown_all() → None` — terminates all running sessions, called on app shutdown

#### T1.2 — `launch_session(project_path: str, model_id: str, name: str) → SessionRecord`

1. Assign `session_id = f"sess_{uuid.uuid4().hex[:12]}"`
2. Spawn `pi --mode rpc` via `asyncio.create_subprocess_exec`
   - `cwd=project_path`, `stdin=PIPE`, `stdout=PIPE`, `stderr=PIPE`
3. Create `SessionRecord` with `status="creating"`
4. **Wait for RPC ready** (critical path):
   - Create `asyncio.Future`, store in `pending_requests[req_id]`
   - Send `{"type":"get_available_models"}` via `_send_command`
   - Wait for response (30s timeout)
   - On success: send `{"type":"set_model","modelId":model_id}`
   - On success: send `{"type":"set_session_name","name":name}` (or default)
   - Set `status="running"`
5. Start `_start_stdout_reader(session_id)` as background task
6. Store in `sessions[session_id]`
7. Return `SessionRecord`

#### T1.3 — `close_session(session_id) → SessionCloseResponse`

1. Lock + validate session exists and `status == "running"`
2. Set `status = "closing"`
3. Send `{"type":"compact"}` via `_send_command` (60s timeout)
4. Send `{"type":"abort"}` via `_send_command`
5. Wait for process exit: `asyncio.wait_for(proc.wait(), 2s)`
6. If still alive after timeout: `proc.kill()` then `proc.wait()`
7. Cancel `stdout_task` if running
8. Remove from `sessions` dict
9. Return `SessionCloseResponse(session_id, compacted=True)`

#### T1.4 — `delete_session(session_id) → SessionCloseResponse`

1. Lock + validate session exists and `status == "running"`
2. Set `status = "closing"`
3. Send `{"type":"abort"}` via `_send_command`
4. Wait for process exit: `asyncio.wait_for(proc.wait(), 2s)`
5. If still alive: `proc.kill()` then `proc.wait()`
6. Cancel `stdout_task` if running
7. Remove from `sessions` dict
8. Return `SessionCloseResponse(session_id, compacted=False)`

#### T1.5 — `switch_model(session_id, model_id) → SessionRecord`

1. Lock + validate session is running
2. Extract `provider` from current model_id or pass through in body
3. Send `{"type":"set_model","provider":provider,"modelId":model_id}` via `_send_command`
4. Update `record.model_id = model_id`
5. Return updated record

#### T1.6 — WS management

- `connect_ws(session_id: str, websocket_id: str) → bool`
  - Lock + validate session exists + running
  - Set `ws_session_id = websocket_id`, `ws_connected = True`
  - Return `True`

- `disconnect_ws(session_id: str, websocket_id: str)`
  - Lock — only clear if `websocket_id == ws_session_id` (prevents stale disconnect)
  - Set `ws_session_id = None`, `ws_connected = False`

#### T1.7 — Query methods

- `get_session(session_id) → SessionRecord | None` — single lookup
- `get_sessions(project_path) → list[SessionRecord]` — filter by path
- `get_all_sessions() → list[SessionRecord]` — all records
- `get_running_instances() → list[SessionRecord]` — status == "running" with valid pid

#### T1.8 — `_send_command(session_id, command) → dict`

1. Lock + validate session running + process not dead
2. Generate UUID for `command["id"]` if not present
3. Create `asyncio.Future`, store in `pending_requests[req_id]`
4. Write JSON line to stdin: `f"{json.dumps(command)}\n"`
5. Drain stdin
6. Wait on Future (30s timeout)
7. On response: return result dict; remove Future from dict
8. On timeout: remove Future from dict, raise HTTPException

#### T1.9 — `_start_stdout_reader(session_id)` — background task

1. Continuously `stdout.readline()`
2. Parse JSON per line
3. Route matching responses to `pending_requests[req_id]` via `Future.set_result()`
4. Queue non-response events (streaming events, extension_ui_request, etc.) in `event_buffer`
5. Auto-reply to `extension_ui_request`:
   - Fire-and-forget methods (`notify`, `setStatus`, etc.) → auto-ack with `extension_ui_response`
   - Interactive methods (`select`, `confirm`, `input`, `editor`) → queue in event_buffer for WS relay
6. On EOF / error: set `status = "stopped"` if still "running"
7. On cancel: clean up

---

### Phase 2: Pydantic Schemas

**File:** `backend/app/schemas/__init__.py` (modify)

#### T2.1 — Add new models

```python
from typing import Literal, Optional
from datetime import datetime

class SessionRecord(BaseModel):
    session_id: str
    project_path: str
    name: str
    model_id: str
    status: Literal["running", "closing", "stopped"]
    pid: Optional[int] = None
    created_at: datetime
    ws_session_id: Optional[str] = None
    ws_connected: bool = False

class SessionCreateRequest(BaseModel):
    model_id: str
    name: Optional[str] = None

class SessionCloseResponse(BaseModel):
    session_id: str
    compacted: bool

class ProjectInfo(BaseModel):
    path: str
    sessions: List[SessionRecord]
    running_count: int
```

#### T2.2 — Update `__all__` if present

Ensure new models are exported.

---

### Phase 3: Project API

**File:** `backend/app/api/project.py` (rewrite)

#### T3.1 — Keep existing `GET /` endpoint

- Lists project folder names under `~/Projects`
- No changes needed

#### T3.2 — Add `GET /info` — project info + sessions

```python
@router.get("/info")
async def get_project_info(project_path: str = Query(...)):
    resolved = resolve_project_path(project_path)
    if not resolved.exists():
        raise HTTPException(404, f"Project not found: {resolved}")
    
    sessions = await session_manager.get_sessions(str(resolved))
    running = [s for s in sessions if s.status == "running"]
    
    return ProjectInfo(
        path=str(resolved),
        sessions=sessions,
        running_count=len(running)
    )
```

#### T3.3 — Add `POST /` — create session

```python
@router.post("", response_model=SessionRecord)
async def create_session(req: SessionCreateRequest, project_path: str = Query(...)):
    resolved = resolve_project_path(project_path)
    if not resolved.exists():
        raise HTTPException(404, f"Project not found: {resolved}")
    
    name = req.name or f"Session {len(await session_manager.get_sessions(str(resolved))) + 1}"
    
    record = await session_manager.launch_session(
        project_path=str(resolved),
        model_id=req.model_id,
        name=name
    )
    return record
```

#### T3.4 — Add import for session_manager

```python
from app.session_manager import session_manager
```

---

### Phase 4: Session API (Rewrite)

**File:** `backend/app/api/session.py` (complete rewrite)

#### T4.1 — `POST /sessions/{id}/close` — compact + terminate

```python
@router.post("/{session_id}/close", response_model=SessionCloseResponse)
async def close_session(session_id: str):
    return await session_manager.close_session(session_id)
```

#### T4.2 — `POST /sessions/{id}/delete` — abort + terminate

```python
@router.post("/{session_id}/delete", response_model=SessionCloseResponse)
async def delete_session(session_id: str):
    return await session_manager.delete_session(session_id)
```

#### T4.3 — `POST /sessions/{id}/model` — switch model

```python
@router.post("/{session_id}/model", response_model=SessionRecord)
async def switch_model(session_id: str, req: dict):
    model_id = req["model_id"]
    provider = req.get("provider")
    return await session_manager.switch_model(session_id, model_id, provider)
```

#### T4.4 — Remove ALL old code

Delete from session.py:
- `_find_rpc_for_project()`
- `_rpc_response_queues` dict
- `send_rpc_command_and_wait()`
- `create_session()`
- `list_sessions()`
- `get_session()`
- `resolve_project_path()` (keep helper if needed elsewhere, otherwise remove)
- All imports from `chat.py` related to RPC

---

### Phase 5: Chat / WebSocket

**File:** `backend/app/api/chat.py` (major refactor)

#### T5.1 — Remove all standalone process management

Delete from chat.py:
- `active_rpc_processes: dict` (line ~45)
- `active_websockets: dict` (line ~47)
- `launch_pi_rpc()` (lines ~55-70)
- `send_rpc_command()` (lines ~72-90)
- `_read_stdout_loop()` (lines ~93-125)
- `forward_rpc_messages()` (lines ~135-200)
- `_auto_reply_to_extension_request()` (lines ~210-250)
- `read_rpc_output()` (lines ~253-320)
- `write_rpc_input()` (lines ~323-380)
- `_cleanup_session()` (lines ~390-410)
- `send_chat_message()` (deprecated POST endpoint, remove)
- `get_chat_history()` (deprecated GET endpoint, remove)
- `rpc_websocket_endpoint()` (old WS endpoint, replace below)

#### T5.2 — Add new WebSocket endpoint

```python
from app.session_manager import session_manager

@router.websocket("/ws")
async def ws_endpoint(websocket: WebSocket, session_id: str = Query(...)):
    # Validate session exists and is running
    ok = await session_manager.connect_ws(session_id, str(websocket))
    if not ok:
        await websocket.close(code=4002, reason="Session not found or not running")
        return
    
    await websocket.accept()
    
    async def _relay_outbound():
        """Drain session's event buffer → send to WS."""
        try:
            while True:
                event = await session_manager.get_next_event(session_id)
                if event is None:
                    break
                await websocket.send_text(json.dumps(event, ensure_ascii=False))
        except WebSocketDisconnect:
            pass
    
    async def _relay_inbound():
        """Receive from WS → route to session's stdin."""
        try:
            while True:
                data = await websocket.receive_text()
                try:
                    payload = json.loads(data)
                except json.JSONDecodeError:
                    payload = {"type": "prompt", "message": data}
                await session_manager.send_to_session(session_id, payload)
        except WebSocketDisconnect:
            pass
    
    out_task = asyncio.create_task(_relay_outbound())
    in_task = asyncio.create_task(_relay_inbound())
    
    done, pending = await asyncio.wait(
        {out_task, in_task}, return_when=asyncio.FIRST_COMPLETED
    )
    for t in pending:
        t.cancel()
        try: await t
        except asyncio.CancelledError: pass
    
    await session_manager.disconnect_ws(session_id, str(websocket))
```

#### T5.3 — Add relay helper methods to SessionManager

- `get_next_event(session_id) → dict | None` — get next queued event from `event_buffer`
- `send_to_session(session_id, payload)` — wrap and send to stdin

---

### Phase 6: Main App Wiring

**File:** `backend/app/main.py` (modify)

#### T6.1 — Add session_manager import and startup event

```python
from app.session_manager import session_manager

@app.on_event("startup")
async def on_startup():
    await session_manager.initialize()
```

#### T6.2 — Add shutdown event

```python
@app.on_event("shutdown")
async def on_shutdown():
    await session_manager.shutdown_all()
```

#### T6.3 — Remove old router dependency on session.py

Ensure `session_router` import references the rewritten module.

---

### Phase 7: Integration Tests

**File:** `backend/integration_test_api.py` (add new tests)

#### T7.1 — Test `POST /projects/` (create session)

```
Given a project path that exists
When POST /projects/?project_path=<path> with body {model_id: "claude-sonnet-4"}
Then response 200 with SessionRecord
  - session_id is non-empty
  - status == "running"
  - pid is set
  - model_id matches request
```

#### T7.2 — Test `GET /projects/info`

```
Given 2 sessions exist for a project
When GET /projects/info?project_path=<path>
Then response 200 with ProjectInfo
  - running_count == 2
  - sessions list has 2 items
```

#### T7.3 — Test `POST /sessions/{id}/close`

```
Given a running session
When POST /sessions/{id}/close
Then response 200 with SessionCloseResponse(compacted=true)
  - session removed from manager
  - process terminated (returncode is set)
```

#### T7.4 — Test `POST /sessions/{id}/delete`

```
Given a running session
When POST /sessions/{id}/delete
Then response 200 with SessionCloseResponse(compacted=false)
  - session removed from manager
  - process terminated
```

#### T7.5 — Test `POST /sessions/{id}/model`

```
Given a running session with model A
When POST /sessions/{id}/model with {model_id: "gpt-4.1"}
Then response 200 with model_id == "gpt-4.1"
```

#### T7.6 — Test concurrent sessions

```
Given project "foo" exists
When create session A and session B simultaneously
Then both have different PIDs
Then both are independent (commands to A don't affect B)
```

#### T7.7 — Test WS connect/disconnect/reconnect

```
Given a running session
When WS connect → then disconnect → then reconnect
Then session stays running throughout
Then reconnect gets fresh event stream
```

#### T7.8 — Test app shutdown terminates all sessions

```
When app receives shutdown signal
Then all running sessions receive abort
Then all processes are terminated
```

---

## Implementation Order

```
Phase 1: session_manager.py          ← core logic, no deps
Phase 2: schemas/__init__.py         ← types, no deps
    ↓
Phase 3: api/project.py              ← depends on 1 + 2
Phase 4: api/session.py              ← depends on 1 + 2
    ↓ (parallel)
Phase 5: api/chat.py                 ← depends on 1
    ↓
Phase 6: main.py                     ← depends on 1
    ↓
Phase 7: integration tests           ← depends on all
```

---

## File Summary

| File | Action | Lines Changed (est.) |
|------|--------|---------------------|
| `backend/app/session_manager.py` | **Create** | ~350 |
| `backend/app/schemas/__init__.py` | **Modify** | +60 |
| `backend/app/api/project.py` | **Modify** | ~80 |
| `backend/app/api/session.py` | **Rewrite** | ~120 |
| `backend/app/api/chat.py` | **Refactor** | ~200 (remove ~300, add ~100) |
| `backend/app/main.py` | **Modify** | +10 |
| `backend/integration_test_api.py` | **Add tests** | ~200 |

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| `pi --rpc` hangs on compact | Session stuck in `closing` | 60s timeout → abort + kill anyway |
| stdout reader crashes mid-session | Events stop flowing | Reader monitors itself; if it dies, mark session stopped |
| Stale WS sends commands | Commands go nowhere | Validate `ws_session_id` before relaying; reject after disconnect |
| Multiple WS connects to same session | Double-events on old connection | Only latest `ws_session_id` receives relay; others get empty buffer |
| `pending_requests` Futures leak | Memory grows over long sessions | Background cleanup every 30s, remove expired Futures |
| Race: command during close | Process may be dead | Check `proc.returncode` before writing; reject if dead |
| Concurrent close + delete | Double-termination | Lock protects mutations; second call returns 404 or "already stopped" |
| Model not in `get_available_models` | Invalid model_id accepted | Optional: validate model_id against available list before creating session |
