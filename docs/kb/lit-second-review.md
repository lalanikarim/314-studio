# Lit Code Second Review — Best Practices & SSR

> **Date:** 2026-07-07  
> **Scope:** All `.ts` files under `frontend-litro/` (pages, components, lib, services, styles, types)  
> **Reference:** `docs/kb/lit-best-practices.md`

---

## Summary

The codebase is in **significantly better shape** after the first round of fixes. Sub-components correctly use `static properties`, CSS custom properties bridge the shadow boundary, the reactive-controller pattern is well-applied, and event dispatching uses `composed: true` throughout.

This review found **3 critical bugs** (1 runtime crash, 1 SSR crash, 1 broken DOM ref), **1 high-priority hydration mismatch**, and several medium-priority patterns that should be tightened before production.

---

## Critical Issues

### 1. `chat-panel.ts` — `this.chatController` undefined during SSR (`render()` crash)

**File:** `frontend-litro/components/chat-panel.ts`  
**Line:** `private chatController!: ChatStreamController;` (declared), initialized in `connectedCallback()`  
**Impact:** Server-side rendering crashes with `Cannot read properties of undefined (reading 'isStreaming')`.

`chatController` is created inside `connectedCallback()`:

```typescript
connectedCallback() {
  super.connectedCallback();
  this.chatController = new ChatStreamController(this, this.sessionId);
}
```

But `render()` accesses `this.chatController.isStreaming`, `this.chatController.state`, `this.chatController.pendingUiRequest`, and `this.chatController.hasEverStreamed` in **six** template expressions. `connectedCallback()` **does not run during SSR**, so `this.chatController` is `undefined` when the server calls `render()`.

**Fix:** Initialize the controller in the `constructor()` (which runs during SSR). The controller's `hostConnected()` will still only fire on the client, so no SSE connection is opened on the server.

```typescript
constructor() {
  super();
  this.chatController = new ChatStreamController(this, this.sessionId);
}
```

Remove the `this.chatController = ...` line from `connectedCallback()`.

---

### 2. `chat-message.ts` — `idx` is not defined in `renderBlock()`

**File:** `frontend-litro/components/chat-message.ts`  
**Line:** ~235

```typescript
private renderBlock(block: MessageContentBlock, isUser: boolean) {
  switch (block.kind) {
    case 'text':
      return isUser
        ? html`<p>${block.content}</p>`
        : html`${unsafeHTML(this._renderedBlocks[idx] ?? '')}`;  // ← idx is NOT defined
```

The `renderContentBlocks` method calls `.map((block) => this.renderBlock(block, isUser))` without passing an index. `idx` does not exist in scope — this will throw `ReferenceError: idx is not defined` at runtime for every assistant text block.

**Fix:** Pass the index through the map callback:

```typescript
${this.contentBlocks.map((block, idx) => this.renderBlock(block, idx, isUser))}

private renderBlock(block: MessageContentBlock, idx: number, isUser: boolean) {
  // ...
  : html`${unsafeHTML(this._renderedBlocks[idx] ?? '')}`;
}
```

---

### 3. `page-workspace.ts` — `.ref` property binding instead of `ref()` directive

**File:** `frontend-litro/pages/workspace.ts`  
**Line:** ~355

```typescript
<div
  class="view-workspace__model-selector"
  .ref=${(el: HTMLElement | null) => { this._modelSelectorRef = el; }}
>
```

`.ref=${...}` sets a property named `ref` on the `<div>`. A plain `HTMLElement` has no `ref` property that does anything. The Lit `ref` directive **must** be used as `${ref(callback)}`.

**Impact:** `this._modelSelectorRef` is always `null`, so `handleOutsideModelClick` can never detect clicks inside the dropdown. The model dropdown stays open when clicking elsewhere on the page.

**Fix:** Import the `ref` directive and use it correctly:

```typescript
import { ref } from 'lit/directives/ref.js';

// In render():
<div
  class="view-workspace__model-selector"
  ${ref((el: HTMLElement | null) => { this._modelSelectorRef = el; })}
>
```

---

## High Priority

### 4. `page-workspace.ts` — `fetchSessionData()` in `connectedCallback()` sets reactive state before hydration

**File:** `frontend-litro/pages/workspace.ts`  
**Lines:** 183–215 (inside `connectedCallback`)

```typescript
connectedCallback() {
  super.connectedCallback();
  // ...
  this.fetchSessionData();  // ← async, but sets sessionId SYNCHRONOUSLY
}

private async fetchSessionData() {
  // ...
  this.sessionId = this._urlSessionId;   // ← synchronous reactive state change
  // await fetchModels() ...
  this.currentModel = model;              // ← another reactive state change
}
```

`fetchSessionData()` is `async`, but its **first** line (`this.sessionId = ...`) executes synchronously. `sessionId` is `@state()`, so setting it triggers `requestUpdate()`. The first client render now sees a populated `sessionId`, while SSR rendered with `sessionId = ''`. This violates the hydration contract: **the first client `render()` must match the SSR output exactly**.

**Fix:** Move the data load to `firstUpdated()`:

```typescript
connectedCallback() {
  super.connectedCallback();
  if (typeof window !== 'undefined') {
    this._urlSessionId = new URLSearchParams(window.location.search).get('session_id') || '';
  }
  this.addController(this.selectionStore.controller(this));
  document.addEventListener('click', this.handleOutsideModelClick);
  // REMOVE: this.fetchSessionData();
}

firstUpdated() {
  this.fetchSessionData();
}
```

The synchronous `this._urlSessionId` assignment is fine — it's a non-reactive private field. Only move the reactive property mutations.

---

## Medium Priority

### 5. In-place mutation of content block objects (two locations)

**KB rule:** "Mutating an object or array property does NOT trigger an update because the reference hasn't changed." Even when followed by an array replacement, in-place mutation is fragile.

#### Location A: `chat-panel.ts` `mergeToolResultsIntoAssistantBlocks()`

**Line:** ~720

```typescript
const existing = block as MutableToolCallBlock;
existing.result = resultById.get(block.id) ?? existing.result;
result.push(existing);
```

`existing` is a reference to the original `block` object. Mutating `.result` in place modifies the source array's objects.

**Fix:** Create a new object:

```typescript
result.push({ ...block, result: resultById.get(block.id) ?? (block as MutableToolCallBlock).result });
```

#### Location B: `chat-panel.ts` `ensureStreamingMessage()`

**Line:** ~430

```typescript
const pb = prevMsg.content[bi] as MutableToolCallBlock;
if (pb.kind === 'toolCall' && pb.id === tc.id) {
  pb.result = tc.result ?? pb.result;  // ← in-place mutation
  break;
}
```

**Fix:** Build a new `content` array with the updated block instead of mutating.

---

### 6. Use `nothing` instead of `''` for conditional template gaps

**KB rule:** "Import `nothing` from `lit` to render nothing without creating DOM nodes... preserves template structure consistency, which is important for hydration."

Multiple files use `''` (empty string) as the else branch of ternaries inside `html`:

| File | Line | Pattern |
|------|------|---------|
| `chat-panel.ts` | ~620 | `${this.errorMessage ? html\`...\` : ''}` |
| `chat-panel.ts` | ~630 | `${this.chatController.pendingUiRequest ? ... : ''}` |
| `chat-panel.ts` | ~640 | `${this.showClearConfirm ? ... : ''}` |
| `page-home.ts` | ~210 | `${this.shutdownTarget ? html\`...\` : ''}` |
| `page-models.ts` | ~280 | `${!this.loading && this.providers.length > 0 ? ... : ''}` |
| `page-workspace.ts` | ~360 | `${this.modelDropdownOpen ? this.renderModelDropdown() : ''}` |

**Fix:** Import `nothing` from `lit` and replace `''` with `nothing` in all template ternaries.

```typescript
import { nothing } from 'lit';

// Before:
${condition ? html\`...\` : ''}

// After:
${condition ? html\`...\` : nothing}
```

---

### 7. `file-preview-markdown.ts` — cache computation in `updated()` instead of `willUpdate()`

**File:** `frontend-litro/components/file-preview-markdown.ts`  
**Lines:** 95–100

```typescript
updated(changedProperties: Map<string, any>) {
  super.updated();
  if (changedProperties.has('content') && this.content) {
    this._renderedPreview = this.renderPreview();
  }
}
```

The KB recommends `willUpdate()` for pre-render computations so the cached value is ready before `render()` runs. Using `updated()` means the first render after a content change still sees the stale `_renderedPreview`, then a second render happens with the new value. For markdown preview, this is a double-render.

**Fix:** Move the cache logic to `willUpdate()`:

```typescript
willUpdate(changed: Map<string, unknown>) {
  if (changed.has('content')) {
    this._renderedPreview = this.content ? this.renderPreview() : '';
  }
}
```

---

## Low Priority / Notes

### 8. `page-home.ts` — `highlight()` returns `TemplateResult` but is typed as `TemplateResult` (not `TemplateResult | string`)

**File:** `frontend-litro/components/chat-message.ts` has the actual undefined `idx` bug. The `page-home.ts` `highlight()` method correctly types its return and is not an issue — this note is just a reminder that `page-home.ts` `highlight()` is fine.

### 9. `chat-input.ts` — `value` as a public property with `{ state: true }`

**File:** `frontend-litro/components/chat-input.ts`

```typescript
static properties = {
  disabled: { type: Boolean },
  isStreaming: { type: Boolean },
  value: { type: String, state: true },
};
```

`value` is internal state (changed by the component itself in response to `@input`), but it's declared as a public property with `state: true`. The KB recommends leading-underscore or `private` naming for internal state. This is stylistic — it works correctly, but renaming to `_value` or making it a true private field would better express intent.

### 10. `chat-panel.ts` — `setTimeout(() => this.loadChatHistory(), 500)` could be shorter

The 500ms delay for history loading is a defensive guard against Litro's hydration double-instance issue. The KB recommends checking `this.isConnected` inside the callback (which is already done). The delay is fine, but consider reducing to `0` or `100` — the `isConnected` check is the real guard.

### 11. `prismjs` side-effect imports may fail during SSR

**File:** `frontend-litro/components/file-preview-code.ts`  
**Lines:** 9–35

The Prism language component files (`prism-typescript.js`, etc.) reference `Prism` as a free global. In an ESM + Node.js SSR environment, `(globalThis as any).Prism = Prism` may not make `Prism` available as an undeclared variable in the component modules. If the bundler does not wrap them, SSR could crash with `ReferenceError: Prism is not defined`.

**Mitigation:** Since `file-preview-code` is not rendered during initial SSR (no file selected), this is unlikely to trigger in practice. For safety, consider lazy-loading Prism on the client only, or verify the production build handles the global correctly.

---

## What's Working Well

| Area | Status | Notes |
|------|--------|-------|
| **Sub-component properties** | ✅ | All sub-components use `static properties` — no decorator bundling risk |
| **Event dispatching** | ✅ | Every custom event crossing shadow boundaries uses `composed: true` |
| **CSS custom properties** | ✅ | Theme vars inherit through shadow boundary; no global selector leakage |
| **Reactive controllers** | ✅ | `ChatStreamController` and `SelectionStore` follow the controller pattern correctly |
| **Immutable array updates** | ✅ | `displayMessages = [...displayMessages, newMsg]` pattern is consistent |
| **SSR guards** | ✅ | `folderPath` getters use `typeof window === 'undefined'` guards |
| **Data loading hooks** | ✅ | `page-home`, `page-models`, `tree-node` use `firstUpdated()` for data loading |
| **Lifecycle cleanup** | ✅ | `disconnectedCallback` removes listeners, revokes object URLs, closes SSE |
| **`:host` display** | ✅ | Nearly every component sets `display` on `:host` |
| **Microtask batching** | ✅ | `chat-panel` drains SSE queue via `queueMicrotask` |
| **Markdown caching** | ✅ | `chat-message` caches rendered markdown in `willUpdate()` |

---

## Fix Checklist

- [ ] **Critical 1:** Move `ChatStreamController` initialization to `chat-panel` constructor
- [ ] **Critical 2:** Pass `idx` parameter through `map()` in `chat-message.ts`
- [ ] **Critical 3:** Replace `.ref=${...}` with `${ref(...)}` in `workspace.ts`
- [ ] **High 4:** Move `fetchSessionData()` from `connectedCallback()` to `firstUpdated()` in `workspace.ts`
- [ ] **Medium 5:** Remove in-place mutations in `mergeToolResultsIntoAssistantBlocks` and `ensureStreamingMessage`
- [ ] **Medium 6:** Replace all `''` fallback branches in templates with `nothing`
- [ ] **Medium 7:** Move `_renderedPreview` cache from `updated()` to `willUpdate()` in `file-preview-markdown.ts`
- [ ] **Low 9:** (Optional) Rename `chat-input.value` to `_value` to signal internal state
