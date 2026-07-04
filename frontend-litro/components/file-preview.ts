import { html, css, LitElement } from 'lit';
import { readFile } from '../services/api';

class FilePreviewElement extends LitElement {
  static styles = css`
    :host { display: block; height: 100%; }
    .panel { display: flex; flex-direction: column; height: 100%; }
    .empty { display: flex; align-items: center; justify-content: center; height: 100%; color: #565f89; }
    .content { padding: 1rem; white-space: pre; font-family: monospace; }
  `;

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
    try {
      const result = await readFile(this.projectPath, this.filePath);
      this.content = result.content || '';
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
    return html`<div class="panel"><div class="content">${this.fileName}: ${this.content}</div></div>`;
  }
}

// Register without decorators
if (!customElements.get('file-preview')) {
  customElements.define('file-preview', FilePreviewElement);
}
