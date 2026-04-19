# FastAPI React Pi

FastAPI backend + React (TypeScript) frontend for the Pi coding agent.

## Quick Start

### Backend

```bash
cd backend
uv run uvicorn app.main:app --reload   # :8000, auto-reload
# Docs: http://localhost:8000/docs
```

### Frontend

```bash
cd frontend
bun dev                                 # :5173
bun run build                           # → dist/
```

### Tests

```bash
cd tests
API_BASE=http://127.0.0.1:8000 WS_BASE=ws://127.0.0.1:8000 uv run pytest -v
```

## Architecture

```
Client ──REST──→ Backend (metadata only: list, create, browse, read)
       ──WS────→ Backend ──stdin/stdout──→ pi --rpc process
                       (all Pi RPC: prompt, set_model, compact, etc.)
```

### Core Principle

**REST = metadata, WebSocket = all Pi RPC actions.**

- Session creation returns a `SessionRecord` with `session_id`
- Model switching via REST only updates metadata; the actual `set_model` is sent by the WS relay
- Sessions outlive WebSocket connections — disconnect/reconnect is painless
- Each session runs its own `pi --mode rpc` process

### Session Lifecycle

```
creating → running ──WS disconnect→ running (ws disconnected)
                    │              └──WS reconnect→ running (ws reconnected)
                    ├──client message → forwarded to stdin
                    └──process events → event buffer → WS relay
                    │
close(compact) → stopped (process terminated, record removed)
delete(abort)  → stopped (process terminated, record removed)
```

## API Endpoints

### Projects
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/` | List project folder names under `~/Projects` |
| `GET` | `/api/projects/info` | Project details + sessions (`?project_path=...`) |
| `POST` | `/api/projects/` | Create session (`?project_path=...`, body: `{model_id, name?}`) |

### Sessions
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/projects/{id}/close` | Compact + abort + terminate |
| `POST` | `/api/projects/{id}/delete` | Abort + terminate (no compact) |
| `POST` | `/api/projects/{id}/model` | Switch model metadata |

### Files
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/browse` | Browse directories recursively |
| `GET` | `/api/projects/files` | List files in project dir |
| `GET` | `/api/projects/files/read` | Read file contents |

### Models
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/models/` | List models (queries RPC if `session_id` provided) |

### WebSocket
| Endpoint | Description |
|----------|-------------|
| `WS /api/projects/ws?session_id=...` | Bidirectional JSON relay |

## Project Structure

```
├── backend/app/
│   ├── main.py              # FastAPI entry point
│   ├── api/                 # Route modules
│   ├── schemas/             # Pydantic models
│   └── session_manager.py   # Core: pi --rpc lifecycle
├── frontend/src/
│   ├── views/               # FolderSelector, ModelSelector, Workspace
│   ├── components/          # ProjectTree, FilePreview, ChatPanel
│   ├── hooks/               # useModels, useFileContent, useWebSocket
│   ├── store/AppContext.tsx # Shared state
│   └── services/api.ts      # API client
├── tests/                   # Integration tests (pytest, uv)
└── docs/                    # Design plans
```

## Current Status

| Area | Status |
|------|--------|
| Backend API | ✅ Complete |
| Session Manager | ✅ Complete |
| Frontend UI | ✅ Complete |
| Frontend/Backend wiring | ✅ Complete |
| WebSocket relay | ✅ Complete |
| Integration tests | 🟡 26/26 passing (3 of 7 flows) |
