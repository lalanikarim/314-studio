# Lit Best Practices Knowledge Base

> **Scope:** Reactive properties, lifecycle, SSR hydration, component composition, styling, performance, and build concerns for Lit/LitElement-based applications.  
> **Applies to:** `frontend-litro/` and any future Lit-based frontends in this project.  
> **Date:** 2026-07-07

---

## Table of Contents

1. [Reactive Properties](#1-reactive-properties)
2. [Component Lifecycle](#2-component-lifecycle)
3. [SSR & Hydration](#3-ssr--hydration)
4. [Component Composition](#4-component-composition)
5. [Shadow DOM & Styling](#5-shadow-dom--styling)
6. [Performance](#6-performance)
7. [Event Handling](#7-event-handling)
8. [Build & Production](#8-build--production)
9. [Anti-Patterns Checklist](#9-anti-patterns-checklist)
10. [Decision Reference](#10-decision-reference)

---

## 1. Reactive Properties

### 1.1 Prefer `static properties` for Sub-Components

**Rule:** Any class that extends `LitElement` (not `LitroPage`) MUST use `static properties` instead of `@property()` or `@state()` decorators.

**Why:** esbuild (used by Litro's Vite adapter) does not bundle `property` from `lit/decorators.js` into the production client build. The dev server resolves imports at runtime, so it works locally. Production crashes with `ReferenceError: property is not defined`.

```typescript
// ❌ WRONG — crashes in production
import { customElement, property, state } from 'lit/decorators.js';
@customElement('chat-message')
export class ChatMessageElement extends LitElement {
  @property({ type: String }) role = '';
  @state() private value = '';
}

// ✅ CORRECT
import { customElement } from 'lit/decorators.js';
@customElement('chat-message')
export class ChatMessageElement extends LitElement {
  static properties = {
    role: { type: String },
    value: { type: String, state: true },
  };
  role = '';
  value = '';
}
```

**Exception:** Top-level pages (extending `LitroPage`) may use `@state()` since the Litro scaffold handles them differently. Sub-components must use `static properties`.

---

### 1.2 Internal State vs Public Properties

| | Public Properties | Internal State |
|---|---|---|
| **Declaration** | `static properties = { foo: { type: String } }` | `static properties = { _foo: { state: true } }` |
| **Attribute** | Generates observed attribute | No attribute |
| **External access** | Part of public API | Internal only |
| **Who changes it** | Parent component (owner) | Component itself |
| **Naming** | No underscore | Leading underscore or `private` |

**Key rule:** A component should not change its own public properties except in response to user input. If the component changes a public property internally, it must dispatch an event to notify the owner.

```typescript
// ❌ WRONG — component mutates its own public property
static properties = { selected: { type: Boolean } };
handleClick() {
  this.selected = !this.selected;  // No event dispatched!
}

// ✅ CORRECT
static properties = { selected: { type: Boolean } };
handleClick() {
  this.selected = !this.selected;
  this.dispatchEvent(new CustomEvent('selection-change', {
    detail: { selected: this.selected },
    bubbles: true,
    composed: true,
  }));
}
```

---

### 1.3 Immutable Objects and Arrays

**Critical rule:** Mutating an object or array property does NOT trigger an update because the reference hasn't changed.

```typescript
// ❌ WRONG — no re-render triggered
this.displayMessages.push(newMsg);

// ❌ WRONG — nested mutation, sub-components won't see it
const last = this.displayMessages[this.displayMessages.length - 1];
last.content = newBlocks;  // Same object, different property
this.displayMessages = [...this.displayMessages];  // Only array is new

// ✅ CORRECT — full immutable replacement
const updated = [...this.displayMessages];
updated[updated.length - 1] = { ...last, content: newBlocks };
this.displayMessages = updated;
```

**When to use `requestUpdate()` directly:** If the data is mutated in a single component and never passed to children, you may mutate and call `this.requestUpdate()`. But prefer immutable patterns for maintainability.

---

### 1.4 Property Defaults

**Always initialize reactive properties with a default value.** Lit uses `undefined` if no default is set, which can cause unexpected attribute reflection behavior.

```typescript
// ✅ CORRECT
static properties = {
  count: { type: Number },
  items: { type: Array },
};
count = 0;
items: string[] = [];
```

**Boolean properties with attributes:** Boolean properties that expose an attribute should default to `false`.

```typescript
static properties = {
  disabled: { type: Boolean },
};
disabled = false;  // Default false: no attribute rendered
```

---

## 2. Component Lifecycle

### 2.1 Lifecycle Order

```
constructor()
  → connectedCallback()
    → requestUpdate() (batched if multiple changes)
      → shouldUpdate() → willUpdate()
        → render()
          → DOM commit (first DOM created on first render)
          → firstUpdated()  ← FIRST RENDER ONLY
        → updated()
  → disconnectedCallback()
```

**Key insight:** `requestUpdate()` is called automatically when reactive properties change. You almost never need to call it manually.

---

### 2.2 `constructor()` — Initialize Only

Use `constructor()` for one-time setup that does NOT depend on the DOM or `renderRoot`.

```typescript
constructor() {
  super();
  // ✅ CORRECT: initialize non-reactive state
  this._debounceTimer = null;
  this._abortController = new AbortController();
}
```

**Do NOT:**
- Access `this.shadowRoot` (doesn't exist yet)
- Call async methods that set reactive state
- Read `window.location` (crashes during SSR)

---

### 2.3 `connectedCallback()` — Setup Only, No Reactive State Changes

Use `connectedCallback()` for adding event listeners, observers, or connecting to external systems. **Do NOT set reactive state that affects `render()` output here** — it causes SSR hydration mismatches.

```typescript
// ❌ WRONG — sets loading state that changes render output
connectedCallback() {
  super.connectedCallback();
  if (typeof window !== 'undefined') {
    this.loadData();  // sets this.loading = true sync
  }
}

// ✅ CORRECT — only adds listeners
connectedCallback() {
  super.connectedCallback();
  document.addEventListener('keydown', this._handleKeydown);
}
```

---

### 2.4 `firstUpdated()` — Client-Side Data Loading

**This is the correct hook for loading data on the client after SSR hydration completes.** The first render has already committed with SSR-matching state, so hydration succeeds. Then `firstUpdated()` runs and triggers the data load.

```typescript
firstUpdated() {
  if (this.items.length === 0) {
    this.loadItems();
  }
}

private async loadItems() {
  this.loading = true;  // Safe: hydration is complete
  try {
    this.items = await fetchItems();
  } catch (e) {
    this.error = e.message;
  } finally {
    this.loading = false;
  }
}
```

---

### 2.5 `willUpdate()` — Pre-Render Computations

Use `willUpdate()` to compute derived state before `render()` runs. This is where caching, markdown rendering, or other pre-render work should happen.

```typescript
willUpdate(changed: Map<string, unknown>) {
  if (changed.has('contentBlocks')) {
    // Pre-render markdown so render() just reads cached HTML
    this._renderedBlocks = this.contentBlocks.map(b =>
      b.kind === 'text' ? renderMarkdown(b.content) : null
    );
  }
}
```

---

### 2.6 `updated()` — Post-Render Side Effects

Use `updated()` for side effects that must happen AFTER the DOM has been updated: scrolling, focusing, measuring, animations.

```typescript
updated(changed: Map<string, unknown>) {
  if (changed.has('displayMessages')) {
    this.scrollToBottom();
  }
}
```

**Do NOT:**
- Set reactive state that triggers another render loop (infinite update risk)
- Perform heavy synchronous work that blocks the next frame

---

### 2.7 `disconnectedCallback()` — Cleanup

Always clean up resources added in `connectedCallback()`:

```typescript
disconnectedCallback() {
  super.disconnectedCallback();
  document.removeEventListener('keydown', this._handleKeydown);
  this._abortController?.abort();
  // Clear any instance-specific static guards
  if (this.sessionId) {
    MyComponent._sessionGuards.delete(this.sessionId);
  }
}
```

---

## 3. SSR & Hydration

### 3.1 The Hydration Contract

**Rule:** The first client `render()` output must match the SSR output **exactly** at every template part (`${...}` expression). If the part type changes (e.g., from a string to a `TemplateResult`, or from one branch to another), hydration fails with:

```
Error: Hydration value mismatch: Unexpected TemplateResult rendered to part
```

### 3.2 Common Hydration Mismatch Patterns

| Pattern | SSR | Client First Render | Result |
|---|---|---|---|
| `connectedCallback()` sets `loading = true` | `loading = false` | `loading = true` | ❌ Mismatch |
| Conditional switches branches before hydration | `items.length === 0` | `items.length === 1` | ❌ Mismatch |
| `unsafeHTML` vs `html` at same position | `html` string | `unsafeHTML(string)` | ❌ Mismatch (part type) |
| Random IDs or timestamps in render | `id="abc-123"` | `id="abc-456"` | ❌ Mismatch |
| `window` access in `render()` or getters | `undefined` (guarded) | actual value | ✅ Safe if guarded |

### 3.3 SSR-Safe Patterns

**Guard all `window`/`document`/`localStorage` access:**

```typescript
private get folderPath(): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('folder') || '';
}

render() {
  // Safe: getter returns '' during SSR
  const folder = this.folderPath;
  return html`<div>${folder}</div>`;
}
```

**Load data in `firstUpdated()`, not `connectedCallback()`:**

```typescript
// ❌ WRONG — causes hydration mismatch
connectedCallback() {
  super.connectedCallback();
  this.loadData();
}

// ✅ CORRECT — hydration-safe
firstUpdated() {
  this.loadData();
}
```

**Keep initial state deterministic:**

```typescript
// ❌ WRONG — random ID changes between SSR and client
id = `msg-${Math.random()}`;

// ✅ CORRECT — deterministic, or set in firstUpdated()
id = '';
firstUpdated() {
  this.id = `msg-${crypto.randomUUID()}`;
}
```

### 3.4 Litro-Specific: Multiple Instances During Hydration

The Litro router **replaces the SSR-rendered page with a new instance** on client hydration. This means:

1. SSR renders `page-home` (instance #1)
2. Litro creates `page-home` (instance #2) for the client
3. Instance #2 hydrates the DOM that instance #1 created

**Implication:** Any state set in `connectedCallback()` on the client (instance #2) is invisible to SSR (instance #1), so the initial renders diverge. **Always defer client-specific state changes to `firstUpdated()`.**

### 3.5 Checking `isConnected` in Async Callbacks

When using `setTimeout`, `setInterval`, or async callbacks, always check `this.isConnected` before mutating state — stale instances from hydration may still fire their timers.

```typescript
private async loadHistory() {
  if (!this.isConnected) return;  // ← CRITICAL
  if (!this.sessionId) return;
  // ...load...
}
```

---

## 4. Component Composition

### 4.1 Properties Down, Events Up

This is the foundational rule of Lit component architecture:

```
Parent ──properties──→ Child
Parent ←──events─────── Child
```

**Never** call child methods from the parent, and **never** reach into a child's shadow DOM.

```typescript
// ❌ WRONG — breaks encapsulation
const cp = this.shadowRoot?.querySelector('chat-panel');
(cp as any).handleSwitchModel(model);

// ✅ CORRECT — property + event
// Parent
html`<chat-panel
  .pendingModel=${this.pendingModel}
  @model-switch=${this.handleModelSwitch}
></chat-panel>`

// Child
updated(changed: Map<string, unknown>) {
  if (changed.has('pendingModel') && this.pendingModel) {
    this.handleSwitchModel(this.pendingModel);
    this.pendingModel = null;  // Clear so it doesn't re-fire
  }
}
```

---

### 4.2 Reactive Controllers

Use reactive controllers to bundle related state, behavior, and lifecycle hooks into a reusable unit.

**When to use a controller:**
- Managing external connections (SSE, WebSocket, WebRTC)
- Handling global events (resize, keyboard, mouse)
- Running animations or timers
- Abstracting complex async tasks

**Controller pattern:**

```typescript
import type { ReactiveController, ReactiveControllerHost } from 'lit';

export class SSEController implements ReactiveController {
  private host: ReactiveControllerHost;
  private sse: EventSource | null = null;

  constructor(host: ReactiveControllerHost) {
    this.host = host;
    host.addController(this);
  }

  hostConnected() {
    this.connect();
  }

  hostDisconnected() {
    this.sse?.close();
  }

  private connect() {
    // ...setup SSE...
  }
}
```

**Usage:**

```typescript
class ChatPanel extends LitElement {
  private sse = new SSEController(this);

  render() {
    return html`<div>Status: ${this.sse.status}</div>`;
  }
}
```

---

### 4.3 Sharing State Between Components

**Option 1: Reactive Controller Store (recommended for local sharing)**

```typescript
export class SelectionStore {
  private _path: string | null = null;
  private listeners = new Set<ReactiveControllerHost>();

  set(path: string | null) {
    if (this._path === path) return;
    this._path = path;
    this.listeners.forEach(h => h.requestUpdate());
  }

  controller(host: ReactiveControllerHost): ReactiveController {
    const listeners = this.listeners;
    return {
      host,
      hostConnected() { listeners.add(host); },
      hostDisconnected() { listeners.delete(host); },
    };
  }
}
```

**Option 2: Custom Events (for one-off communication)**

```typescript
// Child dispatches
this.dispatchEvent(new CustomEvent('file-select', {
  detail: path,
  bubbles: true,
  composed: true,  // ← crosses shadow DOM boundary
}));

// Parent listens
html`<project-tree @file-select=${this.handleFileSelect}></project-tree>`
```

**Option 3: Lit Context (for deep component trees)**

Use `@lit/context` for dependency-injection-style sharing across many levels.

---

## 5. Shadow DOM & Styling

### 5.1 CSS Custom Properties (The Only Global-to-Shadow Bridge)

Lit components render in Shadow DOM, which isolates them from document-level CSS. The ONLY thing that crosses the shadow boundary is **inherited CSS custom properties**.

**Pattern:**

1. Define the entire theme as `:root { --bg-primary: #0f172a; ... }` in a single global stylesheet.
2. Inject it once into `<head>` via the app shell.
3. Reference variables with `var(--bg-primary)` inside each component's `static styles`.

```typescript
static styles = css`
  :host {
    display: block;
    background: var(--bg-primary);
    color: var(--text-primary);
  }
`;
```

**Do NOT** try to style shadow content from a global stylesheet with element selectors (`.my-el .item { ... }`). It silently does nothing.

---

### 5.2 `static styles` Architecture

```typescript
import { designTokens } from '../styles/design-tokens';
import { buttonStyles } from '../styles/shared';

static styles = [
  designTokens,      // Shared utilities, keyframes, panel primitives
  buttonStyles,    // Shared button/icon-button classes
  css`
    :host {
      display: block;
    }
    .local-class {
      /* Component-specific styles */
    }
  `,
];
```

**Rule:** Component-specific styles go in the component's own `static styles`. Shared classes (buttons, panels, animations) go in imported `css` fragments.

---

### 5.3 Shared Style Modules

**`design-tokens.ts`** — animations, utility classes, panel primitives:

```typescript
export const designTokens = css`
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .spinner {
    display: inline-block;
    width: 16px; height: 16px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
  .panel { display: flex; flex-direction: column; height: 100%; }
`;
```

**`shared.ts`** — button families, icon buttons:

```typescript
export const buttonStyles = css`
  .btn { /* ... */ }
  .icon-btn { /* ... */ }
`;
```

---

### 5.4 `:host` and Layout

Always set a display mode on `:host` so the component participates in CSS layout correctly:

```typescript
static styles = css`
  :host {
    display: block;     /* or flex, grid, inline-flex */
    height: 100%;       /* when used inside a flex parent */
  }
`;
```

Without `display`, custom elements default to `inline`, which breaks flex/grid layouts.

---

## 6. Performance

### 6.1 Batch Updates

Lit batches property changes automatically within a microtask. But if you're processing many events (e.g., SSE streaming), batch the work:

```typescript
private _drainQueued = false;

updated() {
  if (!this._drainQueued) {
    this._drainQueued = true;
    queueMicrotask(() => {
      this._drainQueued = false;
      this.drainQueue();
    });
  }
}
```

### 6.2 Cache Expensive Computations

Don't recompute in `render()` if the input hasn't changed:

```typescript
willUpdate(changed: Map<string, unknown>) {
  if (changed.has('contentBlocks')) {
    this._renderedBlocks = this.contentBlocks.map(b =>
      b.kind === 'text' ? renderMarkdown(b.content) : null
    );
  }
}

render() {
  return html`${this._renderedBlocks.map(b =>
    b ? unsafeHTML(b) : nothing
  )}`;
}
```

### 6.3 Avoid `render()` Side Effects

`render()` must be a **pure function** of component state. Never mutate state, call APIs, or attach listeners inside `render()` or methods called from it.

```typescript
// ❌ WRONG — side effect in render path
render() {
  this._lastIds = this.messages.map(m => m.id);  // ← mutates state
  return html`...`;
}

// ✅ CORRECT — side effect in updated()
updated(changed: Map<string, unknown>) {
  if (changed.has('messages')) {
    this._lastIds = this.messages.map(m => m.id);
  }
}
```

### 6.4 Use `nothing` for Conditional Gaps

Import `nothing` from `lit` to render nothing without creating DOM nodes:

```typescript
import { nothing } from 'lit';

render() {
  return html`
    ${this.error
      ? html`<div class="error">${this.error}</div>`
      : nothing
    }
  `;
}
```

This preserves template structure consistency, which is important for hydration.

---

## 7. Event Handling

### 7.1 Custom Events Must Use `composed: true` to Cross Shadow DOM

Events dispatched from inside a Lit component's shadow DOM do NOT bubble out of the shadow boundary unless `composed: true` is set.

```typescript
this.dispatchEvent(new CustomEvent('model-switch', {
  detail: model,
  bubbles: true,
  composed: true,  // ← REQUIRED for parent listeners in light DOM
}));
```

**Without `composed: true`:** The event is trapped inside the shadow DOM and the parent template listener (`@model-switch=${...}`) never fires.

---

### 7.2 Event Naming Convention

- Use kebab-case for custom event names: `file-select`, `model-switch`, `session-close`
- Use present-tense verbs for actions: `select`, `switch`, `close`
- Use `*-change` for value changes: `selection-change`, `value-change`

---

### 7.3 Stop Propagation Sparingly

Avoid `e.stopPropagation()` unless there's a specific collision (nested clickable elements). It prevents parent components and light-DOM event delegation from observing events.

```typescript
// ❌ Usually unnecessary
private handleClick(e: Event) {
  e.stopPropagation();
  // ...
}

// ✅ Let it bubble unless you have a specific reason
private handleClick() {
  this.dispatchEvent(new CustomEvent('file-select', { detail: path, bubbles: true, composed: true }));
}
```

---

## 8. Build & Production

### 8.1 esbuild + Decorator Bundling Issue

**Litro uses esbuild via a custom Vite adapter.** esbuild's experimental decorator support (`tsconfigRaw.experimentalDecorators: true`) is sufficient for compilation but does NOT bundle certain imports from `lit/decorators.js`.

**Affected:**
- `@property()` — NOT bundled → `ReferenceError: property is not defined`
- `@state()` — NOT bundled → same error
- `@query()` — NOT bundled → same error
- `@customElement()` — Usually bundled (check each build)

**Safe:**
- `static properties` block — no decorator imports needed
- `customElements.define('tag-name', MyElement)` — no decorator needed

**Verification:** After every significant change, run `bun run build` and test the production bundle. Do not rely on `bun run dev` alone.

### 8.2 Do Not Add `vite-plugin-swc`

The project previously tried `vite-plugin-swc` and it caused parse errors on TypeScript `as` expressions. esbuild is sufficient.

### 8.3 Port Verification

Litro dev server runs on port 3000 and does NOT roam. Always verify the port is free:

```bash
lsof -iTCP:3000 -sTCP:LISTEN -P -n | awk '$1 == "node" {print $2}' | xargs -r kill -9
```

---

## 9. Anti-Patterns Checklist

Use this checklist before committing any Lit component:

### ❌ Component Definition
- [ ] Class uses `@property()` or `@state()` without extending `LitElement`
- [ ] Class extends `HTMLElement` but uses Lit decorators
- [ ] `@customElement()` used but class doesn't extend `LitElement`

### ❌ Lifecycle
- [ ] `connectedCallback()` sets reactive state that affects `render()`
- [ ] Async data loading starts in `connectedCallback()` instead of `firstUpdated()`
- [ ] `render()` contains side effects (mutating state, calling APIs)
- [ ] `firstRender` / `firstUpdate` boolean flags instead of `firstUpdated()`
- [ ] `updated()` performs heavy synchronous work without batching

### ❌ State Management
- [ ] `.push()` / `.splice()` on array properties without calling `requestUpdate()`
- [ ] Mutating object properties in place: `obj.prop = newVal`
- [ ] Static mutable state (`static _cache = new Map()`) shared across instances
- [ ] Component changes its own public property without dispatching an event

### ❌ DOM Access
- [ ] `this.shadowRoot?.querySelector()` used every frame or every render
- [ ] `.innerHTML` assignment outside Lit's template system
- [ ] Parent reaches into child shadow DOM and calls methods
- [ ] `.ref=${callback}` instead of `ref()` directive from `lit/directives/ref.js`

### ❌ SSR / Hydration
- [ ] `window` / `document` / `localStorage` accessed in `render()` or getters without `typeof window` guard
- [ ] Random or time-based values generated during `render()` or in constructor
- [ ] Conditional branches that switch between `html` and `unsafeHTML` at the same template position
- [ ] `loading` state set to `true` before first render (in `connectedCallback()`)

### ❌ Events
- [ ] Custom event missing `composed: true` when crossing shadow boundary
- [ ] `e.stopPropagation()` used without specific collision reason
- [ ] Event name uses camelCase instead of kebab-case

### ❌ Styling
- [ ] Global stylesheet tries to target elements inside shadow DOM
- [ ] Inline `style` attributes for layout instead of CSS classes
- [ ] `:host` missing `display` property

### ❌ Performance
- [ ] Expensive computation (Markdown, syntax highlighting) in `render()` without caching
- [ ] `unsafeHTML` used for static, controlled content that could use plain `html`

---

## 10. Decision Reference

### When to use `static properties` vs `@property()`

| Context | Use |
|---|---|
| Sub-component (`extends LitElement`) | `static properties` |
| Top-level page (`extends LitroPage`) | `@state()` acceptable |
| Any component in production build | `static properties` (esbuild safety) |
| Quick prototype / internal tool | Either (dev server works with both) |

### When to use `firstUpdated()` vs `connectedCallback()`

| Task | Hook |
|---|---|
| Add/remove event listeners | `connectedCallback()` / `disconnectedCallback()` |
| Connect to SSE/WebSocket | `firstUpdated()` (after hydration) |
| Fetch initial data | `firstUpdated()` |
| Read URL params | `firstUpdated()` (or constructor with guard) |
| Setup ResizeObserver / IntersectionObserver | `firstUpdated()` |
| Setup timers / intervals | `firstUpdated()` |

### When to use Controllers vs Direct State

| Scenario | Pattern |
|---|---|
| Single component, simple state | Direct properties on component |
| Shared state, 2–3 components | Reactive controller store |
| Shared state, deep tree | Lit Context (`@lit/context`) |
| External connection (SSE, WS) | Dedicated controller |
| Complex async task with loading/error states | `@lit/task` controller |

### When to use `unsafeHTML`

| Use Case | Verdict |
|---|---|
| Trusted HTML from markdown renderer | ✅ `unsafeHTML(renderedMarkdown)` |
| Static HTML that could be plain `html` template | ❌ Use `html` template instead |
| User-generated content | ❌ Sanitize with DOMPurify first, then `unsafeHTML` |
| Simple text highlighting with `<mark>` | ❌ Use `html` template |

---

## References

1. [Lit Reactive Properties](https://lit.dev/docs/components/properties/)
2. [Lit Reactive Controllers](https://lit.dev/docs/composition/controllers/)
3. [Lit Component Composition](https://lit.dev/docs/composition/component-composition/)
4. [Lit Lifecycle](https://lit.dev/docs/components/lifecycle/)
5. [Lit Events](https://lit.dev/docs/components/events/)
6. [Lit SSR Overview](https://lit.dev/docs/ssr/overview/)
7. [Lit Hydration](https://lit.dev/docs/ssr/client-usage/)
8. [Lit Cheat Sheet](https://lit.dev/articles/lit-cheat-sheet/)
9. [Lit Directives](https://lit.dev/docs/templates/directives/)
10. [`@lit/task` Async Task Controller](https://lit.dev/docs/data/task/)
