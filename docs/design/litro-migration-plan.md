# Litro Frontend Migration Plan

**Branch:** `refactor/migrate-to-lit-frontend`  
**Started:** 2026-07-04  
**Status:** In Progress

## Overview

Migrate the React/TypeScript frontend (`frontend/`) to a Lit-based frontend (`frontend-litro/`) using the Litro framework. The backend (FastAPI) remains unchanged; the frontend communicates via REST for metadata and SSE for streaming.

## Architecture

```
Client ──REST──→ Backend (metadata: list, create, browse, read)
       ──SSE────→ Backend (streaming: prompt, set_model, compact)
```

## Current Status

### ✅ Completed

| Task | Status | Notes |
|------|--------|-------|
| SSE migration (backend) | ✅ Done | WebSocket removed, SSE + REST for all RPC |
| Litro scaffold | ✅ Done | `@beatzball/litro`, bun, Vite dev + Nitro build |
| API service layer | ✅ Done | `services/api.ts` — browse, models, sessions, files, SSE, cmd |
| Global theme (theme.css) | ✅ Done | Dark slate theme with CSS custom properties |
| Shared button styles | ✅ Done | `styles/shared.ts` — .btn family, .icon-btn |
| Nitro API proxy | ✅ Done | `nitro.config.ts` routeRules for `/api/**` |
| FolderSelector page | ✅ Done | Browse folders, search, open → /models |
| ModelSelector page | ✅ Done | Provider filters, search, model cards, create session |
| Workspace layout | ✅ Done | 3-column: sidebar, preview, chat |
| ProjectTree component | ✅ Done | Recursive tree, lazy loading, auto-expand dirs |
| FilePreview component | ✅ Done | File content display with header |
| File click → preview | ✅ Done | Global state sharing across Litro instances |
| File newline rendering | ✅ Done | PlainTextResponse for file read endpoint |
| Integration tests | ✅ Done | All 8 flows migrated (SSE-based), 55+ tests passing |

### 🔲 In Progress

| Task | Status | Notes |
|------|--------|-------|
| ChatPanel component | 🔲 Not started | SSE streaming, markdown, code blocks, tool calls, message history (~1100 lines in React) |

### ⏳ Blocked / Future

| Task | Notes |
|------|-------|
| Chat input + command panel | Wire chat UI to SSE/REST API |
| FilePreview improvements | Line numbers, syntax highlighting |
| Session management UI | Close/delete sessions from workspace |
| Model switch in workspace | Switch models without returning to models page |
| Production build | Configure Nitro for production (SSR, static assets) |

## Architecture Decisions

### Litro vs Lit directly
- Litro provides SSR, file-system routing, content layer, and Nitro integration
- `@beatzball/litro` (not `litro`) — original was unpublished

### SSR and Shadow DOM Gotchas
- CSS custom properties **inherit** through Shadow DOM boundaries — define theme vars on `:root`
- Plain element styles (font, box-sizing) only apply to light DOM — components need their own `static styles`
- Litro creates multiple component instances — use EventTarget for global state sharing

### API Proxy
- Vite proxy (`vite.config.ts`) doesn't work in dev mode (Litro uses inline Vite config)
- Use Nitro `routeRules` with `proxy` — must include `/api` prefix in target

### Package Manager
- Use `bun` — not npm, not npx

### Component Registration
- Classes using `@property`/`@state` MUST extend `LitElement` (not `HTMLElement`)
- `LitElement` provides `createProperty` static method used by decorators

## Key Files

| File | Purpose |
|------|---------|
| `frontend-litro/app.ts` | Client entry — router, custom element imports |
| `frontend-litro/pages/` | Page components (file-system routing) |
| `frontend-litro/components/` | Reusable Lit components |
| `frontend-litro/services/api.ts` | API client (REST + SSE) |
| `frontend-litro/styles/shared.ts` | Shared button/component styles |
| `frontend-litro/public/theme.css` | Global dark theme |
| `frontend-litro/nitro.config.ts` | Nitro config (proxy, build) |
| `frontend-litro/vite.config.ts` | Vite dev config (proxy, aliases) |
| `frontend-litro/server/routes/[...].ts` | Catch-all — routes + page manifest |

## Known Gotchas (see AGENTS.md for details)

1. **LitElement vs HTMLElement** — `@property`/`@state` require `LitElement`
2. **Shadow DOM styling** — only CSS vars inherit; components need own `static styles`
3. **Nitro proxy prefix** — must include `/api` in proxy target
4. **Multiple Litro instances** — use EventTarget for global state
5. **`innerHTML` binding** — use `.innerHTML=` (property), not `innerHTML=` (attribute)
6. **Boolean attributes** — use `?disabled=${x}` not `disabled=${x}`
7. **`key=` not Lit** — Lit doesn't use React-style `key` for list rendering
8. **SSR `window`** — guard with `typeof window !== 'undefined'`
9. **esbuild decorators** — sufficient for Lit decorators, no SWC needed
10. **`createProperty` error** — means component extends `HTMLElement` instead of `LitElement`

## Testing

```bash
# Headless browser verification
cd /Users/karim/.pi/agent/skills/headless-browser-checker
node check.js --url http://localhost:3000/ --wait 'page-home' --errors --screenshot

# Backend API
curl -s http://localhost:8000/api/projects/sessions

# Integration tests (backend)
cd tests
API_BASE=http://127.0.0.1:8000 WS_BASE=ws://127.0.0.1:8000 uv run pytest -v
```

## Next Steps

1. Port `ChatPanel` component (SSE streaming, markdown, code blocks, tool calls)
2. Wire chat input to SSE/REST API
3. Add syntax highlighting to FilePreview
4. Polish UI (hover states, loading indicators, error handling)
5. Configure Nitro for production build
