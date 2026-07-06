import { css, html, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import { designTokens } from '../styles/design-tokens.js';
import type { ToolCallEntry } from '../types/chat.js';

/**
 * Render a single tool call with collapsible details.
 *
 * Used inside <chat-message> to display tool invocations from the assistant.
 * Tool calls are collapsible by default — users can expand them to see
 * arguments and results.
 */
@customElement('chat-tool-call')
export class ChatToolCallElement extends LitElement {
  static styles = [
    designTokens,
    css`
      :host {
        display: block;
        margin: 0.25rem 0;
      }
      details {
        border: 1px solid var(--border);
        border-radius: 6px;
        background: var(--bg-secondary);
        font-size: 0.8rem;
      }
      summary {
        padding: 0.5rem 0.75rem;
        cursor: pointer;
        user-select: none;
        color: var(--text-secondary);
        font-family: var(--font-mono);
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      summary:hover {
        background: var(--bg-hover);
      }
      summary::before {
        content: '🔧';
        font-size: 0.9rem;
      }
      .tool-call__name {
        font-weight: 600;
        color: var(--accent-light);
      }
      .tool-call__truncated {
        color: var(--text-muted);
        font-family: var(--font-mono);
        font-size: 0.75rem;
        margin-left: 0.5rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .tool-call__id {
        color: var(--text-muted);
        font-family: var(--font-mono);
        font-size: 0.6875rem;
        margin-left: 0.5rem;
        opacity: 0.6;
      }
      pre {
        margin: 0;
        padding: 0.75rem;
        background: var(--bg-primary);
        border-top: 1px solid var(--border);
        color: var(--text-secondary);
        font-family: var(--font-mono);
        font-size: 0.75rem;
        line-height: 1.5;
        overflow-x: auto;
        white-space: pre-wrap;
        word-break: break-all;
      }
    `,
  ];

  static properties = {
    name: { type: String },
    args: { type: String, attribute: false },
    result: { type: String, attribute: false },
    id: { type: String, attribute: false },
  };

  name: string = '';
  args?: string;
  result?: string;
  id: string = '';

  render() {
    const hasContent = this.args || this.result;
    return html`
      <details ?open=${hasContent}>
        <summary>
          <span class="tool-call__name">${this.name}</span>
          ${this.id ? html`<span class="tool-call__id">${this.id}</span>` : ''}
          ${hasContent
            ? html`<span class="tool-call__truncated">
                ${this.args ? this.args.slice(0, 50) : ''}${this.result ? `…${this.result.slice(0, 30)}` : ''}
              </span>`
            : ''}
        </summary>
        ${hasContent
          ? html`
              ${this.args
                ? html`<pre class="tool-call__args"><strong>Args:</strong>\n${this.args}</pre>`
                : ''}
              ${this.result
                ? html`<pre class="tool-call__result"><strong>Result:</strong>\n${this.result}</pre>`
                : ''}
            `
          : ''}
      </details>
    `;
  }
}
