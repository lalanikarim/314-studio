# Frontend — React + TypeScript

React 19 frontend for the Pi coding agent integration.

## Quick Start

```bash
cd frontend
bun dev        # Start dev server on :5173
bun run build  # Production build → dist/
```

## Tech Stack

| Category | Technology |
|----------|------------|
| **Framework** | React 19 (Vite 8) |
| **Language** | TypeScript 6 (strict mode) |
| **Package manager** | Bun |
| **Linting** | ESLint 9 + TypeScript ESLint |
| **CSS** | CSS Modules (scoped per-component) |
| **State** | React Context (single AppContext) |

## Project Structure

```
frontend/src/
├── App.tsx                  # View router (folders → models → workspace)
├── main.tsx                 # Entry point
├── index.css                # Global dark theme
│
├── store/
│   └── AppContext.tsx       # Shared state: view, folder, model, file
│
├── types/
│   └── index.ts             # Model, FileNode, Message, AppState
│
├── services/
│   └── api.ts               # API client: browse, projects, sessions, files, models
│
├── hooks/
│   ├── useModels.ts         # Fetch models from Pi RPC (with session creation)
│   ├── useFileContent.ts    # Fetch file content by projectPath + filePath
│   └── useWebSocket.ts      # WebSocket connection, message routing, reconnection
│
├── views/                   # Top-level views (mutually exclusive)
│   ├── FolderSelector.tsx   # Step 1: browse & select folder
│   ├── ModelSelector.tsx    # Step 2: pick model & create session
│   └── Workspace.tsx        # Step 3: file tree + preview + chat
│
└── components/              # Reusable UI components
    ├── ProjectTree.tsx      # Left sidebar: collapsible directory tree
    ├── FilePreview.tsx      # Center: syntax-highlighted file viewer
    └── ChatPanel.tsx        # Right: chat + model dropdown
```

## App Flow

```
FolderSelector ──open──→ ModelSelector ──switch──→ Workspace
   (step 1)               (step 2)                   (step 3)
```

1. **FolderSelector** — Browse directories via `GET /api/browse` → pick one → "Open"
2. **ModelSelector** — Fetch models from Pi RPC → pick one → "Switch Model & Open"
3. **Workspace** — 3-column layout:
   - **Left**: Project file tree (expand/collapse folders, click files)
   - **Center**: File content preview (line numbers, loading/error states)
   - **Right**: Chat interface with WebSocket relay to Pi RPC

## State Management

### AppContext

Single React Context holds all global state:

```ts
interface AppState {
  view: 'folders' | 'models' | 'workspace';
  selectedFolder: string | null;      // full path of selected folder
  selectedModel: Model | null;        // user's model choice
  currentModel: Model | null;         // active model for chat
  selectedFile: string | null;        // path of selected file
}
```

Access via `useApp()` hook:

```tsx
const { view, selectedFolder, selectedModel, currentModel, selectedFile, setView } = useApp();
```

## Hooks

### `useModels(projectPath?, selectedModel?)`

Fetches available models from Pi RPC.

**Flow:**
1. If `projectPath` provided → creates a Pi RPC session via `POST /api/projects/`
2. Polls `GET /api/models?session_id=...` until models arrive (15s timeout)
3. Falls back to default models on error/timeout
4. Returns `{ models, loading, error, sessionId }`

**Usage:**
```tsx
// ModelSelector — creates session, fetches real models
const { models, loading, error, sessionId } = useModels(selectedFolder, selectedModel);

// ChatPanel — just show the model list (no session needed)
const { models } = useModels();
```

### `useFileContent(projectPath, filePath)`

Fetches file content from the backend.

```tsx
const { content, fileName, loading, error } = useFileContent(projectPath, filePath);
```

- `projectPath`: full path of the project folder
- `filePath`: relative path inside the project (e.g. `src/main.py`)

### `useWebSocket(projectFolder, modelRef)`

Manages a single WebSocket connection to Pi RPC.

```tsx
const { state, send, messages, pendingUiRequest, respondToUi, disconnect } = useWebSocket(
  projectFolder,
  modelRef
);
```

**Features:**
- Auto-connect on mount, auto-reconnect on disconnect (2s retry)
- Plain text → wrapped as `{ type: "prompt", message: "..." }`
- Routes inbound messages: `rpc_event`, `extension_ui_request`, `extension_ui_response`
- Auto-acks fire-and-forget extension UI methods
- Tracks connection state: `connecting | connected | disconnected | error`

**Message types:**

| Type | Direction | Description |
|------|-----------|-------------|
| `{ type: "prompt", message: "..." }` | Client → | Chat message |
| `{ type: "get_state" }` | Client → | Query session state |
| `{ type: "compact" }` | Client → | Compact conversation |
| `{ type: "abort" }` | Client → | Abort current turn |
| `{ type: "response", id: "..." }` | Backend → | Command response |
| `{ kind: "rpc_event", event: {...} }` | Backend → | Streaming events |
| `{ kind: "extension_ui_request", ... }` | Backend → | Interactive UI prompt |
| `{ kind: "extension_ui_response", ... }` | Backend → | Auto-ack response |

## API Service

All fetch calls use relative URLs (works with Vite dev server or behind a reverse proxy).

```ts
// Browse directories
import { listDirectories } from './services/api';
const dirs = await listDirectories('/path/to/dir');

// List projects
import { listProjects, getProjectInfo } from './services/api';
const projects = await listProjects();
const info = await getProjectInfo(projectPath);

// Create session
import { createSession } from './services/api';
const session = await createSession(projectPath, modelId, 'My Session');

// List models (with session)
import { listModels } from './services/api';
const models = await listModels(sessionId);

// File operations
import { listFiles, readFile } from './services/api';
const files = await listFiles(projectPath, 'src/');
const content = await readFile(projectPath, 'src/main.py');
```

## Dependencies

```json
{
  "dependencies": {
    "react": "^19.2.4",
    "react-dom": "^19.2.4"
  },
  "devDependencies": {
    "typescript": "~6.0.2",
    "vite": "^8.0.4",
    "@vitejs/plugin-react": "^6.0.1",
    "eslint": "^9.39.4",
    "typescript-eslint": "^8.58.0"
  }
}
```

## Development Conventions

- **TypeScript**: strict mode, `verbatimModuleSyntax` enabled
- **CSS**: scoped per-component via CSS Modules, no CSS-in-JS
- **Components**: functional components with custom hooks for logic
- **State**: AppContext for global state, local state for component-specific concerns
- **API**: all network calls go through `services/api.ts`, never direct `fetch` in components
