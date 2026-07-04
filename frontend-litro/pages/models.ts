import { html, css, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { LitroPage } from '@beatzball/litro/runtime';
import { fetchModels, createSession } from '../services/api';
import { buttonStyles } from '../styles/shared';
import type { Model } from '../types';

/**
 * Model selector page — pick an AI model for a new session, then create the
 * session and navigate to the workspace.
 *
 * Styling: the `view-models__*` BEM rules are ported verbatim from the React
 * frontend's `views.css`. They live in this page's Shadow DOM so the class
 * names are scoped here. `buttonStyles` (the `.btn` family) is shared via the
 * `styles/shared.ts` module and composed into `static styles`.
 */
@customElement('page-models')
export class ModelSelectorPage extends LitroPage {
  static styles = [
    buttonStyles,
    css`
      :host {
        display: block;
        min-height: 100vh;
        background: var(--bg-primary);
      }
      .view-models {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        padding: 40px 20px;
      }
      .view-models__inner {
        width: 100%;
        max-width: 560px;
      }
      .view-models__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 24px;
      }
      .view-models__header h1 {
        font-size: 28px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0;
      }
      .view-models__refresh {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 8px 14px;
        background: var(--bg-secondary);
        border: 1px solid var(--border);
        border-radius: 6px;
        color: var(--text-secondary);
        font-size: 13px;
        font-family: inherit;
        cursor: pointer;
        transition: all 0.15s;
        flex-shrink: 0;
      }
      .view-models__refresh:hover:not(:disabled) {
        background: var(--border);
        border-color: var(--border-light);
        color: var(--text-placeholder);
      }
      .view-models__refresh:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .view-models__refresh svg {
        width: 16px;
        height: 16px;
      }
      .view-models__project {
        font-size: 14px;
        color: var(--text-muted);
        margin: 0 0 4px;
      }

      .view-models__search {
        position: relative;
        margin-bottom: 16px;
        margin-top: 12px;
      }
      .view-models__search input {
        width: 100%;
        padding: 10px 16px 10px 40px;
        box-sizing: border-box;
        background: var(--bg-secondary);
        border: 1px solid var(--border);
        border-radius: 6px;
        color: var(--text-placeholder);
        font-size: 14px;
        font-family: inherit;
        outline: none;
        transition: border-color 0.15s;
      }
      .view-models__search input::placeholder {
        color: var(--text-muted);
      }
      .view-models__search input:focus {
        border-color: var(--accent);
      }
      .view-models__search-icon {
        position: absolute;
        left: 12px;
        top: 50%;
        transform: translateY(-50%);
        width: 16px;
        height: 16px;
        color: var(--text-muted);
        pointer-events: none;
      }

      .view-models__providers {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 12px;
        margin-bottom: 20px;
        align-items: center;
      }
      .view-models__provider-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        background: var(--bg-secondary);
        border: 1px solid var(--border);
        border-radius: 16px;
        color: var(--text-secondary);
        font-size: 13px;
        font-family: inherit;
        cursor: pointer;
        transition: all 0.15s ease;
        user-select: none;
      }
      .view-models__provider-btn:hover {
        background: var(--border);
        border-color: var(--border-light);
      }
      .view-models__provider-btn--active {
        background: var(--selected-bg);
        border-color: var(--accent);
        color: var(--text-placeholder);
      }
      .view-models__provider-btn--active:hover {
        background: var(--selected-border);
      }
      .view-models__provider-count {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 18px;
        height: 18px;
        padding: 0 6px;
        background: rgba(148, 163, 184, 0.2);
        border-radius: 9px;
        font-size: 11px;
        font-weight: 600;
      }
      .view-models__provider-btn--active .view-models__provider-count {
        background: rgba(255, 255, 255, 0.2);
      }
      .view-models__clear-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        background: transparent;
        border: 1px solid var(--border-light);
        border-radius: 50%;
        color: var(--text-secondary);
        font-size: 12px;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .view-models__clear-btn:hover {
        background: var(--danger-border);
        border-color: var(--danger-border);
        color: white;
      }

      .view-models__list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 32px;
      }
      .view-models__card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px;
        background: var(--bg-secondary);
        border: 1px solid var(--border);
        border-radius: 10px;
        cursor: pointer;
        transition: all 0.15s;
      }
      .view-models__card:hover {
        background: var(--bg-tertiary);
        border-color: var(--border-light);
      }
      .view-models__card--selected {
        border-color: var(--accent);
        background: rgba(59, 130, 246, 0.08);
      }
      .view-models__card-header {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .view-models__card-name {
        font-size: 15px;
        font-weight: 600;
        color: var(--text-primary);
      }
      .view-models__mark {
        background: rgba(59, 130, 246, 0.3);
        border-radius: 2px;
        padding: 0 1px;
        color: var(--text-placeholder);
      }
      .view-models__badge {
        display: inline-block;
        padding: 2px 8px;
        background: var(--accent);
        color: #fff;
        border-radius: 10px;
        font-size: 11px;
        font-weight: 600;
      }
      .view-models__card-meta {
        font-size: 13px;
        color: var(--text-secondary);
      }
      .view-models__divider {
        margin: 0 6px;
      }

      .view-models__loading,
      .view-models__error,
      .view-models__empty {
        text-align: center;
        padding: 24px;
        color: var(--text-secondary);
        font-size: 14px;
      }
      .view-models__error {
        color: var(--danger);
      }
      .view-models__empty {
        color: var(--text-muted);
        font-size: 15px;
      }
      .view-models__loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
      }

      .view-models__actions {
        display: flex;
        justify-content: center;
      }
    `,
  ];

  @state() models: Model[] = [];
  @state() loading = false;
  @state() error: string | null = null;
  @state() selectedModel: Model | null = null;
  @state() search = '';
  @state() selectedProviders: string[] = [];
  @state() switching = false;

  connectedCallback() {
    super.connectedCallback();
    if (typeof window !== 'undefined') this.loadModels();
  }

  private get folderPath(): string {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('folder') || '';
  }

  private async loadModels() {
    this.loading = true;
    this.error = null;
    try {
      this.models = await fetchModels();
      // Default: every provider selected so all models show initially.
      this.selectedProviders = [...this.providers];
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
      !!this.search.trim() ||
      (this.selectedProviders.length > 0 &&
        this.selectedProviders.length < this.providers.length)
    );
  }

  private toggleProvider(provider: string) {
    this.selectedProviders = this.selectedProviders.includes(provider)
      ? this.selectedProviders.filter((p) => p !== provider)
      : [...this.selectedProviders, provider];
  }

  private clearFilters() {
    this.search = '';
    this.selectedProviders = [...this.providers];
  }

  /**
   * Render the model id with the matched search substring wrapped in <mark>.
   * Returns a Lit TemplateResult (not an HTML string) so Lit's templating
   * handles the <mark> safely — no `innerHTML` / `unsafeHTML` needed.
   */
  private highlightMatch(text: string): TemplateResult {
    const search = this.search.trim();
    if (!search) return html`${text}`;
    const q = search.toLowerCase();
    const idx = text.toLowerCase().indexOf(q);
    if (idx < 0) return html`${text}`;
    return html`${text.slice(0, idx)}<mark class="view-models__mark">${text.slice(
      idx,
      idx + search.length,
    )}</mark>${text.slice(idx + search.length)}`;
  }

  private async handleSwitch() {
    if (!this.selectedModel || !this.folderPath || this.switching) return;
    this.switching = true;
    try {
      const session = await createSession(this.folderPath, this.selectedModel.id);
      window.location.href = `/workspace?session_id=${encodeURIComponent(session.session_id)}`;
    } catch (e) {
      console.error('Failed to switch model:', e);
      this.error = e instanceof Error ? e.message : 'Failed to switch model';
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
            <button class="view-models__refresh" ?disabled=${this.loading} @click=${this.loadModels} title="Refresh model list">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M4 4v5h5" />
                <path d="M20 20v-5h-5" />
                <path d="M20.49 9A9 9 0 0 0 5.64 5.64L4 4" />
                <path d="M3.51 15a9 9 0 0 0 14.85 3.36L20 20" />
              </svg>
              Refresh
            </button>
          </div>
          <p class="view-models__project">
            Project: ${this.folderPath.split('/').filter(Boolean).pop() ?? ''}
          </p>

          <div class="view-models__search">
            <svg class="view-models__search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder="Search models…"
              .value=${this.search}
              @input=${(e: Event) => (this.search = (e.target as HTMLInputElement).value)}
            />
          </div>

          ${!this.loading && this.providers.length > 0
            ? html`
                <div class="view-models__providers">
                  ${this.providers.map(
                    (provider) => html`
                      <button
                        class="view-models__provider-btn ${this.selectedProviders.includes(provider)
                          ? 'view-models__provider-btn--active'
                          : ''}"
                        @click=${() => this.toggleProvider(provider)}
                      >
                        ${provider}
                        <span class="view-models__provider-count">
                          ${this.models.filter((m) => m.provider === provider).length}
                        </span>
                      </button>
                    `,
                  )}
                  ${this.hasActiveFilters
                    ? html`<button class="view-models__clear-btn" @click=${this.clearFilters} title="Clear all filters">✕</button>`
                    : ''}
                </div>
              `
            : ''}

          ${this.loading
            ? html`
                <div class="view-models__loading">
                  <svg class="view-models__spinner" viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                  </svg>
                  <p>Fetching models…</p>
                </div>
              `
            : html`
                ${this.error
                  ? html`<p class="view-models__error">${this.error}</p>`
                  : html`
                      <div class="view-models__list">
                        ${this.filteredModels.map(
                          (model) => html`
                            <div
                              class="view-models__card ${this.selectedModel?.id === model.id
                                ? 'view-models__card--selected'
                                : ''}"
                              @click=${() => (this.selectedModel = model)}
                            >
                              <div class="view-models__card-header">
                                <div class="view-models__card-name">${this.highlightMatch(model.id)}</div>
                                ${this.selectedModel?.id === model.id
                                  ? html`<span class="view-models__badge">Selected</span>`
                                  : ''}
                              </div>
                              <div class="view-models__card-meta">
                                <span>${model.provider}</span>
                                ${model.contextWindow > 0
                                  ? html`<span class="view-models__divider">·</span>
                                      <span>${model.contextWindow.toLocaleString()} ctx</span>`
                                  : ''}
                              </div>
                            </div>
                          `,
                        )}
                        ${this.filteredModels.length === 0 && this.models.length > 0
                          ? html`<div class="view-models__empty">No matching models</div>`
                          : ''}
                      </div>

                      <div class="view-models__actions">
                        <button
                          class="btn btn--primary btn--lg"
                          ?disabled=${!this.selectedModel || this.switching}
                          @click=${this.handleSwitch}
                        >
                          ${this.switching ? 'Switching…' : 'Switch Model & Open'}
                        </button>
                      </div>
                    `}
              `}
        </div>
      </div>
    `;
  }
}

export default ModelSelectorPage;