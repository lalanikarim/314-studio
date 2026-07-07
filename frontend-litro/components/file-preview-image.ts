import { html, css, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import { designTokens } from '../styles/design-tokens';

/**
 * Image viewer for the file preview panel.
 *
 * Fetches the file as a blob and renders it via <img> with fit-to-width.
 * Object URLs are revoked on component disconnect to prevent memory leaks.
 */
@customElement('file-preview-image')
export class FilePreviewImageElement extends LitElement {
  static styles = [
    designTokens,
    css`
      :host {
        display: block;
        height: 100%;
      }
      .image-container {
        display: flex;
        align-items: flex-start;
        justify-content: center;
        height: 100%;
        overflow: auto;
        padding: 1rem;
        background: var(--bg-primary, #0f172a);
      }
      .image-container img {
        max-width: 100%;
        height: auto;
        display: block;
        border-radius: 4px;
      }
      .error {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        padding: 1rem;
        color: var(--text-muted, #565f89);
        text-align: center;
      }
    `,
  ];

  static properties = {
    fileName: { type: String },
    projectPath: { type: String },
    filePath: { type: String },
  };

  fileName = '';
  projectPath = '';
  filePath = '';

  private imageUrl: string | null = null;
  private loadError = false;

  updated(changedProperties: Map<string, any>) {
    if (
      changedProperties.has('filePath') ||
      changedProperties.has('projectPath')
    ) {
      this.loadImage();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.imageUrl) {
      URL.revokeObjectURL(this.imageUrl);
      this.imageUrl = null;
    }
  }

  private async loadImage() {
    if (!this.projectPath || !this.filePath) return;

    this.loadError = false;
    if (this.imageUrl) {
      URL.revokeObjectURL(this.imageUrl);
      this.imageUrl = null;
    }

    try {
      const resp = await fetch(
        `/api/projects/files/read?project_path=${encodeURIComponent(this.projectPath)}&file_path=${encodeURIComponent(this.filePath)}`,
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      this.imageUrl = URL.createObjectURL(blob);
    } catch {
      this.loadError = true;
    }
  }

  render() {
    if (this.loadError) {
      return html`
        <div class="error">
          Failed to load image: ${this.fileName}
        </div>
      `;
    }

    if (!this.imageUrl) {
      return html`
        <div class="error">Loading image…</div>
      `;
    }

    return html`
      <div class="image-container">
        <img
          src=${this.imageUrl}
          alt=${this.fileName}
          loading="lazy"
        />
      </div>
    `;
  }
}
