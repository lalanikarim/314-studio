import { html, css } from 'lit';
import { customElement, state, property } from 'lit/decorators.js';
import { readFile } from '../services/api';
import type { ProjectInfo } from '../types';

@customElement('file-preview')
export class FilePreviewComponent extends HTMLElement {
  static styles = css`
    :host {
      display: block;
      height: 100%;
      background: var(--bg-primary, #1a1b26);
    }
    .panel {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    .panel__header {
      padding: 0.5rem 1rem;
      border-bottom: 1px solid var(--border-color, #3b4261);
      font-size: 0.875rem;
      color: var(--text-secondary, #a9b1d6);
    }
    .panel__content {
      flex: 1;
      overflow: auto;
      display: flex;
    }
    .panel__line-numbers {
      padding: 1rem 0.5rem;
      text-align: right;
      user-select: none;
      color: var(--text-muted, #565f89);
      font-family: var(--font-mono, 'SF Mono', Monaco, monospace);
      font-size: 0.875rem;
      line-height: 1.5;
      border-right: 1px solid var(--border-color, #3b4261);
    }
    .panel__code {
      flex: 1;
      padding: 1rem;
      margin: 0;
      font-family: var(--font-mono, 'SF Mono', Monaco, monospace);
      font-size: 0.875rem;
      line-height: 1.5;
      white-space: pre;
      color: var(--text-primary, #c0caf5);
    }
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted, #565f89);
    }
    .empty-state svg {
      width: 48px;
      height: 48px;
      margin-bottom: 1rem;
      opacity: 0.5;
    }
    .loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-secondary, #a9b1d6);
    }
    .error {
      padding: 1rem;
      color: var(--text-error, #f7768e);
    }
  `;

  @state() content = '';
  @state() fileName = '';
  @state() loading = false;
  @state() error: string | null = null;

  @property({ type: String }) projectPath = '';
  @property({ type: String }) filePath = '';

  private abortController: AbortController | null = null;

  updated(changedProperties: Map<string, any>) {
    if (changedProperties.has('filePath') || changedProperties.has('projectPath')) {
      this.loadFile();
    }
  }

  private async loadFile() {
    if (!this.projectPath || !this.filePath) {
      this.content = '';
      this.fileName = '';
      return;
    }

    this.abortController?.abort();
    this.abortController = new AbortController();
    this.loading = true;
    this.error = null;

    try {
      const result = await readFile(this.projectPath, this.filePath);
      this.content = result.content || '';
      this.fileName = this.filePath.split('/').filter(Boolean).pop() || 'Untitled';
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load file';
      this.content = '';
    } finally {
      this.loading = false;
    }
  }

  render() {
    if (!this.projectPath) {
      return html`
        <div class="panel">
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
            </svg>
            <p>Select a file to preview</p>
          </div>
        </div>
      `;
    }

    if (this.error) {
      return html`
        <div class="panel">
          <div class="error">${this.error}</div>
        </div>
      `;
    }

    if (this.loading) {
      return html`
        <div class="panel">
          <div class="loading">Loading file...</div>
        </div>
      `;
    }

    const displayContent = this.content || '// No file selected.\n// Click a file in the explorer to view its contents.';
    const lineNumberCount = displayContent.split('\n').length;

    return html`
      <div class="panel">
        <div class="panel__header">${this.fileName}</div>
        <div class="panel__content">
          <div class="panel__line-numbers">
            ${Array.from({ length: Math.min(lineNumberCount, 200) }, (_, i) => html`<span key=${i}>${i + 1}</span>`)}
          </div>
          <pre class="panel__code">${displayContent}</pre>
        </div>
      </div>
    `;
  }
}
