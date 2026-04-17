# FastAPI React Pi

FastAPI backend + React (TypeScript) frontend for the Pi coding agent.

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Backend** | Python 3.13 · FastAPI · Uvicorn · aiofiles · Pydantic |
| **Frontend** | React 19 · TypeScript 6 · Vite · CSS Modules |
| **Package mgr** | uv (Python) · bun (Node) |

## Project Structure

```
├── backend/app/
│   ├── main.py              # FastAPI entry point
│   ├── api/                 # Route modules
│   │   ├── project.py       # Project CRUD
│   │   ├── session.py       # Session management
│   │   ├── files.py         # File browser/read
│   │   ├── model.py         # Model listing/switching
│   │   └── chat.py          # Chat + WebSocket
│   ├── schemas/             # Pydantic models
│   └── core.utils.py        # Helpers
├── frontend/src/
│   ├── App.tsx              # View router (folders → models → workspace)
│   ├── main.tsx             # Entry point
│   ├── index.css            # Global dark theme
│   ├── store/AppContext.tsx # Shared state (folder, model, selectedFile)
│   ├── types/index.ts       # TypeScript interfaces
│   ├── services/mockData.ts # Mock data (folders, files, models, contents)
│   ├── hooks/               # Custom hooks (useModels, useFileContent)
│   ├── views/               # Top-level views
│   │   ├── FolderSelector   # 1. Browse & select folder → "Open"
│   │   ├── ModelSelector    # 2. Pick model → "Switch & Open"
│   │   └── Workspace        # 3. File tree + preview + chat
│   └── components/          # Reusable UI components
│       ├── ProjectTree      # Left sidebar: collapsible file tree
│       ├── FilePreview      # Center: syntax-highlighted viewer
│       └── ChatPanel        # Right: chat + model dropdown
├── pyproject.toml           # Python deps
├── uv.lock                  # Python lockfile
├── frontend/bun.lock        # Node lockfile
└── main.py                  # Root shim
```

## Development

### Backend (FastAPI)

```bash
cd backend
uv run python app/main.py        # Starts on :8000
# Docs auto-generated at :8000/docs
```

### Frontend (React + Vite)

```bash
cd frontend
bun dev                          # Starts on :5173
bun run build                    # Production build → dist/
```

### Run Both

Open two terminals and start each dev server independently.

## Architecture

### App Flow (3 steps)

```
FolderSelector ──open──→ ModelSelector ──switch──→ Workspace
   (step 1)               (step 2)                   (step 3)
```

1. **Folder Selector** — Browse folders → click "Open"
2. **Model Selector** — Pick AI model → click "Switch Model & Open"
3. **Workspace** — 3-column layout:
   - **Left**: Project file tree (expand/collapse folders, click files)
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
  selectedFile: string | null;       // path of selected file
}
```

Access via `useApp()` hook throughout the component tree.

### Mock Data

Currently all data is mocked (`services/mockData.ts`). Backend wiring is pending.

## API Contract (Planned)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/projects` | List project folders |
| `POST` | `/api/projects/{name}/start` | Initialize project |
| `GET` | `/api/projects/{proj}/sessions` | List sessions |
| `POST` | `/api/projects/{proj}/sessions` | Create session |
| `GET` | `/api/projects/{proj}/files` | List files in path |
| `GET` | `/api/projects/{proj}/files/{path}` | Read file contents |
| `GET` | `/api/models` | List available models |
| `POST` | `/api/sessions/{id}/model` | Switch model |
| `POST` | `/api/projects/{proj}/sessions/{id}/chat` | Send message |
| `WS` | `/api/projects/{proj}/ws/chat/{id}` | Real-time streaming |

## Important Paths

- **Backend root**: `backend/app/`
- **Frontend root**: `frontend/`
- **Config**: `pyproject.toml` (Python), `frontend/package.json` (Node)
- **Docs**: `README.backend.md`, `docs/`

## Development Conventions

- **Python**: ruff for linting, pytest for tests
- **TypeScript**: strict mode, verbatimModuleSyntax enabled
- **CSS**: scoped per-component, no CSS-in-JS
- **Branches**: `backup/*` for preservation snapshots

## Current Status

| Area | Status |
|------|--------|
| Backend API | Scaffolded, needs fixing (file read 404, WebSocket stub) |
| Frontend UI | Complete, mock data only |
| Frontend/Backend wiring | Pending |
| Pi RPC integration | Not started |
| Testing | Not started |
