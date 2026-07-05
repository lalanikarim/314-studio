/**
 * Shared formatting helpers used across pages and components.
 * Extracted from pages/index.ts to eliminate duplication.
 */

/** Format an ISO datetime string to locale date + time. */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  const datePart = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const timePart = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${datePart} ${timePart}`;
}

/** Extract the project name (last path segment) from a project path. */
export function getProjectName(projectPath: string): string {
  const parts = projectPath.split('/').filter(Boolean);
  return parts[parts.length - 1] || projectPath;
}

/** Extract a display name from a model ID string. */
export function getModelName(modelId: string | null): string {
  if (!modelId) return '—';
  return modelId;
}
