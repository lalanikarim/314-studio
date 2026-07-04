import { defineEventHandler, setResponseHeader, getRequestURL } from 'h3';
import { createPageHandler } from '@beatzball/litro/runtime/create-page-handler.js';
import type { LitroRoute } from '@beatzball/litro';
import { routes, pageModules } from '#litro/page-manifest';

// Global <head> content injected into every SSR page shell. The theme stylesheet
// defines CSS custom properties on :root; because custom properties inherit
// through Shadow DOM boundaries, the variables resolve inside every Lit
// component's shadow root. host-page defaults (background, color, font) are set
// on :root so the initial paint matches before components hydrate.
const GLOBAL_HEAD = [
  '<link rel="stylesheet" href="/theme.css" />',
  '<link rel="preconnect" href="https://fonts.googleapis.com" />',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />',
  '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />',
].join('\n  ');

function matchRoute(
  pathname: string,
): { route: LitroRoute; params: Record<string, string> } | undefined {
  for (const route of routes) {
    if (route.isCatchAll) return { route, params: {} };

    if (!route.isDynamic) {
      if (pathname === route.path) return { route, params: {} };
      continue;
    }

    const regexStr =
      '^' +
      route.path
        .replace(/:([^/]+)\(\.\*\)\*/g, '(?<$1>.+)')
        .replace(/:([^/?]+)\?/g, '(?<$1>[^/]*)?')
        .replace(/:([^/]+)/g, '(?<$1>[^/]+)') +
      '$';

    try {
      const match = pathname.match(new RegExp(regexStr));
      if (match) return { route, params: (match.groups ?? {}) as Record<string, string> };
    } catch {
      // malformed pattern — skip
    }
  }
  return undefined;
}

export default defineEventHandler(async (event) => {
  const pathname = getRequestURL(event).pathname;
  const result = matchRoute(pathname);

  if (!result) {
    setResponseHeader(event, 'content-type', 'text/html; charset=utf-8');
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" /><title>404</title>${GLOBAL_HEAD}</head>
<body><h1>404 — Not Found</h1><p>No page matched <code>${pathname}</code>.</p></body>
</html>`;
  }

  const { route: matched, params } = result;
  event.context.params = { ...event.context.params, ...params };

  const pageModule = pageModules[matched.filePath] as
    | { routeMeta?: { head?: string; title?: string } }
    | undefined;
  const pageHead = pageModule?.routeMeta?.head ?? '';
  const mergedHead = pageHead ? `${GLOBAL_HEAD}\n  ${pageHead}` : GLOBAL_HEAD;

  const handler = createPageHandler({
    route: matched,
    pageModule: pageModules[matched.filePath],
    routeMeta: { head: mergedHead },
  });
  return handler(event);
});