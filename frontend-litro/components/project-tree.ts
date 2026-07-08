import { html, css, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import { listFiles } from '../services/api';
import { buttonStyles } from '../styles/shared';
import { designTokens } from '../styles/design-tokens';
import type { TreeNodeData } from '../types/tree';

// ---------------------------------------------------------------------------
// File extension icon helper
// ---------------------------------------------------------------------------

function getFileExtensionIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (!ext) return '📄';
  const iconMap: Record<string, string> = {
    ts: 'TS', tsx: 'TS', js: 'JS', jsx: 'JS',
    py: 'Py', md: 'Md', toml: 'T', json: '{}',
    css: '#', html: '<>', gitignore: '.', lock: '🔒',
    png: '🖼', env: '⚙', sh: '⚡', yaml: 'Y', yml: 'Y',
    sql: 'DB', rs: '🦀', go: '🔵',
  };
  return iconMap[ext] || '📄';
}

// ---------------------------------------------------------------------------
// TreeNode — recursive custom element
// ---------------------------------------------------------------------------

@customElement('tree-node')
export class TreeNodeComponent extends LitElement {
  static styles = [
    designTokens,
    css`
      :host {
        display: block;
      }
      .tree-node__row {
        display: flex;
        align-items: center;
        padding: 4px 8px;
        cursor: pointer;
        user-select: none;
        font-size: 0.875rem;
        color: var(--text-primary, #c0caf5);
        transition: background 0.15s;
      }
      .tree-node__row:hover {
        background: var(--bg-hover, #292e42);
      }
      .tree-node__row--selected {
        background: var(--selected-bg, #1e3a5f);
      }
      .tree-node__icon {
        display: flex;
        align-items: center;
        margin-right: 6px;
        width: 16px;
        flex-shrink: 0;
      }
      .tree-node__icon svg {
        width: 14px;
        height: 14px;
      }
      .tree-node__file-icon {
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--text-secondary, #a9b1d6);
      }
      .tree-node__name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .tree-node__toggle {
        display: flex;
        align-items: center;
        margin-left: 4px;
        opacity: 0.5;
      }
      .tree-node__toggle svg {
        width: 12px;
        height: 12px;
      }
      .tree-node__children {
        display: block;
      }
      .tree-node__empty {
        padding: 4px 8px 4px 32px;
        font-size: 0.8rem;
        color: var(--text-muted, #565f89);
      }
    `,
  ];

  static properties = {
    node: { type: Object },
    depth: { type: Number },
    selectedPath: { type: String },
    projectRoot: { type: String },
    expanded: { type: Boolean },
    children: { type: Array },
    loading: { type: Boolean },
  };

  node: TreeNodeData = { name: '', path: '', isDirectory: false, children: [] };
  depth = 0;
  selectedPath = '';
  projectRoot = '';

  expanded = false;
  children: TreeNodeData[] = [];
  loading = false;

  private fetchCalled = false;

  firstUpdated() {
    // Auto-expand root directory nodes so folder contents load immediately.
    if (this.depth === 0 && this.node?.isDirectory) {
      this.expanded = true;
    }
  }

  updated(changedProperties: Map<string, any>) {
    if (changedProperties.has('expanded') && this.expanded && !this.fetchCalled) {
      this.fetchCalled = true;
      this.loadChildren();
    } else if (!this.expanded) {
      this.fetchCalled = false;
    }
  }

  private async loadChildren() {
    if (!this.projectRoot) return;
    this.loading = true;
    try {
      const items = await listFiles(this.projectRoot, this.node.path);
      this.children = items.map((item: any) => {
        const parentPath = this.node.path;
        const itemName = item.path.split('/').pop() || item.path;
        const childPath = parentPath ? `${parentPath}/${item.path}` : item.path;
        return {
          name: itemName,
          path: childPath,
          isDirectory: item.isDirectory,
          children: [],
        };
      });
    } catch {
      this.children = [];
    } finally {
      this.loading = false;
    }
  }

  private handleClick(e: Event) {
    e.stopPropagation();
    if (this.node.isDirectory) {
      this.expanded = !this.expanded;
    } else {
      this.dispatchEvent(new CustomEvent('file-select', {
        detail: this.node.path,
        bubbles: true,
        composed: true,
      }));
    }
  }

  render() {
    const isSelected = this.selectedPath === this.node.path;
    const icon = this.node.isDirectory
      ? html`<span class="tree-node__icon">
          <svg viewBox="0 0 24 24" fill="currentColor" style="opacity: ${this.expanded ? 1 : 0.6}">
            <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />
          </svg>
        </span>`
      : html`<span class="tree-node__icon"><span class="tree-node__file-icon">${getFileExtensionIcon(this.node.name)}</span></span>`;

    return html`
      <div class="tree-node__row ${isSelected ? 'tree-node__row--selected' : ''}" style="padding-left: ${this.depth * 16 + 8}px" @click=${this.handleClick}>
        ${icon}
        <span class="tree-node__name">${this.node.name}</span>
        ${this.node.isDirectory ? html`
          <span class="tree-node__toggle">
            ${this.loading
              ? html`<span class="spinner spinner--sm"></span>`
              : html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="${this.expanded ? 'M6 9l6 6 6-6' : 'M9 5l7 7-7 7'}" />
                </svg>`
            }
          </span>
        ` : ''}
      </div>
      ${this.expanded ? html`
        <div class="tree-node__children">
          ${this.children.length === 0 && !this.loading
            ? html`<div class="tree-node__empty">Empty</div>`
            : ''
          }
          ${this.children.map((child) => html`
            <tree-node
              .node=${child}
              .depth=${this.depth + 1}
              .selectedPath=${this.selectedPath}
              .projectRoot=${this.projectRoot}
            ></tree-node>
          `)}
        </div>
      ` : ''}
    `;
  }
}

// ---------------------------------------------------------------------------
// ProjectTree — root component
// ---------------------------------------------------------------------------

@customElement('project-tree')
export class ProjectTreeComponent extends LitElement {
  static styles = [
    buttonStyles,
    designTokens,
    css`
      :host {
        display: block;
        height: 100%;
        background: var(--bg-secondary, #16161e);
      }
    `,
  ];

  static properties = {
    projectPath: { type: String },
    selectedFile: { type: String },
  };
  projectPath = '';
  selectedFile = '';

  roots: TreeNodeData[] = [];
  loading = false;

  private folderFetched = false;
  private firstUpdate = true;

  updated(changedProperties: Map<string, any>) {
    // Load roots on first update when projectPath is available.
    if (this.firstUpdate && this.projectPath) {
      this.firstUpdate = false;
      this.folderFetched = true;
      this.loadRoots();
      return;
    }
  }

  private async loadRoots() {
    if (!this.projectPath) return;
    this.loading = true;
    try {
      const items = await listFiles(this.projectPath, '');
      this.roots = items.map((item: any) => ({
        name: item.path.split('/').pop() || item.path,
        path: item.path,
        isDirectory: item.isDirectory,
        children: [],
      }));
    } catch {
      this.roots = [];
    } finally {
      this.loading = false;
    }
  }

  render() {
    return html`
      <div class="panel">
        <div class="panel__header">
          <span>Explorer</span>
          <button class="btn btn--sm" @click=${this.loadRoots} ?disabled=${this.loading} title="Refresh">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <path d="M4 4v5h5" /><path d="M20 20v-5h-5" />
              <path d="M20.49 9A9 9 0 0 0 5.64 5.64L4 10m16 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
            </svg>
          </button>
          ${!this.loading ? html`<span class="panel__count">${this.roots.length} items</span>` : ''}
        </div>
        <div class="panel__content">
          ${this.loading ? html`<div class="loading">Loading project files…</div>` : ''}
          ${!this.loading && this.roots.length === 0 ? html`<div class="empty">No files found</div>` : ''}
          ${this.roots.map((node) => html`
            <tree-node
              .node=${node}
              .depth=${0}
              .selectedPath=${this.selectedFile}
              .projectRoot=${this.projectPath}
            ></tree-node>
          `)}
        </div>
      </div>
    `;
  }
}
