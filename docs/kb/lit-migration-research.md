# Lit Migration Research

> Created: 2026-07-03
> Status: Research phase
> Purpose: Evaluate Lit + Litro as replacement for React frontend in 314 Studio

---

## Table of Contents

- [Lit Framework](#lit-framework)
- [Litro Framework](#litro-framework)
- [React → Lit Migration Mapping](#react--lit-migration-mapping)
- [Architecture Comparison](#architecture-comparison)
- [Package Ecosystem](#package-ecosystem)
- [Migration Strategy for 314 Studio](#migration-strategy-for-314-studio)
- [Risks & Mitigations](#risks--mitigations)
- [References](#references)

---

## Lit Framework

### Overview

Lit (v3.3.3) is a lightweight (~5 KB gzipped) web components library built on native Custom Elements and Shadow DOM. It adds reactivity, declarative templates, and a few thoughtful features on top of the web platform standards.

**Key principles**:
- **Simple** — Building on top of Web Components standards
- **Fast** — Tiny footprint, instant updates via direct DOM diffing (no Virtual DOM)
- **Interoperable** — Every Lit component is a native web component, works anywhere HTML is used

### Core API

```typescript
import { html, css, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

@customElement('simple-greeting')
export class SimpleGreeting extends LitElement {
  static styles = css`
    p { color: blue; }
  `;

  @property()
  name = 'Somebody';

  @state()
  private _count = 0;

  render() {
    return html`
      <p>Hello, ${this.name}!</p>
      <button @click=${() => this._count++}>Count: ${this._count}</button>
    `;
  }
}
```

### Key Concepts

| Concept | Description |
|---------|-------------|
| `LitElement` | Base class for components (extends `HTMLElement`) |
| `html` tagged template | Declarative templates with inline JS expressions. No JSX, no compilation |
| `css` tagged template | Scoped styles via Shadow DOM. No class name collisions |
| `@customElement` | Registers the class as a custom element |
| `@property()` | Declares a reactive property, auto-reflects as HTML attribute |
| `@state()` | Internal reactive state (not reflected as attribute) |
| `@query()` / `@queryAssignedElements()` | DOM reference decorators |
| `connectedCallback()` | Mount lifecycle (replaces `useEffect(() => {}, [])`) |
| `disconnectedCallback()` | Unmount lifecycle (replaces cleanup in `useEffect`) |
| `updated(changed)` | Re-render lifecycle (replaces `useEffect` with deps) |

### v3.0 Breaking Changes

- IE11 support dropped
- Decorators now work with native `accessor` keyword + `experimentalDecorators`
- `performUpdate()` async overrides emit dev warnings
- `renderRoot` type changed to `HTMLElement \| DocumentFragment`
- Deprecated `queryAssignedNodes` with selector argument removed (use `@queryAssignedElements`)
- Experimental hydrate modules moved to `@lit-labs/ssr-client`

### v3.2–3.3 Additions

- `mathml` template tag for MathML support
- `useDefault` property option (default value not considered a change)
- Dev mode warnings emitted on next microtask
- Improved `choose()` and `when()` directive type inference
- `ref()` directive graceful disconnection

---

## Litro Framework

### Overview

Litro is a full-stack application framework for building apps with web components. Think "Next.js for Lit".

**Three pillars**:
1. **Web Components** — Choose Lit (default), FAST Element, or Elena
2. **Nitro** — Server engine (same as Nuxt), handles routing, API routes, SSR, deployment
3. **Vite** — Client bundling + HMR

### Architecture

```
User Request
    │
    ▼
Nitro Server
    ├── /api/**  →  server/api/ route files (plain H3 handlers)
    └── /**      →  Page Handler
                        ├── SSR mode: FrameworkAdapter.renderPage() → streams HTML
                        │     ├── Lit/FAST: @lit-labs/ssr → DSD HTML
                        │     └── Elena: light DOM SSR → plain HTML
                        └── SSG: prerendered .html served statically
```

### What You Get

- File-system routing (`pages/` directory → URL)
- SSR with streaming Declarative Shadow DOM
- `definePageData` for server-side data fetching
- Built-in client-side router (`LitroRouter`) using URLPattern API
- Content layer for Markdown (11ty-compatible)
- SSG via `ssgPreset`
- Deployment to Node.js, Cloudflare Workers, Vercel Edge, and more

### Adapter System

| Adapter | DOM Model | SSR | Best For |
|---------|-----------|-----|----------|
| **Lit** (default) | Shadow DOM | DSD streaming | General-purpose apps, largest ecosystem |
| FAST Element | Shadow DOM | DSD streaming | Fluent UI integration, observable reactivity |
| Elena | Light DOM | Direct rendering | Content sites, global CSS, smallest payloads |

The adapter is selected at project creation: `--adapter lit|fast|elena`. Everything else (routing, data fetching, deployment) stays the same.

### Litro vs Other Frameworks

| | Litro | Next.js | Nuxt.js |
|---|-------|---------|---------|
| Component model | Web components | JSX/React | Vue SFCs |
| Server engine | Nitro (shared with Nuxt) | Custom | Nitro (shared with Litro) |
| SSR | Declarative Shadow DOM | React SSR | Vue SSR |
| File-system routing | Yes | Yes | Yes |
| API routes | Yes (H3 handlers) | Yes | Yes |
| Deployment adapters | Node, Cloudflare, Vercel Edge, etc. | Vercel, Node, etc. | Node, Cloudflare, Vercel, etc. |

---

## React → Lit Migration Mapping

### Components

| React | Lit | Notes |
|-------|-----|-------|
| Function component | Class extending `LitElement` | Use `@customElement('my-comp')` |
| `useState` | `@state()` or `{ state: true }` in `static properties` | Prefix with `_` for internal state |
| `useEffect(() => {}, [])` | `connectedCallback()` | First mount to DOM |
| `useEffect(() => {}, [dep])` | `updated(changedProperties)` | Run when dep changes |
| `useEffect(() => { cleanup }, [])` | `disconnectedCallback()` | Removal from DOM |
| Props (function args) | `static override properties = { name: { type: String } }` | Auto-reflected as HTML attrs |
| `children` prop | `<slot></slot>` | Browser-native projection |
| Named slot props | `<slot name="header"></slot>` | Named slots work like slot props |
| CSS Modules | `static styles = css\`...\`` | Shadow DOM scoping, no class collisions |
| `React.memo` | N/A | Lit batches updates automatically |

### Template Syntax

| React JSX | Lit `html\`...\`` |
|-----------|-------------------|
| `{variable}` | `${variable}` |
| `onClick={handler}` | `@click=${handler}` |
| `className="foo"` | `class="foo"` |
| `style={{ color: 'red' }}` | `style="color:red"` |
| `.prop={value}` (controlled) | `.property=${value}` (dot prefix) |
| `<Comp />` | `<my-comp></my-comp>` |
| `{condition && <el>}` | `${condition ? html\`...`` : ''}` |
| `{arr.map(x => <li>...)}` | `${arr.map(x => html\`...``)}` |
| `dangerouslySetInnerHTML` | `unsafeHTML()` from `lit/directives/` |

### State & Context

| React | Lit |
|-------|-----|
| `useState` | `@state()` decorator or `{ state: true }` in properties |
| `useContext` | `@consume({ context, subscribe: true })` from `@lit/context` |
| Context provider | `@provide({ context })` from `@lit/context` |
| `useReducer` | Manual state management in class fields |
| Custom hooks | Shared utility functions or mixin classes |

### Events

```typescript
// React
function SearchInput({ onSubmit }: { onSubmit: (v: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <input
      value={value}
      onChange={e => setValue(e.target.value)}
      onKeyDown={e => e.key === 'Enter' && onSubmit(value)}
    />
  );
}

// Lit
@customElement('my-search')
class SearchInput extends LitElement {
  static override properties = { _value: { state: true } };
  _value = '';

  override render() {
    return html`
      <input
        .value="${this._value}"
        @input="${(e: InputEvent) => {
          this._value = (e.target as HTMLInputElement).value;
        }}"
        @keydown="${(e: KeyboardEvent) => {
          if (e.key === 'Enter') {
            this.dispatchEvent(new CustomEvent('search', {
              detail: this._value,
              bubbles: true,
              composed: true,
            }));
          }
        }}"
      >
    `;
  }
}
```

**Important**: The `.value` binding (dot prefix) sets the DOM property rather than the HTML attribute, ensuring inputs stay controlled. `composed: true` on CustomEvent allows bubbling out of shadow root.

---

## Architecture Comparison

### Current Stack (React)

```
┌─────────────────────────────────────────────────┐
│ Frontend (React 19 + TypeScript + Vite + Bun)   │
│                                                   │
│  AppContext (shared state)                        │
│  ├── FolderSelector                              │
│  ├── ModelSelector                               │
│  └── Workspace                                   │
│       ├── ProjectTree                             │
│       ├── FilePreview                             │
│       └── ChatPanel                               │
├─────────────────────────────────────────────────┤
│ Backend (FastAPI + Uvicorn)                      │
│  ├── REST: /api/* (metadata)                     │
│  └── WS: /api/projects/ws (RPC relay)            │
└─────────────────────────────────────────────────┘
```

### Target Stack (Lit + Litro)

```
┌─────────────────────────────────────────────────┐
│ Frontend (Litro + Lit + Vite)                   │
│                                                   │
│  pages/ (file-system routing)                    │
│  ├── index.ts (folder selector)                  │
│  ├── models.ts (model selector)                  │
│  └── workspace.ts (workspace)                    │
│                                                   │
│  components/                                     │
│  ├── project-tree (custom element)               │
│  ├── file-preview (custom element)               │
│  └── chat-panel (custom element)                 │
│                                                   │
│  services/ (API client — same as current)        │
├─────────────────────────────────────────────────┤
│ Backend (FastAPI + Uvicorn) — unchanged          │
└─────────────────────────────────────────────────┘
```

### Key Differences

| Aspect | React | Litro + Lit |
|--------|-------|-------------|
| Component model | Function components + hooks | Class components + decorators |
| Templates | JSX (compiled) | Tagged template literals (no compile) |
| Styling | CSS Modules / Tailwind | Shadow DOM + `css` template |
| State | React Context + hooks | `@lit/context` + class fields |
| Routing | Custom view state or React Router | Litro file-system routing |
| Bundle size | ~40+ KB React runtime | ~5 KB Lit core |
| DOM updates | Virtual DOM diffing | Direct DOM diffing |
| TypeScript | Native | Native |
| SSR | Not used | Declarative Shadow DOM streaming |
| Framework lock-in | React-specific | Standards-based (web components) |

---

## Package Ecosystem

### Core Lit Packages

| Package | Version | Purpose |
|---------|---------|---------|
| `lit` | 3.3.3 | Main package (LitElement + html + css) |
| `lit-html` | 3.3.0 | Template engine (standalone) |
| `lit-element` | 4.2.0 | Base class |
| `@lit/reactive-element` | 2.1.0 | Reactivity engine |
| `@lit/context` | — | Provider/consumer context pattern |
| `@lit-labs/ssr` | — | Server-side rendering (DSD streaming) |
| `@lit/react` | — | React wrapper for Lit components |

### Directives & Utilities

| Package | Purpose |
|---------|---------|
| `lit/directives/when` | Conditional rendering |
| `lit/directives/choose` | Switch/case rendering |
| `lit/directives/until` | Async content loading |
| `lit/directives/live` | Live binding for inputs |
| `lit/directives/ref` | Element references |
| `lit/directives/unsafeHTML` | Raw HTML injection |
| `lit/directives/class-map` | Dynamic class binding |
| `lit/directives/style-map` | Dynamic style binding |
| `lit/directives/repeat` | Efficient list rendering |

### Related Projects

| Project | Description |
|---------|-------------|
| **Litro** | Full-stack framework (Lit + Nitro + Vite) |
| **Fast element** | Microsoft's web components library |
| **Elena** | Lightweight web components with Light DOM |
| **Open WC** | Project generator, testing utilities, analysis tools |
| **Slack UI (slack-design-system)** | Production web components built with Lit |
| **Angular Material** | Some components built with Lit |

---

## Gaps & Issues Identified in Codebase Review

### Critical Architecture Mismatch: SSE, Not WebSocket

The migration plan incorrectly states the backend uses **WebSocket** for Pi RPC streaming. **The actual codebase uses Server-Sent Events (SSE)**:

- **Frontend**: `useSSE.ts` hook manages `EventSource` connection to `GET /api/projects/sse`
- **Backend**: `backend/app/api/chat.py` exposes `GET /api/projects/sse` (SSE stream) and `POST /api/projects/cmd` (REST commands)
- **Plan error**: All references to "WebSocket" (`WS /api/projects/ws`, `useWebSocket` hook, "bidirectional WS relay") are factually incorrect for the current implementation

**Impact**: The migration strategy, component mapping, and risk assessment must be rewritten around SSE. The `useSSE` hook is ~350 lines of complex streaming text/tool-call/message-buffer state management — far more involved than a simple "WebSocket controller."

### Integration Tests Are Out of Sync

The integration test suite (`tests/`) still references **WebSocket endpoints** (`/api/projects/ws`) that do not exist in the backend. `test_utils.py` and the `ws_harness/` directory use `websockets` library and expect `ws://` URLs. This contradicts the plan's claim that "pytest flows 1–8 still pass" unchanged.

**Action required**: Decide whether to:
1. Rewrite tests to use SSE (`EventSource` is harder to test from Python than WebSocket)
2. Add a WebSocket adapter layer in backend (adds scope)
3. Use an HTTP/SSE test client (e.g., `httpx` with streaming + a separate command POST)

### CSS Is Global, Not CSS Modules

The plan states the current styling uses "CSS Modules (`.module.css`)." **This is incorrect.** The codebase uses plain global CSS:

- `frontend/src/index.css` — global variables and resets
- `frontend/src/views/views.css` — view-level styles
- `frontend/src/views/common.css` — shared button/component styles
- `frontend/src/components/components.css` — component styles

There are no `.module.css` files, no CSS Modules configuration in Vite, and no scoped-by-default styling. The migration to Shadow DOM `static styles` is a bigger change than the plan implies.

### Unaccounted Dependencies

| Dependency | Used For | Migration Needed |
|-----------|----------|-----------------|
| `react-markdown` + `remark-gfm` | ChatPanel markdown rendering | Replace with `marked`, `markdown-it`, or a custom Lit directive |
| `react-dom` + `createRoot` | Mounting | Replace with `document.createElement` + `customElements.define` |
| `@vitejs/plugin-react` | Vite React plugin | Replace with generic Vite (Litro handles this) |

### Complex UI Patterns Missing from Plan

The plan's component migration table is too simplistic. The actual frontend contains complex patterns that need explicit migration strategies:

1. **ChatPanel message rendering** — `ReactMarkdown` with GFM plugins, collapsible `<details>` for tool calls, streaming cursor animation, syntax-highlighted code blocks via `:global()` selectors
2. **ModelSelector search highlighting** — `highlightMatch()` returns JSX fragments with `<mark>`; in Lit this requires string-splitting + `unsafeHTML` or manual template construction
3. **FolderSelector recursive tree** — `DirectoryTree` recursively renders itself with `useMemo`, lazy loading, and expand/collapse state. In Lit, recursive custom elements need careful slot/property design
4. **Shutdown dialog** — Modal overlay with backdrop blur, animation keyframes, and stop-propagation — needs Lit equivalent (no React event bubbling)
5. **useModels StrictMode guards** — Module-level `Set` guards against React StrictMode double-mount. Lit does not have StrictMode; this pattern disappears but the underlying deduplication logic (session creation) still matters

### Routing: View State vs URL State

The plan proposes file-system routing (`/workspace/:session_id`), but the current app stores the active view (`'folders' | 'models' | 'workspace'`) and `sessionId` in **React Context**, not the URL. The session ID is never in the URL.

**Decision needed**: Should the Litro migration also introduce URL-based routing? This adds scope beyond a pure framework migration. If keeping view-state routing, `@lit/context` is sufficient; if moving to URL routing, Litro's file-system routing adds complexity.

### API Endpoint Discrepancies

The plan's API table has incorrect paths:

| Plan Says | Actual Endpoint |
|-----------|---------------|
| `POST /api/projects/{id}/close` | `POST /api/projects/{session_id}/close` |
| `POST /api/projects/{id}/delete` | `POST /api/projects/{session_id}/delete` |
| `POST /api/projects/{id}/model` | `POST /api/projects/{session_id}/model` |
| `WS /api/projects/ws` | `GET /api/projects/sse` + `POST /api/projects/cmd` |

Also missing from the plan:
- `POST /api/projects/cmd` — the REST command endpoint used by the frontend for all Pi commands
- `GET /api/projects/sessions` — list all active sessions
- Commands like `set_auto_compaction`, `get_messages`, `extension_ui_response` that the frontend actively uses

### State Management Complexity

The plan shows a simplified `AppState` with 5 fields. The actual `AppContext.tsx` manages **14 fields** including `selectedSession`, `models`, `modelsLoading`, `modelsError`, `refreshModels`, `sessionId`, `currentModel`, and multiple setter callbacks. Replacing this with `@lit/context` is nontrivial — every consumer needs `@consume()` and the provider needs `@provide()` on a root element.

### localStorage Model Cache

`useModels.ts` implements a 30-minute localStorage cache for the model list (`PI_MODELS_CACHE`). The plan's state management section does not mention this caching strategy, which is critical for the "instant model list on reload" UX.

---

## Updated Migration Strategy for 314 Studio

### Phase 0: Pre-Migration Fixes (Blockers)

Before starting the Lit migration, fix these issues in the React codebase:

1. **Align tests with backend transport** — Either add a WS compatibility layer to backend, or rewrite `test_utils.py` and `ws_harness/` to use SSE/REST. This must be done first or tests will be permanently broken.
2. **Verify `ws_to_stdin_queue` field** — `session_manager.py` references `record.ws_to_stdin_queue` but `SessionRecord` schema does not define it. This is a latent bug.
3. **Document actual API contract** — Replace plan's incorrect WebSocket references with the real SSE+REST architecture.

### Phase 1: Foundation

1. Scaffold a Litro project with `create-litro` (Lit adapter) — **verify Litro CLI availability first**
2. Configure Vite + TypeScript + ESLint
3. Port the `services/api.ts` REST client (unchanged logic, no React deps)
4. **Create an SSE controller class** (not "WebSocket controller"):
   - Wrap `EventSource` lifecycle
   - Buffer `rpc_event` / `rpc_response` / `extension_ui_request` events
   - Expose `prompt()`, `abort()`, `compact()`, `setAutoCompaction()` methods that `POST` to `/api/projects/cmd`
   - Handle `set_model` initial event and `session_terminated`
5. **Decide on routing approach**:
   - **Option A**: Keep view-state routing (simpler, no URL changes) using `@lit/context`
   - **Option B**: Adopt Litro file-system routing (`/`, `/models`, `/workspace/:session_id`) — adds scope but gives shareable URLs

### Phase 2: Component Migration (Bottom-Up)

Migrate leaf components first, then views:

| Component | Complexity | Key Migration Work |
|-----------|-----------|-------------------|
| `file-preview` | Low | Port `useFileContent` logic to a Lit controller; line numbers are plain DOM |
| `project-tree` | Medium | Port `TreeNode` recursive pattern; lazy `listFiles()` calls on expand |
| `folder-selector` | High | Recursive `DirectoryTree` + search highlighting + session list + shutdown dialog |
| `model-selector` | Medium | Provider filter chips, search highlight (`<mark>` → template logic), model cards |
| `chat-panel` | **Very High** | Markdown rendering (replace `react-markdown`), streaming state, tool call collapsibles, model dropdown, pending UI banner, session controls |

**ChatPanel-specific tasks:**
- Replace `ReactMarkdown` with a markdown-to-Lit-html utility (e.g., `marked` → `unsafeHTML` directive, or pre-rendered HTML)
- Migrate `agentMessageToDisplay()`, `extractText()`, `extractToolCall()` logic into a message-processing controller
- Replace `useRef`-based `processedCountRef` pattern with a class field tracking last processed message index
- Replace `useCallback` handlers with class methods

### Phase 3: State Management

| Current (React) | Litro/Lit Replacement |
|-----------------|----------------------|
| `AppContext` (14-field React Context) | `@lit/context` provider on root element + `@consume` in children |
| `useApp()` hook | `@consume({ context: appContext, subscribe: true })` decorator |
| `useFileContent` | `FileContentController` class with `load()` and `abort()` |
| `useModels` | `ModelsController` class with localStorage cache, fetch, polling, dedup guards |
| `useSSE` | `SSEController` class wrapping `EventSource`, event buffering, streaming state |

### Phase 4: Styling Migration

| Current | Replacement |
|---------|-------------|
| Global `index.css` (CSS custom properties) | Keep as global stylesheet OR inject into `:host` CSS vars on a theme provider element |
| `views.css` / `components.css` / `common.css` | Split into `static styles = css\`...\`` per component, OR keep as Light DOM global styles if Shadow DOM is too invasive |
| `:global()` selectors for markdown | Move markdown styles into a `<style>` block inside the markdown renderer component (Light DOM) |

**Shadow DOM decision**: The current CSS is deeply interconnected (e.g., `.chat-message__content :global(pre)`). Migrating everything to Shadow DOM means duplicating shared styles or adopting CSS custom properties aggressively. Consider using **Light DOM** (Elena adapter) for the initial migration to reduce styling risk, then migrate to Shadow DOM incrementally.

### Phase 5: Testing & Polish

1. **Update integration tests** — Replace `ws_connect` with `sse_connect` (streaming `httpx` or `aiohttp` SSE client) + `cmd_post` REST helper
2. Add Lit component unit tests with `@open-wc/testing`
3. Verify all 8 test flows pass against SSE backend
4. Performance benchmark: compare React bundle (~40+ KB + markdown parser) vs Lit bundle (~5 KB + marked)

### What Stays the Same

- **Backend** (FastAPI + Uvicorn + SSE endpoints) — completely unchanged
- **REST API contract** — `services/api.ts` logic is framework-agnostic
- **Session Manager** — `pi --mode rpc` process lifecycle
- **Development workflow** — Vite HMR, `uv run` for backend

### What Changes

- **Frontend framework** — React 19 → Litro + Lit
- **Component model** — Function + hooks → Class + decorators
- **Templates** — JSX → Tagged template literals (`html\`...\``)
- **Styling** — Global CSS → Shadow DOM `static styles` (or Light DOM if Elena adapter chosen)
- **State** — React Context → `@lit/context` + controller classes
- **Routing** — Custom view state → Either Litro file-system routing OR keep view-state via context
- **Markdown rendering** — `react-markdown` → `marked`/`markdown-it` + `unsafeHTML` directive
- **Streaming transport** — (Plan incorrectly said "WS → WS"; reality is SSE stays SSE)

---

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Plan was written assuming WebSocket backend; actual is SSE | **Critical** | Rewrite SSE controller logic; verify Litro SSE compatibility |
| Integration tests use WebSocket but backend has no WS endpoint | **Critical** | Rewrite tests for SSE+REST before any frontend migration |
| `react-markdown` + GFM has no direct Lit equivalent | Medium | Use `marked` or `markdown-it` with `unsafeHTML` directive; verify XSS safety |
| ChatPanel is very complex (~650 lines, 4 sub-components, streaming state) | High | Migrate incrementally: extract message-processing logic into a testable controller first |
| Recursive `DirectoryTree` with lazy loading | Medium | Lit custom elements can be recursive via self-tagging; test memory leaks |
| Litro is younger than Next.js (fewer recipes/plugins) | Medium | Litro has migration guides; community is growing |
| Class-based components feel unfamiliar to React devs | Medium | Migration guide `litro.dev/docs/migrate/from-react` exists |
| No JSX means learning tagged template literals | Low | Simple syntax, no build step, native JS expressions |
| Shadow DOM makes global CSS harder | Medium | Use CSS custom properties for theming; consider Elena (Light DOM) adapter for initial migration |
| Smaller ecosystem than React | Medium | Lit has solid core; use `@lit/context` for state, standard web APIs for everything else |
| Litro SSR (DSD) may have edge cases | Low | Litro uses `@lit-labs/ssr` which is production-tested |
| TypeScript version compatibility | Low | Lit requires TS ~5.2+; project uses TS ~6.0.2 (compatible) |

---

## References

| Resource | URL |
|----------|-----|
| Lit official site | https://lit.dev/ |
| Lit GitHub | https://github.com/lit/lit |
| Lit changelog | https://github.com/lit/lit/blob/main/packages/lit/CHANGELOG.md |
| Lit getting started | https://lit.dev/docs/getting-started/ |
| Litro official site | https://litro.dev/ |
| Litro introduction | https://litro.dev/docs/introduction |
| Litro from React migration | https://litro.dev/docs/migrate/from-react |
| Litro vs Next.js | https://litro.dev/docs/compare/nextjs |
| Litro vs Nuxt | https://litro.dev/docs/compare/nuxt |
| Lit codelab (for React devs) | https://codelabs.developers.google.com/codelabs/lit-2-for-react-devs |
| Open WC project generator | https://open-wc.org/ |
| @lit/context | https://github.com/lit/lit/tree/main/packages/context |
| @lit-labs/ssr | https://github.com/lit/lit/tree/main/packages/labs/ssr |
