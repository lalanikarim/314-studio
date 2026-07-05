import { html, css, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { closeSession, deleteSession } from '../services/api';

// ---------------------------------------------------------------------------
// ShutdownDialog — reusable confirmation dialog for session shutdown
// ---------------------------------------------------------------------------

@customElement('shutdown-dialog')
export class ShutdownDialog extends LitElement {
  static styles = css`
    :host {
      display: block;
    }
    .dialog {
      position: fixed;
      inset: 0;
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.6);
    }
    .dialog__panel {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      width: 100%;
      max-width: 380px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    }
    .dialog__title {
      font-size: 18px;
      font-weight: 600;
      color: var(--text-primary);
      margin: 0 0 8px;
    }
    .dialog__message {
      font-size: 14px;
      color: var(--text-secondary);
      margin: 0 0 20px;
      line-height: 1.5;
    }
    .dialog__message strong {
      color: var(--text-primary);
    }
    .dialog__actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }
    .dialog__btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      border: 1px solid var(--border);
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      font-family: inherit;
      cursor: pointer;
      transition: all 0.15s;
      background: transparent;
      color: var(--text-secondary);
    }
    .dialog__btn:hover {
      background: var(--bg-hover);
      color: var(--text-placeholder);
    }
    .dialog__btn--graceful {
      border-color: var(--accent);
      color: var(--accent-light);
    }
    .dialog__btn--graceful:hover {
      background: var(--accent);
      color: #fff;
    }
    .dialog__btn--force {
      border-color: var(--danger);
      color: var(--danger);
    }
    .dialog__btn--force:hover {
      background: var(--danger);
      color: #fff;
    }
    .dialog__btn--desc {
      font-size: 11px;
      font-weight: 400;
      opacity: 0.7;
    }
  `;

  static properties = {
    sessionName: { type: String },
    sessionId: { type: String },
    closing: { type: Boolean },
  };
  sessionName = '';
  sessionId = '';
  closing = false;

  private async handleGraceful() {
    if (this.closing) return;
    this.closing = true;
    try {
      await closeSession(this.sessionId);
      this.dispatchEvent(new CustomEvent('shutdown-complete', {
        detail: { sessionId: this.sessionId, type: 'close' },
        bubbles: true,
        composed: true,
      }));
    } catch (e) {
      console.error('Failed to close session:', e);
      this.closing = false;
    }
  }

  private async handleForce() {
    if (this.closing) return;
    this.closing = true;
    try {
      await deleteSession(this.sessionId);
      this.dispatchEvent(new CustomEvent('shutdown-complete', {
        detail: { sessionId: this.sessionId, type: 'delete' },
        bubbles: true,
        composed: true,
      }));
    } catch (e) {
      console.error('Failed to delete session:', e);
      this.closing = false;
    }
  }

  render() {
    return html`
      ${this.sessionName
        ? html`
          <div class="dialog" @click=${(e: Event) => {
            if ((e.target as HTMLElement) === e.currentTarget) this.dispatchEvent(new CustomEvent('shutdown-cancel'));
          }}>
            <div class="dialog__panel">
              <h2 class="dialog__title">Shutdown Session</h2>
              <p class="dialog__message">
                Shutdown <strong>${this.sessionName}</strong>?
              </p>
              <div class="dialog__actions">
                <button class="dialog__btn" @click=${() => this.dispatchEvent(new CustomEvent('shutdown-cancel'))}>Cancel</button>
                <button class="dialog__btn dialog__btn--graceful" @click=${this.handleGraceful}>
                  ⏻ Graceful
                  <span class="dialog__btn--desc">Compact + Abort</span>
                </button>
                <button class="dialog__btn dialog__btn--force" @click=${this.handleForce}>
                  ⨟ Force
                  <span class="dialog__btn--desc">Abort only</span>
                </button>
              </div>
            </div>
          </div>
        `
        : ''
      }
    `;
  }
}
