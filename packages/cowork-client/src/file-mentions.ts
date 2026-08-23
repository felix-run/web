/**
 * Finding file names in prose.
 *
 * Agents name files constantly, and almost never as full paths — "I rewrote
 * `check.js`", "see notes/todo.md", "App.tsx:42". Those names are the most
 * clickable thing in a transcript and today they are inert text.
 *
 * This is the first half of making them live: it extracts CANDIDATES. It
 * deliberately cannot tell you whether a candidate exists — that answer lives in
 * the filesystem and arrives asynchronously (see `file-mention-resolver.ts`).
 * The split matters because the two halves have opposite failure costs. A
 * missed candidate is a link the reader never gets. A false candidate is free,
 * as long as nothing downstream renders it before the filesystem confirms it.
 * So the heuristic here leans permissive, and verification is what makes that
 * safe.
 *
 * What it will NOT emit, because these are the false positives that would
 * otherwise reach the resolver on every message:
 *
 *   - Sentence enders: "done." and "e.g." are not files.
 *   - Version numbers and decimals: `1.2.3`, `3.14`.
 *   - Hosts, bare or with a path: `example.com`, `docs.google.com/foo`.
 *   - Words that end in something extension-shaped: `built.in`, `and so.`
 */

/** A file name found in prose, with the span it occupies in the source text. */
export interface FileMention {
  /** The matched text exactly as it appeared, `:line` suffix included. */
  raw: string;
  /** The path alone, with any trailing `:line[:col]` removed. */
  path: string;
  /** 1-based line number from a `path:42` suffix, when present. */
  line?: number;
  /** Start offset in the source string (inclusive). */
  start: number;
  /** End offset in the source string (exclusive). */
  end: number;
}

/**
 * Extensions that read as English words and end sentences far more often than
 * they name files. `.so` and `.in` are real extensions, but "and so." and
 * "built.in" cost more than they return.
 */
const WORDY_EXTENSIONS = new Set([
  'am',
  'an',
  'as',
  'at',
  'be',
  'by',
  'do',
  'go',
  'if',
  'in',
  'is',
  'it',
  'me',
  'my',
  'no',
  'of',
  'ok',
  'on',
  'or',
  'so',
  'to',
  'up',
  'us',
  'we',
]);

/**
 * Labels that make a first segment a hostname rather than a file.
 *
 * `sh` is pointedly absent despite being a TLD: shell scripts are named that
 * way constantly and `sh.ly`-style hosts are vanishingly rare in a transcript.
 * Where a TLD doubles as a real extension, the extension wins.
 */
const TLD_LIKE = new Set([
  'ai',
  'app',
  'co',
  'com',
  'de',
  'dev',
  'edu',
  'eu',
  'gov',
  'info',
  'io',
  'me',
  'net',
  'nl',
  'org',
  'run',
  'to',
  'tv',
  'uk',
  'us',
  'xyz',
]);

/** Real files that carry no extension at all. */
const EXTENSIONLESS = new Set([
  'Makefile',
  'Dockerfile',
  'Procfile',
  'Justfile',
  'Rakefile',
  'Gemfile',
  'Brewfile',
  'CODEOWNERS',
  'LICENSE',
  'NOTICE',
  'README',
  'CHANGELOG',
]);

/** Anything URL-shaped is already a link; it must not also be a file mention. */
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;

/**
 * A path-shaped run, optionally followed by `:line` or `:line:col`.
 *
 * Kept loose on purpose — `isPlausible` does the rejecting, because the rules
 * are far easier to read as named conditions than as regex alternation.
 */
const TOKEN_RE = /(?:~\/|\.{1,2}\/|\/)?(?:[A-Za-z0-9._@+-]+\/)*[A-Za-z0-9._@+-]+(?::\d+){0,2}/g;

/** Trailing characters that belong to the sentence, not to the name. */
const TRAILING = /[.,;:!?)\]}'"»]+$/;

function stem(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? name : name.slice(0, dot);
}

function extension(name: string): string | null {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

/** Does the first segment read as a hostname? */
function looksLikeHost(path: string): boolean {
  const first = path.split('/')[0] ?? '';
  const ext = extension(first);
  return ext !== null && TLD_LIKE.has(ext);
}

function isPlausible(path: string): boolean {
  if (!path || path.endsWith('/')) return false;
  // `..` and `.` on their own, and anything that is only dots.
  if (/^[./]+$/.test(path)) return false;
  if (looksLikeHost(path)) return false;

  const name = path.slice(path.lastIndexOf('/') + 1);
  if (!name) return false;

  const ext = extension(name);
  if (ext === null) {
    // No extension: a path only counts if it is a known bare filename. A lone
    // word like "done" must never reach the resolver.
    return EXTENSIONLESS.has(name);
  }
  if (/^\d+$/.test(ext)) return false; // 1.2.3, 3.14
  if (!/^[a-z0-9]{1,10}$/i.test(ext)) return false;
  if (WORDY_EXTENSIONS.has(ext)) return false;
  // "e.g", "i.e" — a single letter either side of the dot is an abbreviation.
  // `a.ts` is not: a real extension is two or more characters, which is what
  // separates the two without a list of abbreviations to maintain. A directory
  // in the path vouches for the name either way.
  if (!path.includes('/') && stem(name).length <= 1 && ext.length <= 1) return false;
  return true;
}

/** Every plausible file mention in `text`, in source order. */
export function findFileMentions(text: string): FileMention[] {
  // Blank URLs before scanning, preserving length so offsets stay valid.
  const scannable = text.replace(URL_RE, (m) => ' '.repeat(m.length));

  const found: FileMention[] = [];
  for (const match of scannable.matchAll(TOKEN_RE)) {
    const index = match.index ?? 0;
    let raw = match[0];

    const trimmed = raw.replace(TRAILING, '');
    // A `:42` suffix survives the trim; sentence punctuation does not.
    const withLine = /:\d+(?::\d+)?$/.test(raw) ? raw : trimmed;
    if (!withLine) continue;
    raw = withLine;

    const lineMatch = raw.match(/^(.*?):(\d+)(?::\d+)?$/);
    const path = lineMatch ? (lineMatch[1] ?? '') : raw;
    if (!isPlausible(path)) continue;

    found.push({
      raw,
      path,
      ...(lineMatch?.[2] ? { line: Number(lineMatch[2]) } : {}),
      start: index,
      end: index + raw.length,
    });
  }
  return found;
}
