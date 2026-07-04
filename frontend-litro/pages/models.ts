import { html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { LitroPage } from '@beatzball/litro/runtime';
import { fetchModels, createSession, SSEClient } from '../services/api';
import type { Model } from '../types';

@customElement('page-models')
export class ModelSelectorPage extends LitroPage {
  @state() models: Model[] = [];
  @state() loading = false;
  @state() error: string | null = null;
  @state() selectedModel: Model | null = null;
  @state() search = '';
  @state() selectedProviders: string[] = [];
  @state() switching = false;
  @state() sessionId: string | null = null;

  private sseClient: SSEClient | null = null;

  connectedCallback() {
    super.connectedCallback();
    this.loadModels();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.sseClient?.close();
  }

  private get folderPath(): string {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('folder') || '';
  }

  private async loadModels() {
    this.loading = true;
    this.error = null;
    try {
      // Fetch models without session first (cached list)
      this.models = await fetchModels();
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load models';
    } finally {
      this.loading = false;
    }
  }

  private get providers(): string[] {
    const providerSet = new Set(this.models.map((m) => m.provider));
    return Array.from(providerSet).sort();
  }

  private toggleProvider(provider: string) {
    this.selectedProviders = this.selectedProviders.includes(provider)
      ? this.selectedProviders.filter((p) => p !== provider)
      : [...this.selectedProviders, provider];
  }

  private get filteredModels(): Model[] {
    let result = this.models;

    if (this.selectedProviders.length > 0) {
      result = result.filter((m) => this.selectedProviders.includes(m.provider));
    }

    if (this.search.trim()) {
      const q = this.search.toLowerCase();
      result = result.filter((m) => m.id.toLowerCase().includes(q));
    }

    return result;
  }

  private get hasActiveFilters(): boolean {
    return (
      this.search.trim() ||
      (this.selectedProviders.length > 0 &&
        this.selectedProviders.length < this.providers.length)
    );
  }

  private clearFilters() {
    this.search = '';
    this.selectedProviders = [...this.providers];
  }

  private highlightMatch(text: string, search: string): string {
    if (!search.trim()) return text;
    const q = search.toLowerCase();
    const idx = text.toLowerCase().indexOf(q);
    if (idx < 0) return text;
    return `${text.slice(0, idx)}<mark class="view-models__mark">${text.slice(idx, idx + search.length)}</mark>${text.slice(idx + search.length)}`;
  }

  private async handleSwitch() {
    if (!this.selectedModel || !this.folderPath) return;
    this.switching = true;
    try {
      // Create session with the selected model
      const session = await createSession(this.folderPath, this.selectedModel.id);
      this.sessionId = session.session_id;

      // Navigate to workspace
      window.location.href = `/workspace?session_id=${encodeURIComponent(this.sessionId)}`;
    } catch (e) {
      console.error('Failed to switch model:', e);
      this.error = e instanceof Error ? e.message : 'Failed to switch model';
    } finally {
      this.switching = false;
    }
  }

  render() {
    return html`
      <div class="view-models">
        <div class="view-models__inner">
          <div class="view-models__header">
            <button class="view-models__back" @click=${() => (window.location.href = '/')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              Back
            </button>
            <h1>Choose a Model</h1>
            <button class="view-models__refresh" @click=${this.loadModels} disabled=${this.loading} title="Refresh model list">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                <path d="M4 4v5h5" />
                <path d="M20 20v-5h-5" />
                <path d="M20.49 9A9 9 0 0 0 5.64 5.64L4 4" />
                <path d="M3.51 15a9 9 0 0 0 14.85 3.36L20 20" />
              </svg>
              Refresh
            </button>
            <p class="view-models__project">
              Project: ${this.folderPath.split('/').filter(Boolean).pop()}
            </p>
          </div>

          <div class="view-models__search">
            <svg class="view-models__search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder="Search models…"
              .value=${this.search}
              @input=${(e: Event) => {
                this.search = (e.target as HTMLInputElement).value;
              }}
            />
          </div>

          ${!this.loading && this.providers.length > 0 ? html`
            <div class="view-models__providers">
              ${this.providers.map((provider) => html`
                <button
                  key=${provider}
                  class="view-models__provider-btn ${this.selectedProviders.includes(provider) ? 'view-models__provider-btn--active' : ''}"
                  @click=${() => this.toggleProvider(provider)}
                >
                  ${provider}
                  <span class="view-models__provider-count">
                    ${this.models.filter((m) => m.provider === provider).length}
                  </span>
                </button>
              `)}
              ${this.hasActiveFilters ? html`
                <button class="view-models__clear-btn" @click=${this.clearFilters} title="Clear all filters">
                  ✕
                </button>
              ` : ''}
            </div>
          ` : ''}

          ${this.loading ? html`
            <div class="view-models__loading">
              <svg class="view-models__spinner" viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
              <p>${this.error || 'Fetching models...'}</p>
            </div>
          ` : html`
            ${this.error ? html`<p class="view-models__error">${this.error}</p>` : ''}
            <div class="view-models__list">
              ${this.filteredModels.map((model) => html`
                <div
                  key=${model.provider}:${model.id}
                  class="view-models__card ${this.selectedModel?.id === model.id ? 'view-models__card--selected' : ''}"
                  @click=${() => {
                    this.selectedModel = model;
                  }}
                >
                  <div class="view-models__card-header">
                    <div class="view-models__card-name" innerHTML=${this.highlightMatch(model.id, this.search)}></div>
                    ${this.selectedModel?.id === model.id ? html`
                      <span class="view-models__badge">Selected</span>
                    ` : ''}
                  </div>
                  <div class="view-models__card-meta">
                    <span>${model.provider}</span>
                    ${model.contextWindow > 0 ? html`
                      <span class="view-models__divider">&middot;</span>
                      <span>${model.contextWindow.toLocaleString()} context</span>
                    ` : ''}
                  </div>
                </div>
              `)}
              ${this.filteredModels.length === 0 && this.models.length > 0 ? html`
                <div class="view-models__empty">No matching models</div>
              ` : ''}
            </div>

            <div class="view-models__actions">
              <button
                class="btn btn--primary btn--lg"
                ?disabled=${!this.selectedModel || this.switching}
                @click=${this.handleSwitch}
              >
                ${this.switching ? 'Switching...' : 'Switch Model & Open'}
              </button>
            </div>
          `}
        </div>
      </div>
    `;
  }
}

export default ModelSelectorPage;
