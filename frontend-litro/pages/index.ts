import { html, css, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { LitroPage } from '@beatzball/litro/runtime';
import { browseDirectories } from '../services/api';

/**
 * Folder selector page — browse ~/Projects and pick a project to open.
 *
 * Lists top-level project directories from `/api/browse` (defaults to the
 * backend's configured Projects root). Clicking a folder navigates to the
 * model-selection step by redirecting to `/models?folder=<path>`.
 *
 * SSR safety: `connectedCallback` guards `fetch` behind a client check so the
 * server render produces only the shell; the list populates after hydration.
 */
@customElement('page-home')
export class HomePage extends LitroPage {
  static styles = css`
    :host { display: block; min-height: 100vh; background: var(--bg-primary, #1a1b26); color: var(--text-primary, #c0caf5); }
    .container { max-width: 640px; margin: 0 auto; padding: 3rem 1.5rem; }
    h1 { font-size: 1.5rem; margin: 0 0 0.5rem; }
    .subtitle { color: var(--text-muted, #565f89); margin-bottom: 1.5rem; font-size: 0.9rem; }
    .search { width: 100%; box-sizing: border-box; padding: 0.65rem 0.85rem; border-radius: 6px;
      border: 1px solid var(--border-color, #3b4261); background: var(--bg-secondary, #16161e);
      color: inherit; font-size: 0.9rem; margin-bottom: 1rem; }
    .search:focus { outline: none; border-color: var(--text-secondary, #7aa2f7); }
    .folder-list { list-style: none; margin: 0; padding: 0; max-height: 60vh; overflow: auto; }
    .folder-item { display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0.75rem;
      border-radius: 6px; cursor: pointer; font-size: 0.9rem; }
    .folder-item:hover { background: var(--bg-hover, #292e42); }
    .folder-icon { color: var(--text-secondary, #7aa2f7); }
    .empty { color: var(--text-muted, #565f89); padding: 2rem 0; text-align: center; }
    .error { color: #f7768e; padding: 1rem; border-radius: 6px; background: rgba(247,118,142,0.08); }
  `;

  @state() private folders: Array<{ name: string; path: string }> = [];
  @state() private loading = false;
  @state() private error: string | null = null;
  @state() private search = '';

  connectedCallback() {
    super.connectedCallback();
    // Only fetch on the client — SSR render produces the shell only.
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

  render() {
    return html`
      <div class="container">
        <h1>Select Project Folder</h1>
        <p class="subtitle">Choose a project under ~/Projects to open a chat session.</p>
        <input
          class="search"
          type="text"
          placeholder="Search folders…"
          .value=${this.search}
          @input=${(e: Event) => (this.search = (e.target as HTMLInputElement).value)}
        />
        ${this.error
          ? html`<div class="error">${this.error}</div>`
          : this.loading
            ? html`<div class="empty">Loading folders…</div>`
            : this.filteredFolders.length === 0
              ? html`<div class="empty">No folders found.</div>`
              : html`
                  <ul class="folder-list">
                    ${this.filteredFolders.map(
                      (f) => html`
                        <li
                          class="folder-item"
                          @click=${() => this.openFolder(f.path)}
                          @keydown=${(e: KeyboardEvent) =>
                            (e.key === 'Enter' || e.key === ' ') && this.openFolder(f.path)}
                          tabindex="0"
                          role="button"
                        >
                          <span class="folder-icon">📁</span>
                          <span>${f.name}</span>
                        </li>
                      `,
                    )}
                  </ul>
                `}
      </div>
    `;
  }
}

export default HomePage;