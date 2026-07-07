import { html, css, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import { designTokens } from '../styles/design-tokens';

/**
 * Fallback viewer for binary or unrecognized file types.
 *
 * Displays a centered message indicating the file cannot be previewed.
 */
@customElement('file-preview-empty')
export class FilePreviewEmptyElement extends LitElement {
  static styles = [
    designTokens,
    css`
      :host {
        display: block;
        height: 100%;
      }
      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        padding: 2rem;
        text-align: center;
        gap: 1rem;
      }
      .empty-state svg {
        color: var(--text-muted, #565f89);
        opacity: 0.6;
      }
      .empty-state p {
        margin: 0;
        font-size: 0.9375rem;
        color: var(--text-secondary, #a9b1d6);
        line-height: 1.5;
      }
      .empty-state .subtitle {
        font-size: 0.8125rem;
        color: var(--text-muted, #565f89);
      }
    `,
  ];

  static properties = {
    fileName: { type: String },
  };

  fileName = '';

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
        <p class="subtitle">This file type is not supported for in-app preview.</p>
      </div>
    `;
  }
}
