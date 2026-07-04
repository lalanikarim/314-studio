import { html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { LitroPage } from '@beatzball/litro/runtime';

@customElement('page-workspace')
export class WorkspacePage extends LitroPage {
  static styles = css`
    :host {
      display: block;
      height: 100vh;
      background: var(--bg-primary, #1a1b26);
    }
    .view-workspace {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    .view-workspace__header {
      display: flex;
      align-items: center;
      padding: 0.5rem 1rem;
      border-bottom: 1px solid var(--border-color, #3b4261);
      background: var(--bg-secondary, #16161e);
    }
    .view-workspace__header-left,
    .view-workspace__header-center,
    .view-workspace__header-right {
      display: flex;
      align-items: center;
    }
    .view-workspace__header-left {
      flex: 0 0 auto;
    }
    .view-workspace__header-center {
      flex: 1;
      justify-content: center;
    }
    .view-workspace__header-right {
      flex: 0 0 auto;
    }
    .icon-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: var(--text-secondary, #a9b1d6);
      cursor: pointer;
      padding: 6px;
      transition: background 0.15s;
    }
    .icon-btn:hover {
      background: var(--bg-hover, #292e42);
    }
    .icon-btn--active {
      background: var(--bg-active, #3b4261);
    }
    .view-workspace__project {
      margin-left: 0.75rem;
      font-size: 0.875rem;
      color: var(--text-secondary, #a9b1d6);
    }
    .view-workspace__project-title {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--text-primary, #c0caf5);
      cursor: pointer;
    }
    .view-workspace__project-title:hover {
      text-decoration: underline;
    }
    .view-workspace__body {
      display: flex;
      flex: 1;
      overflow: hidden;
    }
    .view-workspace__body--chat-expanded .view-workspace__sidebar,
    .view-workspace__body--chat-expanded .view-workspace__preview {
      display: none;
    }
    .view-workspace__sidebar {
      flex: 0 0 250px;
      overflow: hidden;
      border-right: 1px solid var(--border-color, #3b4261);
    }
    .view-workspace__sidebar--collapsed {
      flex: 0 0 0;
      overflow: hidden;
    }
    .view-workspace__preview {
      flex: 1;
      overflow: hidden;
      border-right: 1px solid var(--border-color, #3b4261);
    }
    .view-workspace__preview--hidden {
      display: none;
    }
    .view-workspace__chat {
      flex: 0 0 400px;
      overflow: hidden;
    }
    .view-workspace__chat--expanded {
      flex: 1;
    }
  `;

  @state() sidebarCollapsed = false;
  @state() chatExpanded = false;

  render() {
    return html`
      <div class="view-workspace">
        <header class="view-workspace__header">
          <div class="view-workspace__header-left">
            <button class="icon-btn" @click=${() => { this.sidebarCollapsed = !this.sidebarCollapsed; }} title="Toggle file tree">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 3v18" />
              </svg>
            </button>
            <span class="view-workspace__project">Workspace</span>
          </div>
          <div class="view-workspace__header-center">
            <span class="view-workspace__project-title" @click=${() => { window.location.href = '/'; }}>
              314 Studio
            </span>
          </div>
          <div class="view-workspace__header-right">
            <button
              class="icon-btn ${this.chatExpanded ? 'icon-btn--active' : ''}"
              @click=${() => { this.chatExpanded = !this.chatExpanded; }}
              title="${this.chatExpanded ? 'Collapse chat to full width' : 'Expand chat'}"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                ${this.chatExpanded
                  ? html`<path d="M18 6L6 18M6 6l12 12" />`
                  : html`<>
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <path d="M9 3v18" />
                    </>`
                }
              </svg>
            </button>
          </div>
        </header>

        <div class="view-workspace__body ${this.chatExpanded ? 'view-workspace__body--chat-expanded' : ''}">
          <div class="view-workspace__sidebar ${this.sidebarCollapsed ? 'view-workspace__sidebar--collapsed' : ''} ${this.chatExpanded ? 'view-workspace__sidebar--hidden' : ''}">
            <project-tree></project-tree>
          </div>

          <div class="view-workspace__preview ${this.chatExpanded ? 'view-workspace__preview--hidden' : ''}">
            <file-preview></file-preview>
          </div>

          <div class="view-workspace__chat ${this.chatExpanded ? 'view-workspace__chat--expanded' : ''}">
            <!-- TODO: <chat-panel></chat-panel> -->
            <div style="padding: 2rem; color: var(--text-muted); text-align: center;">ChatPanel — coming soon</div>
          </div>
        </div>
      </div>
    `;
  }
}

export default WorkspacePage;
