import { css } from 'lit';

/**
 * Shared button + icon-button styles, ported from `frontend/src/views/common.css`.
 *
 * Each Lit page renders in its own Shadow DOM, so these class names are
 * scoped per-page. Importing this `css` result into a page's `static styles`
 * array makes the `.btn` / `.icon-btn` families available there without
 * duplication. CSS custom properties (`--accent`, `--bg-secondary`, …) are
 * defined once in `public/theme.css` and inherit through the shadow boundary.
 */
export const buttonStyles = css`
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 8px 16px;
    border: 1px solid transparent;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 500;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
    background: var(--bg-hover);
    color: var(--text-secondary);
  }
  .btn:hover:not(:disabled) {
    background: var(--bg-active);
    color: var(--text-placeholder);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn--primary {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
  }
  .btn--primary:hover:not(:disabled) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }
  .btn--lg {
    padding: 12px 24px;
    font-size: 16px;
  }
  .btn--sm {
    padding: 4px;
    width: 24px;
    height: 24px;
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 6px;
    border-radius: 6px;
    transition: all 0.15s ease;
  }
  .icon-btn:hover {
    background: var(--border);
    color: var(--text-placeholder);
  }
  .icon-btn--active {
    color: var(--accent-light);
  }

  .view-models__back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: 14px;
    cursor: pointer;
    padding: 4px 0;
    font-family: inherit;
  }
  .view-models__back:hover {
    color: var(--text-placeholder);
  }

  /* Spinner used by the model selector loading state. */
  .view-models__spinner {
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
`;