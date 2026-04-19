# FastAPI React Pi

FastAPI backend + React (TypeScript) frontend for the Pi coding agent.

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Backend** | Python 3.13 · FastAPI · Uvicorn · aiofiles · Pydantic · uv |
| **Frontend** | React 19 · TypeScript · Vite · Bun · CSS Modules |
| **Tests** | pytest · pytest-asyncio · httpx · websockets · uv |

## Project Structure

```
├── backend/app/
│   ├── main.py                  # FastAPI entry point, lifespan hooks
│   ├── api/                     # Route modules
│   │   ├── browse.py            # Browse directories (recursive)
│   │   ├── project.py           # Project list, info, session create
│   │   ├── session.py           # Close/delete session, model switch
│   │   ├── files.py             # List/read files with path validation
│   │   ├── model.py             # List models (RPC-aware + defaults)
│   │   └── chat.py              # WebSocket bidirectional RPC relay
│   ├── schemas/                 # Pydantic models
│   └── session_manager.py       # Core: spawn/manage pi --rpc processes
├── frontend/src/
│   ├── App.tsx                  # View router (folders → models → workspace)
│   ├── main.tsx                 # Entry point
│   ├── index.css                # Global dark theme
│   ├── store/AppContext.tsx     # Shared state (folder, model, file)
│   ├── types/index.ts           # TypeScript interfaces
│   ├── services/api.ts          # API client (replaces mock data)
│   ├── hooks/                   # useFileContent, useModels, useWebSocket
│   ├── views/                   # Top-level views
│   │   ├── FolderSelector.tsx   # Browse & select folder
│   │   ├── ModelSelector.tsx    # Pick model
│   │   └── Workspace.tsx        # File tree + preview + chat
│   └── components/              # Reusable UI components
│       ├── ProjectTree.tsx      # Left sidebar: collapsible file tree
│       ├── FilePreview.tsx      # Center: syntax-highlighted viewer
│       └── ChatPanel.tsx        # Right: chat + model dropdown
├── tests/                       # Integration tests (pytest, uv)
│   ├── conftest.py              # Fixtures + subfixture support
│   ├── test_utils.py            # Shared HTTP/WS helpers & constants
│   ├── integration_test_harness.py  # CLI entry point (run-tests script)
│   ├── test_flow1_browse_chat.py       # 12 tests
│   ├── test_flow2_file_browse.py       # 7 tests
│   ├── test_flow3_multi_session.py     # 7 tests
│   ├── test_flow4_model_switch.py      # Pending
│   ├── test_flow5_close_delete.py      # Pending
│   ├── test_flow6_error_handling.py    # Pending
│   └── test_flow7_shutdown_cleanup.py  # Pending
├── docs/
│   ├── design/                  # Architecture plans
│   │   ├── integration-test-plan.md  # Test plan (flows 1–7)
│   │   └── session-manager-plan.md   # Session manager design
│   └── backend_status.md        # Implementation progress
├── AGENTS.md                    # This file — project reference
├── pyproject.toml               # Python deps (root shim)
├── pyproject.toml               # Python deps (backend/)
├── uv.lock                      # Python lockfile
├── frontend/package.json        # Node deps
└── frontend/bun.lock            # Node lockfile
```

## Architecture

### Core Principle: REST = metadata, WebSocket = all Pi RPC actions

```
Client ──REST──→ Backend (metadata only: list, create, browse, read)
       ──WS────→ Backend ──stdin/stdout──→ pi --rpc process
                       (all Pi RPC: prompt, set_model, compact, etc.)
```

### Session Manager

One `pi --mode rpc` process per session. Sessions outlive WebSocket connections.

```
Session lifecycle:
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

### Frontend App Flow

```
FolderSelector ──open──→ ModelSelector ──switch──→ Workspace
   (step 1)               (step 2)                   (step 3)
```

1. **Folder Selector** — Browse folders → click "Open"
2. **Model Selector** — Pick AI model → click "Switch & Open"
3. **Workspace** — 3-column layout:
   - **Left**: Project file tree (expand/collapse, click files)
   - **Center**: File content preview with line numbers
   - **Right**: Chat interface + model switcher

### State Management

Single React Context (`AppContext`) holds global state:

```ts
interface AppState {
  view: 'folders' | 'models' | 'workspace';
  selectedFolder: string | null;
  selectedModel: Model | null;
  currentModel: Model | null;
  selectedFile: string | null;
}
```

Access via `useApp()` hook throughout the component tree.

## Development

### Backend (FastAPI)

```bash
cd backend
uv run uvicorn app.main:app --reload    # Starts on :8000, auto-reload
# API docs at http://localhost:8000/docs
```

### Frontend (React + Vite)

```bash
cd frontend
bun dev                          # Starts on :5173
bun run build                    # Production build → dist/
```

### Tests

```bash
cd tests
API_BASE=http://127.0.0.1:8000 WS_BASE=ws://127.0.0.1:8000 uv run pytest -v
```

Or use the harness:

```bash
API_BASE=http://127.0.0.1:8000 WS_BASE=ws://127.0.0.1:8000 uv run run-tests --flows flow1
```

## API Endpoints

### Projects

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/` | List project folder names under `~/Projects` |
| `GET` | `/api/projects/info` | Project details + all sessions (`?project_path=...`) |
| `POST` | `/api/projects/` | Create new session (`?project_path=...`, body: `{model_id, name?}`) |

### Sessions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/projects/{id}/close` | Compact + abort + terminate (`{session_id, compacted: true}`) |
| `POST` | `/api/projects/{id}/delete` | Abort + terminate, no compact (`{session_id, compacted: false}`) |
| `POST` | `/api/projects/{id}/model` | Switch model metadata (`?model_id=...&provider=...`) |

> **Model switching** is a 2-step process:
> 1. REST updates session metadata only (no RPC)
> 2. Client connects WS — relay auto-sends `set_model` with configured `modelId`

### Files

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/browse` | Browse directories recursively (`?path=...`) |
| `GET` | `/api/projects/files` | List files in project dir (`?project_path=...&path=...`) |
| `GET` | `/api/projects/files/read` | Read file contents (`?project_path=...&file_path=...`) |

### Models

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/models/` | List available models (`?session_id=...` queries RPC if active) |

### WebSocket

| Endpoint | Description |
|----------|-------------|
| `WS /api/projects/ws` | Bidirectional JSON relay. Query: `?session_id=...`. Connect → relay sends `set_model` → messages flow both ways. |

### WebSocket Protocol

```
Client → Backend (stdin):
  {"type":"prompt","message":"..."}    # Chat message
  {"type":"get_state"}                 # Query session state
  {"type":"compact"}                   # Compact conversation
  {"type":"abort"}                     # Abort current turn

Backend → Client (stdout):
  {"type":"response","id":"..."}       # Command response
  {"kind":"rpc_event","event":{...}}   # Streaming events
  {"kind":"extension_ui_request",...}  # Interactive UI prompts
```

## API Contract (Replaces Planned Table from AGENTS.md)

All project-scoped endpoints use `project_path` as a query parameter, not a route parameter. This avoids path resolution issues and is consistent across all endpoints.

## Important Paths

- **Backend root**: `backend/app/`
- **Backend entry**: `backend/app/main.py`
- **Session manager**: `backend/app/session_manager.py` (core logic, ~500 lines)
- **Frontend root**: `frontend/src/`
- **Tests root**: `tests/`
- **Config**: `backend/pyproject.toml` (Python deps), `frontend/package.json` (Node deps)
- **Docs**: `docs/`, `AGENTS.md`, `README.backend.md`

## Current Status

| Area | Status |
|------|--------|
| **Backend API** | ✅ Complete — all endpoints implemented and tested |
| **Session Manager** | ✅ Complete — spawns `pi --mode rpc`, manages lifecycle |
| **Frontend UI** | ✅ Complete — 3-column workspace with file tree, preview, chat |
| **Frontend/Backend wiring** | ✅ Complete — real API calls replace mock data |
| **WebSocket relay** | ✅ Complete — bidirectional JSON over `pi --rpc` stdin/stdout |
| **Extension UI handling** | ✅ Complete — auto-ack fire-and-forget, forward interactive |
| **Integration tests** | 🟡 56/60+ passing (flows 1–3, 5–6 of 7) |
| **Flow 4: Model Switch** | ⏳ Not yet written |
| **Flow 5: Close/Delete** | ✅ 4/4 passing |
| **Flow 6: Error Handling** | ✅ 12/12 passing |
| **Flow 7: Shutdown Cleanup** | ⏳ Not yet written |
