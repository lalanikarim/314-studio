import { html, css, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import { readFile } from '../services/api';
import { designTokens } from '../styles/design-tokens';

@customElement('file-preview')
export class FilePreviewElement extends LitElement {
  static styles = [
    designTokens,
    css`
      :host { display: block; height: 100%; }
      .panel { display: flex; flex-direction: column; height: 100%; }
      .empty { display: flex; align-items: center; justify-content: center; height: 100%; }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.5rem 1rem;
      border-bottom: 1px solid var(--border, #334155);
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--text-secondary, #94a3b8);
      background: var(--bg-secondary, #1e293b);
      flex-shrink: 0;
    }
    .header__name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .content { 
      flex: 1; 
      overflow: auto; 
      padding: 1rem; 
      white-space: pre; 
      font-family: var(--font-mono, 'SF Mono', 'JetBrains Mono', Monaco, Menlo, Consolas, monospace);
      font-size: 0.875rem;
      line-height: 1.6;
      color: var(--text-primary, #f1f5f9);
    }
  `,
  ];

  static properties = {
    content: {},
    fileName: {},
    loading: { type: Boolean },
    error: { type: Object },
    projectPath: {},
    filePath: {}
  };

  content = '';
  fileName = '';
  loading = false;
  error: string | null = null;
  projectPath = '';
  filePath = '';

  updated(changedProperties: Map<string, any>) {
    if (changedProperties.has('filePath') || changedProperties.has('projectPath')) {
      this.loadFile();
    }
  }

  private async loadFile() {
    if (!this.projectPath || !this.filePath) return;
    this.loading = true;
    this.error = null;
    try {
      const content = await readFile(this.projectPath, this.filePath);
      this.content = content || '';
      this.fileName = this.filePath.split('/').filter(Boolean).pop() || 'Untitled';
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed';
    } finally {
      this.loading = false;
    }
  }

  render() {
    if (!this.projectPath) {
      return html`<div class="panel"><div class="empty">Select a file to preview</div></div>`;
    }
    if (this.error) {
      return html`<div class="panel"><div class="content">${this.error}</div></div>`;
    }
    if (this.loading) {
      return html`<div class="panel"><div class="content">Loading...</div></div>`;
    }
    return html`
      <div class="panel">
        ${this.fileName ? html`<div class="header"><span class="header__name">${this.fileName}</span></div>` : ''}
        <div class="content">${this.content}</div>
      </div>
    `;
  }
}
