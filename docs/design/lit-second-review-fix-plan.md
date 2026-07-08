# Lit Code Second Review — Fix Plan

> **Date:** 2026-07-07  
> **Based on:** `docs/kb/lit-second-review.md` and `docs/kb/lit-best-practices.md`  
> **Scope:** 7 files, 7 distinct issues across Critical → Low severity tiers

---

## Current Status

| Priority | Fix | File | Status | Commit |
|----------|-----|------|--------|--------|
| Critical 1 | Move `ChatStreamController` to constructor | `chat-panel.ts` | ✅ Done | `ed39a99` |
| Critical 2 | Pass `idx` through `.map()` | `chat-message.ts` | ✅ Done | `ed39a99` |
| Critical 3 | `.ref` → `ref()` directive | `workspace.ts` | ✅ Done | `90c27ff` |
| High 4 | Move `fetchSessionData()` to `firstUpdated()` | `workspace.ts` | ⬜ Pending | — |
| Medium 5A | Immutable block merge | `chat-panel.ts` | ⬜ Pending | — |
| Medium 5B | Immutable toolCall result merge | `chat-panel.ts` | ⬜ Pending | — |
| Medium 6 | `''` → `nothing` | All 6 template files | ⬜ Pending | — |
| Medium 7 | Cache in `willUpdate()` | `file-preview-markdown.ts` | ⬜ Pending | — |

---

## Task Scaffold

Before any edit, the following scaffold defines the exact sequence, error boundaries, and validation.

### Step Sequence

| # | Action | Target File(s) | Reason |
|---|--------|---------------|--------|
| 1 | Read exact source to confirm line positions | All 7 files | Avoid stale text-matching on edit |
| 2 | Fix Critical 1: move `ChatStreamController` to constructor | `chat-panel.ts` | Prevents SSR `render()` crash |
| 3 | Fix Critical 2: pass `idx` through `.map()` | `chat-message.ts` | Prevents `ReferenceError` at runtime |
| 4 | Fix Critical 3: `.ref` → `ref()` directive | `workspace.ts` | Unbreaks model-dropdown outside-click |
| 5 | Fix High 4: move `fetchSessionData()` to `firstUpdated()` | `workspace.ts` | Resolves SSR hydration mismatch |
| 6 | Fix Medium 5A: immutable block merge | `chat-panel.ts` | Eliminates in-place mutation |
| 7 | Fix Medium 5B: immutable toolCall result merge | `chat-panel.ts` | Eliminates in-place mutation |
| 8 | Fix Medium 6: `''` → `nothing` | All 6 template files | Hydration consistency |
| 9 | Fix Medium 7: cache in `willUpdate()` | `file-preview-markdown.ts` | Eliminates double-render |
| 10 | Run `bun run build` to verify production bundle | Project root | Confirms no decorator or import regressions |
| 11 | Run headless browser check against dev server | Project root | Confirms runtime correctness |

### Error-Handling Boundaries

- **Never** touch files outside the 7 listed above.
- **Never** change component public APIs (property names, event names).
- **Never** remove `@state()` from LitroPage classes.
- **Never** introduce `@property()` decorator on sub-components.
- **Never** change `chat-stream-controller.ts`, `chat-processor.ts`, `selection-store.ts`, or any `lib/` file.
- **Never** change the backend.
- **Never** change `import` paths of existing modules.
- If an edit's `oldText` does not match exactly, **stop and re-read** — do not guess.

### Validation Criteria

1. **TypeScript compilation** — `bun run build` completes with zero errors.
2. **No `ReferenceError: idx`** — assistant text messages render.
3. **No `chatController is undefined` during SSR** — dev server starts and renders without stack trace.
4. **Model dropdown closes on outside click** — verified in headless browser.
5. **No hydration mismatch** — dev server renders identical output on first client render.
6. **No in-place object mutation** — content blocks are replaced via spread.
7. **`nothing` used in all template ternary else-branches** — grep confirms zero `: ''}` patterns inside `html`.
8. **Markdown preview renders in one pass** — no double-render visible on scroll.

---

## Fix Details

### Critical 1: `chat-panel.ts` — Move controller to constructor

**Why:** `chatController` is initialized in `connectedCallback()`, which does not run during SSR. `render()` reads `this.chatController.isStreaming`, `state`, `pendingUiRequest`, `hasEverStreamed` — all of which crash when `chatController` is `undefined`.

**What changes:**
- Move `this.chatController = new ChatStreamController(this, this.sessionId);` from `connectedCallback()` to `constructor()`.
- The `ChatStreamController` constructor calls `host.addController(this)`, which is safe during SSR.
- The controller's `hostConnected()` (which opens the SSE) only fires on the client — so no unwanted server-side connection.

**Lines in `frontend-litro/components/chat-panel.ts`:**
- ~355: `private chatController!: ChatStreamController;` — keep declaration, remove `!` (now initialized).
- ~357: Add `constructor() { super(); this.chatController = new ChatStreamController(this, this.sessionId); }`
- ~366: Remove `this.chatController = new ChatStreamController(this, this.sessionId);` from `connectedCallback()`.

**Verification:** Dev server starts without SSR crash. Chat renders with empty state on initial page load.

**Committed:** `ed39a99` — `fix: resolve Critical 1 & 2 from lit second review`

---

### Critical 2: `chat-message.ts` — `idx` is not defined in `renderBlock()`

**Why:** `renderContentBlocks` calls `.map((block) => this.renderBlock(block, isUser))` — no index passed. `renderBlock` references `this._renderedBlocks[idx]` where `idx` is not a parameter. This throws `ReferenceError` at runtime for every assistant text block.

**What changes:**
- `renderContentBlocks`: change `.map((block) => ...)` to `.map((block, idx) => this.renderBlock(block, idx, isUser))`
- `renderBlock`: add `idx: number` parameter between `block` and `isUser`.

**Lines in `frontend-litro/components/chat-message.ts`:**
- ~248: `${this.contentBlocks.map((block) => this.renderBlock(block, isUser))}` → add `, idx)` and `idx,`
- ~253: `block: MessageContentBlock, isUser: boolean,` → `block: MessageContentBlock, idx: number, isUser: boolean,`

**Verification:** Assistant messages with text render correctly. No console errors.

**Committed:** `ed39a99` — `fix: resolve Critical 1 & 2 from lit second review`

---

### Critical 3: `workspace.ts` — `.ref` property binding instead of `ref()` directive

**Why:** `.ref=${callback}` sets a property named `ref` on the `<div>`. `HTMLElement` has no such property. The `ref` directive from `lit/directives/ref.js` must be used as `${ref(callback)}`. `_modelSelectorRef` stays `null`, so the outside-click handler is dead code.

**What changes:**
- Add `import { ref } from 'lit/directives/ref.js';` to imports.
- Change `.ref=${(el) => { ... }}` to `${ref((el) => { ... })}`.

**Lines in `frontend-litro/pages/workspace.ts`:**
- ~1: Add `import { ref } from 'lit/directives/ref.js';`
- ~355: `.ref=${(el: HTMLElement | null) => { this._modelSelectorRef = el; }}` → `${ref((el: HTMLElement | null) => { this._modelSelectorRef = el; })}`

**Verification:** Model dropdown closes when clicking outside it.

---

### High 4: `workspace.ts` — `fetchSessionData()` in `connectedCallback()` sets reactive state

**Why:** `fetchSessionData()` is called from `connectedCallback()`. Its first line `this.sessionId = this._urlSessionId` executes synchronously (before any `await`), which triggers `requestUpdate()` on the reactive `@state() sessionId`. The first client render sees a populated `sessionId` while SSR rendered `''` — hydration mismatch.

**What changes:**
- Remove `this.fetchSessionData();` from `connectedCallback()`.
- Add a `firstUpdated()` method that calls `this.fetchSessionData()`.
- Keep the synchronous `this._urlSessionId` assignment in `connectedCallback()` — it's a non-reactive private field, safe.

**Lines in `frontend-litro/pages/workspace.ts`:**
- ~220: Remove `this.fetchSessionData();` from `connectedCallback()`.
- ~248: Add new method:
  ```typescript
  firstUpdated() {
    this.fetchSessionData();
  }
  ```

**Verification:** No hydration mismatch in console. Session model loads correctly after first render.

---

### Medium 5A: `chat-panel.ts` — Immutable block merge in `mergeToolResultsIntoAssistantBlocks()`

**Why:** `mergeToolResultsIntoAssistantBlocks()` casts a block to `MutableToolCallBlock` and assigns `.result` in place, modifying the original array's objects. Even though the array is replaced afterward, the mutation is fragile and violates the KB's immutable pattern.

**What changes:**
- Replace:
  ```typescript
  const existing = block as MutableToolCallBlock;
  existing.result = resultById.get(block.id) ?? existing.result;
  result.push(existing);
  ```
- With:
  ```typescript
  result.push({
    ...block,
    result: resultById.get(block.id) ?? (block as MutableToolCallBlock).result,
  });
  ```

**Lines in `frontend-litro/components/chat-panel.ts`:**
- ~1025–1030: Replace the 5 lines with the spread version above.

**Verification:** Tool call results merge correctly. No type errors (the `as MutableToolCallBlock` cast is only needed for the spread's result property).

---

### Medium 5B: `chat-panel.ts` — Immutable toolCall result merge in `ensureStreamingMessage()`

**Why:** The `hasOnlyToolResults` branch mutates `prevMsg.content[bi].result` in place, then replaces the array. This is a mutation of an object inside a reactive property.

**What changes:**
- Replace the mutation loop with a new `content` array:
  ```typescript
  const newContent = prevMsg.content.map(pb =>
    pb.kind === 'toolCall' && pb.id === tc.id
      ? { ...pb, result: tc.result ?? pb.result }
      : pb,
  );
  const updated = [...this.displayMessages];
  updated[lastIdx] = { ...prevMsg, content: newContent };
  this.displayMessages = updated;
  ```

**Lines in `frontend-litro/components/chat-panel.ts`:**
- ~600–614: Replace the entire `hasOnlyToolResults` block (the for-loop + array replacement) with the immutable version.

**Verification:** Tool results on pre-existing assistant messages update correctly during streaming.

---

### Medium 6: `nothing` instead of `''` for template ternary else-branches

**Why:** `''` (empty string) creates a text node in the template. `nothing` (from `lit`) is a sentinel that renders nothing without creating a DOM node. Using `nothing` preserves template structure consistency, which matters for SSR hydration.

**What changes (per file):**

#### `chat-panel.ts` (~12 of these patterns)
- `import { html, css, LitElement, nothing } from 'lit';` — add `nothing` to import
- `${this.errorMessage ? html\`...\` : ''}` → `: nothing}`
- `${this.chatController.pendingUiRequest ? this.renderExtensionUI() : ''}` → `: nothing}`
- `${this.showClearConfirm ? html\`...\` : ''}` → `: nothing}`

#### `chat-message.ts`
- `import { unsafeHTML } from 'lit/directives/unsafe-html.js';` → `import { unsafeHTML, nothing } from 'lit';`
- `return html``;` in `renderContentBlocks` when `contentBlocks.length === 0` → `return nothing;`

#### `workspace.ts`
- `import { html, css, nothing } from 'lit';` — add `nothing` to import
- `${this.modelDropdownOpen ? this.renderModelDropdown() : ''}` → `: nothing}`

#### `page-home.ts`
- `import { html, css, LitElement, nothing } from 'lit';` — add `nothing` to import
- `${this.shutdownTarget ? html\`...\` : ''}` → `: nothing}`

#### `page-models.ts`
- `import { html, css, type TemplateResult, nothing } from 'lit';` — add `nothing` to import
- `${!this.loading && this.providers.length > 0 ? html\`...\` : ''}` → `: nothing}`
- `${this.hasActiveFilters ? html\`...\` : ''}` → `: nothing}`

**Verification:** Grep `: ''}` inside `html` templates returns zero matches.

---

### Medium 7: `file-preview-markdown.ts` — Cache in `willUpdate()` instead of `updated()`

**Why:** `_renderedPreview` is cached in `updated()`, which runs after `render()`. On the first render after content changes, the cache still holds the old value. A second render happens with the updated cache. This is a double-render.

**What changes:**
- Replace the `updated()` block with a `willUpdate()` block.
- `willUpdate()` runs before `render()`, so the cached value is ready.

**Lines in `frontend-litro/components/file-preview-markdown.ts`:**
- ~203–207: Replace:
  ```typescript
  updated(changedProperties: Map<string, any>) {
    super.updated();
    if (changedProperties.has('content') && this.content) {
      this._renderedPreview = this.renderPreview();
    }
  }
  ```
- With:
  ```typescript
  willUpdate(changed: Map<string, unknown>) {
    if (changed.has('content')) {
      this._renderedPreview = this.content ? this.renderPreview() : '';
    }
  }
  ```

**Verification:** Markdown preview renders in a single pass. No flicker.

---

## Post-Fix Verification

### Automated checks

```bash
# 1. Type-check + production build
cd frontend-litro && bun run build 2>&1
# Expected: exit 0, no errors

# 2. Headless browser check (dev server)
kill -9 $(lsof -iTCP:3000 -sTCP:LISTEN -P -n 2>/dev/null | awk '$1 == "node" {print $2}') 2>/dev/null
sleep 1
cd frontend-litro && bun run dev &
sleep 5

# 3. Run browser checker
node check.js --url http://localhost:3000/ --wait 'page-home' --errors --screenshot /tmp/shot.png
# Expected: exit 0, no JS errors reported

# 4. Verify specific pages load
node check.js --url http://localhost:3000/models?folder=/tmp/test --errors
node check.js --url http://localhost:3000/workspace?folder=/tmp/test&session_id=abc --errors
```

### Manual checks

1. **SSR**: Server console shows no stack traces on page load.
2. **Model dropdown**: Open workspace → click model selector → click outside → dropdown closes.
3. **Chat**: Send a message → assistant responds with text → text renders with markdown.
4. **Markdown preview**: Select a `.md` file → toggle Source/Preview → renders correctly.
5. **Tool results**: Send a message that triggers tools → tool call results merge into the assistant message.
6. **No hydration errors**: Dev server console is clean (no "Hydration value mismatch" messages).

---

## Risk Assessment

| Fix | Risk Level | Rollback |
|-----|-----------|----------|
| Critical 1 (constructor) | Low | Controller creation is idempotent; SSR-safe by design |
| Critical 2 (idx param) | Low | Pure signature change |
| Critical 3 (ref directive) | Low | Standard Lit directive pattern |
| High 4 (firstUpdated) | Medium | `firstUpdated` runs only once — if `fetchSessionData` throws, session state stays empty |
| Medium 5A/5B (immutable) | Low | Same logical outcome, cleaner code |
| Medium 6 (nothing) | Low | Pure template syntax change |
| Medium 7 (willUpdate) | Low | Same cache, earlier execution |

---

## Files Modified Summary

| File | Fixes | Lines Changed (est.) |
|------|-------|---------------------|
| `chat-panel.ts` | Critical 1, Medium 5A, Medium 5B, Medium 6 | ~25 |
| `chat-message.ts` | Critical 2, Medium 6 | ~5 |
| `workspace.ts` | Critical 3, High 4, Medium 6 | ~10 |
| `page-home.ts` | Medium 6 | ~2 |
| `page-models.ts` | Medium 6 | ~3 |
| `file-preview-markdown.ts` | Medium 7 | ~5 |
