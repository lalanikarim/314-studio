# 314 Studio

FastAPI backend + React (TypeScript) frontend for the Pi coding agent.

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Backend** | Python 3.13 · FastAPI · Uvicorn · aiofiles · Pydantic · uv |
| **Frontend** | React 19 · TypeScript · Vite · Bun · CSS Modules |
| **Tests** | pytest · pytest-asyncio · httpx · uv |

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
│   │   └── chat.py              # SSE stream + REST commands
│   ├── schemas/                 # Pydantic models
│   └── session_manager.py       # Core: spawn/manage pi --rpc processes
├── frontend/src/
│   ├── App.tsx                  # View router (folders → models → workspace)
│   ├── main.tsx                 # Entry point
│   ├── index.css                # Global dark theme
│   ├── store/AppContext.tsx     # Shared state (folder, model, file)
│   ├── types/index.ts           # TypeScript interfaces
│   ├── services/api.ts          # API client (replaces mock data)
│   ├── hooks/                   # useFileContent, useModels, useSSE
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
│   ├── test_utils.py            # Shared HTTP/SSE helpers & constants
│   ├── integration_test_harness.py  # CLI entry point (run-tests script)
│   ├── test_flow1_browse_chat.py       # 12 tests
│   ├── test_flow2_file_browse.py       # 7 tests
│   ├── test_flow3_multi_session.py     # 7 tests
│   ├── test_flow4_model_switch.py      # 4 tests (all passing)
│   ├── test_flow5_close_delete.py      # 4 tests (all passing)
│   ├── test_flow6_error_handling.py    # 12 tests (all passing)
│   ├── test_flow7_shutdown_cleanup.py  # 2 tests (all passing)
│   ├── test_flow8_model_operations.py  # 6 tests (all passing)
├── docs/
│   ├── design/                  # Architecture plans
│   │   ├── integration-test-plan.md  # Test plan (flows 1–8)
│   │   └── session-manager-plan.md   # Session manager design
│   └── kb/                      # Knowledge base (RPC, WebSocket, testing)
├── AGENTS.md                    # This file — project reference
├── pyproject.toml               # Python deps (root shim)
├── pyproject.toml               # Python deps (backend/)
├── uv.lock                      # Python lockfile
├── frontend/package.json        # Node deps
└── frontend/bun.lock            # Node lockfile
```

## Architecture

### Core Principle: REST = metadata, SSE = events, REST = commands

```
Client ──REST──→ Backend (metadata: list, create, browse, read, commands)
       ──SSE───→ Backend ──stdin/stdout──→ pi --rpc process
                       (SSE stream: streaming text, tool calls, events)
Client ──REST──→ Backend (commands: prompt, abort, compact, set_model)
```

### Session Manager

One `pi --mode rpc` process per session. Sessions outlive SSE connections.

```
Session lifecycle:
  creating ──RPC ready──→ running
     │                       │
     │                       ├── SSE disconnect → running (subscribed)
     │                       ├── SSE reconnect  → running (resubscribed)
     │                       ├── REST command   → written to stdin
     │                       └── process events → event buffer → SSE stream
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
API_BASE=http://127.0.0.1:8000 uv run pytest -v
```

Or use the harness:

```bash
API_BASE=http://127.0.0.1:8000 uv run run-tests --flows flow1
```

### Development Notes

- **Never run `python` directly.** Always use `uv run` to execute Python code:
  ```bash
  uv run python script.py    # ✅ correct
  python script.py           # ❌ wrong — uses system python, wrong env
  ```
  This ensures the virtual environment with all project dependencies is used.

- **`timeout` command is not available** (macOS). Use these alternatives:
  - **For asyncio code**: use `asyncio.wait_for(coro, timeout=N)` — this is preferred for async scripts.
  - **For bash**: use `gtimeout` from `coreutils` (`brew install coreutils`), or spawn a background process with a delayed `kill`.
  - **For uv runs**: pass `--timeout` if supported, or wrap in a Python-based timeout.

## Common Gotchas

### React StrictMode double-render in development

React 19's `StrictMode` (enabled in `frontend/src/main.tsx`) **mounts every component twice** in development. This means:

- **`useEffect` runs twice** — any side effect (API calls, session creation, etc.) will execute twice
- **Refs persist** across the two renders — `useRef` values survive, but state (`useState`) does not propagate between them
- **Effect cleanup runs between renders** — the cleanup from the first mount runs before the second mount's effect starts

**Classic bug pattern:** An async operation inside `useEffect` (e.g., creating a session) sets a guard ref after the `await`. The second StrictMode effect runs before the first `await` completes, so the guard is still `false`, and the operation runs again — creating duplicate sessions, double API calls, etc.

**The fix:** Set any deduplication guard **synchronously before the `await`**, not after. Use a `useRef` (not `useState`) since refs persist across StrictMode's double-render while state does not propagate:

```ts
// ❌ WRONG — ref set after await, second StrictMode render sees false
if (!guard.current) {
  guard.current = true;
  const result = await someAsyncCall(); // ← second effect runs before this completes
  // guard.current = true;  ← too late
}

// ✅ CORRECT — ref set synchronously before the await
if (!guard.current) {
  guard.current = true;  // ← set NOW, before any async work
  try {
    const result = await someAsyncCall();
    // ... handle result
  } catch {
    guard.current = false;  // ← reset on failure so retry is possible
  }
}
```

This pattern is used in `frontend/src/hooks/useModels.ts` (`sessionCreatedRef`) to prevent duplicate `POST /api/projects/` calls during session creation.

**Another StrictMode gotcha: effect cleanup cancelling in-flight fetches.**

When a `useEffect` cleanup sets a `cancelled` flag, StrictMode's double-mount causes the first cleanup to run before the second effect. If the second effect has a guard that skips re-execution (e.g., `if (ref.current === value) return`), the first fetch is cancelled and never completes — leaving the UI stuck in a "Loading…" state.

**Fix:** If you have a guard that prevents re-execution, don't cancel in-flight work in the cleanup. The guard is sufficient to prevent duplicate work.

### Integration test sessions leak if cleanup is not in `try/finally`

The integration tests create `pi --rpc` sessions via `POST /api/projects/`. If a test fails **before** reaching the cleanup code (which is not in `try/finally` blocks), the session is left running indefinitely — consuming a Pi process and cluttering the session list.

**Fix:** Always wrap session-creating test flows in `try/finally` and close sessions in the `finally` block:

```python
async def run(result):
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        session_id = None
        try:
            # ... test steps that may create a session ...
            session_id = await create_session(client, result)
            # ... more tests ...
        finally:
            if session_id:
                try:
                    await client.post(f"{API_BASE}/api/projects/{session_id}/close")
                except Exception:
                    pass  # Best-effort cleanup
```

This ensures sessions are always cleaned up, even when tests fail mid-flow.

**Quick cleanup command** (if you ever see orphaned sessions):
```bash
cd tests && API_BASE=http://127.0.0.1:8000 python3 -c "
import asyncio, httpx, os
async def cleanup():
    base = os.environ.get('API_BASE', 'http://127.0.0.1:8000')
    async with httpx.AsyncClient(timeout=30) as c:
        for s in (await c.get(f'{base}/api/projects/sessions')).json():
            await c.post(f'{base}/api/projects/{s[\"session_id\"]}/close')
asyncio.run(cleanup())
"
```

### macOS: no `timeout` command

The Unix `timeout` command is not available on macOS. Use these alternatives:
- **For asyncio code**: use `asyncio.wait_for(coro, timeout=N)`
- **For bash**: use `gtimeout` from `coreutils` (`brew install coreutils`)
- **For uv runs**: pass `--timeout` if supported, or wrap in a Python-based timeout

### Never run `python` directly

Always use `uv run` to execute Python code to ensure the correct virtual environment:
```bash
uv run python script.py    # ✅ correct
python script.py           # ❌ wrong — uses system python, wrong env
```

### Litro/Lit: Components using `@property`/`@state` MUST extend `LitElement`, not `HTMLElement`

This is the #1 cause of `Uncaught TypeError: i.constructor.createProperty is not a function`.

Lit's `@property()` and `@state()` decorators call `target.constructor.createProperty(name, options)` at class-definition time. `createProperty` is a **static method on `LitElement` (via `ReactiveElement`)**, not on the plain `HTMLElement` constructor. If your component extends `HTMLElement` directly, the prototype chain does not include `createProperty`, and the decorator throws at module load.

```typescript
// ❌ WRONG — throws `createProperty is not a function`
import { customElement, property } from 'lit/decorators.js';
@customElement('my-el')
export class MyEl extends HTMLElement {       // ← missing LitElement
   @property() foo = '';
 }

// ✅ CORRECT
import { LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
@customElement('my-el')
export class MyEl extends LitElement {       // ← has createProperty
   @property() foo = '';
 }
```

**Rule:** Any class that uses ANY Lit decorator (`@property`, `@state`, `@query`, etc.) MUST extend `LitElement`. `customElements.define('tag', HTMLElementSubclass)` alone is fine only if you also avoid decorators and use the static `properties` block.

**Note on esbuild/swc:** esbuild's experimental decorator support (enabled via `tsconfigRaw.experimentalDecorators` in the Litro Vite adapter) is sufficient. Do NOT add `vite-plugin-swc` — it causes its own parse errors on TypeScript `as` expressions and is not needed.

### Litro: `window` not available during SSR

Litro uses SSR (Server-Side Rendering) by default. Any code that accesses `window`, `document`, or `localStorage` **during the initial render** will crash the server with `ReferenceError: window is not defined`.

**Fix:** Guard client-only code:
```typescript
// ❌ CRASHES during SSR
private get folderPath(): string {
  return new URLSearchParams(window.location.search).get('folder') || '';
}

// ✅ Safe
private get folderPath(): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('folder') || '';
}
```

**Rule of thumb:** Only access `window`/`document`/`localStorage` inside event handlers (`@click`, `@input`, etc.) or in `updated()` lifecycle — never in `render()` or getters called during `render()`.

### Litro: Backend API proxy — Nitro `routeRules` (not Vite proxy)

The Litro dev server runs through Nitro, **not** Vite's dev middleware. The custom `server/middleware/vite-dev.ts` creates Vite with inline config (it does **not** load `vite.config.ts`), so a `server.proxy` entry in `vite.config.ts` is never consulted. Configure the backend proxy in `nitro.config.ts` instead:

```ts
export default defineNitroConfig({
  routeRules: {
    // Nitro's `**` captures only the portion AFTER /api/, so re-add /api in
    // the target. Query strings are preserved automatically.
    '/api/**': { proxy: 'http://localhost:8000/api/**' },
  },
});
```

A common mistake is `proxy: 'http://localhost:8000/**'` — that strips the `/api` prefix, so `/api/browse` becomes `/browse` on the backend and returns 404. Always include `/api` in the target.

### Litro: Port names use `[...].ts` not `[...catchAll].ts`

The catch-all route file in Litro/Nitro must be named `[...].ts` (not `[...catchAll].ts`). Nitro treats any file matching `[...].ts` as the catch-all handler.

### Litro: Package name is `@beatzball/litro`, not `litro`

The npm package is `@beatzball/litro`. Using `litro` as a dependency name will fail with "No matching version found".

### Litro: `{{ROOT}}` placeholder in page-manifest.ts

The scaffolded `server/stubs/page-manifest.ts` contains `{{ROOT}}` placeholders that must be replaced with the actual absolute path before the catch-all route handler can resolve page modules.

### Litro: Content plugin causes `litro:` import errors

If your project doesn't use the content layer (Markdown/blog), remove the `litroContentPlugin` from `vite.config.ts` AND remove `server/api/posts.ts` and `content/` directory. Otherwise Nitro will fail to resolve `litro:content` imports during build.

### Litro: Use `bun`, not `npm`

The project uses Bun for the frontend. Always use `bun install`, `bun run`, etc. Don't mix npm and bun.

### Litro/Lit: Global styles + Shadow DOM — use CSS custom properties

Lit components render inside **Shadow DOM**, which isolates them from document-level CSS. A `<link>` to a global stylesheet in `<head>` does **not** style anything inside a component's shadow root — `body { font-family: ... }`, `* { box-sizing }`, scrollbar rules, etc. only apply to the light DOM.

**What DOES penetrate Shadow DOM: CSS custom properties (variables).** Inherited properties (including custom properties) cross the shadow boundary. So the working pattern is:

1. Define the entire theme as `:root { --bg-primary: #0f172a; --text-primary: #f1f5f9; ... }` in a single global stylesheet (`public/theme.css`).
2. Inject it once into the document `<head>` via the Litro shell — pass `routeMeta: { head: '<link rel="stylesheet" href="/theme.css" />' }` from `server/routes/[...].ts` (Litro serves `public/` at `/`, and `createPageHandler` forwards `routeMeta.head` to the shell builder).
3. In each Lit component, reference variables with `var(--bg-primary)` inside `static styles`. These resolve because the variables inherit from `:root` through the shadow boundary.
4. Component-local plain styles (background of the `:host`, layout, borders) go in each component's own `static styles = css\`...\`` — they are scoped automatically.

Don't try to style shadow content from a global stylesheet with element selectors (`page-home .folder-item { ... }`) — it will silently do nothing. Only `var(--*)` references and the component's own `static styles` work.

### Litro: Always kill old server processes

Litro dev server uses dynamic port allocation (3000, then 3001, 3002... if 3000 is in use). Always `pkill -f "litro dev"` before starting a new instance to avoid port conflicts.

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
> 2. Client subscribes to SSE — initial `set_model` event sent with configured `modelId`

### Files

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/browse` | Browse directories recursively (`?path=...`) |
| `GET` | `/api/projects/files` | List files in project dir (`?project_path=...&path=...`) |
| `GET` | `/api/projects/files/read` | Read file contents (`?project_path=...&file_path=...`) |

### Models

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/models/` | List available models — serves cached list (no session required). `session_id` is optional and used for RPC fallback. |

### SSE (Server-Sent Events)

| Endpoint | Description |
|----------|-------------|
| `GET /api/projects/sse?session_id=...` | SSE stream. First event: `set_model`. Then streaming events. |
| `POST /api/projects/{session_id}/cmd` | REST command endpoint. Body: `{"command": "...", ...}`. Responses flow back via SSE. |

### Protocol

```
SSE Stream (server → client):
  event: set_model          → Initial model config on connect
  event: rpc_event          → Streaming text, tool calls
  event: rpc_response       → Command responses (get_state, compact, etc.)
  event: extension_ui_request → Interactive UI prompts
  event: extension_ui_response → Auto-ack relay
  event: session_terminated → Process exit

REST Commands (client → server):
  POST /api/projects/{id}/cmd  {"command": "prompt", "message": "..."}
  POST /api/projects/{id}/cmd  {"command": "abort"}
  POST /api/projects/{id}/cmd  {"command": "compact"}
  POST /api/projects/{id}/cmd  {"command": "set_model", "modelId": "...", "provider": "..."}
  POST /api/projects/{id}/cmd  {"command": "get_state"}
  POST /api/projects/{id}/cmd  {"command": "get_messages"}
  POST /api/projects/{id}/cmd  {"command": "extension_ui_response", "id": "...", "value": true}
  POST /api/projects/{id}/cmd  {"command": "set_auto_compaction", "enabled": true}
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
- **Docs**: `docs/`, `AGENTS.md`, `README.backend.md`, `README.frontend.md`

## Current Status

| Area | Status |
|------|--------|
| **Backend API** | ✅ Complete — all endpoints implemented and tested |
| **Session Manager** | ✅ Complete — spawns `pi --mode rpc`, manages lifecycle |
| **Frontend UI** | ✅ Complete — 3-column workspace with file tree, preview, chat |
| **Frontend/Backend wiring** | ✅ Complete — real API calls replace mock data |
| **SSE stream** | ✅ Complete — `text/event-stream` via `sse-starlette` |
| **Extension UI handling** | ✅ Complete — auto-ack fire-and-forget, forward interactive |
| **Integration tests** | ✅ Migrated to SSE + REST (all flows use SSE) |
| **Flow 4: Model Switch** | ✅ 4/4 passing (6 checks + 2 skip path) |
| **Flow 5: Close/Delete** | ✅ 4/4 passing |
| **Flow 6: Error Handling** | ✅ 12/12 passing |
| **Flow 7: Shutdown Cleanup** | ✅ 3/3 passing |
| **Flow 8: Model Operations** | ✅ All passing (fetch, verify, switch, chat before/after) |
