/**
 * File type detection utility.
 *
 * Classifies a filename by extension into one of:
 * - markdown  → rendered with source/preview toggle
 * - image     → rendered inline via <img>
 * - code      → syntax highlighted via Prism
 * - binary    → cannot be previewed
 * - unknown   → fallback message
 */

export type FileType = 'markdown' | 'image' | 'code' | 'binary' | 'unknown';

export interface FileTypeInfo {
  type: FileType;
  /** Prism language identifier (only set when type === 'code') */
  language?: string;
}

/** Extension list → Prism language mapping. */
const CODE_LANGUAGES: Record<string, string> = {
  // JavaScript / TypeScript
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  mjs: 'javascript',
  cjs: 'javascript',
  // Python
  py: 'python',
  pyw: 'python',
  pyx: 'python',
  // HTML / CSS
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'css',
  sass: 'css',
  less: 'css',
  // JSON
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  // Shell
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'bash',
  // Rust
  rs: 'rust',
  // Go
  go: 'go',
  // TOML
  toml: 'toml',
  // YAML
  yml: 'yaml',
  yaml: 'yaml',
  // XML
  xml: 'xml',
  xsl: 'xml',
  xsd: 'xml',
  plist: 'xml',
  // SQL
  sql: 'sql',
  // C / C++
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cc: 'cpp',
  hh: 'cpp',
  // Java / Kotlin
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  // Ruby
  rb: 'ruby',
  gemspec: 'ruby',
  // Swift
  swift: 'swift',
  // Dart
  dart: 'dart',
  // PHP
  php: 'php',
  phtml: 'php',
  // C#
  cs: 'csharp',
  // Lua
  lua: 'lua',
  // R
  r: 'r',
  R: 'r',
  // Makefile
  Makefile: 'clike',
  makefile: 'clike',
  GNUmakefile: 'clike',
  // Diff
  diff: 'diff',
  patch: 'diff',
};

const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp',
]);

const BINARY_EXTENSIONS = new Set([
  'pdf', 'zip', 'tar', 'gz', 'tgz', 'exe', 'dylib', 'so', 'dmg', 'deb', 'rpm',
  'mp4', 'mov', 'avi', 'mkv', 'mp3', 'wav', 'ogg', 'flac',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
]);

const MARKDOWN_EXTENSIONS = new Set([
  'md', 'markdown', 'mdx',
]);

/**
 * Get the file extension (lowercased), or empty string if none.
 */
function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot <= 0) return '';
  return filename.slice(lastDot + 1).toLowerCase();
}

/**
 * Detect the type of a file based on its extension.
 */
export function detectFileType(filename: string): FileTypeInfo {
  if (!filename) return { type: 'unknown' };

  // Special-case Makefile (no extension, filename IS the extension)
  if (['Makefile', 'makefile', 'GNUmakefile'].includes(filename)) {
    return { type: 'code', language: 'clike' };
  }

  const ext = getExtension(filename);
  if (!ext) return { type: 'unknown' };

  if (MARKDOWN_EXTENSIONS.has(ext)) return { type: 'markdown' };
  if (IMAGE_EXTENSIONS.has(ext)) return { type: 'image' };
  if (BINARY_EXTENSIONS.has(ext)) return { type: 'binary' };

  const language = CODE_LANGUAGES[ext];
  if (language) return { type: 'code', language };

  return { type: 'unknown' };
}
