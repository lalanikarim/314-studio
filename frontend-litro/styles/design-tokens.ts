import { css } from 'lit';

/**
 * Design tokens — shared animation keyframes, utility classes, panel
 * primitives, and font-size helpers that cut across components and pages.
 *
 * Import into any component's `static styles` array to make these available
 * in that component's shadow root. `@keyframes` in Lit are scoped per shadow
 * root, so each importer gets its own copy — that is the desired behavior.
 *
 * This is the **single source of truth** for:
 *   - Spinner animation + `.spinner` / `.spinner--sm`
 *   - `.view-models__spinner` (model-selector loading state)
 *   - Panel layout primitives: `.panel`, `.panel__header`, `.panel__count`, `.panel__content`
 *   - Highlight mark: `.highlight-mark`
 *   - Empty / loading utilities: `.empty`, `.loading`
 *   - Font-size helpers: `.text-xs`, `.text-sm`, `.text-base`, `.text-lg`
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

  /* ── Model selector spinner ─────────────────────────────────────────── */
  .view-models__spinner {
    animation: spin 0.8s linear infinite;
  }

  /* ── Panel layout primitives ────────────────────────────────────────── */
  .panel {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .panel__header {
    display: flex;
    align-items: center;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--border, #334155);
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-secondary, #a9b1d6);
  }
  .panel__header span {
    flex: 1;
  }
  .panel__count {
    font-size: 0.75rem;
    font-weight: 400;
    color: var(--text-muted, #565f89);
  }
  .panel__content {
    flex: 1;
    overflow: auto;
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

  /* ── Font-size helpers ──────────────────────────────────────────────── */
  .text-xs  { font-size: 0.75rem; }
  .text-sm  { font-size: 0.875rem; }
  .text-base { font-size: 14px; }
  .text-lg  { font-size: 16px; }
`;
