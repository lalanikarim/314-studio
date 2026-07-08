import { html, css, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { designTokens } from '../styles/design-tokens';
import { readFile } from '../services/api';
import { detectFileType } from '../lib/file-types';

/** File type icon mapping for the header. */
const TYPE_ICONS: Record<string, string> = {
  markdown: '\u{1F4DD}', // 📝
  image: '\u{1F5BC}\u{FE0F}', // 🖼️
  code: '\u{1F4BB}', // 💻
};

/**
 * File preview orchestrator.
 *
 * Manages loading/error/empty states and delegates rendering to the
 * appropriate sub-component based on file type detection.
 *
 * Public props (unchanged from previous version):
 *   - projectPath: string — project root directory
 *   - filePath: string — relative path within the project
 */
@customElement('file-preview')
export class FilePreviewElement extends LitElement {
  static styles = [
    designTokens,
    css`
      :host {
        display: block;
        height: 100%;
      }
      .panel {
        display: flex;
        flex-direction: column;
        height: 100%;
      }

      /* ── Header ──────────────────────────────────────────────────── */
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.5rem 0.75rem;
        border-bottom: 1px solid var(--border, #334155);
        font-size: 0.8125rem;
        font-weight: 500;
        color: var(--text-secondary, #a9b1d6);
        background: var(--bg-secondary, #1e293b);
        flex-shrink: 0;
        gap: 0.5rem;
      }
      .header__left {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        overflow: hidden;
      }
      .header__icon {
        flex-shrink: 0;
        font-size: 0.875rem;
      }
      .header__name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .header__actions {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        flex-shrink: 0;
      }

      /* ── Toggle buttons (markdown source/preview) ────────────────── */
      .toggle-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0.25rem 0.5rem;
        background: none;
        border: 1px solid transparent;
        border-radius: 4px;
        color: var(--text-muted, #565f89);
        font-size: 0.75rem;
        font-family: inherit;
        cursor: pointer;
        transition: all 0.15s ease;
        white-space: nowrap;
      }
      .toggle-btn:hover {
        background: var(--bg-hover, #334155);
        color: var(--text-secondary, #a9b1d6);
      }
      .toggle-btn--active {
        background: var(--bg-active, #334155);
        color: var(--text-primary, #f1f5f9);
        border-color: var(--border, #334155);
      }

      /* ── Content area ────────────────────────────────────────────── */
      .content {
        flex: 1;
        overflow: auto;
      }
      .empty {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--text-muted, #565f89);
        font-size: 0.875rem;
      }
    `,
  ];

  static properties = {
    projectPath: { type: String },
    filePath: { type: String },
    content: { type: String },
    fileName: { type: String },
    loading: { type: Boolean },
    error: { type: String, state: true },
    viewMode: { type: String },
  };

  projectPath = '';
  filePath = '';

  content = '';
  fileName = '';
  loading = false;
  error: string | null = null;
  viewMode: 'source' | 'preview' = 'source';

  updated(changedProperties: Map<string, any>) {
    if (
      changedProperties.has('filePath') ||
      changedProperties.has('projectPath')
    ) {
      this.loadFile();
    }
  }

  private async loadFile() {
    if (!this.projectPath || !this.filePath) return;

    this.loading = true;
    this.error = null;
    try {
      const raw = await readFile(this.projectPath, this.filePath);
      this.content = raw || '';
      this.fileName =
        this.filePath.split('/').filter(Boolean).pop() || 'Untitled';
      // Reset view mode when file changes
      const fileInfo = detectFileType(this.fileName);
      this.viewMode = fileInfo.type === 'markdown' ? 'source' : 'source';
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load file';
    } finally {
      this.loading = false;
    }
  }

  private toggleViewMode() {
    this.viewMode = this.viewMode === 'source' ? 'preview' : 'source';
  }

  private getFileTypeInfo() {
    if (!this.fileName) return { type: 'unknown' as const };
    return detectFileType(this.fileName);
  }

  render() {
    // No project selected
    if (!this.projectPath) {
      return html`
        <div class="panel">
          <div class="empty">Select a file to preview</div>
        </div>
      `;
    }

    // Error state
    if (this.error) {
      return html`
        <div class="panel">
          <div class="header">
            <span class="header__name">${this.fileName || 'Error'}</span>
          </div>
          <div class="content" style="padding: 1rem; color: var(--text-muted);">
            ${this.error}
          </div>
        </div>
      `;
    }

    // Loading state
    if (this.loading) {
      return html`
        <div class="panel">
          <div class="header">
            <span class="header__name">${this.fileName || 'Loading...'}</span>
          </div>
          <div class="content" style="padding: 1rem; color: var(--text-muted);">
            Loading...
          </div>
        </div>
      `;
    }

    const fileInfo = this.getFileTypeInfo();
    const icon = TYPE_ICONS[fileInfo.type] || '';

    // Build header (shared across all types)
    const header = this.fileName
      ? html`
          <div class="header">
            <div class="header__left">
              ${icon ? html`<span class="header__icon">${icon}</span>` : ''}
              <span class="header__name">${this.fileName}</span>
            </div>
            <div class="header__actions">
              ${fileInfo.type === 'markdown'
                ? html`
                    <button
                      class="toggle-btn ${this.viewMode === 'source'
                        ? 'toggle-btn--active'
                        : ''}"
                      @click=${() => (this.viewMode = 'source')}
                      title="Show raw markdown"
                    >
                      Source
                    </button>
                    <button
                      class="toggle-btn ${this.viewMode === 'preview'
                        ? 'toggle-btn--active'
                        : ''}"
                      @click=${() => (this.viewMode = 'preview')}
                      title="Render markdown"
                    >
                      Preview
                    </button>
                  `
                : ''}
            </div>
          </div>
        `
      : html``;

    // Delegate to sub-component based on file type
    let viewer: any;
    switch (fileInfo.type) {
      case 'image':
        viewer = html`<file-preview-image
          .fileName=${this.fileName}
          .projectPath=${this.projectPath}
          .filePath=${this.filePath}
        ></file-preview-image>`;
        break;
      case 'markdown':
        viewer = html`<file-preview-markdown
          .content=${this.content}
          .fileName=${this.fileName}
          .viewMode=${this.viewMode}
        ></file-preview-markdown>`;
        break;
      case 'code':
        viewer = html`<file-preview-code
          .content=${this.content}
          .language=${fileInfo.language || ''}
          .fileName=${this.fileName}
        ></file-preview-code>`;
        break;
      default:
        viewer = html`<file-preview-empty
          .fileName=${this.fileName}
        ></file-preview-empty>`;
        break;
    }

    return html`
      <div class="panel">
        ${header}
        <div class="content">${viewer}</div>
      </div>
    `;
  }
}
