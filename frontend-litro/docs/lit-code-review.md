# Lit Code Review — Deviation Analysis & Recommendations

> **Scope:** `frontend-litro/` — Litro + Lit components, pages, controllers, and services.  
> **Date:** 2026-07-07  
> **Severity:** 🔴 Critical · 🟡 Significant · 🟢 Minor/Style

---

## Summary

The codebase demonstrates solid understanding of Lit fundamentals—reactive controllers (`ChatStreamController`), CSS custom properties for theming, proper Shadow DOM scoping, and mostly correct immutable data patterns. However, there are **several critical deviations** from Lit design principles that will cause production crashes, break encapsulation, or introduce subtle reactivity bugs.

---

## 1. 🔴 Critical Issues

### 1.1 `@property` decorator used in sub-component (`chat-message.ts`)

**File:** `components/chat-message.ts`  
**Principle:** [Lit Decorators — Production Build Safety](https://lit.dev/docs/components/decorators/)

```typescript
// ❌ WRONG — crashes in production builds
import { customElement, property } from 'lit/decorators.js';
@customElement('chat-message')
export class ChatMessageElement extends LitElement {
  @property({ type: String }) role = '';
  @property({ type: Number }) timestamp = 0;
  @property({ type: Array, attribute: false }) contentBlocks = [];
```

**Problem:** esbuild (used by Litro's Vite adapter) does **not** bundle the `property` import into the production client bundle. The dev server resolves it at runtime, so it works locally. Production crashes with `ReferenceError: property is not defined`.

**Fix:** Convert to `static properties` block, consistent with every other sub-component:

```typescript
// ✅ CORRECT
static properties = {
  role: { type: String },
  timestamp: { type: Number },
  contentBlocks: { type: Array, attribute: false },
  isStreaming: { type: Boolean, attribute: false },
};
role = '';
timestamp = 0;
contentBlocks: MessageContentBlock[] = [];
isStreaming = false;
```

**Also affected:** `file-preview-markdown.ts` uses `@state()` — same issue, same fix.

---

### 1.2 Imperative DOM manipulation bypasses Lit (`file-preview-code.ts`)

**File:** `components/file-preview-code.ts`  
**Principle:** [Rendering — Lit Template Purity](https://lit.dev/docs/components/rendering/)

```typescript
// ❌ WRONG — mutates DOM outside Lit's control
private renderCodeDOM() {
  if (!this.codeContainer) return;
  this.codeContainer.innerHTML = this.highlightedLines.join('\n');
}

render() {
  return html`
    <pre class="code-container__pre" .ref=${this.refCodeContainer}></pre>
  `;
}
```

**Problems:**
1. `.ref=${...}` is **not a Lit directive** — it sets a DOM property named `ref`, never calling the callback. The callback only fires if something else assigns it. Lit's actual `ref()` directive is imported from `lit/directives/ref.js`.
2. `innerHTML` assignment bypasses Lit's template system, hydration reconciliation, and security model.
3. If the component re-renders for any reason (theme change, resize), the `pre` element is recreated by Lit and the imperative `innerHTML` is lost.

**Fix:** Use `unsafeHTML()` inside the template, or a `Directive` that manages Prism highlighting reactively:

```typescript
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

render() {
  if (!this.highlighted) return html`<div class="code-container">Loading…</div>`;
  return html`
    <div class="code-container">
      <pre class="code-container__pre">
        <code>${unsafeHTML(this.highlightedLines.join('\n'))}</code>
      </pre>
    </div>
  `;
}
```

> ⚠️ If the concern is re-running Prism on every render, move the tokenization to `willUpdate()` and cache the result string. `unsafeHTML` only sets `innerHTML` once per unique string value.

---

### 1.3 Parent directly calls child method (`workspace.ts`)

**File:** `pages/workspace.ts`  
**Principle:** [Component Composition — Events Up, Properties Down](https://lit.dev/docs/composition/component-composition/)

```typescript
// ❌ WRONG — breaks component encapsulation
const cp = this.shadowRoot?.querySelector('chat-panel');
if (cp && typeof (cp as any).handleSwitchModel === 'function') {
  (cp as any).handleSwitchModel(model);
}
```

**Problem:** The parent reaches into the child's shadow DOM, casts to `any`, and calls an internal method. This is the exact opposite of Lit's top-down, event-up architecture. It tightly couples the parent to the child's internal API and makes refactoring impossible.

**Fix:** Use a property binding + event pattern:

```typescript
// workspace.ts
html`
  <chat-panel
    .pendingModelSwitch=${this.pendingModelSwitch}
    @model-switch=${(e: CustomEvent<Model>) => this.handleModelSwitch(e)}
  ></chat-panel>
`

// chat-panel.ts
static properties = {
  pendingModelSwitch: { type: Object, attribute: false },
};

updated(changed: Map<string, unknown>) {
  if (changed.has('pendingModelSwitch') && this.pendingModelSwitch) {
    this.handleSwitchModel(this.pendingModelSwitch);
    // Clear so it doesn't re-fire
    this.pendingModelSwitch = null;
  }
}
```

---

### 1.4 Mutable object mutation inside reactive arrays (`chat-panel.ts`)

**File:** `components/chat-panel.ts`  
**Principle:** [Mutating Object/Array Properties](https://lit.dev/docs/components/properties/#mutating-object-and-array-properties)

```typescript
// ❌ WRONG — mutates object reference without changing it
private updateStreamingMessageContent() {
  const lastMsg = this.displayMessages[this.displayMessages.length - 1];
  // ...build contentBlocks...
  (lastMsg as any).content = contentBlocks;   // ← mutation
  this.displayMessages = [...this.displayMessages]; // ← only array is new
}
```

**Problem:** The `lastMsg` object reference is mutated in place. While the array spread triggers an update on `chat-panel`, any *sub-component* receiving that `ChatMessage` object (e.g., `<chat-message .contentBlocks=${msg.content}>`) will **not** re-render because the object reference hasn't changed—only a property inside it changed. Lit compares property values by reference for Objects/Arrays.

**Fix:** Treat message objects as immutable:

```typescript
const updated = [...this.displayMessages];
updated[updated.length - 1] = {
  ...lastMsg,
  content: contentBlocks,
};
this.displayMessages = updated;
```

---

### 1.5 Global mutable static state on component class (`chat-panel.ts`)

**File:** `components/chat-panel.ts`

```typescript
// ❌ WRONG — shared mutable state across all instances + SSR hydration
private static _lastRenderMsgIds: string[] = [];
private static _historyLoadedSessions = new Set<string>();
```

**Problem:** Litro's SSR → hydration creates **multiple component instances** for the same logical element. Static mutable state means:
- A disconnected instance can block history loading for the visible instance.
- `_lastRenderMsgIds` is shared globally, so unrelated chat panels interfere with each other's render tracking.
- Memory leaks: old session IDs accumulate in the `Set` forever.

**Fix:** Use instance-level `Set`/`Map` keyed by session ID, or store guards in an external WeakMap:

```typescript
// Instance level (cleared on session change)
private historyLoadedForSession: string | null = null;

private async loadChatHistory() {
  if (!this.sessionId || this.historyLoadedForSession === this.sessionId) return;
  // ...load...
  this.historyLoadedForSession = this.sessionId;
}
```

---

## 2. 🟡 Significant Issues

### 2.1 Side effects inside `render()` (`chat-panel.ts`)

**File:** `components/chat-panel.ts`  
**Principle:** `render()` must be a **pure function** of component state.

```typescript
// ❌ WRONG — side effect in render path
private renderMessages() {
  const msgs = this.sortedMessages;
  const ids = msgs.map((m) => m.id);
  const prevIds = ChatPanelElement._lastRenderMsgIds;
  const added = ids.filter((id) => !prevIds.includes(id));
  // ...
  if (added.length > 0 || removed.length > 0) {
    ChatPanelElement._lastRenderMsgIds = ids;  // ← side effect
  }
  return msgs.map(...);
}
```

**Problem:** `render()` (and methods called from it) must not mutate state. Lit may call `render()` speculatively, during hydration, or without committing the result. Side effects cause unpredictable state corruption.

**Fix:** Move tracking to `updated()` or `willUpdate()`:

```typescript
updated(changed: Map<string, unknown>) {
  if (changed.has('displayMessages')) {
    const ids = this.displayMessages.map(m => m.id);
    const prev = this._prevMessageIds;
    this._prevMessageIds = ids;
    // Do transition logic here (e.g., scroll, animation)
  }
}
```

---

### 2.2 Heavy synchronous work in `updated()` (`chat-panel.ts`)

**File:** `components/chat-panel.ts`

```typescript
updated(changedProperties: Map<string, unknown>) {
  // ...
  this.drainQueue();        // ← processes potentially hundreds of events
  if (this.chatController.isStreaming) {
    this.scrollToBottom();  // ← async but triggered every update
  }
}
```

**Problem:** `drainQueue()` iterates through ALL unprocessed controller messages and performs complex merging logic. The controller calls `host.requestUpdate()` on **every** incoming SSE event, which means `updated()` runs for every single event. With high-volume streaming, this can cause frame drops.

**Fix:** Batch queue draining using `requestAnimationFrame` or microtask batching:

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

---

### 2.3 `unsafeHTML` for markdown without caching (`chat-message.ts`)

**File:** `components/chat-message.ts`

```typescript
private renderBlock(block: MessageContentBlock, isUser: boolean) {
  case 'text':
    return html`${unsafeHTML(renderMarkdown(block.content))}`;
}
```

**Problem:** `renderMarkdown()` (MarkdownIt) is invoked on every re-render of every text block. For long chats with many messages, this is O(n²) markdown parsing.

**Fix:** Cache rendered HTML at the message level in `willUpdate()` or use a directive:

```typescript
willUpdate(changed: Map<string, unknown>) {
  if (changed.has('contentBlocks')) {
    this._renderedBlocks = this.contentBlocks.map(b =>
      b.kind === 'text' ? renderMarkdown(b.content) : null
    );
  }
}
```

---

### 2.4 `firstRender` / `firstUpdate` boolean anti-pattern

**Files:** `components/project-tree.ts`, `components/tree-node.ts`

```typescript
// ❌ WRONG — manual flag tracking
private firstRender = true;
updated(changedProperties: Map<string, any>) {
  if (this.firstRender) {
    // ...do one-time work...
    this.firstRender = false;
  }
}
```

**Problem:** Lit provides `firstUpdated()` specifically for one-time post-render initialization. Using `updated()` with a boolean flag is fragile (resets won't work) and less readable.

**Fix:**

```typescript
firstUpdated() {
  if (this.depth === 0 && this.node?.isDirectory) {
    this.expanded = true;
  }
}
```

---

### 2.5 `tree-node` stops event propagation unnecessarily

**File:** `components/project-tree.ts`

```typescript
private handleClick(e: Event) {
  e.stopPropagation();  // ← unnecessary, breaks delegation
  // ...
}
```

**Problem:** `stopPropagation()` prevents parent components or light-DOM event delegation from observing clicks. Since the component dispatches its own composed `file-select` event, bubbling the native click is harmless and sometimes useful for analytics or debugging.

**Fix:** Remove `e.stopPropagation()` unless there's a specific collision (e.g., nested clickable elements).

---

### 2.6 Inconsistent SSR safety patterns

**Files:** `pages/index.ts`, `pages/models.ts`, `pages/workspace.ts`

```typescript
// Some use getters
private get folderPath(): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('folder') || '';
}

// Others check in connectedCallback
connectedCallback() {
  super.connectedCallback();
  if (typeof window !== 'undefined' && this.folders.length === 0) {
    this.loadFolders();
  }
}
```

**Problem:** The `folderPath` getter runs during `render()`, which means it MUST guard `window`. But `loadFolders()` checks in `connectedCallback()` which only runs client-side anyway (SSR doesn't call `connectedCallback`). The inconsistency makes the code harder to audit for SSR safety.

**Fix:** Standardize on one pattern. For Litro SSR, prefer guards in getters called during `render()`, since `connectedCallback` is indeed client-only but getters may be called during SSR template evaluation.

---

### 2.7 `file-preview-image.ts` bypasses API service layer

**File:** `components/file-preview-image.ts`

```typescript
const resp = await fetch(
  `/api/projects/files/read?project_path=${encodeURIComponent(this.projectPath)}&file_path=${encodeURIComponent(this.filePath)}`
);
```

**Problem:** Inconsistent with the rest of the app which uses `services/api.ts`. If the API base path or URL scheme changes, this breaks independently.

**Fix:** Add a `readFileBlob()` helper to `services/api.ts` and use it here.

---

### 2.8 `extractProvider` still used despite known bug

**File:** `pages/workspace.ts`  
**Context:** `AGENTS.md` explicitly warns against this.

```typescript
// ❌ WRONG — falls back to "anthropic" for models without "/"
this.currentModel = createMinimalModel(
  session.model_id,
  extractProvider(session.model_id)
);
```

**Problem:** The `session` object from the API has `model_id` but not `provider`. However, the `fetchModels()` response DOES include `provider`. The workspace should look up the model in the already-fetched `this.models` array to get the correct provider.

**Fix:**

```typescript
const model = this.models.find(m => m.id === session.model_id);
this.currentModel = model ?? createMinimalModel(session.model_id, 'unknown');
```

---

## 3. 🟢 Minor / Style Issues

### 3.1 `sessionsFetched` dead code (`page-home.ts`)

```typescript
private async loadSessions() {
  this.sessionsFetched = false;
  // Reset for next time...
  if (this.sessionsFetched) {      // ← always false here
    this.sessionsFetched = true;
    return;
  }
  this.sessionsFetched = true;
  // ...
}
```

The `if (this.sessionsFetched)` check immediately after setting it to `false` is unreachable dead code.

---

### 3.2 `highlight()` in `page-home.ts` uses `unsafeHTML` unnecessarily

```typescript
// Can be done without unsafeHTML
return html`${name.slice(0, idx)}<mark class="highlight-mark">${name.slice(idx, idx + this.search.length)}</mark>${name.slice(idx + this.search.length)}`;
```

The current code uses `unsafeHTML` to inject a `<mark>` tag, but the content is fully controlled and static. The above template is safer and more idiomatic.

---

### 3.3 `renderModelDropdown` uses inline styles for layout

**File:** `pages/workspace.ts`

```typescript
html`<div style="font-weight: 500;">${model.name}</div>`
```

Minor deviation — these should be CSS class rules in `static styles` for maintainability and to avoid CSP issues.

---

### 3.4 Missing `super.updated()` calls

**Files:** `components/chat-panel.ts`, `components/project-tree.ts`, `components/tree-node.ts`, `components/file-preview.ts`, etc.

While `LitElement.updated()` is currently empty (so omitting `super.updated()` has no effect), it's good defensive practice to always call it in case future Lit versions add behavior there.

---

### 3.5 `scrollToBottom` uses `querySelector` every call

**File:** `components/chat-panel.ts`

```typescript
private async scrollToBottom() {
  const messagesContainer = this.shadowRoot?.querySelector('.chat-panel__messages');
  // ...
}
```

**Fix:** Use the `ref()` directive or `@query` decorator to hold a stable reference:

```typescript
import { query } from 'lit/decorators.js';
@query('.chat-panel__messages') private messagesContainer!: HTMLElement;
```

---

### 3.6 `unsafeHTML` for user search highlight (`page-home.ts`)

```typescript
return html`${name.slice(0, idx)}${unsafeHTML(`<mark class="highlight-mark">${name.slice(idx, idx + this.search.length)}</mark>`)}${name.slice(idx + this.search.length)}`;
```

The `name` and `search` values come from user input (folder names and search query). While `unsafeHTML` with fully controlled string concatenation is technically safe here, it's unnecessary and sets a bad precedent. Use the standard `html` tagged template:

```typescript
return html`${name.slice(0, idx)}<mark class="highlight-mark">${name.slice(idx, idx + this.search.length)}</mark>${name.slice(idx + this.search.length)}`;
```

---

### 3.7 Inconsistent use of designTokens in component styles

Some components (e.g., `shutdown-dialog.ts`) don't include `designTokens` in their `static styles` array. CSS custom properties do inherit through shadow boundaries, so this works when `theme.css` is loaded. However, if a component is ever used outside the Litro shell (e.g., in a test, storybook, or standalone), the tokens are undefined. For robustness, all components that reference design tokens should import them.

---

## 4. ✅ Strengths (Preserve These)

| Pattern | Where | Why It's Good |
|--------|-------|---------------|
| **Reactive Controllers** | `lib/chat-stream-controller.ts` | Clean separation of transport vs. presentation. The controller owns SSE lifecycle; the component owns rendering. Perfect Lit pattern. |
| **Immutable data updates** | Most array assignments | `this.displayMessages = [...this.displayMessages, newMsg]` is the correct pattern. |
| **CSS custom properties for theming** | `public/theme.css` + all `static styles` | Inherits through shadow boundaries; single source of truth for the dark theme. |
| **Event dispatching for cross-component communication** | `chat-panel.ts`, `tree-node.ts` | Custom events with `composed: true, bubbles: true` correctly cross shadow DOM boundaries. |
| **Top-down data flow** | `workspace.ts` → children | Properties flow down (`sessionId`, `models`, `currentModel`); events flow up (`model-switch`, `session-close`). |
| **SSR window guards** | Most pages | `typeof window !== 'undefined'` checks prevent SSR crashes. |
| **Controller-based shared state** | `lib/selection-store.ts` | Creative use of `ReactiveController` for shared selection state without a global store. |
| **Static properties in sub-components** | `chat-input.ts`, `chat-tool-call.ts`, etc. | Follows the documented workaround for the esbuild decorator bundling issue. |

---

## 5. Recommended Priority Order

| Priority | Issue | Effort | Files |
|----------|-------|--------|-------|
| **P0** | Replace `@property` with `static properties` | 15 min | `chat-message.ts`, `file-preview-markdown.ts` |
| **P0** | Fix `.ref=` and `innerHTML` in file-preview-code | 30 min | `file-preview-code.ts` |
| **P0** | Remove parent→child method call in workspace | 20 min | `workspace.ts`, `chat-panel.ts` |
| **P0** | Fix mutable object mutation in chat-panel | 15 min | `chat-panel.ts` |
| **P1** | Move render side effects to `updated()` / `willUpdate()` | 30 min | `chat-panel.ts` |
| **P1** | Replace static mutable guards with instance-level | 20 min | `chat-panel.ts` |
| **P1** | Batch drainQueue with queueMicrotask | 15 min | `chat-panel.ts` |
| **P1** | Cache markdown rendering | 20 min | `chat-message.ts` |
| **P2** | Use `firstUpdated()` instead of boolean flags | 15 min | `project-tree.ts`, `tree-node.ts` |
| **P2** | Add `readFileBlob` to API service | 10 min | `services/api.ts`, `file-preview-image.ts` |
| **P2** | Standardize `@query` / `ref()` for DOM access | 30 min | `chat-panel.ts`, `file-preview-code.ts` |
| **P3** | Remove dead code, inline styles, minor cleanups | 20 min | Various |

---

## 6. Appendix: SSR Hydration Mismatch Analysis

The logs show a **critical hydration mismatch** that was not covered in the initial review:

```
Uncaught (in promise) Error: Hydration value mismatch: Unexpected TemplateResult rendered to part
```

This error occurs **twice** (two identical traces), which suggests multiple pages or multiple hydration attempts are affected.

---

### 6.1 Root Cause: `connectedCallback()` + Synchronous State Change Before First Render

**Lit SSR hydration rule:** The first client `render()` output must match the SSR output **exactly** at every template "part" (`${...}` expression). If a property changes between SSR serialization and the client's first render, the part types differ and hydration crashes.

**The problematic pattern in the codebase:**

```typescript
// pages/index.ts  &  pages/models.ts
connectedCallback() {
  super.connectedCallback();
  if (typeof window !== 'undefined') this.loadFolders(); // or loadModels()
}

private async loadFolders() {
  this.loading = true;   // ← SYNCHRONOUS state change
  this.error = null;
  try {
    const items = await browseDirectories('');
    this.folders = items.map(...);
  } catch (err) {
    this.error = ...;
  } finally {
    this.loading = false;
  }
}
```

**What happens:**

| Phase | `loading` | `folders` | Rendered Output |
|-------|-----------|-----------|-----------------|
| **SSR** | `false` | `[]` | `<div class="view-folder__empty">No folders found.</div>` |
| **Client connectedCallback()** | `true` (set sync before `await`) | `[]` | `<div class="view-folder__empty"><span class="spinner"></span>Loading folders…</div>` |

The `this.loading = true` fires **synchronously** inside `loadFolders()`, before the first `await`. Lit batches this property change with the initial connection update. The first client `render()` sees `loading = true`, producing a **different DOM structure** than the SSR output. Hydration fails with "Unexpected TemplateResult rendered to part" because the template branch switched from the empty-state `TemplateResult` to the loading-state `TemplateResult` at the same part position.

**Same issue in `page-models.ts`:**

```typescript
private async loadModels() {
  this.loading = true;   // ← same synchronous mismatch
  // ...
}
```

---

### 6.2 Why `firstUpdated()` Is the Correct Hook

Lit lifecycle order:

```
constructor → connectedCallback → requestUpdate (batched) → performUpdate → render() → DOM commit → firstUpdated() → updated()
```

If data loading starts in `connectedCallback()`, the synchronous state change is batched into the **initial** update. If it starts in `firstUpdated()`, the initial render has already committed with SSR-matching state, hydration succeeds, and THEN the load begins.

**Fix for `page-home.ts` and `page-models.ts`:**

```typescript
// ✅ CORRECT — load AFTER hydration is complete
firstUpdated() {
  if (this.folders.length === 0) {
    this.loadFolders();
  }
}

// Remove the connectedCallback() load entirely
```

This ensures:
1. SSR renders with `loading = false`, `folders = []` → empty state
2. Client first render matches exactly → hydration succeeds
3. `firstUpdated()` runs → `loadFolders()` → `loading = true` → re-render shows spinner
4. Fetch completes → `folders = [...]` → re-render shows list

---

### 6.3 `workspace.ts`: `sessionId` Assignment Timing

**File:** `pages/workspace.ts`

```typescript
connectedCallback() {
  super.connectedCallback();
  this.fetchSessionData();   // ← async, but sets sessionId SYNCHRONOUSLY
}

private async fetchSessionData() {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    this.sessionId = params.get('session_id') || '';  // ← sync
  }
  this.models = await fetchModels(...);  // ← async
  // ...
}
```

**Analysis:** `sessionId` defaults to `''`. If the URL has `?session_id=abc`, the client sets `sessionId = 'abc'` synchronously before the first render. The SSR rendered with `sessionId = ''`. However, `sessionId` does not change the **structure** of `workspace.ts`'s template — it only affects property bindings to child elements. So `workspace.ts` itself may not trigger a hydration mismatch.

**But:** The nested `<chat-panel>` receives a different `sessionId` during hydration. While `chat-panel`'s `render()` doesn't branch on `sessionId`, its `connectedCallback` creates `ChatStreamController(this, this.sessionId)`. The controller lifecycle might trigger state changes that affect the child's render. If `chat-panel` re-renders during its own hydration due to controller setup, it could cause a mismatch in its own template.

**Fix:** Move the synchronous `sessionId` read to `firstUpdated()`, or read it in the constructor if it's needed before the first render (constructors run on both server and client, so guard with `typeof window`).

---

### 6.4 `tree-node.ts`: Auto-Expand via `updated()` Boolean Flag

**File:** `components/tree-node.ts`

```typescript
updated(changedProperties: Map<string, any>) {
  if (this.firstRender) {
    if (this.depth === 0 && !this.expanded && this.node?.isDirectory) {
      this.expanded = true;   // ← triggers re-render
      this.firstRender = false;
      return;
    }
    this.firstRender = false;
    return;
  }
  // ...
}
```

**Problem:** During SSR, `updated()` may run and set `expanded = true`, but the async `loadChildren()` won't complete before SSR serialization finishes. The final SSR output may have `expanded = true` with no children (empty `<div class="tree-node__children"></div>`), or `expanded = false` if the SSR engine didn't process the `updated()`-triggered re-render.

On the client, the fresh instance starts with `expanded = false`. The first render produces `expanded = false` output. If SSR output was `expanded = true`, hydration mismatches.

**Fix:** Move auto-expand to `firstUpdated()` and use Lit's built-in `firstUpdated` hook instead of a manual boolean flag:

```typescript
firstUpdated() {
  if (this.depth === 0 && this.node?.isDirectory) {
    this.expanded = true;
  }
}
```

This guarantees:
- SSR: `expanded = false` → row only, no children
- Client first render: `expanded = false` → matches SSR → hydration succeeds
- `firstUpdated()` → `expanded = true` → children container expands (still empty until `loadChildren()` completes)

---

### 6.5 `unsafeHTML` and Hydration Sensitivity

**Files:** `page-home.ts`, `chat-message.ts`, `file-preview-markdown.ts`

`unsafeHTML` creates a special "attribute part" or "node part" that renders raw HTML. During SSR, `unsafeHTML` content is serialized as literal HTML. During hydration, the client must find the same `unsafeHTML` directive at the same template position.

**Risk:** If a conditional switches from `html`...` to `unsafeHTML(...)` or vice-versa between SSR and client, the part types don't match. Currently this is not triggered on initial load (`search = ''`, `displayMessages = []`, `content = ''`), but any future change that populates these before hydration completes would break it.

**Recommendation:** Replace `unsafeHTML` in `page-home.ts` `highlight()` with plain `html` (see §3.2). For `chat-message.ts`, the `unsafeHTML` is gated behind `contentBlocks.length > 0` which is false on initial render, so it's safe — but keep it in mind if pre-loading messages for SSR later.

---

### 6.6 Litro Router: Multiple Instances During Hydration

**Context from `AGENTS.md`:**

> The Litro router **replaces the SSR-rendered page with a new instance** on client hydration. This creates **multiple instances** of nested components.

This means:
1. SSR renders `page-home` (instance #1)
2. Litro router creates a new `page-home` (instance #2) for the client
3. Instance #2 hydrates the DOM that instance #1 created

If instance #2's first `render()` doesn't match instance #1's output, hydration fails. The fix is ensuring instance #2 starts with the **exact same state** as instance #1 had during its initial render.

**Key implication:** Any state set in `connectedCallback()` on the client is invisible to SSR, so it cannot be reflected in the SSR output. Therefore, `connectedCallback()` must not set any reactive state that affects `render()` output before hydration completes.

---

### 6.7 Updated Priority Table (Including Hydration Fixes)

| Priority | Issue | Effort | Files |
|----------|-------|--------|-------|
| **P0** | **Move data loading from `connectedCallback` to `firstUpdated`** | 15 min | `pages/index.ts`, `pages/models.ts` |
| **P0** | **Fix `tree-node` auto-expand timing** | 10 min | `components/tree-node.ts` |
| **P0** | Replace `@property` with `static properties` | 15 min | `chat-message.ts`, `file-preview-markdown.ts` |
| **P0** | Fix `.ref=` and `innerHTML` in file-preview-code | 30 min | `file-preview-code.ts` |
| **P0** | Remove parent→child method call in workspace | 20 min | `workspace.ts`, `chat-panel.ts` |
| **P0** | Fix mutable object mutation in chat-panel | 15 min | `chat-panel.ts` |
| **P1** | Move render side effects to `updated()` / `willUpdate()` | 30 min | `chat-panel.ts` |
| **P1** | Replace static mutable guards with instance-level | 20 min | `chat-panel.ts` |
| **P1** | Batch drainQueue with queueMicrotask | 15 min | `chat-panel.ts` |
| **P1** | Cache markdown rendering | 20 min | `chat-message.ts` |
| **P2** | Use `firstUpdated()` instead of boolean flags | 15 min | `project-tree.ts`, `tree-node.ts` |
| **P2** | Add `readFileBlob` to API service | 10 min | `services/api.ts`, `file-preview-image.ts` |
| **P2** | Standardize `@query` / `ref()` for DOM access | 30 min | `chat-panel.ts`, `file-preview-code.ts` |
| **P3** | Remove dead code, inline styles, minor cleanups | 20 min | Various |

---

## 7. References

1. [Lit Reactive Properties](https://lit.dev/docs/components/properties/)
2. [Lit Reactive Controllers](https://lit.dev/docs/composition/controllers/)
3. [Lit Component Composition](https://lit.dev/docs/composition/component-composition/)
4. [Lit Lifecycle](https://lit.dev/docs/components/lifecycle/)
5. [Lit Events](https://lit.dev/docs/components/events/)
6. [Lit Cheat Sheet](https://lit.dev/articles/lit-cheat-sheet/)
7. [Lit Decorators](https://lit.dev/docs/components/decorators/)
8. [Lit SSR Overview](https://lit.dev/docs/ssr/overview/)
9. [Lit Hydration](https://lit.dev/docs/ssr/client-usage/)
