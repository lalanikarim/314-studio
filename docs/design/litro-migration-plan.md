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
| ChatPanel component | 🔲 Not started | **See [Litro ChatPanel Migration Plan](litro-chat-panel-plan.md)** — SSE streaming, markdown, code blocks, tool calls, message history (~1100 lines in React) |

### ⏳ Blocked / Future

| Task | Status | Blocked By |
|------|--------|------------|
| Chat input + command panel | ⏳ Future | ChatPanel complete |
| FilePreview improvements | ⏳ Future | Phase 1 of best-practices plan |
| Session management UI | ⏳ Future | Phase 2 of best-practices plan |
| Model switch in workspace | ⏳ Future | Phase 2 of best-practices plan |
| Production build | ⏳ Future | Phase 0 of best-practices plan |

### ChatPanel Migration Plan

The ChatPanel port has its own dedicated plan: **[Litro ChatPanel Migration Plan](litro-chat-panel-plan.md)**. It is a **hard dependency** of this migration plan and follows the same verification protocol (Tier 1–4) from the best-practices plan. Do not start ChatPanel work without reading it first.

### Best Practices Plan Status

See the [Litro Component Best Practices Plan](litro-component-best-practices-plan.md) for phase details. Summary:

| Best-Practices Phase | Status | Unblocks |
|---|---|---|
| Phase 0: Fix `@property` production bug | ✅ Done | Production build |
| Phase 1: Component file separation | ✅ Done | ChatPanel, syntax highlighting |
| Phase 2: State management cleanup | ✅ Done | Session UI, model switch |
| Phase 3: Event-based communication | ✅ Done | General cleanup |
| Phase 4: Shared style consolidation | 🟡 In progress | — |

**Last updated:** 2026-07-05

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

> ⚠️ **Prerequisite:** The work below must **not** resume until [Litro Component Best Practices Plan](litro-component-best-practices-plan.md) Phases 0–3 are complete. Those phases fix a production-breaking `@property` bug in `project-tree.ts`, split the 798-line `pages/index.ts` into isolated components, replace module-global state with a `ReactiveController`, and standardize event-based communication — all foundations that ChatPanel directly builds on.
>
> **Hard dependency:** [Litro ChatPanel Migration Plan](litro-chat-panel-plan.md) must be read before starting the ChatPanel port. It defines the exact phases, file structure, `ChatStreamController` architecture, markdown strategy, and verification steps. Do not start ChatPanel work without it.

1. Execute [Litro ChatPanel Migration Plan](litro-chat-panel-plan.md) Phases 0–7
2. Add syntax highlighting to FilePreview
3. Polish UI (hover states, loading indicators, error handling)
4. Configure Nitro for production build
