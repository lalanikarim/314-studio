import { marked } from 'marked';

marked.use({ gfm: true });

/**
 * Render markdown source to an HTML string.
 *
 * GFM is enabled (tables, code blocks, strikethrough, task lists).
 * The returned string is safe for binding via `unsafeHTML` in Lit.
 *
 * Source is trusted (Pi agent output, closed Shadow DOM).
 * For stricter sanitization later, wrap output with DOMPurify.
 *
 * @param source Markdown source string
 * @returns HTML string
 */
export function renderMarkdown(source: string): string {
  if (!source) return '';
  return marked.parse(source, { async: false }) as string;
}
