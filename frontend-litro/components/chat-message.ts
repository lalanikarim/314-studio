import { css, html, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { designTokens } from '../styles/design-tokens.js';
import { renderMarkdown } from '../lib/markdown.js';
import type { MessageContentBlock } from '../types/chat.js';

/**
 * Render a single chat message with ordered content blocks.
 *
 * Content blocks can be:
 * - `text`: rendered as markdown
 * - `thinking`: rendered as a collapsible container (default collapsed)
 * - `toolCall`: rendered as a `<chat-tool-call>` sub-component
 *
 * All blocks are rendered within the same message body, preserving order.
 */
@customElement('chat-message')
export class ChatMessageElement extends LitElement {
  static styles = [
    designTokens,
    css`
      :host {
        display: block;
        padding: 0.75rem 1rem;
        border-bottom: 1px solid var(--border);
      }
      :host(:last-child) {
        border-bottom: none;
      }
      .message {
        display: flex;
        gap: 0.75rem;
      }
      .message--user {
        flex-direction: row-reverse;
      }
      .message__avatar {
        flex-shrink: 0;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.75rem;
        font-weight: 600;
        color: #fff;
      }
      .message--user .message__avatar {
        background: var(--accent);
      }
      .message--assistant .message__avatar {
        background: var(--bg-active);
        color: var(--text-primary);
      }
      .message__body {
        flex: 1;
        min-width: 0;
      }
      .message__meta {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 0.25rem;
        font-size: 0.75rem;
        color: var(--text-muted);
      }
      .message__meta__name {
        font-weight: 600;
        color: var(--text-secondary);
      }
      .message__content {
        font-size: 0.875rem;
        line-height: 1.6;
        color: var(--text-primary);
      }
      .message__content p {
        margin: 0 0 0.5rem 0;
      }
      .message__content p:last-child {
        margin-bottom: 0;
      }
      .message__content pre {
        background: var(--bg-primary);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 0.75rem;
        overflow-x: auto;
        font-family: var(--font-mono);
        font-size: 0.8rem;
        line-height: 1.5;
      }
      .message__content code {
        font-family: var(--font-mono);
        font-size: 0.85em;
        background: var(--bg-hover);
        padding: 0.125rem 0.25rem;
        border-radius: 3px;
      }
      .message__content pre code {
        background: none;
        padding: 0;
      }
      .message__content ul,
      .message__content ol {
        padding-left: 1.5rem;
        margin: 0.5rem 0;
      }
      .message__content li {
        margin: 0.25rem 0;
      }
      .message__content table {
        border-collapse: collapse;
        width: 100%;
        margin: 0.5rem 0;
        font-size: 0.85rem;
      }
      .message__content th,
      .message__content td {
        border: 1px solid var(--border);
        padding: 0.5rem;
        text-align: left;
      }
      .message__content th {
        background: var(--bg-secondary);
        font-weight: 600;
      }
      .message__content blockquote {
        border-left: 3px solid var(--accent);
        margin: 0.5rem 0;
        padding-left: 1rem;
        color: var(--text-secondary);
      }
      .message__content a {
        color: var(--accent-light);
        text-decoration: none;
      }
      .message__content a:hover {
        text-decoration: underline;
      }
      .message__tools {
        margin: 0.5rem 0;
      }
      .message__tools chat-tool-call {
        display: block;
      }
      .message__thinking {
        margin: 0.5rem 0;
      }
      .message__thinking details {
        border: 1px solid var(--border);
        border-radius: 6px;
        background: var(--bg-secondary);
        font-size: 0.8125rem;
      }
      .message__thinking summary {
        cursor: pointer;
        padding: 0.375rem 0.625rem;
        font-size: 0.75rem;
        color: var(--text-muted);
        user-select: none;
        display: flex;
        align-items: center;
        gap: 0.375rem;
      }
      .message__thinking summary:hover {
        color: var(--text-secondary);
      }
      .message__thinking summary::before {
        content: '🧠';
        font-size: 0.75rem;
      }
      .message__thinking details[open] summary {
        border-bottom: 1px solid var(--border);
        margin-bottom: 0.375rem;
      }
      .message__thinking .thinking__content {
        padding: 0.5rem 0.625rem;
        white-space: pre-wrap;
        word-break: break-word;
        color: var(--text-secondary);
        font-size: 0.8125rem;
        line-height: 1.5;
        max-height: 300px;
        overflow-y: auto;
      }
    `,
  ];

  static properties = {
    role: { type: String },
    timestamp: { type: Number },
    contentBlocks: { type: Array, attribute: false },
    isStreaming: { type: Boolean, attribute: false },
  };

  role = '';
  timestamp = 0;
  contentBlocks: MessageContentBlock[] = [];
  /** When true, keeps <details> open so the user can watch them stream.
   *  Also true after streaming completes so they stay expanded.
   *  False during initial hydration so collapsed by default. */
  isStreaming = false;

  private formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  render() {
    const isUser = this.role === 'user';
    const name = isUser ? 'You' : 'Pi';
    const time = this.formatTime(this.timestamp);

    return html`
      <div class="message ${isUser ? 'message--user' : 'message--assistant'}">
        <div class="message__avatar">${isUser ? 'Y' : 'π'}</div>
        <div class="message__body">
          <div class="message__meta">
            <span class="message__meta__name">${name}</span>
            <span class="message__meta__time">${time}</span>
          </div>
          ${this.renderContentBlocks(isUser)}
        </div>
      </div>
    `;
  }

  private renderContentBlocks(isUser: boolean) {
    if (this.contentBlocks.length === 0) return html``;

    return html`
      <div class="message__content">
        ${this.contentBlocks.map((block) => this.renderBlock(block, isUser))}
      </div>
    `;
  }

  private renderBlock(
    block: MessageContentBlock,
    isUser: boolean,
  ) {
    switch (block.kind) {
      case 'text':
        return isUser
          ? html`<p>${block.content}</p>`
          : html`${unsafeHTML(renderMarkdown(block.content))}`;
      case 'thinking':
        return html`
          <div class="message__thinking">
            <details ?open=${this.isStreaming}>
              <summary>Thinking</summary>
              <div class="thinking__content">${block.content}</div>
            </details>
          </div>
        `;
      case 'toolCall':
        return html`<chat-tool-call
          .name=${block.name}
          .args=${block.args}
          .result=${block.result}
          .id=${block.id ?? ''}
          .isStreaming=${this.isStreaming}
        ></chat-tool-call>`;
    }
  }
}
