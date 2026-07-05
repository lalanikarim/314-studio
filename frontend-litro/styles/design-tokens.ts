import { css } from 'lit';

/**
 * Design tokens — shared animation keyframes, utility classes, and cross-cutting
 * styles that cut across components and pages.
 *
 * Import into any component's `static styles` array to make these available
 * in that component's shadow root. `@keyframes` in Lit are scoped per shadow
 * root, so each importer gets its own copy — that is the desired behavior.
 */
export const designTokens = css`
  /* ── Spinner animation ──────────────────────────────────────────────── */
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .spinner {
    display: inline-block;
    width: 16px;
    height: 16px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
    vertical-align: middle;
  }
  .spinner--sm {
    width: 12px;
    height: 12px;
  }

  /* ── Highlight / mark ───────────────────────────────────────────────── */
  .highlight-mark {
    background: rgba(59, 130, 246, 0.3);
    border-radius: 2px;
    padding: 0 1px;
    color: var(--text-placeholder);
  }

  /* ── Empty-state utility ────────────────────────────────────────────── */
  .empty {
    padding: 1rem;
    color: var(--text-muted);
    font-size: 0.875rem;
    text-align: center;
  }

  /* ── Loading utility ────────────────────────────────────────────────── */
  .loading {
    padding: 1rem;
    color: var(--text-muted);
    font-size: 0.875rem;
  }
`;
