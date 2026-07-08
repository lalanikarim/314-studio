import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  breaks: false,
});

/**
 * Render markdown source to an HTML string.
 *
 * GFM is enabled by default (tables, strikethrough).
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
  return md.render(source);
}
