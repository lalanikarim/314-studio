import { html, css, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import { designTokens } from '../styles/design-tokens';

// Make Prism available as a global before loading language components
// This is required because Prism component files reference `Prism` as a free global
import Prism from 'prismjs';
if (typeof globalThis !== 'undefined') {
  (globalThis as any).Prism = Prism;
}

// Language imports - core first, then extensions
import 'prismjs/components/prism-clike.js';
import 'prismjs/components/prism-markup.js';  // HTML, XML, SVG
import 'prismjs/components/prism-markup-templating.js';  // Required by PHP, EJS, etc.
import 'prismjs/components/prism-css.js';
import 'prismjs/components/prism-json.js';
import 'prismjs/components/prism-javascript.js';
import 'prismjs/components/prism-typescript.js';
import 'prismjs/components/prism-python.js';
import 'prismjs/components/prism-bash.js';
import 'prismjs/components/prism-yaml.js';
import 'prismjs/components/prism-toml.js';
import 'prismjs/components/prism-sql.js';
import 'prismjs/components/prism-go.js';
import 'prismjs/components/prism-rust.js';
import 'prismjs/components/prism-java.js';
import 'prismjs/components/prism-c.js';
import 'prismjs/components/prism-cpp.js';
import 'prismjs/components/prism-csharp.js';
import 'prismjs/components/prism-php.js';
import 'prismjs/components/prism-swift.js';
import 'prismjs/components/prism-kotlin.js';
import 'prismjs/components/prism-dart.js';
import 'prismjs/components/prism-lua.js';
import 'prismjs/components/prism-diff.js';

/**
 * Code file viewer with Prism syntax highlighting.
 *
 * Renders code with line numbers (CSS counters), monospace font,
 * and language-specific token colors from Prism's default theme.
 */
@customElement('file-preview-code')
export class FilePreviewCodeElement extends LitElement {
  static styles = [
    designTokens,
    css`
      :host {
        display: block;
        height: 100%;
      }
      .code-container {
        height: 100%;
        overflow: auto;
        padding: 1rem;
        counter-reset: line;
      }
      .code-container__pre {
        margin: 0;
        font-family: var(--font-mono, 'SF Mono', 'JetBrains Mono', Monaco, Menlo, Consolas, monospace);
        font-size: 0.875rem;
        line-height: 1.6;
        tab-size: 2;
        counter-reset: line;
      }
      pre {
        margin: 0;
        font-family: var(--font-mono, 'SF Mono', 'JetBrains Mono', Monaco, Menlo, Consolas, monospace);
        font-size: 0.875rem;
        line-height: 1.6;
        tab-size: 2;
        counter-reset: line;
      }
      code {
        display: block;
      }
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
        color: var(--text-muted, #565f89);
        user-select: none;
        -webkit-user-select: none;
      }
      /* Override Prism token colors for dark theme */
      .token.comment,
      .token.prolog,
      .token.doctype,
      .token.cdata {
        color: var(--text-muted, #565f89);
        font-style: italic;
      }
      .token.property,
      .token.tag,
      .token.boolean,
      .token.number,
      .token.constant,
      .token.symbol,
      .token.deleted {
        color: var(--accent-light, #60a5fa);
      }
      .token.selector,
      .token.attr-name,
      .token.string,
      .token.char,
      .token.builtin,
      .token.inserted {
        color: var(--accent, #3b82f6);
      }
      .token.operator,
      .token.entity,
      .token.url {
        color: var(--text-secondary, #a9b1d6);
      }
      .token.atrule,
      .token.attr-value,
      .token.keyword {
        color: var(--accent-hover, #2563eb);
        font-weight: 600;
      }
      .token.function,
      .token.class-name {
        color: var(--accent-light, #60a5fa);
      }
      .token.regex,
      .token.important,
      .token.variable {
        color: var(--text-primary, #f1f5f9);
      }
      /* Fallback when Prism fails to highlight */
      .code-fallback {
        font-family: var(--font-mono, 'SF Mono', 'JetBrains Mono', Monaco, Menlo, Consolas, monospace);
        font-size: 0.875rem;
        line-height: 1.6;
        white-space: pre;
        color: var(--text-primary, #f1f5f9);
      }
    `,
  ];

  static properties = {
    content: {},
    language: { type: String },
    fileName: { type: String },
    highlighted: { type: Boolean, attribute: false },
  };

  content = '';
  language = '';
  fileName = '';

  highlighted = false;

  private codeContainer: HTMLPreElement | null = null;

  updated(changedProperties: Map<string, any>) {
    if (changedProperties.has('content') && this.content && this.language) {
      // Defer to next frame to ensure Prism is ready
      requestAnimationFrame(() => this.highlight());
    }
  }

  private highlightedLines: string[] = [];

  private highlight() {
    if (!this.content || !this.language) return;

    try {
      const grammar = Prism.languages[this.language];
      if (!grammar) {
        // Fallback: show raw text
        this.highlightedLines = [this.escapeHtml(this.content)];
        this.highlighted = true;
        this.renderCodeDOM();
        return;
      }

      const escaped = this.escapeHtml(this.content);
      const lines = escaped.split('\n');
      
      this.highlightedLines = lines.map((line) => {
        const highlighted = Prism.highlight(line, grammar, this.language);
        return `<span class="line">${highlighted}</span>`;
      });

      this.highlighted = true;
      this.renderCodeDOM();
    } catch {
      // Fallback: show raw text
      this.highlightedLines = [this.escapeHtml(this.content)];
      this.highlighted = true;
      this.renderCodeDOM();
    }
  }

  private renderCodeDOM() {
    if (!this.codeContainer || !this.highlightedLines.length) return;
    this.codeContainer.innerHTML = this.highlightedLines.join('\n');
  }

  private refCodeContainer(el: HTMLPreElement | null) {
    this.codeContainer = el;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  render() {
    if (!this.content) {
      return html`<div class="code-container">No content</div>`;
    }

    if (!this.highlighted) {
      return html`<div class="code-container">Loading…</div>`;
    }

    return html`
      <div class="code-container">
        <pre class="code-container__pre" .ref=${this.refCodeContainer}></pre>
      </div>
    `;
  }
}
