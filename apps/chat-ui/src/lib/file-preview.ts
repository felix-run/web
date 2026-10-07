import type { BundledLanguage } from 'shiki';

/**
 * What the workspace's file preview may show, decided from the file's bytes.
 *
 * Images, PDFs, audio and video are recognised by their magic numbers, never by
 * extension: a name is whatever the agent typed, and the bytes are the only
 * thing that can say what a file is. Everything else is decoded as text, and a
 * NUL in the opening bytes still means binary (git uses the same tell) — an
 * archive drawn as replacement characters helps nobody.
 *
 * SVG is deliberately not media. It is markup that can carry script, so it is
 * shown as its source, as HTML is; neither is ever rendered in this origin.
 */
export type MediaKind = 'image' | 'pdf' | 'audio' | 'video';

export type Preview =
  | { kind: 'binary' }
  | { kind: 'media'; media: MediaKind; type: string; bytes: Uint8Array }
  | { kind: 'text'; text: string; lines: number; truncated: boolean };

/**
 * Past this the preview shows the head and says so. Highlighting is
 * synchronous per token run, and a 5 MB log froze the tab for seconds while
 * the operator only wanted to see what kind of file it was.
 */
export const PREVIEW_LIMIT = 200_000;

const SNIFF = 8_000;

/** A file's bytes as a preview: media when they say so, text otherwise. */
export function previewOfBytes(bytes: Uint8Array): Preview {
  const media = sniffMedia(bytes);
  if (media) return { kind: 'media', ...media, bytes };
  // Non-fatal, like `File.text()`: the NUL check below decides binary, not
  // whether every byte happened to be valid UTF-8.
  return previewOf(new TextDecoder().decode(bytes));
}

export function previewOf(text: string): Preview {
  if (text.slice(0, SNIFF).includes('\u0000')) return { kind: 'binary' };
  const truncated = text.length > PREVIEW_LIMIT;
  const shown = truncated
    ? text.slice(0, text.lastIndexOf('\n', PREVIEW_LIMIT) + 1 || PREVIEW_LIMIT)
    : text;
  return { kind: 'text', text: shown, lines: countLines(text), truncated };
}

function ascii(bytes: Uint8Array, at: number, tag: string): boolean {
  for (let i = 0; i < tag.length; i++) {
    if (bytes[at + i] !== tag.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * The media a file's opening bytes declare, or null. Only formats a browser
 * draws by itself are listed — recognising a HEIC or an AVI would only trade
 * "binary" for a player that cannot play it.
 */
export function sniffMedia(b: Uint8Array): { media: MediaKind; type: string } | null {
  if (b.length < 4) return null;
  if (b[0] === 0x89 && ascii(b, 1, 'PNG')) return { media: 'image', type: 'image/png' };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { media: 'image', type: 'image/jpeg' };
  }
  if (ascii(b, 0, 'GIF8')) return { media: 'image', type: 'image/gif' };
  if (ascii(b, 0, '%PDF-')) return { media: 'pdf', type: 'application/pdf' };
  if (ascii(b, 0, 'RIFF')) {
    if (ascii(b, 8, 'WEBP')) return { media: 'image', type: 'image/webp' };
    if (ascii(b, 8, 'WAVE')) return { media: 'audio', type: 'audio/wav' };
    return null;
  }
  if (ascii(b, 0, 'ID3')) return { media: 'audio', type: 'audio/mpeg' };
  if (isMpegFrame(b)) return { media: 'audio', type: 'audio/mpeg' };
  if (ascii(b, 0, 'OggS')) return { media: 'audio', type: 'audio/ogg' };
  if (ascii(b, 0, 'fLaC')) return { media: 'audio', type: 'audio/flac' };
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
    return { media: 'video', type: 'video/webm' };
  }
  // ISO base media: the brand after `ftyp` says which of the family this is.
  if (ascii(b, 4, 'ftyp')) {
    if (ascii(b, 8, 'M4A')) return { media: 'audio', type: 'audio/mp4' };
    if (ascii(b, 8, 'avif')) return { media: 'image', type: 'image/avif' };
    if (ascii(b, 8, 'qt  ')) return { media: 'video', type: 'video/quicktime' };
    if (ascii(b, 8, 'hei') || ascii(b, 8, 'mif1')) return null;
    return { media: 'video', type: 'video/mp4' };
  }
  return null;
}

/**
 * An MPEG audio frame with no ID3 tag in front: eleven set sync bits, then a
 * version and a layer that are not the reserved values. `FF FE` — a UTF-16
 * text file's byte-order mark — has the sync bits too, and is text.
 */
function isMpegFrame(b: Uint8Array): boolean {
  const b1 = b[1] ?? 0;
  if (b[0] !== 0xff || b1 === 0xfe || (b1 & 0xe0) !== 0xe0) return false;
  return ((b1 >> 3) & 3) !== 1 && ((b1 >> 1) & 3) !== 0;
}

/** Markdown that may be drawn rendered as well as as source. */
export function isMarkdown(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
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
