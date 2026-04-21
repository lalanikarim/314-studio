# Backend Implementation Status

## Architecture

**REST = metadata, WebSocket = all Pi RPC actions.**

- Each session runs its own `pi --mode rpc` process (managed by `SessionManager`)
- Sessions outlive WebSocket connections — disconnect/reconnect is painless
- Model switching: REST updates metadata, WS relay sends the actual `set_model` command

## Implemented

### Session Manager (`backend/app/session_manager.py`)

| Feature | Status |
|---------|--------|
| `launch_session(project_path, model_id, name)` | ✅ Spawns `pi --mode rpc`, waits for ready |
| `close_session(session_id)` | ✅ Compact (5s timeout) → abort → terminate → remove |
| `delete_session(session_id)` | ✅ Abort → terminate → remove (no compact) |
| `switch_model(session_id, model_id, provider)` | ✅ Updates metadata only |
| `get_model_id(session_id)` | ✅ Reads configured model for WS relay |
| `connect_ws / disconnect_ws` | ✅ Tracks last connected WebSocket |
| `get_session / get_sessions / get_running_instances` | ✅ Query methods |
| `_send_command_internal` | ✅ JSON line protocol with Future-based response matching |
| stdout reader | ✅ Routes responses to Futures, queues events in buffer |
| Extension UI handling | ✅ Auto-ack fire-and-forget, forward interactive to event buffer |
| Cleanup task | ✅ Removes expired Futures every 30s |

### API Endpoints

| Module | Endpoints | Status |
|--------|-----------|--------|
| `browse.py` | `GET /api/browse?path=...` | ✅ Recursive directory listing |
| `project.py` | `GET /api/` | ✅ List project names |
| | `GET /api/projects/info?project_path=...` | ✅ Project + sessions |
| | `POST /api/projects/?project_path=...` | ✅ Create session |
| `session.py` | `POST /api/projects/{id}/close` | ✅ Compact + terminate |
| | `POST /api/projects/{id}/delete` | ✅ Abort + terminate |
| | `POST /api/projects/{id}/model` | ✅ Switch model metadata |
| `files.py` | `GET /api/projects/files?project_path=...&path=...` | ✅ List files |
| | `GET /api/projects/files/read?project_path=...&file_path=...` | ✅ Read file |
| `model.py` | `GET /api/models/?session_id=...` | ✅ RPC-aware with fallback defaults |
| `chat.py` | `WS /api/projects/ws?session_id=...` | ✅ Bidirectional JSON relay |

### Session Record Fields

Only serializable fields are included in API responses. Runtime-only fields are excluded:

| Field | Included in API? | Notes |
|-------|-----------------|-------|
| `session_id` | ✅ | `sess_<hex>` |
| `project_path` | ✅ | Absolute path |
| `name` | ✅ | Human-readable |
| `model_id` | ✅ | Configured model |
| `status` | ✅ | running / closing / stopped |
| `pid` | ✅ | Process ID |
| `created_at` | ✅ | ISO timestamp |
| `ws_session_id` | ✅ | Last connected WS ID |
| `ws_connected` | ✅ | Boolean |
| `process` | ❌ | `asyncio.Process` — excluded |
| `stdin` / `stdout` | ❌ | Streams — excluded |
| `pending_requests` | ❌ | Futures dict — excluded |
| `event_buffer` | ❌ | Queue — excluded |
| `stdout_task` | ❌ | Task — excluded |
| `ws_to_stdin_queue` | ❌ | Queue — excluded |

## Tests

76 integration tests passing across all 8 flows:

| Flow | File | Tests | Status |
|------|------|-------|----------|
| 1: Browse & Chat | `test_flow1_browse_chat.py` | 12 | ✅ All passing |
| 2: File Browse | `test_flow2_file_browse.py` | 7 | ✅ All passing |
| 3: Multi Session | `test_flow3_multi_session.py` | 7 | ✅ All passing |
| 4: Model Switch | `test_flow4_model_switch.py` | 4 | ✅ All passing (6 checks + 2 skip path) |
| 5: Close/Delete | `test_flow5_close_delete.py` | 4 | ✅ All passing |
| 6: Error Handling | `test_flow6_error_handling.py` | 12 | ✅ All passing |
| 7: Shutdown Cleanup | `test_flow7_shutdown_cleanup.py` | 3 | ✅ All passing |
| 8: Model Operations | `test_flow8_model_operations.py` | 27 | ✅ All passing (fetch, verify, switch, chat before/after) |

Run tests:
```bash
cd tests
API_BASE=http://127.0.0.1:8000 WS_BASE=ws://127.0.0.1:8000 uv run pytest -v
```

## Known Design Decisions

1. **Session creation doesn't auto-send RPC commands** — model selection and session naming happen when the client connects via WebSocket. This keeps the REST API lightweight.
2. **Model switch is metadata-only** — the actual `set_model` RPC is sent by the WS relay when the client reconnects, ensuring all Pi actions go through WS.
3. **Compact has a 5s timeout** — Pi may not respond to `compact`, so we don't block indefinitely. The session is still terminated regardless.
4. **One WS per session** — only the latest WebSocket connection receives the event relay. Previous connections are ignored.
5. **All paths validated** — file browsing is restricted to the project directory. Path traversal (`../`) returns 403.
