# FastAPI + React (TypeScript) Integration Plan for Pi Coding Agent

## Objective
Create a **FastAPI server** (using **uv** and **Python 3.13**) with a **React front‑end written in TypeScript**. The app should let the user:
1. Pick a project folder (any sub‑directory of the server).
2. Pick an existing session for that folder or start a new one.
3. See the selected project in a **file‑tree** view, open any file to view its text, and have a **chat console** where they can talk to the Pi coding agent (via RPC) and change the model used in the current session.

---

## 1. High‑level Architecture
```
            +------------------------+
            |  React + TS Front‑end  |
            |  (Vite)                |
            +-----------+------------+
                        |
      HTTP (JSON)      |  (async calls, fetch)
           +----------------------------+
           |   FastAPI (Python 3.13)   |
           |  - Project browsing         |
           |  - Session management       |
           |  - File read API            |
           |  - Model switch endpoint    |
           +-------------------+--------+
                               |
          +--------------------+-----------------------------+
          |        |                     |                      |
 +-------------------+   +-------------------+    +-------------------+
 |  Process: Pi Rpc  |   |  Process: Pi Rpc  |    |  Process: Pi Rpc  |
 |  Agent (sub‑proc) |   |  (optional)      |    |  (optional)      |
 +-------------------+   +-------------------+    +-------------------+
          ^                     ^                        ^
          |                     |                        |
   stdin/stdout (JSONL)   stdin/stdout (JSONL)   stdin/stdout (JSONL)
```
- The **FastAPI** server is the single source of truth for user‑action -> agent communication.
- The Pi **agent** runs in *RPC mode* as a separate subprocess, communicated with over **stdin/stdout** (JSONL). It is started by the backend when a new session is needed or a steering message is required.
- All UI interactions flow: *frontend → FastAPI → (optional) Pi Rpc → (events) → Frontend*.
- Sessions are stored as JSONL files inside a hidden folder (`.pi/sessions/`) that lives **inside the chosen project folder**. The path `sessionFile` is exposed via `GET /session/{sessionId}`.

---

## 2. Tech‑stack Decision
| Layer         | Technology                | Reason                                                                 |
|---------------|---------------------------|------------------------------------------------------------------------|
| Server runtime| **uv** (Python 3.13)      | Lightning fast installation, lockfile (`uv.lock`) gives reproducible deps. |
| Backend       | **FastAPI** (async)      | OpenAPI spec, modern async I/O ideal for long‑running agent I/O.     |
| Front‑end     | **React** (TypeScript) on **Vite** (TS) | Fast dev server, out‑of‑the‑box TS support, small bundle. |
| UI components| Simple CSS + **React‑Query** (or **SWR**) for data fetching, **Headless UI** for dropdowns. |
| Data store    | Plain **JSONL** files for sessions (no DB required). |
| Process mgmt  | `asyncio.create_subprocess_exec` (Python) – keep one Pi Rpc instance per session. |
| Testing       | Pytest (backend) + React Testing Library (frontend). |

---

## 3. Project Directory Layout
```
fastapi-react-pi/
├── backend/                     # FastAPI source
│   ├── app/
│   │   ├── api/                # routers
│   │   │   ├── project.ts
│   │   │   ├── session.ts
│   │   │   ├── files.ts
│   │   │   └── model.ts
│   │   ├── core/               # utils, session registry
│   │   ├── schemas/            # pydantic models
│   │   └── main.py
│   ├── pyproject.toml
│   └── uv.lock
├── frontend/                    # React + Vite
│   ├── src/
│   │   ├── components/
│   │   │   ├── Home.tsx
│   │   │   ├── ProjectSelector.tsx
│   │   │   ├── SessionSelector.tsx
│   │   │   ├── ProjectTree.tsx
│   │   │   ├── FileViewer.tsx
│   │   │   ├── ChatWindow.tsx
│   │   │   └── ModelPicker.tsx
│   │   ├── hooks/
│   │   ├── services/
│   │   │   └── api.ts          # axios instance (baseURL http://localhost:8000)
│   │   └── App.tsx
│   ├── public/
│   ├── package.json
│   └── vite.config.ts
├── .gitignore
└── README.md
```

---

## 4. API Surface (REST JSON)

### 4.1 Project & Session
```http
GET  /api/projects
POST /api/projects/{projectName}/start
GET  /api/projects/{projectName}/sessions
POST /api/projects/{projectName}/sessions  # body: {name, parentSession?}
GET  /api/projects/{projectName}/sessions/{sessionId}
```

### 4.2 Files
```http
GET  /api/projects/{projectName}/files?path=src/backend/app
GET  /api/projects/{projectName}/files/{absolutePath}
```

### 4.3 Models
```http
GET  /api/models
POST /api/sessions/{sessionId}/model   # body: {modelId}
```

### 4.4 Chat
```http
POST /api/projects/{projectName}/sessions/{sessionId}/chat
# body: {message, streamingBehavior?}
GET  /api/projects/{projectName}/sessions/{sessionId}/chat
# returns array of message objects (text, agent reply, etc.)
```

> **Note**: Each `POST /.../chat` spawns (if needed) a Pi Rpc subprocess tied to the selected **sessionId** and returns immediately with a `taskId`. The backend opens a dedicated async task that reads Pi’s stdout in real‑time and pushes events through a **WebSocket** (FastAPI WebSocket endpoint) to the front‑end. The front‑end can optionally poll `/chat` if WebSocket isn’t required.

---

## 5. Data Model (pydantic)

### Session JSONL entry (simplified)
```json
{
  "sessionId": "b115c39c",
  "name": "auth‑bug‑work",
  "project": "my‑project",
  "messages": [
    {"role": "user", "content": "How do I fix this auth error?"},
    {"role": "assistant", "content": "..."},
    ...
  ],
  "model": {"id": "claude-sonnet-4-20250514", "provider": "anthropic"},
  "thinking": "medium"
}
```

### File metadata
```json
{
  "path": "src/backend/app/main.py",
  "isDirectory": false,
  "size": 2847,
  "sha256": "abcd1234..."
}
```

### Model config
```json
{
  "id": "claude-sonnet-4-20250514",
  "name": "Claude Sonnet 4",
  "provider": "anthropic",
  "contextWindow": 200000,
  "maxTokens": 16384
}
```

---

## 6. Session Management Flow
1. **Home** → User clicks *“Select Project”*.  
   - Frontend fetches list of sub‑folders of current working directory (backend call) → displays in a modal.
2. **Project selected** → URL becomes `/:projectId`.  
   - UI shows *Session Selector*.
3. **Session selector**:
   - Backend returns list of JSONL files in `project/<projectId>/.pi/sessions/`.
   - UI renders a dropdown + *Start New Session* button.
4. **Start New Session** → POST → backend creates a fresh `new_session.jsonl` inside the project’s session folder, returns a `sessionId` and a *base sessionId* (optional parent) for forking later.
5. UI navigates to **Chat Screen** (client‑side routing). The current state (project, session, current model) is stored in a React `useContext` (so refreshes survive page reload).
6. **File Tree** loads from `/api/projects/.../files?path=` (recursive). File navigation updates a central `selectedFile` state, and a REST GET loads the file’s `text` from `/api/files/...`.
7. **Model list** is fetched once when the session is entered; the first model is pre‑selected. The “Apply Model” button triggers `POST /sessions/{sessionId}/model` (no UI round‑trip needed for response – the backend replies “OK”).
8. **Conversation** is a bidirectional data stream:
   - UI sends each utterance via `POST /.../chat` (with optional `streamingBehavior` for `prompt`).
   - The backend streams the Pi Rpc response via **WebSocket** (`ws://localhost:8000/ws/chat/{sessionId}`) so the UI can display the partial assistant messages as they arrive (using the same `assistantMessageEvent` fields described in the RPC knowledge base).
   - When the agent finishes a turn, the backend confirms the event (`message_end`) and the UI can let the user type the next message.

---

## 7. Implementation Roadmap (with milestones)

| Milestone | Tasks | Owner | Est. Time |
|----------|-------|-------|------------|
| **M0 – Boilerplate** | - `uv init` with `fastapi` & `uvicorn`<br>- `npm create vite@latest frontend -- --template react-ts` | Backend dev | 1 day |
| **M1 – Project / Files API** | - Serve `os.listdir` for given path (with security checks)<br>- `GET /files/:path` reads file text (use `aiofiles` for async I/O) | Backend dev | 2 days |
| **M2 – Session API** | - Session JSONL load / create / list in `project//.pi/sessions/`<br>- `POST /sessions/{id}/model` forwards to Pi (maintain a map `sessionId → PiProcess`) | Backend dev | 3 days |
| **M3 – Background Agent Launcher** | - Function `launch_rpc(process_name, session_id, project_path)`<br>- Keep a global `/sessions/{id}/process` dict, reuse if process alive, else spawn a new Pi RPC with correct `--session-dir` and parent session (if needed).<br>- Async task that reads stdout → pushes events to a **FastAPI WebSocket** for that session. | Backend dev | 3 days |
| **M4 – WebSocket Client** | - FastAPI `@websocket` endpoints (`/ws/chat/{sessionId}`) that accept a connection and forward each line from Pi’s stdout to the client (JSONL parsing + mapping). | Backend dev | 2 days |
| **M5 – Frontend Home + Project Selector** | - Implement folder selection modal, list sub‑directories via fetch. | Frontend dev | 1.5 days |
| **M6 – Session Selector + New Session** | - Call backend session endpoints, store result in React context.<br>- “Start New Session” triggers `POST` and navigates to chat screen. | Frontend dev | 1.5 days |
| **M7 – File Tree Viewer** | - Component using `react-sortable-tree` or custom recursion.<br>- On click → request file contents via REST; render in centered preview panel. | Frontend dev | 2 days |
| **M8 – Model Picker + Apply** | - Fetch list of models (`GET /models`).<br>- Dropdown shows model names, current one highlighted. Clicking “Apply” → `POST /sessions/{sessionId}/model`. | Frontend dev | 1 day |
| **M9 – Chat UI + Agent Communication** | - Chat area (list of messages).<br>- Input box -> `POST /.../chat` (or `prompt`) with correct `type` (prompt, steer, follow_up).<br>- WebSocket receives `assistantMessageEvent` and renders incremental text (using the delta format).<br>- On `agent_end` push final message to the list. | Frontend dev | 3 days |
| **M10 – Persistence & Cleanup** | - On page unload or route change, send `agent.abort()` for the session (if still alive).<br>- Offer “Export Session as HTML” button (`/api/export`). | Backend + Frontend | 1.5 days |
| **M11 – Testing & Docs** | - Write Pytest for each API (including file read edge‑cases).<br>- Jest + React Testing Library for UI components.<br>- Generate OpenAPI spec, add a README with run instructions. | QA | 2 days |
| **M12 – Deploy / Docker (optional)** | - Add `Dockerfile` for backend (uv + python 3.13) and `Dockerfile` for frontend (node 20 → Vite build).<br>- `docker-compose.yml` for dev (`backend` & `frontend` in same compose). | DevOps | 2 days |

**Total estimated effort:** ≈ 25–30 developer-days (12‑14 working weeks). This is a realistic scope for a single 2‑person team.

---

## 8. Security & Edge Cases
- **Path traversal:** Always resolve the resolved path (`os.path.abspath`) and ensure it starts with the configured project_root path.
- **Rate limiting:** Limit file reads (`GET /files`) to 10 req/s per client; use FastAPI `asyncio.sleep`.
- **Concurrent agent instances:** Each session may have its own Pi Rpc process; ensure only one process per session ID. Use a `session_id → process` dict with `asyncio.Lock`.
- **Session isolation:** Delete (or move) a session folder after a project is removed; cleanup stale `*.jsonl` after 30 days via a cron (or on app start).
- **Model permissions:** Backend validates that the selected `modelId` is present in the *available_models* list for that provider.

---

## 9. Open Questions / Decisions
- **Do we want a separate API for “apply model” or let the client just switch UI state (optimistic)?** We’ll implement the explicit POST for safety.
- **Should we use `WebSocket for chat` or fallback to simple polling?** WebSocket gives smoother UI; we’ll implement it and keep a `GET /chat` as a backup for debugging.
- **Do we commit a default `.pi/sessions` configuration file for each project?** It can contain the `session_name` so that UI shows a nice title.
- **How to handle images in prompts?** The backlog spec for the Pi agent already defines `images` field in `prompt`. The UI can optionally upload an image via a `<input type=file>` and pass it as base64 string (JSON) – not required for MVP.

---

## 10. Quick Start (Developer Setup)
```bash
# Clone / create repo
git clone <repo-url>
cd fastapi-react-pi

# --------------------
# Backend
# --------------------
python3.13 -m venv .venv
source .venv/bin/activate
uv venv          # creates .venv but uses uv’s lockfile, ensures python 3.13
uv install       # installs from pyproject.toml (fastapi, uvicorn, aiofiles, pydantic)
uv add fastapi uvicorn[standard] aiofiles
uv run --project fastapi-server          # runs uvicorn backend/app/main.py

# --------------------
# Frontend
# --------------------
cd frontend
npm i
npm run dev                # starts Vite on http://localhost:5173

# Development workflow:
# • Modify backend → uvicorn reload (auto-reload)
# • Modify React – hot reload in browser at localhost:5173
```

**Production** – Use `uvicorn fastapi-server --host 0.0.0.0 --port 8000` behind a reverse proxy (Caddy/Nginx). Build React (`npm run build`) and serve static files via FastAPI’s `StaticFiles` router.

---

## 11. Appendices
### A. Example FastAPI Endpoint – List Files
```python
@router.get("/files", response_model=List[FileInfo])
async def list_project_files(project: str, path: str = "/"):
    # Validate that resolved path is inside project root
    base = resolve_relative_path(project_root, path)
    if not base.startswith(project_root):
        raise HTTPException(403, "Beyond project root")
    files = []
    for entry in os.scandir(base):
        stat = await async_lambda.run_in_thread(io.stat, entry.path)
        files.append(FileInfo(path=entry.name, is_dir=entry.is_dir(), size=stat.st_size))
    return files
```

### B. React Context Sketch (TypeScript)
```ts
interface SessionContext {
  project: string;
  session: SessionMetadata; // id, name, messages, currentModel
  setProject: (proj: string) => void;
  setSession: (s: SessionMetadata) => void;
}
const SessionContext = createContext<SessionContext>({project: '', session: null, setProject: () => {}, setSession: () => {}});
```

### C. WebSocket Message Format (client side)
```ts
interface AssistantMessageEvent {
  type: 'text_delta' | 'thinking_delta' | 'toolcall_start' | 'done' | 'error';
  delta: string;        // only for delta types
  // you can also map to UI: push delta to assistant's message container.
}
socket.onmessage = (event) => {
  const data = JSON.parse(event.data);
  // event.type will be 'assistantMessageEvent' key that contains this sub‑object
};
```

---

### 📌 TL;DR
- **FastAPI** handles project navigation, session files, model config, and streams agent data via WebSocket.
- **React+TS** gives a clean UI: folder picker → session picker → tree + preview + chat + model picker.
- The **Pi assistant** runs in its own RPC process, started per session, fed via stdin/stdout JSONL and bridged to the front‑end through the FastAPI server.
- A solid **session/process map** makes switching sessions painless and keeps the agent isolated.

Feel free to adjust the folder layout, add a small CSS framework (Tailwind or DaisyUI) or switch to Ant Design for richer components. The plan is intentionally modular – you can replace “Vite” with “Create‑React‑App” and still follow the same API/architecture approach.

--- 

*Documented on 2026‑04‑14 by the integration team.*