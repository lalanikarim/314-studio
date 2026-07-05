# Litro Component Best Practices Plan

**Branch:** `refactor/migrate-to-lit-frontend`
**Created:** 2026-07-05
**Status:** Not Started
**Prerequisite for:** All remaining Litro migration tasks (ChatPanel, workspace session controls, FilePreview improvements, production build)

## Overview

An audit of the Litro frontend (`frontend-litro/`) found that while Shadow DOM isolation, CSS architecture, and `static properties` usage are sound, several Lit best-practice violations exist. Two are **critical** (break production builds); others hurt maintainability, reusability, and scalability.

This plan addresses each finding in **independently verifiable phases**. Each phase produces a concrete, testable artifact and can be worked on in isolation. No phase depends on another except where explicitly noted.

> **Why now:** The remaining migration work (ChatPanel, workspace session controls, production build) will compound these problems if built on the current foundations. This plan is a **hard prerequisite** — the migration plan's "Next Steps" must not resume until Phases 0 and 1 below are complete.

## Audit Summary

| # | Finding | Severity | Phase |
|---|---------|----------|-------|
| 1 | `@property` decorator in `project-tree.ts` — breaks production builds | 🔴 Critical | 0 |
| 2 | Monolithic `pages/index.ts` (798 lines) mixes page + sub-components | 🟡 Medium | 1 |
| 3 | Global state via module variables + `EventTarget` in `workspace.ts` | 🟡 Medium | 2 |
| 4 | Callback props (`onSelect`, `onShutdown`) instead of Lit events | 🟡 Medium | 3 |
| 5 | Inconsistent component registration (`customElements.define` vs `@customElement`) | 🟢 Low | 1 |
| 6 | Styles not shared beyond `buttonStyles` (`.icon-btn`, layout, typography duplicated) | 🟢 Low | 4 |

### Scorecard (current → target)

| Category | Current | Target |
|----------|--------|--------|
| Shadow DOM Isolation | 10/10 | 10/10 |
| CSS Architecture | 8/10 | 9/10 |
| Component Separation | 6/10 | 10/10 |
| State Management | 5/10 | 9/10 |
| Event Handling | 7/10 | 9/10 |
| Production Readiness | 7/10 | 10/10 |
| Reusability | 6/10 | 9/10 |

---

## Phase 0: Fix `@property` Production Bug 🔴

**Goal:** Eliminate the `ReferenceError: property is not defined` runtime error in production builds.

**Scope:** `components/project-tree.ts` only.

### Background

Litro's esbuild config (`tsconfigRaw.experimentalDecorators: true` in the Lit Vite adapter) does **not** bundle the `property` import from `lit/decorators.js` into the production client bundle. The dev server resolves it fine, but `bun run litro build` then serving `dist/` crashes at runtime. This is the exact bug already documented in `AGENTS.md` ("Litro: `@property` decorator not bundled in production builds") and was fixed in `pages/index.ts` — `project-tree.ts` was missed.

### Step 0.1 — Convert `TreeNodeComponent` to `static properties`

Move `node`, `depth`, `selectedPath`, `projectRoot` from `@property` decorators into a `static properties` block. Keep `@state()` for `expanded`, `children`, `loading` (those work in dev; they are set internally, not passed from parents, so the import issue does not affect them — but see Step 0.3).

```typescript
// Before
@state() expanded = false;
@state() children: TreeNodeData[] = [];
@state() loading = false;
@property({ type: Object }) node: TreeNodeData = { name: '', path: '', isDirectory: false, children: [] };
@property({ type: Number }) depth = 0;
@property({ type: String }) selectedPath = '';
onSelect!: (path: string) => void;
@property({ type: String }) projectRoot = '';

// After
@state() expanded = false;
@state() children: TreeNodeData[] = [];
@state() loading = false;
static properties = {
  node: { type: Object },
  depth: { type: Number },
  selectedPath: { type: String },
  projectRoot: { type: String },
};
node: TreeNodeData = { name: '', path: '', isDirectory: false, children: [] };
depth = 0;
selectedPath = '';
projectRoot = '';
onSelect!: (path: string) => void;
```

### Step 0.2 — Convert `ProjectTreeComponent` to `static properties`

Move `projectPath`, `selectedFile` into a `static properties` block. Keep `@state()` for `roots`, `loading`.

### Step 0.3 — Verify `@state` is safe in production

`@state()` internals are never passed from parents, so the missing `property` import only affects decorators that emit `__decorate([property(...)], ...)`. Confirm by grepping the production bundle for any remaining `property(` calls originating from this file. If any remain, convert `@state()` to plain fields plus a `static properties` entry with `{ state: true }`:

```typescript
static properties = {
  expanded: { state: true },
  children: { state: true },
  loading: { state: true },
};
```

### Verification ✅

```bash
cd frontend-litro
pkill -f "litro dev"; sleep 1
rm -rf dist && bun run litro build
# 1. No `property(` references in the tree-node / project-tree chunks:
grep -l "property(" dist/client/assets/*.js | xargs grep -L "static properties\|\.properties=" || echo "clean"
# 2. Production server runs without errors:
node dist/server/server/index.mjs &
# 3. Headless check passes with 0 JS errors:
cd /Users/karim/.pi/agent/skills/headless-browser-checker
node check.js --url http://localhost:3000/workspace?folder=/Users/karim/Projects/314-studio \
  --wait 'project-tree' --screenshot /tmp/phase0.png
# Expect: "JS/TS Errors: 0"
```

**Acceptance criterion:** Production build runs `workspace` route withzero JS errors; expanding folders and selecting files works.

---

## Phase 1: Component File Separation 🟡

**Goal:** One component per file; eliminate the 798-line `pages/index.ts`.

**Depends on:** Phase 0 complete (so moved files use the correct `static properties` pattern).

### Target Structure

```
frontend-litro/
├── pages/
│   ├── index.ts              # HomePage page only (~250 lines)
│   ├── models.ts
│   └── workspace.ts
├── components/
│   ├── file-preview.ts
│   ├── project-tree.ts
│   ├── shutdown-dialog.ts    # NEW — extracted from pages/index.ts
│   ├── session-row.ts        # NEW — extracted from pages/index.ts
│   └── chat-panel.ts         # (future)
├── lib/                      # NEW — module-private helpers + types
│   ├── format.ts             # formatTime, getProjectName, getModelName
│   └── model.ts              # deriveModelName, extractProvider (port from React utils)
```

### Step 1.1 — Extract shared helpers to `lib/format.ts`

Move `formatTime()`, `getProjectName()`, `getModelName()` out of `pages/index.ts` into `frontend-litro/lib/format.ts`. Export them as named functions. Update `pages/index.ts` to import them.

```typescript
// lib/format.ts
export function formatTime(iso: string): string { ... }
export function getProjectName(projectPath: string): string { ... }
export function getModelName(modelId: string | null): string { ... }
```

**Verify:** `bun run litro build` succeeds; FolderSelector page unchanged visually.

### Step 1.2 — Extract `ShutdownDialog` to `components/shutdown-dialog.ts`

Create `frontend-litro/components/shutdown-dialog.ts`. Move the `ShutdownDialog` class (extends `LitElement`, `static properties`) and its `static styles` from `pages/index.ts`. Export as `ShutdownDialog`. Add `// import './components/shutdown-dialog.js'` to `app.ts` so it registers on the client.

Update `pages/index.ts` to reference `<shutdown-dialog>` (already registered globally) and listen for `@shutdown-complete` / `@shutdown-cancel` events.

**Verify:** Shutdown dialog still opens from the Sessions tab; graceful/force/cancel all work in the browser.

### Step 1.3 — Extract `SessionRow` to `components/session-row.ts`

Same as Step 1.2 for `SessionRow`. Export as `SessionRow`. Register in `app.ts`.

**Verify:** Sessions tab renders rows identically; click and shutdown button both work.

### Step 1.4 — Standardize component registration

`components/file-preview.ts` currently does manual `customElements.define('file-preview', FilePreviewElement)` with no decorator. Convert it to use `@customElement('file-preview')` for consistency with all other components, or — if the no-decorator style is preferred — document that style as the project standard and convert `project-tree.ts` / `shutdown-dialog.ts` / `session-row.ts` to match. **Pick one style and apply it everywhere.**

Recommended: keep `@customElement` (cleaner, matches Lit docs). The `static properties` pattern stays either way — it is independent of the registration style.

**Verify:** All four components register on first load (no "already defined" warnings); `grep -r "customElements.define" components/` shows consistent patterns.

### Step 1.5 — Slim `pages/index.ts`

After extraction, `pages/index.ts` should contain only the `HomePage` class, its `static styles`, `@state` fields, and the `render()` / lifecycle methods. Target ≤ 300 lines.

**Verify:** `wc -l pages/index.ts` ≤ 300; FolderSelector page functionally identical (Projects tab, Sessions tab, search, tab switch all work).

### Verification ✅

```bash
cd frontend-litro
bun run litro build
# File sizes sane:
wc -l pages/index.ts components/*.ts lib/*.ts
# Headless check on home page:
node /Users/karim/.pi/agent/skills/headless-browser-checker/check.js \
  --url http://localhost:3000/ --wait 'page-home' --screenshot /tmp/phase1.png
# Manually: switch to Sessions tab, trigger shutdown dialog, click through.
```

**Acceptance criterion:** Every component lives in its own file ≤ ~250 lines; `pages/index.ts` ≤ 300 lines; no functional regressions on the FolderSelector.

---

## Phase 2: State Management Cleanup 🟡

**Goal:** Replace module-global state in `workspace.ts` with a Lit `ReactiveController` so state is reactive, scoped, and testable.

**Depends on:** Phase 1 (helpers are extractable; no inline components).

### Background

`pages/workspace.ts` shares the selected file across `ProjectTree` and `FilePreview` via:

```typescript
let globalSelectedFile: string | null = null;
const selectedFileEventTarget = new EventTarget();
export function getSelectedFile(): string | null { ... }
export function setSelectedFile(path: string | null): void { ... }
```

Problems:
- **Module-global** — survives across route changes; a stale value can leak between workspace mounts.
- **No reactivity by default** — `WorkspacePage` manually subscribes in `connectedCallback` and unsubscribes in `disconnectedCallback`; easy to leak listeners.
- **Hard to test** — state is hidden in module scope.

### Step 2.1 — Create `lib/selection-store.ts`

Implement a small store using Lit's `ReactiveController` host pattern (or a tiny `EventTarget`-based reactive container). The store holds the selected file path; components that adopt the controller re-render automatically on change.

```typescript
// lib/selection-store.ts
import type { ReactiveController, ReactiveControllerHost } from 'lit';

export class SelectionStore {
  private _path: string | null = null;
  private listeners = new Set<ReactiveControllerHost>();
  get path() { return this._path; }
  set(path: string | null) {
    if (this._path === path) return;
    this._path = path;
    this.listeners.forEach(h => h.requestUpdate());
  }
  controller(host: ReactiveControllerHost): ReactiveController {
    return {
      host,
      hostConnected: () => this.listeners.add(host),
      hostDisconnected: () => this.listeners.delete(host),
    };
  }
}
```

Create a single exported instance (`export const selectionStore = new SelectionStore();`) scoped to the workspace, or instantiate per-mount in `workspace.ts`.

### Step 2.2 — Wire `WorkspacePage` to the store

Replace `getSelectedFile()` / `setSelectedFile()` calls with `selectionStore`. Add the controller in the constructor: `this.addController(selectionStore.controller(this))`. Read `selectionStore.path` in `render()`.

### Step 2.3 — Wire `ProjectTree` and `FilePreview`

`ProjectTree`'s `onSelect` callback now calls `selectionStore.set(path)`. `FilePreview` takes `filePath` from the store (already passed as `.filePath=${this.selectedFile}` from workspace, so the binding stays — only the source of truth changes).

### Step 2.4 — Remove the global module state

Delete `globalSelectedFile`, `selectedFileEventTarget`, `getSelectedFile`, `setSelectedFile`. Confirm no other file imports them.

### Verification ✅

```bash
cd frontend-litro
grep -rn "globalSelectedFile\|selectedFileEventTarget\|getSelectedFile\|setSelectedFile" . --include=*.ts
# Expect: no matches outside lib/selection-store.ts (or none at all)
bun run litro build
node /Users/karim/.pi/agent/skills/headless-browser-checker/check.js \
  --url "http://localhost:3000/workspace?folder=/Users/karim/Projects/314-studio" \
  --wait 'page-workspace' --screenshot /tmp/phase2.png
# Manually: click a file in the tree → FilePreview updates. Navigate away and back → no stale selection.
```

**Acceptance criterion:** No module-global state; clicking files updates the preview; navigate away/back does not leak previous selection.

---

## Phase 3: Event-Based Component Communication 🟡

**Goal:** Replace callback props (`onSelect`, `onShutdown`) with Lit `CustomEvent` dispatch so children are decoupled from parents.

**Depends on:** Phase 1 (components in separate files).

### Step 3.1 — `SessionRow` emits `session-select` / `session-shutdown`

Replace `.onSelect` / `.onShutdown` callback properties with dispatched events:

```typescript
// session-row.ts
render() {
  return html`<div class="row" @click=${() =>
    this.dispatchEvent(new CustomEvent('session-select', { detail: this.session, bubbles: true, composed: true }))
  }>...</div>`;
}
```

Remove the callback properties from `static properties`. The parent listens:

```html
<session-row .session=${s}
  @session-select=${(e) => this.openSession(e.detail)}
  @session-shutdown=${(e) => this.handleShutdown(e.detail)}
></session-row>
```

**Verify:** Select + shutdown still work from the Sessions tab.

### Step 3.2 — `ProjectTree` / `TreeNode` emit `file-select` / (custom expand events)

Keep `expanded` as internal `@state`. Replace `onSelect` callback with a `file-select` event. The parent (`WorkspacePage`) listens:

```html
<project-tree .projectPath=${root} .selectedFile=${sel}
  @file-select=${(e: CustomEvent<string>) => selectionStore.set(e.detail)}
></project-tree>
```

**Verify:** Clicking a file in the tree still updates FilePreview.

### Step 3.3 — `ShutdownDialog` events already correct

`ShutdownDialog` already uses `dispatchEvent(new CustomEvent('shutdown-complete', ...))`. Document this as the canonical pattern in `AGENTS.md` component authoring notes (optional).

### Verification ✅

```bash
cd frontend-litro
grep -rn "onSelect!\|onShutdown!\|\.onSelect=\|\.onShutdown=" . --include=*.ts
# Expect: no callback props; only @event listeners remain.
bun run litro build
# Headless: Sessions tab + Workspace both pass with 0 JS errors.
```

**Acceptance criterion:** No `onXxx` callback fields; all child→parent communication is via `CustomEvent`.

---

## Phase 4: Shared Style Consolidation 🟢

**Goal:** Reduce duplicated CSS by extracting common primitives into `styles/shared.ts`.

**Depends on:** Phase 1 (components split so styles can be re-imported cleanly).

### Step 4.1 — Audit duplicated styles

Grep for repeated blocks: `.icon-btn`, spinner `@keyframes spin`, `.panel__header`, flex layout helpers, typography (`font-size`, `font-weight`).

```bash
cd frontend-litro
grep -rn "@keyframes spin" . --include=*.ts
grep -rn "\.icon-btn" . --include=*.ts
```

### Step 4.2 — Extend `styles/shared.ts`

Add: `iconButtonStyles` (the `.icon-btn` family already partially inlined in `workspace.ts`), `spinnerStyles` (`@keyframes spin` + `.spinner`), `panelHeaderStyles`. Each exported as a `css` template literal that pages compose into `static styles`:

```typescript
static styles = [buttonStyles, iconButtonStyles, spinnerStyles, css`...page-specific...`];
```

### Step 4.3 — Refactor consumers

Replace the inlined `.icon-btn` in `workspace.ts` and the inlined spinner keyframes in `pages/index.ts` and `project-tree.ts` with the shared fragments.

### Verification ✅

```bash
cd frontend-litro
bun run litro build
# No more than one @keyframes spin declaration across the bundle:
grep -c "@keyframes spin" dist/client/assets/*.js | awk -F: '$2>1{print}'
# Expect: no output (all counts ≤ 1).
# Visual regression: all pages render identically (screenshots unchanged).
```

**Acceptance criterion:** One shared definition of each shared primitive; no visual regressions.

---

## Sequencing & Dependencies

```
Phase 0  ──┐
           ├──► Phase 1 ──► Phase 2 ──┐
           └────────────► Phase 3 ───┤──► Resume migration (ChatPanel, etc.)
                                   └► Phase 4
```

- **Phase 0** is standalone — ship it first; it is the only true bug.
- **Phase 1** depends on Phase 0 (so moved files use correct `static properties`).
- **Phase 2** depends on Phase 1 (helpers/component split makes the store swappable).
- **Phase 3** depends on Phase 0 (no point converting `@property` callbacks to events then re-fixing).
- **Phase 4** depends on Phase 1 (styles consolidated only after components are split).

Each phase is independently verifiable via its `Verification ✅` block. No phase requires the migration-plan "Next Steps" to have started.

## Definition of Done

- [ ] Phase 0: `project-tree.ts` uses `static properties`; production build runs `workspace` route with 0 JS errors.
- [ ] Phase 1: One component per file; `pages/index.ts` ≤ 300 lines; registration style consistent.
- [ ] Phase 2: No module-global state in `workspace.ts`; `SelectionStore` controller wired; no stale selection after navigation.
- [ ] Phase 3: No `onXxx` callback properties; all child→parent communication via `CustomEvent`.
- [ ] Phase 4: Shared style primitives (`icon-button`, `spinner`, `panel-header`) live once in `styles/shared.ts`.
- [ ] `AGENTS.md` gotchas updated to record the final patterns (registration style, store pattern, event pattern).

## Out of Scope

- Porting `ChatPanel` (covered by `litro-migration-plan.md` Next Steps; starts only after Phase 1 and 2 land).
- Adding syntax highlighting to `FilePreview` (separate task).
- Production Nitro build configuration (separate task; Phase 0 only ensures it no longer crashes).