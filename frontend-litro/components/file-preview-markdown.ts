import { html, css, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { designTokens } from '../styles/design-tokens';
import { renderMarkdown } from '../lib/markdown';

/**
 * Markdown file viewer with source/preview toggle.
 *
 * - Source mode: raw markdown in a <pre> block
 * - Preview mode: rendered HTML via `marked`
 *
 * The toggle button lives in the parent orchestrator (file-preview.ts),
 * which passes `viewMode` as a property.
 */
@customElement('file-preview-markdown')
export class FilePreviewMarkdownElement extends LitElement {
  static styles = [
    designTokens,
    css`
      :host {
        display: block;
        height: 100%;
      }

      /* ── Source mode ─────────────────────────────────────────────── */
      .source {
        height: 100%;
        overflow: auto;
        padding: 1rem;
      }
      .source pre {
        margin: 0;
        font-family: var(--font-mono, 'SF Mono', 'JetBrains Mono', Monaco, Menlo, Consolas, monospace);
        font-size: 0.875rem;
        line-height: 1.6;
        white-space: pre;
        color: var(--text-primary, #f1f5f9);
      }

      /* ── Preview mode ────────────────────────────────────────────── */
      .markdown-preview {
        padding: 1rem;
        font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
        font-size: 0.9375rem;
        line-height: 1.7;
        color: var(--text-primary, #f1f5f9);
      }
      .markdown-preview h1 {
        font-size: 1.75rem;
        font-weight: 700;
        margin-top: 1.5rem;
        margin-bottom: 0.75rem;
        padding-bottom: 0.5rem;
        border-bottom: 1px solid var(--border, #334155);
        color: var(--text-primary, #f1f5f9);
      }
      .markdown-preview h2 {
        font-size: 1.5rem;
        font-weight: 600;
        margin-top: 1.5rem;
        margin-bottom: 0.75rem;
        padding-bottom: 0.4rem;
        border-bottom: 1px solid var(--border, #334155);
        color: var(--text-primary, #f1f5f9);
      }
      .markdown-preview h3 {
        font-size: 1.25rem;
        font-weight: 600;
        margin-top: 1.5rem;
        margin-bottom: 0.5rem;
        color: var(--text-primary, #f1f5f9);
      }
      .markdown-preview h4,
      .markdown-preview h5,
      .markdown-preview h6 {
        font-size: 1.1rem;
        font-weight: 600;
        margin-top: 1.25rem;
        margin-bottom: 0.5rem;
        color: var(--text-primary, #f1f5f9);
      }
      .markdown-preview p {
        margin: 0.75rem 0;
      }
      .markdown-preview a {
        color: var(--accent, #3b82f6);
        text-decoration: none;
      }
      .markdown-preview a:hover {
        text-decoration: underline;
        color: var(--accent-hover, #2563eb);
      }
      .markdown-preview code {
        font-family: var(--font-mono, 'SF Mono', 'JetBrains Mono', Monaco, Menlo, Consolas, monospace);
        font-size: 0.85em;
        background: var(--bg-hover, #1e293b);
        padding: 0.15rem 0.35rem;
        border-radius: 3px;
        color: var(--accent-light, #60a5fa);
      }
      .markdown-preview pre {
        background: var(--bg-secondary, #1e293b);
        border: 1px solid var(--border, #334155);
        border-radius: 6px;
        padding: 1rem;
        overflow-x: auto;
        margin: 1rem 0;
      }
      .markdown-preview pre code {
        background: none;
        padding: 0;
        font-size: 0.85rem;
        color: var(--text-primary, #f1f5f9);
      }
      .markdown-preview ul,
      .markdown-preview ol {
        padding-left: 1.5rem;
        margin: 0.75rem 0;
      }
      .markdown-preview li {
        margin: 0.25rem 0;
      }
      .markdown-preview li > ul,
      .markdown-preview li > ol {
        margin-top: 0.25rem;
        margin-bottom: 0.25rem;
      }
      .markdown-preview blockquote {
        border-left: 3px solid var(--accent, #3b82f6);
        margin: 1rem 0;
        padding: 0.5rem 1rem;
        color: var(--text-secondary, #a9b1d6);
        background: var(--bg-hover, #1e293b);
        border-radius: 0 4px 4px 0;
      }
      .markdown-preview blockquote p {
        margin: 0.25rem 0;
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
      .markdown-preview th,
      .markdown-preview td {
        border: 1px solid var(--border, #334155);
        padding: 0.5rem 0.75rem;
        text-align: left;
      }
      .markdown-preview th {
        background: var(--bg-secondary, #1e293b);
        font-weight: 600;
        color: var(--text-primary, #f1f5f9);
      }
      .markdown-preview tr:nth-child(even) {
        background: var(--bg-hover, #1e293b);
      }
      .markdown-preview hr {
        border: none;
        border-top: 1px solid var(--border, #334155);
        margin: 1.5rem 0;
      }
      .markdown-preview strong {
        font-weight: 700;
        color: var(--text-primary, #f1f5f9);
      }
      .markdown-preview em {
        font-style: italic;
      }
    `,
  ];

  static properties = {
    content: {},
    fileName: {},
    viewMode: { type: String },
    _renderedPreview: { type: String, state: true },
  };

  content = '';
  fileName = '';
  viewMode: 'source' | 'preview' = 'source';

  _renderedPreview = '';

  updated(changedProperties: Map<string, any>) {
    super.updated();
    if (changedProperties.has('content') && this.content) {
      this._renderedPreview = this.renderPreview();
    }
  }

  private renderPreview(): string {
    if (!this.content) return '';
    try {
      return renderMarkdown(this.content);
    } catch {
      return '';
    }
  }

  render() {
    if (!this.content) {
      return html`<div class="empty">Empty file</div>`;
    }

    if (this.viewMode === 'preview') {
      return html`
        <div class="markdown-preview">${unsafeHTML(this._renderedPreview)}</div>
      `;
    }

    // Source mode
    return html`
      <div class="source">
        <pre>${this.content}</pre>
      </div>
    `;
  }
}
