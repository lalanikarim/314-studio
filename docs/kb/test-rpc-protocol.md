# Pi RPC Protocol Tests

This document describes the Pi RPC protocol as tested by the integration test suite.
All tests run against a live `pi --mode rpc` process started by the backend server.

## Test Environment

### Architecture

```
┌─────────────┐     HTTP/WS      ┌──────────────┐     stdout     ┌─────────────┐
│ Frontend    │ ───────────────> │ Backend      │ ─────────────> │ pi --mode   │
│             │ <─────────────── │ (FastAPI)    │ <───────────── │ rpc         │
│             │                  │              │                │             │
└─────────────┘                  └──────────────┘               └─────────────┘
                                  │
                                  ├─ session_manager.py — orchestrates processes
                                  ├─ chat.py — WebSocket relay
                                  ├─ model.py — model listing
                                  ├─ files.py — file browsing
                                  └─ project.py — project/session management
```

### Test Setup

- Backend server: `uvicorn app.main:app --host 127.0.0.1 --port 8765`
- Test suite: `/Users/karim/Projects/ocproject/remote-pi/web-pi/tests/`
- Test project: `~/Projects/web-pi-integration-tests`
- Model: `Qwen/Qwen3.6-35B-A3B` (configurable via `TEST_MODEL_ID`)

Run tests:
```bash
cd tests
uv run pytest test_flow*.py -v
```

---

## Test Coverage Matrix

| Flow File              | Tests | Description                           |
|------------------------|-------|---------------------------------------|
| test_flow1_browse_chat.py  | 12    | Browse → Model → Session → Chat       |
| test_flow2_file_browse.py  | 7     | File listing & reading                |
| test_flow3_multi_session.py| 7     | Multiple sessions per project         |
| test_flow4_model_switch.py | 4     | Model switching                       |
| test_flow5_close_delete.py | 4     | Session close vs delete               |
| test_flow6_error_handling.py|14    | Error cases & edge conditions         |
| test_flow7_shutdown_cleanup.py|2   | Backend shutdown & cleanup            |
| test_flow8_model_operations.py|6   | Model operations & verification       |
| **Total**              | 55    | **All tests pass ✓**                  |

---

## Session Lifecycle

### 1. Session Creation

**HTTP POST** `/api/projects/` with `project_path` query parameter

```json
// Request
POST /api/projects/?project_path=/Users/karim/Projects/web-pi-integration-tests
{
  "name": "MySession"
}

// Response
{
  "session_id": "sess_48fd50df42ab",
  "project_path": "/Users/karim/Projects/web-pi-integration-tests",
  "name": "MySession",
  "status": "running",
  "model_id": null,      // model-agnostic creation
  "pid": 12345,
  "ws_session_id": null,
  "ws_connected": false,
  "created_at": "2025-04-22T10:00:00Z"
}
```

**Backend behavior:**
- Spawns `pi --mode rpc` process in the project directory
- Waits for process to be alive (no RPC calls during creation)
- Starts stdout reader task
- Does NOT send set_model, get_available_models, or set_session_name

---

### 2. Model Listing (via Pi RPC)

**HTTP GET** `/api/models/` with `session_id` query parameter

```json
// Request
GET /api/models/?session_id=sess_48fd50df42ab

// Internal RPC sent
{
  "type": "get_available_models",
  "id": "uuid-48fd50df42ab"
}

// Response
[
  {
    "id": "anthropic/claude-3.5-sonnet",
    "provider": "anthropic",
    "contextWindow": 200000,
    "maxTokens": 8192
  },
  {
    "id": "openai/gpt-4.1",
    "provider": "openai",
    "contextWindow": 100000,
    "maxTokens": 16384
  }
]
```

**Notes:**
- RPC command sent synchronously via stdin
- Response waited with 30s timeout
- Result parsed from `get_available_models` response

---

### 3. WebSocket Connection

**WebSocket** `/api/projects/ws?session_id=SESSION_ID`

On connect, backend automatically sends:

```json
// Internal RPC sent after WS accept
{
  "type": "set_model",
  "modelId": "Qwen/Qwen3.6-35B-A3B",
  "provider": "",
  "id": "uuid-generated"
}
```

**Response:**
```json
{
  "type": "set_model",
  "result": {},
  "id": "uuid-generated"
}
```

**Key point:** All Pi actions go through WebSocket, NOT direct HTTP→stdin.

---

### 4. Chat via WebSocket

**Send prompt:**
```json
// Client → Backend → Pi
{
  "type": "prompt",
  "message": "Hello, who are you?"
}
```

**Streaming responses (Pi → Backend → Client):**
```json
{
  "type": "turn_start",
  "id": "turn-xxx"
}

{
  "type": "agent_message",
  "text": "Hello! I'm Pi, a coding assistant..."
}

{
  "type": "turn_end",
  "id": "turn-xxx",
  "message": {...}
}
```

---

### 5. Session Close (compact → abort → terminate)

**HTTP POST** `/api/projects/{session_id}/close`

```json
// Step 1: Compact
{
  "type": "compact",
  "id": "uuid-xxx"
}
// Timeout: 300s (context can be large)

// Step 2: Abort
{
  "type": "abort"
}
// No id, fire-and-forget

// Step 3: Terminate process
// SIGTERM, then SIGKILL after 2s

// Response
{
  "session_id": "sess_48fd50df42ab",
  "compacted": true
}
```

---

### 6. Session Delete (abort → terminate, no compact)

**HTTP POST** `/api/projects/{session_id}/delete`

```json
// Step 1: Abort only (skip compact)
{
  "type": "abort"
}

// Step 2: Terminate process

// Response
{
  "session_id": "sess_48fd50df42ab",
  "compacted": false
}
```

---

## RPC Command Types

### Streaming / Event-Based

| Command | Description | Response Type |
|---------|-------------|---------------|
| `prompt` | Send user message | `turn_start`, `agent_message`, `turn_end` |
| `steer` | Steer conversation | Streaming |
| `follow_up` | Follow-up response | Streaming |

### Blocking / One-Shot

| Command | Timeout | Description |
|---------|---------|-------------|
| `get_available_models` | 30s | List models |
| `get_state` | 30s | Get session state |
| `get_messages` | 30s | Get conversation history |
| `get_session_stats` | 30s | Get stats |
| `compact` | 300s | Compact context |

### Configuration

| Command | Description |
|---------|-------------|
| `set_model` | Switch model |
| `cycle_model` | Cycle through models |
| `set_thinking_level` | Set thinking level |
| `set_auto_compaction` | Enable/disable auto-compact |
| `set_steering_mode` | Set steering mode |
| `set_follow_up_mode` | Set follow-up mode |

---

## WebSocket Message Routing

### Backend → Pi (stdin)

1. Client sends JSON over WS
2. Backend parses → routes to `record.stdin.write(json.dumps(msg) + "\n")`
3. Pi processes command

### Pi → Backend (stdout)

1. `record.stdout.readline()` in background task
2. Parse JSON
3. Route based on `type`:
   - `{"type": "response", "id": "xxx"}` → resolves pending Future
   - `{"type": "extension_ui_request"}` → auto-ack or queue to event_buffer
   - Everything else → queue to `record.event_buffer`
4. WS relay reads from `event_buffer` and sends to client

---

## Extension UI Handling

### Fire-and-Forget Methods

These methods send auto-ack without waiting for user input:

```python
_FIRE_AND_FORGET_METHODS = {
    "notify",
    "setStatus",
    "setTitle",
    "setFooter",
    "setHeader",
    "setWidget",
    "setEditorComponent",
    "set_tools_expanded",
}
```

**Auto-response:**
```json
{
  "type": "extension_ui_response",
  "id": "request-id",
  "value": null,
  "cancelled": false
}
```

### Interactive Methods

Queued to event_buffer for client to handle:

```python
_INTERACTIVE_METHODS = {"select", "confirm", "input", "editor"}
```

**Forwarded to client:**
```json
{
  "kind": "extension_ui_request",
  "method": "select",
  "title": "Choose an option",
  "id": "request-id"
}
```

---

## Error Handling

### Connection Errors

```python
httpcore.ConnectError: All connection attempts failed
 → Backend not running
```

### Session Errors

```json
{
  "status_code": 404,
  "detail": "Session sess_xxx not found or not running"
}
```

### Path Traversal Prevention

```python
if not target_path.resolve().is_relative_to(base.resolve()):
    raise HTTPException(status_code=403, detail="Access denied")
```

### Timeout Handling

```python
asyncio.timeout(30.0)
 → Raises `asyncio.TimeoutError` on slow commands
```

---

## Test Utilities

### Shared Helpers

Location: `tests/test_utils.py`

```python
async def http_get(client, path, params) → response
async def http_post_json(client, path, body, params) → response
async def ws_connect(session_id) → websocket
async def ws_send(ws, payload) → None
async def ws_receive(ws, timeout) → dict | None
async def ws_collect(ws, max_events, total_timeout) → list
```

### Constants

```python
API_BASE = "http://127.0.0.1:8765"
WS_BASE = "ws://127.0.0.1:8765"
TEST_MODEL_ID = "Qwen/Qwen3.6-35B-A3B"
TESTS_DIR = ~/Projects/web-pi-integration-tests
```

---

## Example Test Flow

### T1.4 — Create Session

```python
async def test_create_session(client, result):
    resp = await http_post_json(
        client,
        "/api/projects/",
        body={"name": "Flow1-Test"},
        params={"project_path": str(TESTS_DIR)},
    )
    data = resp.json()
    assert data["status"] == "running"
    assert data["pid"] is not None
    assert len(data["session_id"]) > 0
    return data["session_id"]
```

### T1.7 — WebSocket Connect

```python
async def test_ws_connect_set_model(client, result, session_id: str):
    ws = await ws_connect(session_id)
    
    # Server auto-sends set_model on connect
    initial = await ws_receive(ws, timeout=10.0)
    
    return ws
```

### T1.9 — Send Prompt

```python
async def test_ws_prompt(client, result, ws):
    await ws_send(ws, {"type": "prompt", "message": "Hello!"})
    events = await ws_collect(ws)
    assert len(events) > 0
    assert any(e["type"] == "turn_end" for e in events)
```

---

## Known Behaviors

1. **Session creation is model-agnostic** — model set on WS connect
2. **Sessions persist** — disconnecting WS doesn't kill session
3. **One process per session** — not per project
4. **Compact timeout is 300s** — context can be large
5. **Extension UI auto-ack** — fire-and-forget methods acked immediately
6. **Path security enforced** — no traversal outside project root

---

## Debugging Tips

### Check Running Sessions

```bash
lsof -i :8765           # Backend port
lsof -i :6022           # Pi RPC ports (vary)
```

### View Backend Logs

```bash
tail -f /tmp/backend.log
```

### Inspect Session State

```python
GET /api/projects/info?project_path=...
# Shows running_count and sessions array
```

### Force Cleanup

```bash
pkill -f "pi --mode"    # Kill all Pi processes
```

---

## Future Improvements

1. ✓ Model listing via RPC (GET /api/models/)
2. ✓ Model switching via WS (not HTTP endpoint)
3. ✓ Extension UI request/response handling
4. ✗ WebSocket auto-reconnect on connection loss
5. ✗ Model preference persistence per project
6. ✗ Context size tracking & warning

---

## License

MIT License — per project root.

## Contact

Issues → GitHub repository
Documentation → See README.md
