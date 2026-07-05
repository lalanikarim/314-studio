import { html, css, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import type { SessionItem } from '../services/api';

// ---------------------------------------------------------------------------
// SessionRow — single session list item in the Sessions tab
// ---------------------------------------------------------------------------

@customElement('session-row')
export class SessionRow extends LitElement {
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
