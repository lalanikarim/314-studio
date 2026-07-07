import { html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { LitroPage } from '@beatzball/litro/runtime';
import { SelectionStore } from '../lib/selection-store';
import { buttonStyles } from '../styles/shared';
import { fetchModels, fetchProjectInfo } from '../services/api.js';
import { createMinimalModel, extractProvider } from '../lib/model.js';
import type { Model } from '../types/index.js';

@customElement('page-workspace')
export class WorkspacePage extends LitroPage {
  static styles = [
    buttonStyles,
    css`
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
        gap: 4px;
      }
      .view-workspace__header-left { flex: 0 0 auto; }
      .view-workspace__header-center { flex: 1; justify-content: center; }
      .view-workspace__header-right { flex: 0 0 auto; gap: 4px; }
      /* Model selector — lives in light DOM so real clicks reach it
         (shadow-DOM-nested buttons lose real-click events to the host). */
      .view-workspace__model-selector {
        position: relative;
      }
      .view-workspace__model-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.375rem 0.75rem;
        background: var(--bg-hover);
        border: 1px solid var(--border);
        border-radius: 6px;
        color: var(--text-primary);
        font-size: 0.8125rem;
        font-weight: 500;
        font-family: inherit;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .view-workspace__model-btn:hover {
        background: var(--bg-active);
      }
      .view-workspace__model-dropdown {
        position: absolute;
        top: 100%;
        right: 0;
        margin-top: 0.25rem;
        min-width: 240px;
        max-height: 300px;
        overflow-y: auto;
        background: var(--bg-secondary);
        border: 1px solid var(--border);
        border-radius: 8px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
        z-index: 100;
      }
      .view-workspace__model-option {
        display: block;
        width: 100%;
        padding: 0.5rem 0.75rem;
        background: none;
        border: none;
        color: var(--text-primary);
        font-size: 0.8125rem;
        font-family: inherit;
        text-align: left;
        cursor: pointer;
        transition: background 0.15s ease;
      }
      .view-workspace__model-option:hover {
        background: var(--bg-hover);
      }
      .view-workspace__model-option--active {
        background: var(--accent);
        color: #fff;
      }
      .view-workspace__model-option--active:hover {
        background: var(--accent-hover);
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
    `,
  ];

  @state() sidebarCollapsed = false;
  @state() chatExpanded = false;
  @state() sessionId = '';
  @state() models: Model[] = [];
  @state() currentModel: Model | null = null;
  @state() modelDropdownOpen = false;

  readonly selectionStore = new SelectionStore();

  private async fetchSessionData() {
    if (!this.folderPath) return;

    try {
      // Read session_id from URL params
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        this.sessionId = params.get('session_id') || '';
      }

      // Fetch available models
      this.models = await fetchModels(this.sessionId || undefined);

      // If we have a session, get its current model from project info
      if (this.sessionId) {
        try {
          const info = await fetchProjectInfo(this.folderPath);
          const session = info.sessions?.find(
            (s) => s.session_id === this.sessionId
          );
          if (session?.model_id) {
            this.currentModel = createMinimalModel(
              session.model_id,
              extractProvider(session.model_id)
            );
          }
        } catch {
          // Ignore — chat-panel will get model from SSE state
        }
      }
    } catch (err) {
      console.error('Failed to fetch session data:', err);
    }
  }

  private handleSessionClose() {
    // Navigate back to home when session is closed
    window.location.href = '/';
  }

  private handleSessionDelete() {
    // Navigate back to home when session is deleted
    window.location.href = '/';
  }

  private handleModelSwitch(e: CustomEvent<Model>) {
    this.currentModel = e.detail;
  }

  private handleModelBtnClick() {
    this.modelDropdownOpen = !this.modelDropdownOpen;
  }

  private handleModelSelect(model: Model) {
    this.modelDropdownOpen = false;
    this.currentModel = model;
    // Forward to chat-panel to perform the actual switch (API + RPC)
    const cp = this.shadowRoot?.querySelector('chat-panel');
    if (cp && typeof (cp as any).handleSwitchModel === 'function') {
      (cp as any).handleSwitchModel(model);
    }
  }

  private handleOutsideModelClick = (e: Event) => {
    if (this.modelDropdownOpen && this._modelSelectorRef) {
      if (!this._modelSelectorRef.contains(e.target as Node)) {
        this.modelDropdownOpen = false;
      }
    }
  };

  private _modelSelectorRef: HTMLElement | null = null;

  connectedCallback() {
    super.connectedCallback();
    this.addController(this.selectionStore.controller(this));
    document.addEventListener('click', this.handleOutsideModelClick);
    this.fetchSessionData();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('click', this.handleOutsideModelClick);
  }

  private get folderPath(): string {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('folder') || '';
  }

  private renderModelDropdown() {
    if (this.models.length === 0) {
      return html`<div class="view-workspace__model-dropdown">
        <div style="padding: 0.75rem; text-align: center; color: var(--text-muted); font-size: 0.8125rem;">
          No models available
        </div>
      </div>`;
    }
    return html`
      <div class="view-workspace__model-dropdown">
        ${this.models.map(
          (model) => html`
            <button
              class="view-workspace__model-option ${this.currentModel?.id === model.id
                ? 'view-workspace__model-option--active'
                : ''}"
              @click=${() => this.handleModelSelect(model)}
            >
              <div style="font-weight: 500;">${model.name}</div>
              <div style="font-size: 0.75rem; opacity: 0.7; margin-top: 0.25rem;">
                ${model.provider} ${model.contextWindow > 0 ? `· ${model.contextWindow.toLocaleString()} ctx` : ''}
              </div>
            </button>
          `,
        )}
      </div>
    `;
  }

  private handleFileSelect(path: string) {
    // Only set selectedFile for files (not directories).
    // The tree-node component checks isDirectory before calling onSelect,
    // but the path format is the full path so we can't easily tell here.
    // We'll let file-preview attempt to load and handle errors.
    this.selectionStore.set(path);
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
            <div
              class="view-workspace__model-selector"
              .ref=${(el: HTMLElement | null) => { this._modelSelectorRef = el; }}
            >
              <button
                class="view-workspace__model-btn"
                @click=${this.handleModelBtnClick}
              >
                ${this.currentModel?.name || 'Select model'}
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="transition: transform 0.15s; ${this.modelDropdownOpen ? 'transform: rotate(180deg);' : ''}">
                  <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
              ${this.modelDropdownOpen ? this.renderModelDropdown() : ''}
            </div>
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
              @file-select=${(e: CustomEvent<string>) => this.handleFileSelect(e.detail)}
            ></project-tree>
          </div>

          <div class="view-workspace__preview ${this.chatExpanded ? 'view-workspace__preview--hidden' : ''}">
            <file-preview
              .projectPath=${projectRoot}
              .filePath=${this.selectionStore.path || ''}
            ></file-preview>
          </div>

          <div class="view-workspace__chat ${this.chatExpanded ? 'view-workspace__chat--expanded' : ''}">
            <chat-panel
              .sessionId=${this.sessionId}
              .models=${this.models}
              .currentModel=${this.currentModel}
              .projectPath=${this.folderPath}
              @session-close=${() => this.handleSessionClose()}
              @session-delete=${() => this.handleSessionDelete()}
              @model-switch=${(e: CustomEvent<Model>) => this.handleModelSwitch(e)}
            ></chat-panel>
          </div>
        </div>
      </div>
    `;
  }
}

export default WorkspacePage;
