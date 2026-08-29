/**
 * What was typed last, and the time before that.
 *
 * A chat client without prompt recall makes you retype a paragraph whenever a
 * run fails — the one moment you are least inclined to. This is the terminal's
 * answer to a browser's back button: a small ring of submitted lines, kept in
 * the same state directory as the transcripts and read on ↑.
 *
 * One JSON-encoded string per line rather than raw text, because a prompt may
 * contain newlines and a line-delimited file may not. A line that will not
 * parse is dropped rather than shown — the file is a convenience, and half a
 * recalled prompt is worse than none.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stateDir } from './threads.js';

/** Entries kept. Enough to reach yesterday's prompt, small enough to reread. */
export const HISTORY_LIMIT = 50;

export interface PromptHistory {
  /** Oldest first, so ↑ walks backwards from the end. */
  entries(): string[];
  add(text: string): void;
}

/** Whatever survives parsing, newest last, capped. */
export function parseHistory(text: string): string[] {
  return text
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const value: unknown = JSON.parse(line);
        return typeof value === 'string' && value ? [value] : [];
      } catch {
        return [];
      }
    })
    .slice(-HISTORY_LIMIT);
}

export function createPromptHistory(dir = stateDir()): PromptHistory {
  const path = join(dir, 'prompt-history.jsonl');
  const serialize = (lines: string[]) =>
    `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`;

  const write = (lines: string[]) => {
    try {
      // 0700/0600 for the same reason the transcripts are: a prompt is as
      // revealing as the reply it asked for.
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeFileSync(path, serialize(lines), { encoding: 'utf8', mode: 0o600 });
    } catch {
      // no recall is better than no client
    }
  };

  const raw = (() => {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return '';
    }
  })();
  const lines = parseHistory(raw);

  // Rewriting on load is what keeps a corrupt or overlong file from staying
  // that way: whatever parsed is now the whole file. Skipped when the file
  // already says exactly this, so a read-only run stays a read.
  if (raw && serialize(lines) !== raw) write(lines);

  return {
    entries: () => lines.slice(),
    add: (text) => {
      const value = text.trim();
      // A run repeated verbatim is one entry, not two — ↑ should step back
      // through what was *said*, not how many times it was sent.
      if (!value || value === lines[lines.length - 1]) return;
      lines.push(value);
      if (lines.length > HISTORY_LIMIT) lines.splice(0, lines.length - HISTORY_LIMIT);
      // The whole file, every time. Fifty short lines cost nothing to rewrite,
      // and an append that trims separately is two ways to be wrong.
      write(lines);
    },
  };
}
