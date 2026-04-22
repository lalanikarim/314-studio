# WebSocket Harness Flow Knowledge Base

Comprehensive reference for the `ws_harness` testing flow, RPC protocol details, backend routing behavior, and known gotchas.

---

## 1. Flow Overview

The harness mimics the exact frontend flow:

| Step | Description |
|------|-------------|
| **1** | FolderSelector — `setSelectedFolder` + `setView('models')` |
| **2** | ModelSelector mounts → `useModels` → `createSession` (POST) |
| **3** | `useModels` polls `GET /api/models/` until models arrive |
| **4** | User selects model → `switchModel` + `setView('workspace')` |
| **5** | ChatPanel mounts → `useWebSocket(folder, modelRef, sessionId)` |
| **6** | WS Connect — `mimics useWebSocket doConnect()` |
| **7** | WS onopen → `get_state` + `set_model` |
| **8** | Send prompt message (plain text) |
| **9** | Relay inbound messages until `agent_end` |
| **10** | Send `get_messages` to retrieve conversation |
| **11** | Wait for `get_messages` response |

---

## 2. Frontend WebSocket Protocol

### 2.1 Message Types (Frontend → Backend)

```typescript
// Plain text prompt (auto-wrapped by frontend)
{ type: "prompt", message: "Tell me about this project" }

// RPC commands (auto-generated id by frontend)
{ type: "get_state" }                    // id: crypto.randomUUID()
{ type: "set_model", provider: "...", modelId: "..." }
{ type: "compact" }
{ type: "abort" }
{ type: "get_messages" }                 // id: crypto.randomUUID()
{ type: "set_auto_compaction", enabled: true }
```

**Key detail:** The frontend **auto-generates an `id`** for all RPC commands:

```typescript
const command: RpcCommand = { ...(data as RpcCommand) };
if (command.id === undefined) {
    command.id = crypto.randomUUID();
}
ws.send(JSON.stringify(command));
```

### 2.2 Message Types (Backend → Frontend)

The backend wraps raw `pi --rpc` output into typed messages:

```typescript
// RPC streaming events
{ kind: "rpc_event", event: { type: "message_update", assistantMessageEvent: { ... } } }

// Extension UI interactive requests
{ kind: "extension_ui_request", id: "...", method: "select", params: { ... } }

// RPC responses (for commands WITH id)
{ kind: "rpc_response", response: { type: "...", ... } }

// Raw response (for commands WITHOUT id)
{ type: "response", id: "...", command: "...", success: true, data: { ... } }

// Extension UI responses
{ kind: "extension_ui_response", id: "...", value: ..., cancelled: false }

// Non-JSON raw events
{ kind: "rpc_event", event: { raw: "..." } }
```

---

## 3. Backend Routing Logic

The critical routing decision happens in `session_manager.py::_stdout_reader_loop()`:

```
pi --rpc stdout
       │
       ▼
┌─────────────────────────────────┐
│ Parse JSON line                 │
└─────────┬───────────────────────┘
          │
          ▼
    ┌──────────────┐
    │ Has "id" ?   │
    └──┬────────┬──┘
       │Yes     │No
       ▼        ▼
  pending_   event_buffer
  requests   (WS relay reads)
  Future     ←──────────────────→ WebSocket
```

### 3.1 Commands WITH an `id`

- Route to `pending_requests` dict (Future)
- **NOT sent to event_buffer**
- **NOT relayed to WebSocket**
- Only consumed by the code that initiated the command

### 3.2 Commands WITHOUT an `id`

- Go to `event_buffer`
- **Relayed to all connected WebSocket clients**
- This is how `get_messages`, `compact`, `abort`, etc. responses reach the UI

---

## 4. Known Gotchas & Debugging

### 4.1 `get_messages` Response Never Arrives

**Symptom:** Harness hangs at Step 11, no response within timeout.

**Root cause:** Sending `{"type": "get_messages", "id": "..."}` routes the response to `pending_requests` Future, bypassing `event_buffer` entirely.

**Fix:** Send `{"type": "get_messages"}` **without an `id`**.

### 4.2 `pi --rpc` Response Format

**pi --rpc returns:**
```json
{"type":"response","command":"get_messages","success":true,"data":{"messages":[]}}
```

**NOT:**
```json
{"type":"get_messages","messages":[]}
```

**Check for `msg.get("command") == "get_messages"`, NOT `msg.get("type") == "get_messages"`.**

### 4.3 Response Wrapping (Frontend vs Backend)

| Component | `get_messages` Response Format |
|-----------|-------------------------------|
| **Backend** → WS | `{ type: "response", command: "get_messages", data: { messages: [...] } }` |
| **Frontend** (wrapped) | `{ kind: "rpc_response", response: { type: "response", command: "get_messages", data: {...} } }` |
| **Harness** (direct) | `{ type: "response", command: "get_messages", data: { messages: [...] } }` |

The frontend creates an `rpc_response` wrapper; the harness receives the raw format.

### 4.4 `pi --rpc` Startup Time

- `pi --rpc` takes **10-15 seconds** to initialize the model
- Don't use short timeouts (e.g., `timeout 5`) for harness startup
- Use Python `asyncio.wait_for()` for async timeouts instead of bash `timeout`

### 4.5 macOS `timeout` Not Available

| Approach | Command |
|----------|---------|
| ❌ Wrong | `timeout 10 pi --mode rpc` |
| ✅ Right (asyncio) | `await asyncio.wait_for(coro, timeout=10)` |
| ✅ Right (gtimeout) | `gtimeout 10 pi --mode rpc` (requires `brew install coreutils`) |
| ✅ Right (background) | Background process + delayed `kill` |

---

## 5. `get_messages` Deep Dive

### 5.1 When to Call

After a conversation turn completes (i.e., after `agent_end` is received in the relay loop).

### 5.2 Request Format

```json
{ "type": "get_messages" }
```

**No `id`** — must go through `event_buffer` to reach the WS relay.

### 5.3 Response Format

```json
{
    "type": "response",
    "command": "get_messages",
    "success": true,
    "data": {
        "messages": [
            {
                "role": "user",
                "content": "[{\"type\": \"text\", \"text\": \"Tell me about this project\"}]"
            },
            {
                "role": "assistant",
                "content": "[{\"type\": \"thinking\", \"thinking\": \"...\"}, {\"type\": \"text\", \"text\": \"...\"}]"
            },
            {
                "role": "toolResult",
                "content": "[{\"type\": \"text\", \"text\": \"ls -la ...\"}]"
            }
        ]
    }
}
```

### 5.4 Parsing in Harness

```python
# Step 11: Wait for get_messages response
while time.monotonic() - relay_start < 80.0:
    msg = await ws_receive(ws, timeout=5.0)
    if msg is None:
        break

    kind = msg.get("kind", msg.get("type", "unknown"))

    # Check command field, NOT type field
    if kind == "response" and msg.get("command") == "get_messages":
        messages_data = msg.get("data", {}).get("messages", []) if msg.get("data") else []
        if isinstance(messages_data, list):
            for i, m in enumerate(messages_data[:5]):
                role = m.get("role", "unknown")
                content = str(m.get("content", "")[:100])
                info(f"  [{i}] role={role} content='{content}...'")
            break
```

---

## 6. Relay Loop Message Extraction

### 6.1 Text Content from `message_update` Events

```typescript
// Per official RPC protocol docs:
// { type: "message_update", assistantMessageEvent: { type, delta, partial } }

if (delta_type == "text_delta") {
    // Single chunk: ami.delta contains the new chunk
    return ami.get("delta", "");
}

if (delta_type == "text_start") {
    // Accumulated: ami.partial.content[0].text
    return ami.get("partial", {}).get("content", [{}])[0].get("text", "");
}
```

### 6.2 Important Event Types

| Event Type | Meaning |
|------------|---------|
| `agent_start` | Agent beginning a new turn |
| `turn_start` | Turn within agent execution |
| `message_start` | New message being streamed |
| `message_update` | Streaming text delta/accumulation |
| `message_end` | Message stream complete |
| `tool_execution_start` | Tool call beginning |
| `tool_execution_update` | Tool execution progress |
| `tool_execution_end` | Tool call finished |
| `turn_end` | Turn complete |
| `agent_end` | Agent fully idle — **breaking signal** |

---

## 7. Extension UI Handling

### 7.1 Auto-Ack (Fire-and-Forget)

For non-interactive methods (`read`, `bash`, `edit`, `write`, `ls`, `mcp__`, etc.):

```json
// Backend sends this to pi --rpc stdin:
{ "type": "extension_ui_response", id: "...", value: null, cancelled: false }
```

### 7.2 Interactive Methods

For interactive methods (`select`, `confirm`, `input`, `editor`), the backend forwards to the WS client and waits for a reply:

```json
// Backend → Client:
{ kind: "extension_ui_request", id: "...", method: "select", params: { ... } }

// Client → Backend:
{ kind: "extension_ui_response", id: "...", value: [...], cancelled: false }
```

---

## 8. Session Lifecycle (Backend Side)

```
creating ──RPC ready──→ running
   │                       │
   │                       ├── WS disconnect → running (ws disconnected)
   │                       ├── WS reconnect  → running (ws reconnected)
   │                       ├── client message → forwarded to stdin
   │                       └── process events → event buffer → WS relay
   │
 close(compact) ──→ stopped (process terminated, record removed)
 delete(abort)  ──→ stopped (process terminated, record removed)
```

---

## 9. Harness Configuration

```python
# ws_harness/config.py
API_BASE = os.environ.get("API_BASE", "http://127.0.0.1:8765")
WS_BASE  = os.environ.get("WS_BASE",  "ws://127.0.0.1:8765")
PROJECT_NAME = os.environ.get("PROJECT_NAME", "agent-spy")
TEST_MODEL_ID = os.environ.get("TEST_MODEL_ID", "Qwen/Qwen3.6-35B-A3B")
POLL_INTERVAL = 1.5      # seconds between model polls
MAX_POLL_TIME = 30.0     # max seconds to wait for models
WS_RECV_TIMEOUT = 30.0   # seconds between WS messages before timeout
RELAY_WINDOW = 60.0      # seconds to relay inbound messages after prompt
```

### Run Harness

```bash
cd tests
API_BASE=http://127.0.0.1:8000 WS_BASE=ws://127.0.0.1:8000 PROJECT_NAME=agent-spy uv run python -m ws_harness
```

---

## 10. Full Flow Trace (Successful Run)

```
STEP 6: WS Connect
  → WebSocket: ws://127.0.0.1:8000/api/projects/ws?session_id=sess_xxx
  ✓ WS connected

STEP 7: WS onopen → get_state + set_model
  → send: {"type": "get_state"}
  → send: {"type": "set_model", "provider": "vllm", "modelId": "Qwen/Qwen3.6-35B-A3B"}
  ✓ get_state + set_model sent

STEP 8: Send prompt
  → send: Tell me about this project

STEP 9: Relay inbound messages until agent_end
  [+1s] ✓ response (get_state)
  [+1s] ✓ response (set_model)
  [+1s] * agent_start
  [+1s] * turn_start
  [+1s] * message_start
  [+1s] * message_end
  [+1s] * message_start
  [+1s] * message_update          ← streaming begins
  [+4s] text: Let me explore...
  ...
  [+41s] * agent_end
  [+41s] Agent idle — breaking relay loop

STEP 10: Send get_messages
  → send: {"type": "get_messages"}    ← NO ID!

STEP 11: Wait for get_messages response
  get_messages: 5 conversation message(s)
    [0] role=user content='Tell me about this project'
    [1] role=assistant content='[thinking + toolCalls...]'
    [2] role=toolResult content='ls -la ...'
    [3] role=toolResult content='cat README.md...'
    [4] role=assistant content='Agent Spy is a self-hosted...'

✓ WS CONNECTION STABLE
  598 inbound, 594 RPC events, no loop
```
