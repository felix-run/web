/**
 * A line diff for skill files, and the hunks a reader is shown.
 *
 * LCS over lines, which is what a SKILL.md wants: prose edited a paragraph at a
 * time, where a word-level diff is noise. The table is quadratic, so the common
 * head and tail are trimmed first — an edit to one section of a long file costs
 * that section, not the file — and a middle still too large to tabulate falls
 * back to "these lines went, these came" rather than freezing the tab. That
 * fallback is *said* (`exact: false`), never passed off as a minimal diff.
 */

export type DiffLine =
  | { type: 'same'; line: string; oldNo: number; newNo: number }
  | { type: 'remove'; line: string; oldNo: number }
  | { type: 'add'; line: string; newNo: number };

export interface Diff {
  lines: DiffLine[];
  added: number;
  removed: number;
  /** False when the changed middle was too large to align and is shown as a block swap. */
  exact: boolean;
}

/** Cells of LCS table past which the middle is shown as a block swap. ~16 MB of Uint32. */
export const MAX_DIFF_CELLS = 4_000_000;

function splitLines(text: string): string[] {
  return text === '' ? [] : text.split('\n');
}

export function diffLines(oldText: string, newText: string): Diff {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);

  const lines: DiffLine[] = [];
  for (let i = 0; i < head; i++) {
    lines.push({ type: 'same', line: a[i] ?? '', oldNo: i + 1, newNo: i + 1 });
  }

  const m = midA.length;
  const n = midB.length;
  const exact = (m + 1) * (n + 1) <= MAX_DIFF_CELLS;
  if (exact) {
    // dp[i][j] = LCS length of midA[i:] and midB[j:], flattened.
    const w = n + 1;
    const dp = new Uint32Array((m + 1) * w);
    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        dp[i * w + j] =
          midA[i] === midB[j]
            ? (dp[(i + 1) * w + j + 1] ?? 0) + 1
            : Math.max(dp[(i + 1) * w + j] ?? 0, dp[i * w + j + 1] ?? 0);
      }
    }
    let i = 0;
    let j = 0;
    while (i < m || j < n) {
      if (i < m && j < n && midA[i] === midB[j]) {
        lines.push({ type: 'same', line: midA[i] ?? '', oldNo: head + i + 1, newNo: head + j + 1 });
        i++;
        j++;
      } else if (i < m && (j === n || (dp[(i + 1) * w + j] ?? 0) >= (dp[i * w + j + 1] ?? 0))) {
        // Removals first on a tie, so a changed line reads old-then-new.
        lines.push({ type: 'remove', line: midA[i] ?? '', oldNo: head + i + 1 });
        i++;
      } else {
        lines.push({ type: 'add', line: midB[j] ?? '', newNo: head + j + 1 });
        j++;
      }
    }
  } else {
    midA.forEach((line, i) => {
      lines.push({ type: 'remove', line, oldNo: head + i + 1 });
    });
    midB.forEach((line, j) => {
      lines.push({ type: 'add', line, newNo: head + j + 1 });
    });
  }

  for (let k = 0; k < tail; k++) {
    const oldNo = a.length - tail + k + 1;
    const newNo = b.length - tail + k + 1;
    lines.push({ type: 'same', line: a[oldNo - 1] ?? '', oldNo, newNo });
  }
  return {
    lines,
    added: lines.filter((l) => l.type === 'add').length,
    removed: lines.filter((l) => l.type === 'remove').length,
    exact,
  };
}

/** A run of lines to draw, or a fold standing for `count` unchanged lines. */
export type DiffChunk =
  | { kind: 'lines'; lines: DiffLine[] }
  | { kind: 'fold'; count: number; lines: DiffLine[] };

/**
 * The diff as a reader sees it: every change with `context` unchanged lines on
 * either side, and each longer unchanged run folded to a count (its lines kept,
 * so a reader can open it). Without folding,
 * a one-line edit to a 400-line skill is 400 lines to scroll for one.
 */
export function diffChunks(lines: DiffLine[], context = 3): DiffChunk[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((l, i) => {
    if (l.type === 'same') return;
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) {
      keep[k] = true;
    }
  });
  const chunks: DiffChunk[] = [];
  let run: DiffLine[] = [];
  let folded: DiffLine[] = [];
  const flushRun = () => {
    if (run.length) chunks.push({ kind: 'lines', lines: run });
    run = [];
  };
  const flushFold = () => {
    if (folded.length) chunks.push({ kind: 'fold', count: folded.length, lines: folded });
    folded = [];
  };
  lines.forEach((l, i) => {
    if (keep[i]) {
      flushFold();
      run.push(l);
    } else {
      flushRun();
      folded.push(l);
    }
  });
  flushRun();
  flushFold();
  return chunks;
}
