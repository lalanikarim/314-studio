import { html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { LitroPage } from '@beatzball/litro/runtime';


// Use a global signal pattern to share state across component instances
let globalSelectedFile: string | null = null;

// Create an event target for notifications
const selectedFileEventTarget = new EventTarget();

export function getSelectedFile(): string | null {
  return globalSelectedFile;
}

export function setSelectedFile(path: string | null): void {
  globalSelectedFile = path;
  selectedFileEventTarget.dispatchEvent(new Event('selectedfilechange'));
}

// Listen for changes and update all instances
selectedFileEventTarget.addEventListener('selectedfilechange', () => {
  // This will be called on all instances when the global state changes
  // Each instance will update its own state in the callback
});

@customElement('page-workspace')
export class WorkspacePage extends LitroPage {
  static styles = css`
    :host {
      display: block;
      height: 100vh;
      background: var(--bg-primary);
    }
    .view-workspace {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    .view-workspace__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 48px;
      padding: 0 12px;
      border-bottom: 1px solid var(--border);
      background: var(--bg-secondary);
      flex-shrink: 0;
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
    .view-workspace__header-left,
    .view-workspace__header-center,
    .view-workspace__header-right {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .view-workspace__header-left { flex: 0 0 auto; }
    .view-workspace__header-center { flex: 1; justify-content: center; }
    .view-workspace__header-right { flex: 0 0 auto; }
    .icon-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: none;
      border-radius: 6px;
      background: transparent;
      color: var(--text-secondary);
      cursor: pointer;
      padding: 6px;
      transition: all 0.15s ease;
    }
    .icon-btn:hover {
      background: var(--border);
      color: var(--text-placeholder);
    }
    .icon-btn--active {
      color: var(--accent-light);
    }
    .view-workspace__project {
      margin-left: 8px;
      font-size: 14px;
      font-weight: 500;
      color: var(--text-placeholder);
    }
    .view-workspace__project-title {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-secondary);
      cursor: pointer;
      padding: 4px 12px;
      border-radius: 6px;
      transition: color 0.15s ease, background 0.15s ease;
    }
    .view-workspace__project-title:hover {
      color: var(--text-placeholder);
      background: rgba(255, 255, 255, 0.06);
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
    .view-workspace__body--chat-expanded .view-workspace__chat {
      flex: 1;
      width: 100%;
    }
    .view-workspace__sidebar {
      width: 260px;
      flex: 0 0 260px;
      min-width: 0;
      overflow: hidden;
      border-right: 1px solid var(--border);
      transition: width 0.2s ease, flex 0.2s ease;
    }
    .view-workspace__sidebar--collapsed {
      width: 0;
      flex: 0 0 0;
      border-right: none;
    }
    .view-workspace__sidebar--hidden {
      display: none;
    }
    .view-workspace__preview {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      border-right: 1px solid var(--border);
    }
    .view-workspace__preview--hidden {
      display: none;
    }
    .view-workspace__chat {
      flex: 0 0 400px;
      width: 400px;
      min-width: 0;
      overflow: hidden;
      transition: width 0.2s ease, flex 0.2s ease;
    }
    .view-workspace__chat--expanded {
      flex: 1;
    }
    .view-workspace__chat-placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      padding: 2rem;
      color: var(--text-muted);
      text-align: center;
      font-size: 14px;
    }
  `;

  @state() sidebarCollapsed = false;
  @state() chatExpanded = false;
  @state() selectedFile: string | null = null;

  connectedCallback() {
    super.connectedCallback();
    const saved = getSelectedFile();
    if (saved) {
      this.selectedFile = saved;
    }
    
    // Listen for changes to the global selected file
    this._selectedFileListener = () => {
      this.selectedFile = getSelectedFile();
    };
    selectedFileEventTarget.addEventListener('selectedfilechange', this._selectedFileListener);
  }
  
  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._selectedFileListener) {
      selectedFileEventTarget.removeEventListener('selectedfilechange', this._selectedFileListener);
    }
  }
  
  private _selectedFileListener: EventListener | null = null;

  private get folderPath(): string {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('folder') || '';
  }

  private handleFileSelect(path: string) {
    // Only set selectedFile for files (not directories).
    // The tree-node component checks isDirectory before calling onSelect,
    // but the path format is the full path so we can't easily tell here.
    // We'll let file-preview attempt to load and handle errors.
    setSelectedFile(path);
    this.selectedFile = path;
    this.requestUpdate();
  }

  render() {
    const projectRoot = this.folderPath;
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
              ${projectRoot ? projectRoot.split('/').filter(Boolean).pop() : '314 Studio'}
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
            <project-tree
              .projectPath=${projectRoot}
              .selectedFile=${this.selectedFile}
              .onSelect=${this.handleFileSelect}
            ></project-tree>
          </div>

          <div class="view-workspace__preview ${this.chatExpanded ? 'view-workspace__preview--hidden' : ''}">
            <file-preview
              .projectPath=${projectRoot}
              .filePath=${this.selectedFile || ''}
            ></file-preview>
          </div>

          <div class="view-workspace__chat ${this.chatExpanded ? 'view-workspace__chat--expanded' : ''}">
            <!-- TODO: <chat-panel></chat-panel> -->
            <div class="view-workspace__chat-placeholder">ChatPanel — coming soon</div>
          </div>
        </div>
      </div>
    `;
  }
}

export default WorkspacePage;
