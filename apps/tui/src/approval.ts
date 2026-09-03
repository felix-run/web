/**
 * What a write approval actually shows you.
 *
 * This is the one surface in the monorepo where a person authorizes the model
 * to write to their own disk, and until now the entire evidence was a character
 * count — `replaces 20 chars already in that file`. Both halves of the change
 * were already in hand: `PendingApproval.before` is the prior file content,
 * read for exactly this purpose, and the new content is in the tool's own
 * arguments. The browser client has rendered a real before-and-after for a
 * while; the terminal asked you to approve a number.
 *
 * Three states are kept apart, because they are three different decisions:
 * `before === undefined` means this is not a write at all and there is nothing
 * to diff; `null` means the file does not exist yet, so the change is the whole
 * file arriving; a string means an edit.
 */

import type { PendingApproval } from '@felix/client';
import { createPatch } from 'diff';

/**
 * Rows of diff shown before it is cut.
 *
 * A cap is not a nicety. The buttons sit *below* the payload on purpose —
 * approving a file write should mean having scrolled past what it does — and an
 * unbounded diff of a whole-file rewrite pushes the `y`/`n` line off the bottom
 * of the terminal, which is an approval you cannot answer.
 */
export const DIFF_ROWS = 16;

/** Lines of unchanged context on either side of each change. */
const CONTEXT = 3;

export interface WriteDiff {
  /** A unified patch, ready for `<diff>`. */
  patch: string;
  /** The file being written, for the banner to name. */
  path: string;
  /** Rows the patch body actually occupies, up to the cap. */
  rows: number;
  /** Rows cut from the end to keep the decision reachable, or zero. */
  omitted: number;
  /** True when the file does not exist yet and this is the whole of it. */
  isNew: boolean;
}

/**
 * One `@@` hunk, kept whole.
 *
 * The cap has to fall on a hunk boundary. A unified diff is not a list of
 * lines a reader can stop part-way down: every hunk declares how many lines
 * follow it, and a body cut mid-hunk contradicts its own header. The renderer
 * then refuses the patch outright — `Error parsing diff: Added line count did
 * not match` — and falls back to printing the raw text, so an approval on any
 * file long enough to need two hunks showed an error message and a wall of
 * diff syntax instead of a diff.
 */
interface Hunk {
  header: string;
  lines: string[];
}

function splitHunks(body: string[]): Hunk[] {
  const hunks: Hunk[] = [];
  for (const line of body) {
    if (line.startsWith('@@')) hunks.push({ header: line, lines: [] });
    else if (hunks.length) hunks[hunks.length - 1]?.lines.push(line);
  }
  return hunks;
}

/**
 * Re-state a hunk's header for the lines it actually carries.
 *
 * Only needed when a *single* hunk is larger than the whole budget, where
 * keeping it whole would defeat the cap and dropping it would show nothing. The
 * counts are derived rather than copied: a context line is in both sides, a
 * removal only in the old, an addition only in the new.
 */
function retitle(hunk: Hunk, lines: string[]): string {
  const starts = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(hunk.header);
  if (!starts) return hunk.header;
  let oldCount = 0;
  let newCount = 0;
  for (const line of lines) {
    if (line.startsWith('-')) oldCount++;
    else if (line.startsWith('+')) newCount++;
    else if (!line.startsWith('\\')) {
      oldCount++;
      newCount++;
    }
  }
  return `@@ -${starts[1]},${oldCount} +${starts[2]},${newCount} @@${starts[3] ?? ''}`;
}

/**
 * The patch a write approval should show, or `null` when there is nothing to
 * diff — a tool that is not a write, or one whose new content is not text.
 */
export function writeDiff(pending: PendingApproval, rows = DIFF_ROWS): WriteDiff | null {
  if (pending.before === undefined) return null;
  const args = (pending.args ?? {}) as Record<string, unknown>;
  const next = args.content;
  if (typeof next !== 'string') return null;

  const path = typeof args.path === 'string' ? args.path : 'file';
  const prior = pending.before ?? '';
  const full = createPatch(path, prior, next, undefined, undefined, { context: CONTEXT });

  // `createPatch` opens with an `Index:`/`===`/`---`/`+++` preamble that names
  // the file three times. The banner has already said the tool and the path, so
  // those four rows would be spent on nothing — but they stay in the string,
  // because the renderer parses them as the patch's header.
  const lines = full.split('\n');
  const head = lines.slice(0, 4);
  const hunks = splitHunks(lines.slice(4).filter((line) => line.length > 0));

  const kept: string[] = [];
  let used = 0;
  let omitted = 0;

  for (const hunk of hunks) {
    const cost = hunk.lines.length + 1;
    if (used + cost <= rows) {
      kept.push(hunk.header, ...hunk.lines);
      used += cost;
      continue;
    }
    // Room for part of this one, and only if it is the first — a later hunk cut
    // short would sit under complete ones and read as though the file ends there.
    const room = rows - used - 1;
    if (kept.length === 0 && room > 0) {
      const part = hunk.lines.slice(0, room);
      kept.push(retitle(hunk, part), ...part);
      used += part.length + 1;
      omitted += hunk.lines.length - part.length;
      continue;
    }
    omitted += hunk.lines.length;
  }

  return {
    patch: [...head, ...kept].join('\n'),
    path,
    // Sized to what the patch needs rather than to the cap, or a two-line edit
    // reserves sixteen rows and the banner is mostly empty box.
    rows: Math.max(1, Math.min(kept.length, rows)),
    omitted,
    isNew: pending.before === null,
  };
}
