# Pi RPC Integration - Bug Fixes TODO

Sorted by priority (most critical first).

---

## ✅ Fixed

- [x] **#1 Fix RPC launch command** (`chat.py`) — `--rpc` → `--mode rpc`
  - Confirmed by `pi --help`: the correct flag is `--mode <mode>`

- [x] **#2 Fix session.py** — Replace stub data with real RPC calls
  - `new_session` RPC command to create sessions
  - `get_state` RPC command to retrieve session info
  - `set_session_name` RPC command for naming

- [x] **#3 Fix chat.py message wrapping** — Wrap messages in `prompt` command envelope
  - Plain text messages → `{"type":"prompt","id":"<uuid>","message":"..."}`
  - Structured messages routed by `type` field

- [x] **#4 Fix chat.py request ID tracking** — Auto-generate UUIDs for each command
  - `send_rpc_command()` attaches `id` via `uuid.uuid4()`
  - Responses echo back the same `id` for matching

- [x] **#5 Fix files.py route conflict** — Source of 404 bug
  - Changed `/{file_path:.+}` to `/files/read/{file_path:path}`
  - `path` type annotation prevents FastAPI route disambiguation issues
  - Removed `project_name` double-binding

- [x] **#6 Handle extension_ui_request events** (`chat.py`)
  - `extension_ui_request` → `{"kind":"extension_ui_request", ...}`
  - `extension_ui_response` → `{"kind":"extension_ui_response", ...}`

- [x] **#7 Fix model.py** — RPC-aware model management
  - `list_models()` queries RPC if active, falls back to defaults
  - `switch_model()` sends `set_model` RPC command
  - Helper: `_parse_rpc_models()` to parse RPC response format

- [x] **#8 Fix core.utils.py** — Removed dead code (used non-existent `pi-rpc` binary)
  - Not imported anywhere, confirmed safe to delete

- [x] **#9 Fix WebSocket path** — removed duplicate `project_name` from route
  - Route changed from `/ws/rpc/{project_name}` to `/ws`
  - Full path: `/api/projects/{project_name}/ws` (clean)

- [x] **#10 Distinguish response vs event events** (`chat.py`)
  - Responses: forwarded as-is with `{"type":"response"}`
  - Events: wrapped as `{"kind":"rpc_event", "event": {...}}`

- [x] **#11 Forward extension_ui events as typed messages** (`chat.py`)
  - All Pi output tagged with `kind` field
  - `kind: "extension_ui_request" | "extension_ui_response" | "rpc_event"`

## ✅ Integration Tests (passing)

- [x] `backend/integration_test_rpc.py` — 42 assertions, all passing against live `pi --mode rpc`
  - Warm-up phase triggers extension loading before test sequence
  - Single `event_reader` task owns stdout; `send_command` writes stdin + waits on queue
  - Auto-replies to `extension_ui_request` so Pi doesn't block
  - Covers: `get_available_models`, `set_model`, `get_state`, `get_messages`, `get_session_stats`, `get_commands`, `set_thinking_level`, `set_session_name`, prompt+event-streaming, extension_ui handling, message wrapping, model parsing

## Remaining

### Phase 1: Wire Frontend → Backend (Biggest Impact)

#### 1.1 Replace `mockData.ts` with real API calls
- [x] `FolderSelector` → `GET /api/browse` to list real folders from `~/Projects`
- [x] `ModelSelector` → launches `pi --mode rpc` via `POST /sessions`, polls `GET /models`
- [x] `ProjectTree` → `GET /api/projects/files?project_path=...&path=...` for directory expansion
- [x] `FilePreview` → `GET /api/projects/files/read?project_path=...&file_path=...` for file content
- [x] `useFileContent` hook → real fetch (via `readFile`)
- [x] `useModels` hook → real fetch with pi init + polling fallback

#### 1.2 Backend route scheme
- [x] All project-scoped endpoints now use `project_path` query param instead of `{project_name}` route param
- [x] Route prefix changed from `/api/projects/{project_name}` to `/api/projects`
- [x] Fixed `StreamWriter.write()` — it's sync, only `drain()` is async (was causing 500 on session create)
- [x] Fixed `project_path` resolution matching `browse.py` / `project.py` (uses `Path.home() / "Projects"`)
- [x] Fixed `files.py` to return `entry.relative_to(target_path)` (was returning project-root-relative paths)
- [x] `FolderSelector` stores full path (not just project name) for backend query params
- [x] `ProjectTree` path construction fixed for nested items
- [ ] WebSocket endpoint: `GET /api/projects/ws?project_path=...` (needs frontend implementation)

#### 1.2 Add WebSocket client to `ChatPanel.tsx`
- [ ] Connect to `ws://localhost:8000/api/projects/{project_name}/ws` on workspace mount
- [ ] Send `{kind: "chat", message: "..."}` for user messages
- [ ] Render `kind: "rpc_event"` messages as streaming assistant responses
- [ ] Handle `kind: "response"` for command responses (model switch, state, etc.)
- [ ] Handle `kind: "extension_ui_request"` for interactive prompts
- [ ] Send warm-up command (`get_session_stats`) on connect
- [ ] Handle `kind: "extension_ui_response"` auto-acks
- [ ] Add connection status indicator (connected/disconnecting/error)
- [ ] Add reconnection logic for WebSocket drops

### Phase 2: Fix Backend Gaps

#### 2.1 Fix session API to use real RPC data
- [ ] `GET /sessions` → return real session info from RPC `get_state`
- [ ] `GET /sessions/{id}` → return data from `get_state` response (sessionName, model, thinkingLevel, etc.)
- [ ] Add proper session ID tracking in the RPC process mapping
- [ ] `POST /sessions` → wire `new_session` + `set_session_name` + `set_model` fully

#### 2.2 Add CORS middleware to `main.py`
- [ ] `fastapi.middleware.cors.CORSMiddleware` for dev (frontend :5173 → backend :8000)
- [ ] Allow origins, methods, headers

### Phase 3: Polish

- [ ] Implement extension UI dialog in frontend (`select`, `confirm`, `input`, `editor` methods)
- [ ] Add loading states and error handling across all components
- [ ] Add rate limiting and connection pooling
- [ ] Session cleanup / auto-expunge logic
- [ ] Backend unit tests for RPC integration
- [ ] Export session (`export_html`, `get_messages`) via WebSocket
- [ ] File tree search/filter
- [ ] Model switching from UI actually calls `set_model` via WebSocket
