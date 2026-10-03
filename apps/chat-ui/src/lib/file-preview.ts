import type { BundledLanguage } from 'shiki';

/**
 * What the workspace's file preview may show, decided from the text alone.
 *
 * Both stores hand back a string — the in-tab VFS never held anything else,
 * and a mounted folder's file is read with `File.text()` whatever it contains —
 * so an image or an archive arrives as a page of replacement characters. A NUL
 * in the opening bytes is the conventional tell (git uses the same one), and a
 * preview that says "binary" is more use than one that draws the noise.
 */
export type Preview =
  | { kind: 'binary' }
  | { kind: 'text'; text: string; lines: number; truncated: boolean };

/**
 * Past this the preview shows the head and says so. Highlighting is
 * synchronous per token run, and a 5 MB log froze the tab for seconds while
 * the operator only wanted to see what kind of file it was.
 */
export const PREVIEW_LIMIT = 200_000;

const SNIFF = 8_000;

export function previewOf(text: string): Preview {
  if (text.slice(0, SNIFF).includes('\u0000')) return { kind: 'binary' };
  const truncated = text.length > PREVIEW_LIMIT;
  const shown = truncated
    ? text.slice(0, text.lastIndexOf('\n', PREVIEW_LIMIT) + 1 || PREVIEW_LIMIT)
    : text;
  return { kind: 'text', text: shown, lines: countLines(text), truncated };
}

function countLines(text: string): number {
  if (!text) return 0;
  let n = 1;
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) n++;
  return text.endsWith('\n') ? n - 1 : n;
}

/**
 * A highlighter language for a path, or null to draw it as plain text.
 *
 * A short table rather than Shiki's whole language map: the map is a few
 * hundred dynamic imports in the entry chunk, and a language Shiki does not
 * have makes `createHighlighter` reject, which the code block does not catch.
 * Anything not here is shown unhighlighted, which is right for most of what
 * else lands in a workspace — notes, logs, data.
 */
const BY_EXTENSION: Record<string, BundledLanguage> = {
  ts: 'typescript',
  tsx: 'tsx',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'jsonc',
  md: 'markdown',
  mdx: 'mdx',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  sql: 'sql',
  html: 'html',
  css: 'css',
  scss: 'scss',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  svg: 'xml',
  graphql: 'graphql',
  dockerfile: 'docker',
};

export function languageFor(path: string): BundledLanguage | null {
  const name = path.split('/').pop()?.toLowerCase() ?? '';
  if (name === 'dockerfile') return 'docker';
  if (name === 'makefile') return 'make';
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  return BY_EXTENSION[name.slice(dot + 1)] ?? null;
}
