import { css, html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { designTokens } from '../styles/design-tokens.js';
import { buttonStyles } from '../styles/shared.js';

/**
 * Chat input bar with send/abort buttons.
 *
 * - Sends message on Enter (without Shift)
 * - Sends on button click
 * - Aborts current stream on abort button click
 * - Disables input while streaming or when explicitly disabled
 *
 * Dispatches CustomEvents:
 * - 'send-message' with detail = trimmed message string
 * - 'abort-message' with no detail
 *
 * Events are composed so they propagate through Shadow DOM boundaries.
 */
@customElement('chat-input')
export class ChatInputElement extends LitElement {
  static styles = [
    designTokens,
    buttonStyles,
    css`
      :host {
        display: block;
        padding: 0.75rem 1rem;
        border-top: 1px solid var(--border);
        background: var(--bg-secondary);
      }
      .chat-input {
        display: flex;
        align-items: flex-end;
        gap: 0.5rem;
      }
      .chat-input__wrapper {
        flex: 1;
        display: flex;
        align-items: center;
        background: var(--bg-primary);
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 0.5rem 0.75rem;
        transition: border-color 0.15s ease;
      }
      .chat-input__wrapper:focus-within {
        border-color: var(--accent);
      }
      .chat-input__textarea {
        flex: 1;
        border: none;
        outline: none;
        background: none;
        color: var(--text-primary);
        font-family: inherit;
        font-size: 0.875rem;
        line-height: 1.5;
        resize: none;
        max-height: 120px;
        overflow-y: auto;
      }
      .chat-input__textarea::placeholder {
        color: var(--text-muted);
      }
      .chat-input__textarea:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .chat-input__actions {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        flex-shrink: 0;
      }
      .chat-input__btn {
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .chat-input__btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
      }
      .chat-input__btn--send {
        background: var(--accent);
        color: #fff;
      }
      .chat-input__btn--send:hover:not(:disabled) {
        background: var(--accent-hover);
      }
      .chat-input__btn--abort {
        background: var(--danger);
        color: #fff;
      }
      .chat-input__btn--abort:hover {
        background: var(--danger-bg-dark);
      }
    `,
  ];

  static properties = {
    disabled: { type: Boolean },
    isStreaming: { type: Boolean },
    value: { type: String, state: true },
  };

  value = '';

  disabled = false;
  isStreaming = false;

  private onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.send();
    }
  }

  private onInput(e: Event) {
    const target = e.target as HTMLTextAreaElement;
    this.value = target.value;
  }

  private send() {
    const trimmed = this.value.trim();
    if (!trimmed || this.disabled || this.isStreaming) return;

    this.dispatchEvent(
      new CustomEvent('send-message', {
        detail: trimmed,
        bubbles: true,
        composed: true,
      })
    );

    this.value = '';
  }

  private abort() {
    if (this.disabled || !this.isStreaming) return;

    this.dispatchEvent(
      new CustomEvent('abort-message', {
        bubbles: true,
        composed: true,
      })
    );
  }

  render() {
    const canSend =
      this.value.trim().length > 0 && !this.disabled && !this.isStreaming;
    const showAbort = this.isStreaming;

    return html`
      <div class="chat-input">
        <div class="chat-input__wrapper">
          <textarea
            class="chat-input__textarea"
            placeholder="Message Pi…"
            .value=${this.value}
            @input=${this.onInput}
            @keydown=${this.onKeyDown}
            ?disabled=${this.disabled || this.isStreaming}
            rows="1"
          ></textarea>
        </div>
        <div class="chat-input__actions">
          ${showAbort
            ? html`<button
                class="chat-input__btn chat-input__btn--abort"
                @click=${this.abort}
                title="Abort"
              >
                ■
              </button>`
            : html`<button
                class="chat-input__btn chat-input__btn--send"
                @click=${this.send}
                ?disabled=${!canSend}
                title="Send"
              >
                ➤
              </button>`}
        </div>
      </div>
    `;
  }
}
