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

  // `createPatch` opens with an `Index:`/`===`/`---`/`+++` preamble that says
  // the filename three times. The banner has already named the tool and the
  // path, so those rows are four of the sixteen spent on nothing.
  const lines = full.split('\n');
  const body = lines.slice(4);
  const kept = body.slice(0, rows);

  return {
    patch: [lines[0] ?? '', ...lines.slice(1, 4), ...kept].join('\n'),
    path,
    // Sized to what the patch needs rather than to the cap, or a two-line edit
    // reserves sixteen rows and the banner is mostly empty box.
    rows: Math.max(1, Math.min(kept.filter((line) => line.length > 0).length, rows)),
    omitted: Math.max(0, body.filter((line) => line.length > 0).length - kept.length),
    isNew: pending.before === null,
  };
}
