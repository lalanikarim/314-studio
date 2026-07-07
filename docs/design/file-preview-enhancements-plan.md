# File Preview Enhancements Plan

**Branch:** `refactor/migrate-to-lit-frontend`  
**Created:** 2026-07-07  
**Status:** Pending Approval

## Overview

Enhance the Litro `file-preview` component to intelligently render different file types with appropriate viewing modes:

- **Markdown files** — toggle between raw source and rendered preview
- **Code files** — syntax highlighting via Prism
- **Image files** — inline display, fit-to-width
- **Binary/unrecognized files** — "Cannot preview" message

## Current State

The current `file-preview.ts` is a plain-text viewer. It reads file content and dumps it into a `<pre>` block with monospace font. There is no file type detection, no syntax highlighting, no markdown rendering, and no image support.

**Existing component** (`frontend-litro/components/file-preview.ts`):
- Header with filename only
- Content area: raw text in `<pre>` with line numbers
- No type awareness whatsoever

**Dependencies already available:**
- `marked` v18 — markdown rendering (already in `package.json`)
- No syntax highlighter yet — **Prism** to be added

## Proposed Architecture

### Component Tree

```
file-preview.ts               # Orchestrator — loading/error/empty states, delegates rendering
├── file-preview-code.ts      # Code viewer — Prism syntax highlighting
├── file-preview-markdown.ts  # Markdown — source/preview toggle, rendered via marked
├── file-preview-image.ts     # Image viewer — fit-to-width <img>
└── file-preview-empty.ts     # "Cannot preview this file" message
```

All components are `LitElement` subclasses (not `LitroPage` subclasses, since they're sub-components nested inside pages). Sub-components use `static properties` blocks (no `@property` decorator imports, to avoid production build issues).

### File Type Detection

A small utility in `frontend-litro/lib/file-types.ts`:

```ts
type FileType = 'markdown' | 'image' | 'code' | 'binary' | 'unknown';

interface FileTypeInfo {
  type: FileType;
  language?: string;  // e.g. 'python', 'javascript', 'typescript'
}

function detectFileType(filename: string): FileTypeInfo
```

**Mapping tables:**

| Category | Extensions | Language |
|----------|-----------|----------|
| Markdown | `.md`, `.markdown`, `.mdx` | `markdown` |
| Image | `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.ico`, `.bmp` | — |
| Code | See Prism language list below | Mapped to Prism language |
| Binary | `.pdf`, `.zip`, `.tar`, `.gz`, `.exe`, `.dylib`, `.so`, `.dmg` | — |
| Unknown | Everything else | — |

**Code language mapping** (Prism supports):

| Category | Extensions | Prism Language |
|----------|-----------|----------------|
| JavaScript/TypeScript | `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs` | `javascript` |
| Python | `.py`, `.pyw`, `.pyx` | `python` |
| HTML/CSS | `.html`, `.htm`, `.css`, `.scss`, `.sass`, `.less` | `html` / `css` |
| JSON | `.json`, `.jsonc`, `.json5` | `json` |
| Shell | `.sh`, `.bash`, `.zsh`, `.fish` | `bash` |
| Rust | `.rs` | `rust` |
| Go | `.go` | `go` |
| TOML | `.toml` | `toml` |
| YAML | `.yml`, `.yaml` | `yaml` |
| XML | `.xml`, `.xsl`, `.xsd`, `.plist` | `xml` |
| SQL | `.sql` | `sql` |
| C/C++ | `.c`, `.h`, `.cpp`, `.hpp`, `.cc`, `.hh` | `c` / `cpp` |
| Java/Kotlin | `.java`, `.kt`, `.kts` | `java` / `kotlin` |
| Ruby | `.rb`, `.gemspec` | `ruby` |
| Swift | `.swift` | `swift` |
| Dart | `.dart` | `dart` |
| PHP | `.php`, `.phtml` | `php` |
| C# | `.cs` | `csharp` |
| Lua | `.lua` | `lua` |
| R | `.r`, `.R` | `r` |
| Makefile | `Makefile`, `makefile`, `GNUmakefile` | `clike` (best effort) |
| Diff | `.diff`, `.patch` | `diff` |
| Markdown (code blocks) | `.md` | `markdown` |
| SVG (inline) | `.svg` | Handled as image, but if text-based rendered as `xml` |

### Component Details

#### 1. `file-types.ts` (lib utility)

Pure function, no Lit dependencies. Classifies a filename by extension.

```ts
export function detectFileType(filename: string): FileTypeInfo {
  const ext = getExtension(filename);
  if (!ext) return { type: 'unknown' };

  if (['md', 'markdown', 'mdx'].includes(ext)) return { type: 'markdown' };
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'].includes(ext)) return { type: 'image' };
  if (['pdf', 'zip', 'tar', 'gz', 'exe', 'dylib', 'so', 'dmg'].includes(ext)) return { type: 'binary' };

  const lang = extensionToLanguage(ext);
  if (lang) return { type: 'code', language: lang };

  return { type: 'unknown' };
}
```

#### 2. `file-preview.ts` (orchestrator)

Manages the full lifecycle: empty state, loading, error, and delegates rendering to the correct sub-component.

**Properties:**
```ts
static properties = {
  content: {},
  fileName: {},
  loading: { type: Boolean },
  error: { type: Object },
  projectPath: {},
  filePath: {}
};
```

**Render logic:**
```
if (!projectPath)          → empty placeholder
if (error)                 → error message
if (loading)               → loading spinner
if (fileType === 'image')  → <file-preview-image>
if (fileType === 'markdown') → <file-preview-markdown>
if (fileType === 'code')   → <file-preview-code>
otherwise                  → <file-preview-empty>
```

**Header** (shared across all file types):
- Filename (truncated with ellipsis)
- File type icon (📝 for markdown, 💻 for code, 🖼 for image)
- For markdown: source/preview toggle button

#### 3. `file-preview-code.ts` (code viewer)

Renders code with Prism syntax highlighting.

**Properties:**
```ts
static properties = {
  content: {},
  language: {},  // Prism language identifier
  fileName: {}
};
```

**Behavior:**
- On first render with content, run Prism highlighting
- Use `Prism.highlight(code, Prism.languages[language], language)`
- Render as `<pre><code class="language-{lang}">`
- If content changes, re-highlight

**Prism imports:**
```ts
import Prism from 'prismjs';
import 'prismjs/components/prism-javascript.js';
import 'prismjs/components/prism-typescript.js';
import 'prismjs/components/prism-python.js';
// ... one import per language we want to support
```

**Consideration:** Static imports for all ~25+ languages add significant bundle size. Options:
- **Static import all** (simple, larger bundle ~300KB gzip for common languages)
- **Lazy load per language** (dynamic `import()` on first view — smaller initial bundle, but adds latency on first code file view)

Decision: **Static import all** per user requirement.

**Styling:**
```css
:host { display: block; height: 100%; }
.code-container { overflow: auto; padding: 1rem; }
pre {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.875rem;
  line-height: 1.6;
  tab-size: 2;
  counter-reset: line;
}
code { display: block; }
code .line {
  display: block;
  padding: 0 0.5rem;
  counter-increment: line;
}
code .line::before {
  content: counter(line);
  display: inline-block;
  width: 2rem;
  margin-right: 1rem;
  text-align: right;
  color: var(--text-muted);
  user-select: none;
}
/* Prism token colors use Prism's default theme,
   overridden by CSS custom properties if needed */
```

#### 4. `file-preview-markdown.ts` (markdown viewer)

Renders markdown with source/preview toggle.

**Properties:**
```ts
static properties = {
  content: {},
  fileName: {}
};
```

**Internal state:**
```ts
@state() viewMode: 'source' | 'preview' = 'source';
```

**Behavior:**
- **Source mode**: Show raw markdown in `<pre>` with monospace font
- **Preview mode**: Render via `marked.parse(content)` → inject as `innerHTML`
- Toggle button in header switches mode
- Preview mode: apply basic CSS for headings, lists, code blocks, links

**Marked usage:**
```ts
import { marked } from 'marked';

private renderPreview(): string {
  return marked.parse(this.content || '', { async: false }) as string;
}
```

**Preview CSS** (in-component `static styles`):
```css
.markdown-preview {
  padding: 1rem;
  font-family: var(--font-sans);
  font-size: 0.9375rem;
  line-height: 1.7;
  color: var(--text-primary);
}
.markdown-preview h1, .markdown-preview h2, .markdown-preview h3,
.markdown-preview h4, .markdown-preview h5, .markdown-preview h6 {
  margin-top: 1.5rem;
  margin-bottom: 0.75rem;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.3;
}
.markdown-preview h1 { font-size: 1.75rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; }
.markdown-preview h2 { font-size: 1.5rem; border-bottom: 1px solid var(--border); padding-bottom: 0.4rem; }
.markdown-preview h3 { font-size: 1.25rem; }
.markdown-preview p { margin: 0.75rem 0; }
.markdown-preview a { color: var(--accent); text-decoration: none; }
.markdown-preview a:hover { text-decoration: underline; }
.markdown-preview code {
  font-family: var(--font-mono);
  font-size: 0.85em;
  background: var(--bg-hover);
  padding: 0.15rem 0.35rem;
  border-radius: 3px;
}
.markdown-preview pre {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 1rem;
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: 0.85rem;
  line-height: 1.5;
}
.markdown-preview pre code {
  background: none;
  padding: 0;
  font-size: inherit;
}
.markdown-preview ul, .markdown-preview ol {
  padding-left: 1.5rem;
  margin: 0.75rem 0;
}
.markdown-preview li { margin: 0.25rem 0; }
.markdown-preview blockquote {
  border-left: 3px solid var(--accent);
  margin: 1rem 0;
  padding: 0.5rem 1rem;
  color: var(--text-secondary);
  background: var(--bg-hover);
  border-radius: 0 4px 4px 0;
}
.markdown-preview img {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
  margin: 1rem 0;
}
.markdown-preview table {
  border-collapse: collapse;
  width: 100%;
  margin: 1rem 0;
}
.markdown-preview th, .markdown-preview td {
  border: 1px solid var(--border);
  padding: 0.5rem 0.75rem;
  text-align: left;
}
.markdown-preview th {
  background: var(--bg-secondary);
  font-weight: 600;
}
.markdown-preview hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 1.5rem 0;
}
```

#### 5. `file-preview-image.ts` (image viewer)

Renders images inline with fit-to-width.

**Properties:**
```ts
static properties = {
  fileName: {},
  filePath: {},
  projectPath: {}
};
```

**Behavior:**
- Construct image URL: `/api/projects/files/read?project_path=...&file_path=...`
- Render `<img>` with `style="max-width: 100%; height: auto; display: block;"`
- Show filename in header
- Handle load errors gracefully (show error state)

**Note:** The image is served via the existing `readFile` API which returns raw bytes. The `<img>` src must point to a URL the browser can fetch directly. We need to either:
- (a) Return base64 data URI from the API (simple, works for small images)
- (b) Create a new API endpoint that serves images with proper `Content-Type` headers
- (c) Fetch as blob and create object URL (`URL.createObjectURL`)

**Decision:** Use option (c) — fetch as blob, create object URL, set as `<img src>`. Revoke on cleanup.

```ts
private imageUrl: string | null = null;

async loadImage() {
  if (!this.projectPath || !this.filePath) return;
  
  const resp = await fetch(
    `/api/projects/files/read?project_path=${encodeURIComponent(this.projectPath)}&file_path=${encodeURIComponent(this.filePath)}`
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  
  const blob = await resp.blob();
  this.imageUrl = URL.createObjectURL(blob);
}

disconnectedCallback() {
  super.disconnectedCallback();
  if (this.imageUrl) {
    URL.revokeObjectURL(this.imageUrl);
    this.imageUrl = null;
  }
}
```

#### 6. `file-preview-empty.ts` (fallback)

Simple message for binary/unrecognized files.

**Properties:**
```ts
static properties = {
  fileName: {}
};
```

**Render:**
```ts
render() {
  return html`
    <div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <line x1="12" y1="18" x2="12" y2="12" />
        <line x1="9" y1="15" x2="15" y2="15" />
      </svg>
      <p>Cannot preview <strong>${this.fileName}</strong></p>
      <p style="font-size: 0.8125rem; color: var(--text-muted);">This file type is not supported for in-app preview.</p>
    </div>
  `;
}
```

## Implementation Plan

### Step 1: File Type Detection Utility

**File:** `frontend-litro/lib/file-types.ts`

- Create `detectFileType()` function
- Extension → type/language mapping tables
- Pure function, no dependencies

### Step 2: Prism Integration

**File:** `frontend-litro/components/file-preview-code.ts`

- Install Prism: `bun add prismjs`
- Create language import map
- Implement `file-preview-code.ts` with Prism highlighting
- Line numbers via CSS counters
- Monospace font, dark theme token colors

### Step 3: Markdown Component

**File:** `frontend-litro/components/file-preview-markdown.ts`

- Use existing `marked` dependency
- Implement source/preview toggle (internal `@state()`)
- Preview CSS for headings, lists, code blocks, tables, images, links
- Source mode: raw `<pre>` with monospace

### Step 4: Image Component

**File:** `frontend-litro/components/file-preview-image.ts`

- Fetch as blob, create object URL
- Fit-to-width `<img>` rendering
- Cleanup object URL on disconnect

### Step 5: Empty/Fallback Component

**File:** `frontend-litro/components/file-preview-empty.ts`

- Simple centered message with icon
- Show filename and unsupported file type message

### Step 6: Refactor Main File Preview

**File:** `frontend-litro/components/file-preview.ts`

- Keep orchestration logic (loading/error/empty)
- Use `detectFileType()` to choose sub-component
- Render appropriate sub-component based on file type
- Move header + toggle into orchestrator (shared across markdown/code/image)

### Step 7: Update Workspace Integration

**File:** `frontend-litro/pages/workspace.ts`

- No changes needed — `file-preview` props remain the same (`projectPath`, `filePath`)
- The orchestrator handles all internal logic

## File Changes Summary

| File | Action | Purpose |
|------|--------|---------|
| `frontend-litro/lib/file-types.ts` | **New** | File type detection utility |
| `frontend-litro/components/file-preview-code.ts` | **New** | Code viewer with Prism |
| `frontend-litro/components/file-preview-markdown.ts` | **New** | Markdown viewer with toggle |
| `frontend-litro/components/file-preview-image.ts` | **New** | Image viewer |
| `frontend-litro/components/file-preview-empty.ts` | **New** | "Cannot preview" fallback |
| `frontend-litro/components/file-preview.ts` | **Modify** | Refactor as orchestrator |
| `frontend-litro/package.json` | **Modify** | Add `prismjs` dependency |
| `frontend-litro/pages/workspace.ts` | **No change** | Same props, orchestrator handles rest |

## Technical Considerations

### Bundle Size

Prism static imports for ~25 languages will add approximately 200-300KB (gzipped). This is acceptable for a developer tool. If bundle size becomes an issue, languages can be lazy-loaded later.

### Security

- **Markdown preview**: Raw `marked` output is used without sanitization (per user decision). This is acceptable since users view their own project files. If external content is ever rendered, DOMPurify should be added.
- **Image URLs**: `URL.createObjectURL` creates a blob URL scoped to the page. Revoked on component disconnect. No security concerns.
- **File paths**: All file paths are validated by the backend API. The frontend passes them through without modification.

### Performance

- **Code highlighting**: Runs synchronously on content change. For very large files (>10,000 lines), Prism may be slow. Consider chunked rendering or virtual scrolling in a follow-up.
- **Markdown rendering**: `marked.parse()` is synchronous and fast. No performance concerns.
- **Image loading**: Blob fetch + object URL is fast. Large images (e.g., 4K screenshots) will load instantly but may be large in memory. Browser handles this.

### Edge Cases

- **Empty files**: Show empty state (same as no file selected)
- **Binary content in code files**: Prism will attempt to highlight; if it fails, show raw text fallback
- **SVG files**: Treated as images (per mapping table), not code
- **Files with no extension**: Treated as `unknown` → fallback message
- **Concurrent file changes**: If `filePath` changes while a previous file is still loading, the new load overwrites the old. No cancellation needed since we always show the latest `content` prop.

## Testing Strategy

### Manual Testing Checklist

- [ ] Open a `.ts` file → see Prism-highlighted code with line numbers
- [ ] Open a `.py` file → see Python-highlighted code
- [ ] Open a `.js` file → see JavaScript-highlighted code
- [ ] Open a `.json` file → see JSON-highlighted code
- [ ] Open a `.md` file in source mode → see raw markdown
- [ ] Toggle `.md` to preview mode → see rendered markdown
- [ ] Toggle back to source → see raw markdown again
- [ ] Open a `.png` file → see image fit to width
- [ ] Open a `.jpg` file → see image fit to width
- [ ] Open a `.svg` file → see image (not code)
- [ ] Open a `.pdf` file → see "Cannot preview" message
- [ ] Open a file with no extension → see "Cannot preview" message
- [ ] Switch between files rapidly → no stale content
- [ ] Close workspace → no memory leaks (object URLs revoked)

### Automated Testing

Integration tests for the existing flows (browse, file preview, etc.) should continue to pass. The file preview is a UI-only component with no API interactions beyond the existing `readFile` call, which is already tested.

## Success Criteria

- [ ] Markdown files show source/preview toggle in header
- [ ] Code files display with Prism syntax highlighting
- [ ] Image files display inline, fit to width
- [ ] Binary/unrecognized files show "Cannot preview" message
- [ ] No TypeScript errors
- [ ] Build succeeds with `bun run litro build`
- [ ] All existing integration tests still pass
- [ ] No regressions in workspace layout or chat panel

## Next Steps

1. **Review this plan** and provide feedback
2. **Get approval** to proceed
3. **Implement** in order: file-types → Prism → markdown → image → empty → refactor orchestrator
4. **Test** manually with various file types
5. **Run existing tests** to ensure no regressions
6. **Commit and push** on feature branch
