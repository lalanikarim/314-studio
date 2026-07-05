import { html, css, type TemplateResult, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { LitroPage } from '@beatzball/litro/runtime';
import { browseDirectories, fetchSessions, closeSession, deleteSession } from '../services/api';
import type { SessionItem } from '../services/api';

// ---------------------------------------------------------------------------
// ShutdownDialog — reusable confirmation dialog
// ---------------------------------------------------------------------------

@customElement('shutdown-dialog')
class ShutdownDialog extends LitElement {
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

// ---------------------------------------------------------------------------
// SessionRow — single session list item
// ---------------------------------------------------------------------------

@customElement('session-row')
class SessionRow extends LitElement {
  static styles = css`
    :host {
      display: block;
    }
    .row {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 14px 16px;
      background: var(--bg-secondary);
      border: 1px solid transparent;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .row:hover {
      background: var(--bg-tertiary);
      border-color: var(--border);
    }
    .row__top {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .row__info {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
      min-width: 0;
    }
    .row__status {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .row__status--connected { background: var(--success); }
    .row__status--running { background: var(--warning); }
    .row__status--other { background: var(--text-muted); }
    .row__name {
      font-size: 14px;
      font-weight: 500;
      color: var(--text-placeholder);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .row__time {
      font-size: 12px;
      color: var(--text-muted);
      flex-shrink: 0;
    }
    .row__shutdown {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      padding: 4px 6px;
      font-size: 16px;
      transition: all 0.15s;
      flex-shrink: 0;
      margin-left: 8px;
    }
    .row__shutdown:hover {
      background: var(--danger);
      color: #fff;
    }
    .row__meta {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--text-muted);
      padding-left: 16px;
    }
    .row__meta-divider {
      color: var(--border);
    }
  `;

  static properties = {
    session: { type: Object },
  };

  session!: SessionItem;
  onSelect!: () => void;
  onShutdown!: () => void;

  private formatTime(iso: string): string {
    const d = new Date(iso);
    const datePart = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const timePart = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${datePart} ${timePart}`;
  }

  private getStatusClass(): string {
    if (this.session?.sse_connected) return 'row__status--connected';
    if (this.session?.status === 'running') return 'row__status--running';
    return 'row__status--other';
  }

  private getProjectName(): string {
    const parts = (this.session?.project_path || '').split('/').filter(Boolean);
    return parts[parts.length - 1] || this.session?.project_path || '—';
  }

  private getModelName(): string {
    if (!this.session?.model_id) return '—';
    return this.session.model_id;
  }

  render() {
    return html`
      <div
        class="row"
        role="button"
        tabindex="0"
        @click=${this.onSelect}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this.onSelect();
          }
        }}
      >
        <div class="row__top">
          <div class="row__info">
            <span class="row__status ${this.getStatusClass()}"></span>
            <span class="row__name">${this.session?.name || this.getProjectName()}</span>
          </div>
          <span class="row__time">${this.formatTime(this.session?.created_at || '')}</span>
          <button
            class="row__shutdown"
            @click=${(e: Event) => {
              e.stopPropagation();
              this.onShutdown();
            }}
            title="Shutdown session"
          >
            ⏻
          </button>
        </div>
        <div class="row__meta">
          <span>${this.getProjectName()}</span>
          <span class="row__meta-divider">·</span>
          <span>${this.getModelName()}</span>
        </div>
      </div>
    `;
  }
}

// ---------------------------------------------------------------------------
// Directory tree (inline, not a separate component)
// ---------------------------------------------------------------------------

function formatTime(iso: string): string {
  const d = new Date(iso);
  const datePart = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const timePart = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${datePart} ${timePart}`;
}

function getProjectName(projectPath: string): string {
  const parts = projectPath.split('/').filter(Boolean);
  return parts[parts.length - 1] || projectPath;
}

// ---------------------------------------------------------------------------
// Folder selector page — browse ~/Projects and pick a project to open.
//
// Also supports a "Sessions" tab showing active sessions with shutdown
// controls. Clicking a session navigates to /models?folder=<project_path>
// with that session pre-selected.
// ---------------------------------------------------------------------------

@customElement('page-home')
export class HomePage extends LitroPage {
  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
      background: var(--bg-primary);
    }
    .view-folder {
      display: flex;
      align-items: flex-start;
      justify-content: center;
      min-height: 100vh;
      padding: 24px 20px 32px;
    }
    .view-folder__inner {
      width: 100%;
      max-width: 640px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      max-height: calc(100vh - 56px);
    }
    .view-folder__header {
      text-align: center;
      margin-bottom: 24px;
      flex-shrink: 0;
    }
    .view-folder__header h1 {
      font-size: 28px;
      font-weight: 600;
      color: var(--text-primary);
      margin: 0 0 8px;
    }
    .view-folder__subtitle {
      font-size: 15px;
      color: var(--text-muted);
      margin: 0;
    }

    /* Tabs */
    .view-folder__tabs {
      display: flex;
      gap: 0;
      margin-bottom: 24px;
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .view-folder__tab {
      flex: 1;
      padding: 10px 16px;
      background: transparent;
      border: none;
      border-bottom: 2px solid transparent;
      color: var(--text-muted);
      font-size: 14px;
      font-weight: 500;
      font-family: inherit;
      cursor: pointer;
      transition: all 0.15s;
    }
    .view-folder__tab:hover {
      color: var(--text-secondary);
    }
    .view-folder__tab--active {
      color: var(--text-primary);
      border-bottom-color: var(--accent);
    }

    /* Search */
    .view-folder__search {
      position: relative;
      margin-bottom: 24px;
      flex-shrink: 0;
    }
    .view-folder__search input {
      width: 100%;
      box-sizing: border-box;
      padding: 12px 16px 12px 44px;
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text-placeholder);
      font-size: 15px;
      font-family: inherit;
      outline: none;
      transition: border-color 0.15s;
    }
    .view-folder__search input::placeholder {
      color: var(--text-muted);
    }
    .view-folder__search input:focus {
      border-color: var(--accent);
    }
    .view-folder__search-icon {
      position: absolute;
      left: 14px;
      top: 50%;
      transform: translateY(-50%);
      width: 18px;
      height: 18px;
      color: var(--text-muted);
      pointer-events: none;
    }

    /* List */
    .view-folder__list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      flex: 1;
      overflow-y: auto;
      padding-right: 4px;
      padding-bottom: 24px;
      scrollbar-width: thin;
      scrollbar-color: var(--border) var(--bg-secondary);
    }
    .view-folder__list::-webkit-scrollbar {
      width: 8px;
    }
    .view-folder__list::-webkit-scrollbar-track {
      background: var(--bg-secondary);
    }
    .view-folder__list::-webkit-scrollbar-thumb {
      background: var(--border);
      border-radius: 4px;
    }

    /* Folder items */
    .view-folder__item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      background: var(--bg-secondary);
      border: 1px solid transparent;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      color: var(--text-placeholder);
      transition: all 0.15s;
      user-select: none;
    }
    .view-folder__item:hover {
      background: var(--bg-tertiary);
      border-color: var(--border);
    }
    .view-folder__item:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: -2px;
    }
    .view-folder__icon {
      font-size: 16px;
      line-height: 1;
      flex-shrink: 0;
    }
    .view-folder__name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .view-folder__open {
      padding: 4px 12px;
      background: var(--accent);
      color: #fff;
      border: none;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      flex-shrink: 0;
      transition: background 0.15s;
    }
    .view-folder__item:hover .view-folder__open {
      background: var(--accent-hover);
    }
    .view-folder__mark {
      background: rgba(59, 130, 246, 0.3);
      color: #fff;
      border-radius: 2px;
      padding: 0 1px;
    }

    /* Empty / error / loading */
    .view-folder__empty {
      text-align: center;
      color: var(--text-muted);
      font-size: 14px;
      padding: 32px;
      flex-shrink: 0;
    }
    .view-folder__error {
      color: var(--danger);
      padding: 16px;
      border-radius: 6px;
      background: rgba(239, 68, 68, 0.08);
      border: 1px solid rgba(239, 68, 68, 0.2);
      font-size: 14px;
      flex-shrink: 0;
    }

    /* Spinner */
    .view-folder__spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid var(--border);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
      vertical-align: middle;
      margin-right: 8px;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `;

  @state() private folders: Array<{ name: string; path: string }> = [];
  @state() private sessions: SessionItem[] = [];
  @state() private activeTab: 'projects' | 'sessions' = 'projects';
  @state() private loading = false;
  @state() private error: string | null = null;
  @state() private search = '';
  @state() private sessionLoadError: string | null = null;
  @state() private shutdownTarget: { session_id: string; name: string } | null = null;

  private sessionsFetched = false;

  connectedCallback() {
    super.connectedCallback();
    if (typeof window !== 'undefined' && this.folders.length === 0) {
      this.loadFolders();
    }
  }

  private async loadFolders() {
    this.loading = true;
    this.error = null;
    try {
      const items = await browseDirectories('');
      this.folders = items.map((d) => ({ name: d.name, path: d.path }));
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load folders';
    } finally {
      this.loading = false;
    }
  }

  private async loadSessions() {
    this.sessionsFetched = false;
    this.sessionLoadError = null;
    // Reset for next time the sessions tab opens
    if (this.sessionsFetched) {
      this.sessionsFetched = true;
      return;
    }
    this.sessionsFetched = true;
    try {
      const allSessions = await fetchSessions();
      // Only show running sessions
      this.sessions = allSessions.filter((s) => s.status === 'running');
    } catch (err) {
      this.sessionLoadError = 'Failed to load sessions. Please try again.';
    }
  }

  private openFolder(path: string) {
    window.location.href = `/models?folder=${encodeURIComponent(path)}`;
  }

  private openSession(session: SessionItem) {
    // Navigate to models page with the session pre-selected
    const params = new URLSearchParams();
    params.set('folder', session.project_path);
    params.set('session_id', session.session_id);
    params.set('session_name', session.name || '');
    params.set('session_model_id', session.model_id || '');
    params.set('session_status', session.status);
    params.set('session_sse_connected', session.sse_connected ? '1' : '0');
    params.set('session_created_at', session.created_at);
    window.location.href = `/models?${params.toString()}`;
  }

  private handleShutdown(session: SessionItem) {
    this.shutdownTarget = {
      session_id: session.session_id,
      name: session.name || getProjectName(session.project_path),
    };
  }

  private handleShutdownComplete() {
    this.shutdownTarget = null;
    if (this.activeTab === 'sessions') {
      this.loadSessions();
    }
  }

  private handleShutdownCancel() {
    this.shutdownTarget = null;
  }

  // ── Folder search filter ──────────────────────────────────────────────

  private get filteredFolders() {
    const q = this.search.trim().toLowerCase();
    if (!q) return this.folders;
    return this.folders.filter((f) => f.name.toLowerCase().includes(q));
  }

  private highlight(name: string): TemplateResult {
    const q = this.search.trim().toLowerCase();
    if (!q) return html`${name}`;
    const idx = name.toLowerCase().indexOf(q);
    if (idx < 0) return html`${name}`;
    return html`${name.slice(0, idx)}<mark class="view-folder__mark">${name.slice(
      idx,
      idx + this.search.length,
    )}</mark>${name.slice(idx + this.search.length)}`;
  }

  // ── Render ────────────────────────────────────────────────────────────

  render() {
    return html`
      <div class="view-folder">
        <div class="view-folder__inner">
          <div class="view-folder__header">
            <h1>Open Project</h1>
            <p class="view-folder__subtitle">Navigate to a project folder to open with Pi</p>
          </div>

          <!-- Tabs -->
          <div class="view-folder__tabs">
            <button
              class="view-folder__tab ${this.activeTab === 'projects' ? 'view-folder__tab--active' : ''}"
              @click=${() => { this.activeTab = 'projects'; this.search = ''; }}
            >
              Projects
            </button>
            <button
              class="view-folder__tab ${this.activeTab === 'sessions' ? 'view-folder__tab--active' : ''}"
              @click=${() => {
                this.activeTab = 'sessions';
                this.search = '';
                this.loadSessions();
              }}
            >
              Sessions ${this.sessions.length > 0 ? `(${this.sessions.length})` : ''}
            </button>
          </div>

          <!-- Search -->
          <div class="view-folder__search">
            <svg class="view-folder__search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder=${this.activeTab === 'sessions' ? 'Search sessions…' : 'Search folders…'}
              .value=${this.search}
              @input=${(e: Event) => (this.search = (e.target as HTMLInputElement).value)}
            />
          </div>

          <!-- Content -->
          <div class="view-folder__list">
            ${this.activeTab === 'projects'
              ? this.renderProjectsTab()
              : this.renderSessionsTab()
            }
          </div>

          <!-- Shutdown dialog -->
          ${this.shutdownTarget
            ? html`
              <shutdown-dialog
                .sessionName=${this.shutdownTarget.name}
                .sessionId=${this.shutdownTarget.session_id}
                @shutdown-complete=${() => this.handleShutdownComplete()}
                @shutdown-cancel=${() => this.handleShutdownCancel()}
              ></shutdown-dialog>
            `
            : ''
          }
        </div>
      </div>
    `;
  }

  private renderProjectsTab() {
    if (this.error) {
      return html`<div class="view-folder__error">${this.error}</div>`;
    }
    if (this.loading) {
      return html`<div class="view-folder__empty"><span class="view-folder__spinner"></span>Loading folders…</div>`;
    }
    if (this.filteredFolders.length === 0) {
      return html`<div class="view-folder__empty">${this.search ? 'No matching folders' : 'No folders found.'}</div>`;
    }
    return this.filteredFolders.map(
      (f) => html`
        <div
          class="view-folder__item"
          role="button"
          tabindex="0"
          @click=${() => this.openFolder(f.path)}
          @keydown=${(e: KeyboardEvent) =>
            (e.key === 'Enter' || e.key === ' ') && this.openFolder(f.path)}
        >
          <span class="view-folder__icon">📁</span>
          <span class="view-folder__name">${this.highlight(f.name)}</span>
          <span class="view-folder__open">Open</span>
        </div>
      `,
    );
  }

  private renderSessionsTab() {
    if (this.sessionLoadError) {
      return html`<div class="view-folder__error">${this.sessionLoadError}</div>`;
    }
    if (this.sessions.length === 0) {
      return html`<div class="view-folder__empty">No active sessions</div>`;
    }
    return this.sessions.map(
      (s) => html`
        <session-row
          .session=${s}
          .onSelect=${() => this.openSession(s)}
          .onShutdown=${() => this.handleShutdown(s)}
        ></session-row>
      `,
    );
  }
}

export default HomePage;
