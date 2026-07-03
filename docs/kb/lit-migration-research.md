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

## Migration Strategy for 314 Studio

### Phase 1: Foundation

1. Scaffold a Litro project with `create-litro` (Lit adapter)
2. Configure Vite + TypeScript + ESLint
3. Set up the API client (reuse existing `services/api.ts` logic)
4. Configure file-system routing:
   - `/` → Folder selector
   - `/models` → Model selector
   - `/workspace/:session_id` → Workspace

### Phase 2: Component Migration

Migrate components one at a time (each is a custom element):

| Component | Purpose | Key Dependencies |
|-----------|---------|-----------------|
| `project-tree` | File tree sidebar | `useFileContent` hook → API service |
| `file-preview` | Syntax-highlighted viewer | Line numbers, content rendering |
| `chat-panel` | Chat + model switcher | WebSocket, model dropdown |
| `folder-selector` | Browse & select folder | Recursive API, search/filter |
| `model-selector` | Pick AI model | `useModels` hook → API service, refresh button |

### Phase 3: State Management

| Current (React) | Litro/Lit Replacement |
|-----------------|----------------------|
| `AppContext` (React Context) | `@lit/context` provider/consumer |
| `useApp()` hook | `@consume({ context: appContext, subscribe: true })` |
| `useFileContent` hook | Lit controller (`LitController`) |
| `useModels` hook | Lit controller with fetch + cache logic |
| `useWebSocket` hook | Lit controller with WebSocket management |

### Phase 4: Styling

| Current | Replacement |
|---------|-------------|
| CSS Modules (`.module.css`) | `static styles = css\`...\`` with Shadow DOM |
| Global `index.css` | Move shared variables to a root custom element or `:host` |
| View-specific CSS (`.views.css`) | `static styles` per component |

### Phase 5: Testing & Polish

1. Migrate integration tests (pytest for backend unchanged)
2. Add Lit component tests (`@open-wc/testing`)
3. Verify WebSocket relay still works (backend is unchanged)
4. Performance benchmarking (bundle size, render time)

### What Stays the Same

- **Backend** (FastAPI + Uvicorn) — completely unchanged
- **API contract** — REST + WebSocket endpoints
- **Session Manager** — `pi --mode rpc` process management
- **Integration tests** — pytest flows 1–8 still pass
- **Development workflow** — Vite HMR, `uv run` for backend

### What Changes

- **Frontend framework** — React → Litro + Lit
- **Component model** — Function + hooks → Class + decorators
- **Templates** — JSX → Tagged template literals
- **Styling** — CSS Modules → Shadow DOM
- **State** — React Context → `@lit/context`
- **Routing** — Custom view state → Litro file-system routing
- **Build tool** — Bun + Vite → Litro + Vite (Bun may still work for `bun dev`)

---

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Litro is younger than Next.js (fewer recipes/plugins) | Medium | Litro has migration guides; community is growing |
| Class-based components feel unfamiliar to React devs | Medium | Migration guide `litro.dev/docs/migrate/from-react` exists |
| No JSX means learning tagged template literals | Low | Simple syntax, no build step, native JS expressions |
| Shadow DOM makes global CSS harder | Low | Use CSS custom properties for theming; Light DOM adapter (Elena) available if needed |
| Smaller ecosystem than React | Medium | Lit has solid core; use `@lit/context` for state, standard web APIs for everything else |
| Litro SSR (DSD) may have edge cases | Low | Litro uses `@lit-labs/ssr` which is production-tested |
| TypeScript version compatibility | Low | Lit requires TS ~5.2+ (we're already on TS 5.x) |

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
