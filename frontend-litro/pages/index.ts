import { html, css, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { LitroPage } from '@beatzball/litro/runtime';
import { browseDirectories } from '../services/api';

/**
 * Folder selector page — browse ~/Projects and pick a project to open.
 *
 * Lists top-level project directories from `/api/browse` (defaults to the
 * backend's configured Projects root). Clicking a folder navigates to the
 * model-selection step at `/models?folder=<path>`.
 *
 * SSR safety: `connectedCallback` guards the fetch behind a client check so
 * the server render produces only the shell; the list populates after
 * hydration. Styling uses the `view-folder__*` BEM names ported from the
 * React frontend's `views.css`, scoped to this page's Shadow DOM.
 */
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
    }
  `;

  @state() private folders: Array<{ name: string; path: string }> = [];
  @state() private loading = false;
  @state() private error: string | null = null;
  @state() private search = '';

  connectedCallback() {
    super.connectedCallback();
    if (typeof window !== 'undefined' && this.folders.length === 0) this.loadFolders();
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

  private openFolder(path: string) {
    window.location.href = `/models?folder=${encodeURIComponent(path)}`;
  }

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

  render() {
    return html`
      <div class="view-folder">
        <div class="view-folder__inner">
          <div class="view-folder__header">
            <h1>Open Project</h1>
            <p class="view-folder__subtitle">Navigate to a project folder to open with Pi</p>
          </div>

          <div class="view-folder__search">
            <svg class="view-folder__search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder="Search folders…"
              .value=${this.search}
              @input=${(e: Event) => (this.search = (e.target as HTMLInputElement).value)}
            />
          </div>

          <div class="view-folder__list">
            ${this.error
              ? html`<div class="view-folder__error">${this.error}</div>`
              : this.loading
                ? html`<div class="view-folder__empty">Loading folders…</div>`
                : this.filteredFolders.length === 0
                  ? html`<div class="view-folder__empty">No folders found.</div>`
                  : this.filteredFolders.map(
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
                    )}
          </div>
        </div>
      </div>
    `;
  }
}

export default HomePage;