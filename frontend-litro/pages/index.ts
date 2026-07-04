import { html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { LitroPage } from 'litro/runtime';
import { fetchFolders } from '../services/api';
import type { Folder } from '../types';

@customElement('page-index')
export class FolderSelectorPage extends LitroPage {
  @state() folders: Folder[] = [];
  @state() loading = false;
  @state() error: string | null = null;

  async connectedCallback() {
    super.connectedCallback();
    await this.loadFolders();
  }

  private async loadFolders() {
    this.loading = true;
    this.error = null;
    try {
      this.folders = await fetchFolders();
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load folders';
    } finally {
      this.loading = false;
    }
  }

  render() {
    if (this.loading) {
      return html`<div class="loading">Loading folders...</div>`;
    }

    if (this.error) {
      return html`<div class="error">${this.error}</div>`;
    }

    return html`
      <div class="folder-selector">
        <h1>Select Project Folder</h1>
        <ul class="folder-list">
          ${this.folders.map(
            (folder) => html`
              <li>
                <a href="/models?folder=${encodeURIComponent(folder.path)}">
                  ${folder.name}
                </a>
              </li>
            `
          )}
        </ul>
      </div>
    `;
  }
}

export default FolderSelectorPage;
