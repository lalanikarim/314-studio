# Lit Code Review — Fix Plan

> **Based on:** `frontend-litro/docs/lit-code-review.md` + `docs/kb/lit-best-practices.md`  
> **Date:** 2026-07-07  
> **Branch target:** `refactor/migrate-to-lit-frontend`  
> **Scope:** All `frontend-litro/` source — pages, components, controllers, services

---

## Executive Summary

The codebase has **22 identified issues** across 9 files. **6 are P0 (critical)** — they cause production crashes (decorator bundling) or SSR hydration failures. **7 are P1 (significant)** — they cause reactivity bugs, performance degradation, or encapsulation violations. **9 are P2/P3 (minor/style)** — dead code, inline styles, minor refactorings.

All fixes follow the patterns documented in `docs/kb/lit-best-practices.md` and the existing `AGENTS.md` gotchas section.

---

## Issue Matrix

| # | Priority | Category | Issue | File(s) | Verified | Status |
|---|----------|----------|-------|---------|----------|--------|
| 1 | **P0** | Build/Crash | `@property` decorator in sub-component | `components/chat-message.ts:191-197` | ✅ Present | ✅ Fixed |
| 2 | **P0** | Build/Crash | `@state` decorator in sub-components (6 files) | `project-tree.ts`, `file-preview-code.ts`, `chat-input.ts`, `file-preview-markdown.ts`, `file-preview.ts` | ✅ Present | ✅ Fixed |
| 3 | **P0** | SSR/Hydration | Data loading in `connectedCallback()` causes hydration mismatch | `pages/index.ts:243-246`, `pages/models.ts:282-284` | ✅ Present | ✅ Fixed |
| 4 | **P0** | SSR/Hydration | `tree-node` auto-expand in `updated()` boolean flag | `components/project-tree.ts:112-122` | ✅ Present | ✅ Fixed |
| 5 | **P0** | Encapsulation | Parent reaches into child shadow DOM | `pages/workspace.ts:251-253` | ✅ Present | ✅ Fixed |
| 6 | **P0** | Reactivity | Mutable object mutation in displayMessages | `components/chat-panel.ts:637-659` | ✅ Present | ✅ Fixed |
| 7 | P1 | Reactivity | Static mutable state shared across instances | `components/chat-panel.ts:1378-1379` | ✅ Present | ✅ Fixed |
| 8 | P1 | Reactivity | Side effects inside render path | `components/chat-panel.ts` (render→drainQueue) | ✅ Present | ✅ Fixed |
| 9 | P1 | Performance | No batching on `drainQueue()` | `components/chat-panel.ts:420` | ✅ Present | ✅ Fixed |
| 10 | P1 | Performance | Markdown rendered on every re-render | `components/chat-message.ts:243` | ✅ Present | ✅ Fixed |
| 11 | P1 | Build/Crash | Imperative `.ref=` + `innerHTML` bypass | `components/file-preview-code.ts:205,215,229` | ✅ Present | ✅ Fixed |
| 12 | P1 | Known Bug | `extractProvider` falls back to `"anthropic"` | `pages/workspace.ts:217` | ✅ Present | ✅ Fixed |
| 13 | P2 | Lifecycle | `firstRender`/`firstUpdate` boolean anti-pattern | `components/project-tree.ts:112,243` | ✅ Present | ✅ Fixed |
| 14 | P2 | API | `file-preview-image.ts` bypasses API service layer | `components/file-preview-image.ts:87` | ✅ Present | ✅ Fixed |
| 15 | P2 | DOM Access | `querySelector` for `.chat-panel__messages` every call | `components/chat-panel.ts:1239` | ✅ Present | ✅ Fixed |
| 16 | P2 | DOM Access | `stopPropagation` unnecessary in tree-node click | `components/project-tree.ts:157` | ✅ Present | ✅ Fixed |
| 17 | P3 | Dead Code | `sessionsFetched` always-false dead code | `pages/index.ts:261-271` | ✅ Present | ✅ Fixed |
| 18 | P3 | Style | `unsafeHTML` for controlled `<mark>` highlight | `pages/index.ts:324` | ✅ Present | ✅ Fixed |
| 19 | P3 | Style | No inline `style` for layout in workspace model dropdown | `pages/workspace.ts` | ✅ Present | ✅ Fixed |
| 20 | P3 | Defensive | Missing `super.updated()` in all components | All components | ✅ Present | ✅ Fixed |
| 21 | P3 | Style | `designTokens` not imported in some components | `components/shutdown-dialog.ts` etc. | ✅ Present | ✅ Fixed |
| 22 | P2 | Hydration | `workspace.ts` synchronous `sessionId` read before first render | `pages/workspace.ts:267-274` | ✅ Present | ✅ Fixed |

---

## P0: Critical Fixes (Production Crashes & Hydration Failures)

These must be fixed **before** the next production build. They either crash in production or break SSR hydration.

### Fix #1: Replace `@property` decorator with `static properties`

**File:** `frontend-litro/components/chat-message.ts`  
**Lines:** 191-197

```typescript
// CURRENT (BROKEN in production)
import { customElement, property } from 'lit/decorators.js';
// ...
@property({ type: String }) role = '';
@property({ type: Number }) timestamp = 0;
@property({ type: Array, attribute: false }) contentBlocks: MessageContentBlock[] = [];
@property({ type: Boolean, attribute: false }) isStreaming = false;

// FIX
import { customElement } from 'lit/decorators.js';
// ...
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

**Validation:**
- `bun run build` succeeds without `ReferenceError: property is not defined`
- `chat-message` renders correctly in dev server
- Props still work as attribute bindings

---

### Fix #2: Replace `@state` decorator with `static properties` in all sub-components

**Files affected:**

| File | Lines | Current | Fix |
|------|-------|---------|-----|
| `components/project-tree.ts` | 107-109 | `@state() expanded`, `@state() children`, `@state() loading` | `static properties = { expanded: { type: Boolean }, children: { type: Array }, loading: { type: Boolean } }` |
| `components/project-tree.ts` | 239-240 | `@state() roots`, `@state() loading` | `static properties = { roots: { type: Array }, loading: { type: Boolean } }` |
| `components/file-preview-code.ts` | 159 | `@state() highlighted` | `static properties = { highlighted: { type: Boolean, attribute: false } }` |
| `components/chat-input.ts` | 113 | `@state() private value` | `static properties = { value: { type: String, state: true } }` |
| `components/file-preview-markdown.ts` | 190 | `@state() private _renderedPreview` | `static properties = { _renderedPreview: { type: String, state: true } }` |
| `components/file-preview.ts` | 125-129 | 5× `@state()` | `static properties = { content: { type: String }, fileName: { type: String }, loading: { type: Boolean }, error: { type: String, state: true }, viewMode: { type: String } }` |

**Note:** For `static properties` blocks, the import from `lit/decorators.js` should only contain `customElement` (no `property`/`state`). Verify existing blocks in `components/file-preview-empty.ts`, `components/session-row.ts`, `components/shutdown-dialog.ts`, `components/chat-input.ts` (line 108 — already done), `components/chat-tool-call.ts`, `components/file-preview-image.ts`, `components/file-preview-markdown.ts` (line 180 — already done), `components/chat-panel.ts` (line 320 — already done), `components/file-preview.ts` (line 117 — already done) are correct patterns.

**Validation:**
- `bun run build` succeeds
- No `ReferenceError` at runtime in production bundle
- Each component still renders with correct initial values

---

### Fix #3: Move data loading from `connectedCallback()` to `firstUpdated()`

**Files:** `pages/index.ts`, `pages/models.ts`

**Rationale:** `connectedCallback()` runs before the first render commits. Setting `loading = true` synchronously inside `loadFolders()` / `loadModels()` changes the SSR output → hydration mismatch → `Error: Hydration value mismatch: Unexpected TemplateResult rendered to part`.

**`pages/index.ts` change:**

```typescript
// REMOVE from connectedCallback()
connectedCallback() {
  super.connectedCallback();
  // ← REMOVE these two lines:
  // if (typeof window !== 'undefined' && this.folders.length === 0) {
  //   this.loadFolders();
  // }
}

// ADD firstUpdated()
firstUpdated() {
  if (this.folders.length === 0) {
    this.loadFolders();
  }
}
```

**`pages/models.ts` change:**

```typescript
// REMOVE from connectedCallback()
connectedCallback() {
  super.connectedCallback();
  if (typeof window !== 'undefined') this.loadModels(); // ← REMOVE
}

// ADD firstUpdated()
firstUpdated() {
  this.loadModels();
}
```

**Validation:**
- `bun run build` succeeds
- Headless browser check confirms no hydration mismatch error in console
- Loading state still appears correctly after initial render
- The `typeof window !== 'undefined'` guard in `loadFolders()` can be removed since `firstUpdated()` only runs client-side

---

### Fix #4: Move tree-node auto-expand to `firstUpdated()`

**File:** `components/project-tree.ts` (tree-node sub-component, lines 112-122)

```typescript
// CURRENT (broken hydration)
private firstRender = true;
updated(changedProperties: Map<string, any>) {
  if (this.firstRender) {
    if (this.depth === 0 && !this.expanded && this.node?.isDirectory) {
      this.expanded = true;   // ← changes render output before hydration
      this.firstRender = false;
      return;
    }
    this.firstRender = false;
    return;
  }
  // ...
}

// FIX
firstUpdated() {
  if (this.depth === 0 && this.node?.isDirectory) {
    this.expanded = true;
  }
}
```

Also remove the `firstRender` field declaration (line 112).

**Validation:**
- Tree expands on first client render without hydration mismatch
- SSR output has `expanded=false` (matching client first render)
- Root directory auto-expands correctly on client

---

### Fix #5: Remove parent→child shadow DOM method call

**Files:** `pages/workspace.ts` (lines 251-253), `components/chat-panel.ts`

**Current (broken encapsulation):**
```typescript
const cp = this.shadowRoot?.querySelector('chat-panel');
if (cp && typeof (cp as any).handleSwitchModel === 'function') {
  (cp as any).handleSwitchModel(model);
}
```

**Fix — workspace.ts:** Add a property and event listener:

```typescript
// In workspace template:
<chat-panel
  .pendingModelSwitch=${this.pendingModelSwitch}
  @model-switch=${(e: CustomEvent<Model>) => this.handleModelSwitch(e)}
></chat-panel>

// In workspace class:
static properties = {
  pendingModelSwitch: { type: Object, attribute: false },
};
pendingModelSwitch: Model | null = null;

// When model switch is needed:
this.pendingModelSwitch = model;
// The chat-panel's updated() will pick it up

// Remove the shadow DOM query entirely (lines 251-253)
```

**Fix — chat-panel.ts:** Handle the property in `updated()`:

```typescript
// In static properties:
pendingModelSwitch: { type: Object, attribute: false },

// In updated():
updated(changed: Map<string, unknown>) {
  super.updated();  // ← ADD
  if (changed.has('pendingModelSwitch') && this.pendingModelSwitch) {
    this.handleSwitchModel(this.pendingModelSwitch);
    this.pendingModelSwitch = null;  // Clear to prevent re-fire
  }
  // ... rest of existing updated()
}
```

**Validation:**
- Model switch still works end-to-end
- No `querySelector` in workspace hitting `chat-panel`
- `chat-panel` still dispatches `model-switch` events for other paths
- `bun run build` succeeds

---

### Fix #6: Fix mutable object mutation in `displayMessages`

**File:** `components/chat-panel.ts` (lines 637-659)

```typescript
// CURRENT (sub-components won't re-render)
const lastMsg = this.displayMessages[this.displayMessages.length - 1];
// ... build contentBlocks ...
(lastMsg as any).content = contentBlocks;   // ← mutates in place
this.displayMessages = [...this.displayMessages];  // ← only array is new

// FIX (immutable replacement)
const updated = [...this.displayMessages];
updated[updated.length - 1] = {
  ...lastMsg,
  content: contentBlocks,
};
this.displayMessages = updated;
```

Also check `updateStreamingMessageContent()` — it may have the same pattern. Search for all locations where `lastMsg.content` or `msg.content` is assigned directly.

**Validation:**
- Chat messages re-render when content updates during streaming
- `chat-message` component receives updated `contentBlocks` reference
- No TypeScript errors

---

## P1: Significant Fixes

### Fix #7: Replace static mutable guards with instance-level state

**File:** `components/chat-panel.ts` (lines 1378-1379)

```typescript
// CURRENT (shared across all instances, memory leak)
private static _lastRenderMsgIds: string[] = [];
private static _historyLoadedSessions = new Set<string>();

// FIX — instance level, keyed by session
private _prevMessageIds: string[] = [];
private _historyLoadedForSession: string | null = null;

private async loadChatHistory() {
  if (!this.sessionId) return;
  if (this._historyLoadedForSession === this.sessionId) return;
  if (!this.isConnected) return;  // ← CRITICAL for hydration safety
  // ... load ...
  this._historyLoadedForSession = this.sessionId;
}

disconnectedCallback() {
  super.disconnectedCallback();
  // ← REMOVE static Set cleanup (no longer needed with instance-level state)
}
```

**Validation:**
- Multiple chat panels can exist simultaneously without interfering
- Session history still loads once per session
- Disconnected instances don't block new instances

---

### Fix #8: Move render-side effects to `updated()` / `willUpdate()`

**File:** `components/chat-panel.ts`

Move the message-ID tracking (`_lastRenderMsgIds`) and any other state mutations from `renderMessages()` to `updated()`:

```typescript
// REMOVE from renderMessages():
const ids = msgs.map((m) => m.id);
const prevIds = ChatPanelElement._lastRenderMsgIds;
const added = ids.filter((id) => !prevIds.includes(id));
// ...
if (added.length > 0 || removed.length > 0) {
  ChatPanelElement._lastRenderMsgIds = ids;  // ← side effect

// ADD to updated():
updated(changed: Map<string, unknown>) {
  super.updated();
  if (changed.has('displayMessages')) {
    const ids = this.displayMessages.map(m => m.id);
    const added = ids.filter(id => !this._prevMessageIds.includes(id));
    const removed = this._prevMessageIds.filter(id => !ids.includes(id));
    this._prevMessageIds = ids;
    // Transition logic (scroll, animation)
  }
}
```

**Validation:**
- Render function is pure (no state mutations)
- Message transitions still work
- No infinite update loops

---

### Fix #9: Batch `drainQueue()` with `queueMicrotask`

**File:** `components/chat-panel.ts`

```typescript
// CURRENT — drainQueue() called from connectedCallback() and possibly updated()
// Every SSE event triggers requestUpdate() → updated() → drainQueue()

// FIX — batch with microtask:
private _drainQueued = false;

updated(changed: Map<string, unknown>) {
  super.updated();
  // ... other update logic ...

  if (!this._drainQueued) {
    this._drainQueued = true;
    queueMicrotask(() => {
      this._drainQueued = false;
      this.drainQueue();
    });
  }
}
```

**Validation:**
- Streaming chat remains smooth at high event rates
- No frame drops during rapid SSE events
- Messages still appear correctly

---

### Fix #10: Cache markdown rendering in `willUpdate()`

**File:** `components/chat-message.ts`

```typescript
// Add to class:
private _renderedBlocks: (string | null)[] = [];

willUpdate(changed: Map<string, unknown>) {
  if (changed.has('contentBlocks')) {
    this._renderedBlocks = this.contentBlocks.map(b =>
      b.kind === 'text' ? renderMarkdown(b.content) : null
    );
  }
}

// Update renderBlock():
private renderBlock(block: MessageContentBlock) {
  // ... existing switch ...
  case 'text':
    return html`${unsafeHTML(this._renderedBlocks[idx] ?? '')}`;
  // ...
}
```

**Validation:**
- Long chats don't cause O(n²) markdown parsing
- Rendered output is identical to current behavior
- `willUpdate` only re-renders when `contentBlocks` actually changes

---

### Fix #11: Replace `.ref=` and `innerHTML` with `unsafeHTML()` in template

**File:** `components/file-preview-code.ts` (lines 205, 215, 229)

```typescript
// CURRENT (imperative DOM mutation):
private renderCodeDOM() {
  if (!this.codeContainer) return;
  this.codeContainer.innerHTML = this.highlightedLines.join('\n');
}
render() {
  return html`
    <pre class="code-container__pre" .ref=${this.refCodeContainer}></pre>
  `;
}

// FIX — use unsafeHTML() in template, cache in willUpdate():
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

willUpdate(changed: Map<string, unknown>) {
  if (changed.has('highlighted') && this.highlighted) {
    this._cachedHighlighted = this.highlighted;
  }
}

render() {
  if (!this.highlighted) return html`<div class="code-container">Loading…</div>`;
  return html`
    <div class="code-container">
      <pre class="code-container__pre">
        <code>${unsafeHTML(this._cachedHighlighted)}</code>
      </pre>
    </div>
  `;
}
```

Remove the `refCodeContainer` field and `renderCodeDOM()` method entirely.

**Validation:**
- Code highlighting still renders correctly
- `bun run build` succeeds
- Re-rendering preserves highlighted content (no flicker)

---

### Fix #12: Replace `extractProvider` with model lookup

**File:** `pages/workspace.ts` (line 217)

```typescript
// CURRENT (falls back to "anthropic" for models without "/"):
this.currentModel = createMinimalModel(
  session.model_id,
  extractProvider(session.model_id)
);

// FIX — look up in already-fetched models array:
const model = this.models.find(m => m.id === session.model_id);
this.currentModel = model ?? createMinimalModel(session.model_id, 'unknown');
```

**Validation:**
- Model switch works for all providers (especially `aurora/qwen3.5:27b`)
- Fallback to `'unknown'` when model not in list (graceful degradation)
- `extractProvider` import can be removed if no longer used

---

## P2: Moderate Fixes

### Fix #13: Add `readFileBlob()` to API service

**Files:** `services/api.ts`, `components/file-preview-image.ts`

```typescript
// ADD to services/api.ts:
export async function readFileBlob(projectPath: string, filePath: string): Promise<Blob> {
  const resp = await fetch(
    `/api/projects/files/read?project_path=${encodeURIComponent(projectPath)}&file_path=${encodeURIComponent(filePath)}`
  );
  if (!resp.ok) throw new Error(`Failed to read file: ${resp.statusText}`);
  return resp.blob();
}

// UPDATE components/file-preview-image.ts:
import { readFileBlob } from '../services/api';

// Replace inline fetch() (line 87):
const blob = await readFileBlob(this.projectPath, this.filePath);
```

**Validation:**
- Image preview still loads correctly
- API base path changes propagate automatically

---

### Fix #14: Use `@query` decorator for DOM references

**Files:** `components/chat-panel.ts` (line 1239), `components/file-preview-code.ts` (ref field)

```typescript
// chat-panel.ts — replace querySelector in scrollToBottom():
import { query } from 'lit/decorators.js';
// Note: @query is safe for LitroPage (top-level pages), but chat-panel is a
// sub-component. Use static styles block or instance-level ref via @query
// since it's bundled differently. Alternatively use a template ref.
// For chat-panel (sub-component), use the template ref approach:

// In render():
html`<div class="chat-panel__messages" .ref=${(el) => { this._messagesContainer = el; }}>`;

// Field:
private _messagesContainer: HTMLElement | null = null;

private scrollToBottom() {
  if (!this._messagesContainer) return;
  // ...
}
```

**Note:** `@query` is also affected by the esbuild decorator bundling issue. For sub-components, use the `.ref=` template directive (which IS a Lit directive when properly imported from `lit/directives/ref.js` — note this is different from the broken `.ref=${field}` syntax).

**Correct ref directive usage:**
```typescript
import { ref } from 'lit/directives/ref.js';

html`<div ${ref((el) => { this._messagesContainer = el; })}>`;
```

**Validation:**
- `scrollToBottom` works without `querySelector`
- No `ReferenceError` in production build

---

### Fix #15: Remove unnecessary `stopPropagation()`

**File:** `components/project-tree.ts` (line 157)

```typescript
// Remove:
private handleClick(e: Event) {
  e.stopPropagation();  // ← DELETE THIS LINE
  // ... rest of handler
}
```

**Validation:**
- File click still selects the file
- No double-fire issues with nested elements (verify by clicking on expand/collapse icons)

---

### Fix #16: Synchronous `sessionId` read timing

**File:** `pages/workspace.ts` (lines 267-274)

```typescript
// CURRENT:
connectedCallback() {
  super.connectedCallback();
  this.fetchSessionData();   // reads sessionId synchronously, sets async
}

// FIX — guard the sync read:
connectedCallback() {
  super.connectedCallback();
  // Read URL params synchronously — this doesn't change render structure
  const params = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search)
    : null;
  this._urlSessionId = params?.get('session_id') || '';
}

// In fetchSessionData, use this._urlSessionId instead of reading window directly
```

The `sessionId` itself doesn't change workspace template structure (only child bindings), so this is a lower-priority fix. The main concern is that nested `chat-panel` instances receive the correct `sessionId` without hydration issues.

**Validation:**
- Session ID persists through navigation
- No hydration errors in console

---

## P3: Minor / Style Fixes

### Fix #17: Remove dead code in `loadSessions()`

**File:** `pages/index.ts` (lines 261-271)

```typescript
// CURRENT:
this.sessionsFetched = false;
this.sessionLoadError = null;
if (this.sessionsFetched) {      // ← ALWAYS false, dead code
  this.sessionsFetched = true;
  return;
}
this.sessionsFetched = true;

// FIX — simplify:
private async loadSessions() {
  this.sessionLoadError = null;
  try {
    const allSessions = await fetchSessions();
    this.sessions = allSessions.filter((s) => s.status === 'running');
  } catch (err) {
    this.sessionLoadError = 'Failed to load sessions. Please try again.';
  }
}
```

Also remove the `sessionsFetched` field if no longer used elsewhere.

---

### Fix #18: Replace `unsafeHTML` with plain `html` for `<mark>` highlight

**File:** `pages/index.ts` (line 324)

```typescript
// CURRENT:
return html`${name.slice(0, idx)}${unsafeHTML(`<mark class="highlight-mark">${name.slice(idx, idx + this.search.length)}</mark>`)}${name.slice(idx + this.search.length)}`;

// FIX:
return html`${name.slice(0, idx)}<mark class="highlight-mark">${name.slice(idx, idx + this.search.length)}</mark>${name.slice(idx + this.search.length)}`;
```

---

### Fix #19: Remove inline styles in workspace model dropdown

**File:** `pages/workspace.ts`

Replace any `style="font-weight: 500;"` with a CSS class defined in `static styles`.

---

### Fix #20: Add `super.updated()` calls everywhere

**Files:** All components that override `updated()`

```typescript
// In every updated() override:
updated(changed: Map<string, unknown>) {
  super.updated();  // ← ADD THIS LINE
  // ... existing logic ...
}
```

Files to update:
- `components/chat-panel.ts`
- `components/project-tree.ts`
- `components/file-preview.ts`
- `components/session-row.ts`
- `pages/index.ts`
- `pages/models.ts`
- `pages/workspace.ts`

---

### Fix #21: Import `designTokens` in components that use CSS custom properties

**Files:** `components/shutdown-dialog.ts` and any other component using `var(--*)` without importing `designTokens`.

```typescript
import { designTokens } from '../styles/design-tokens';

static styles = [
  designTokens,
  css`
    // component-specific styles
  `,
];
```

---

## Execution Order

Execute fixes in priority order. Each P0 fix should be tested independently (build + dev server check) before proceeding.

**All 22 fixes completed on 2026-07-07.** Four commit batches:
- `fix(litro): P0 fixes` — 10 files, decorators + SSR + encapsulation + reactivity
- `fix(litro): P1 fixes` — 4 files, reactivity + performance + build safety
- `fix(litro): P2 fixes` — 5 files, API abstraction + DOM refs + lifecycle
- `fix(litro): P3 cleanup` — 9 files, dead code + inline styles + super.updated() + designTokens

```
Phase 1 (P0):
  1. ✅ Fix #1: chat-message.ts @property → static properties
  2. ✅ Fix #2: All @state sub-components → static properties
  3. ✅ Fix #3: index.ts + models.ts connectedCallback → firstUpdated
  4. ✅ Fix #4: project-tree.ts auto-expand → firstUpdated
  5. ✅ Fix #5: workspace.ts → chat-panel property/event pattern
  6. ✅ Fix #6: chat-panel.ts immutable message updates

Phase 2 (P1):
  7. ✅ Fix #7: Static guards → instance-level
  8. ✅ Fix #8: Render side effects → updated()
  9. ✅ Fix #9: drainQueue batching
  10. ✅ Fix #10: Markdown caching
  11. ✅ Fix #11: file-preview-code.ts unsafeHTML
  12. ✅ Fix #12: extractProvider → model lookup

Phase 3 (P2):
  13. ✅ Fix #13: readFileBlob API helper
  14. ✅ Fix #14: ref directive
  15. ✅ Fix #15: Remove stopPropagation
  16. ✅ Fix #16: sessionId timing

Phase 4 (P3):
  17. ✅ Fix #17: Dead code removal
  18. ✅ Fix #18: Plain html for <mark>
  19. ✅ Fix #19: CSS classes for dropdown
  20. ✅ Fix #20: super.updated() everywhere
  21. ✅ Fix #21: designTokens import
```

---

## Validation Criteria

### Build Validation
- `bun run build` completes without errors
- Production bundle loads in headless browser without `ReferenceError`
- No hydration mismatch errors in browser console

### Functional Validation
- Folder browser loads folders correctly (dev + prod)
- Model selector loads and switches models (including `aurora/qwen3.5:27b`)
- Workspace opens with correct session
- File tree expands/collapses and selects files
- File preview renders code, images, markdown correctly
- Chat streams SSE events smoothly
- Model switch works from both workspace dropdown and chat-panel
- Session close/delete works
- Multiple sessions can coexist

### Performance Validation
- Chat with 100+ messages does not cause frame drops
- Streaming chat at high SSE event rates remains smooth
- No memory leaks from static Sets accumulating session IDs

### SSR/Hydration Validation
- Headless browser check confirms no hydration errors
- `page-home` renders empty state on first load, then loads folders
- `page-models` renders correctly on first load
- Workspace loads without template part type mismatches

---

## Files Summary

| File | Issues | Priority |
|------|--------|----------|
| `components/chat-message.ts` | #1, #10 | P0, P1 |
| `components/project-tree.ts` | #2, #4, #13, #15 | P0, P2 |
| `components/file-preview-code.ts` | #2, #11, #14 | P0, P1, P2 |
| `components/chat-input.ts` | #2 | P0 |
| `components/file-preview-markdown.ts` | #2 | P0 |
| `components/file-preview.ts` | #2 | P0 |
| `components/chat-panel.ts` | #5, #6, #7, #8, #9, #14 | P0-P1 |
| `pages/workspace.ts` | #5, #12, #16, #19 | P0-P2 |
| `pages/index.ts` | #3, #17, #18 | P0-P3 |
| `pages/models.ts` | #3 | P0 |
| `components/file-preview-image.ts` | #13 | P2 |
| `services/api.ts` | #13 (add) | P2 |

---

## References

- [Lit Reactive Properties](https://lit.dev/docs/components/properties/)
- [Lit SSR Hydration](https://lit.dev/docs/ssr/client-usage/)
- [Lit Component Composition](https://lit.dev/docs/composition/component-composition/)
- [Lit Directives (ref, unsafeHTML)](https://lit.dev/docs/templates/directives/)
- `docs/kb/lit-best-practices.md` — full decision reference
- `AGENTS.md` — project-specific gotchas (StrictMode, port 3000, SSR patterns)
