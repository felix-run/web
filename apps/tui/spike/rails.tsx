/**
 * `apps/tui/src/ui/rails.tsx`, ported to OpenTUI.
 *
 * `railWindow` is copied unchanged and on purpose: it is pure arithmetic with
 * its own test, and it survives any renderer. What changed is only the drawing
 * around it — and the honest note is that on OpenTUI this whole function is
 * replaceable by a `scrollbox`, which windows natively. Keeping it here is what
 * makes the two files comparable; deleting it is what the real port would do.
 *
 * Ink's `wrap="truncate"` has no direct prop here, so the spike truncates in
 * JS. That is a real (small) gap, noted rather than hidden.
 */

import type { ThreadMeta } from '@felix/client';
import { createTextAttributes } from '@opentui/core';

const DIM = createTextAttributes({ dim: true });
const BOLD = createTextAttributes({ bold: true });

/** Rows the rail draws at once. */
const RAIL_ROWS = 20;

/** Inner width of the rail, less its border and padding. */
const RAIL_TEXT = 22;

const truncate = (s: string, width = RAIL_TEXT) =>
  s.length > width ? `${s.slice(0, width - 1)}…` : s;

/**
 * The slice of a list to draw so that `cursor` is always inside it.
 *
 * A head slice is the tempting version, and it is wrong the moment the list
 * outgrows the rail: the cursor walks past the last drawn row, the highlight
 * disappears, further presses do nothing anyone can see, and enter opens a
 * thread that was never on screen. Clamped at both ends, so the top of the list
 * does not slide under the cursor and the bottom does not leave empty rows.
 */
export function railWindow(
  total: number,
  cursor: number,
  rows: number,
): { start: number; end: number } {
  if (rows <= 0 || total <= 0) return { start: 0, end: 0 };
  if (total <= rows) return { start: 0, end: total };
  const clamped = Math.max(0, Math.min(total - 1, cursor));
  const head = Math.max(0, clamped - Math.floor(rows / 2));
  const end = Math.min(total, head + rows);
  return { start: Math.max(0, end - rows), end };
}

export function ThreadRail({
  threads,
  activeId,
  cursor,
  focused,
  filter = '',
  total,
}: {
  /** Already filtered: what is drawn and what enter picks are the same list. */
  threads: ThreadMeta[];
  activeId: string;
  cursor: number;
  focused: boolean;
  /** The live filter text, so a rail narrowed to nothing explains itself. */
  filter?: string;
  /** Rows before filtering, so "3/40" is sayable. */
  total?: number;
}) {
  const all = total ?? threads.length;
  const { start, end } = railWindow(threads.length, cursor, RAIL_ROWS);

  return (
    <box
      flexDirection="column"
      width={26}
      marginRight={2}
      border
      borderStyle="rounded"
      borderColor={focused ? 'green' : 'gray'}
      paddingLeft={1}
      paddingRight={1}
    >
      <text attributes={DIM}>
        {truncate(filter ? `/${filter} · ${threads.length}/${all}` : 'threads')}
      </text>
      {all === 0 ? <text attributes={DIM}>(none yet)</text> : null}
      {all > 0 && threads.length === 0 ? (
        <text attributes={DIM}>no match · esc clears</text>
      ) : null}
      {start > 0 ? <text attributes={DIM}>↑ {start} more</text> : null}
      {threads.slice(start, end).map((thread, i) => {
        const index = start + i;
        const active = thread.id === activeId;
        const label = `${active ? '• ' : '  '}${thread.title || 'Untitled'}${
          thread.onServer === false ? ' *' : ''
        }`;
        return (
          <text
            key={thread.id}
            fg={focused && index === cursor ? 'green' : undefined}
            attributes={active ? BOLD : undefined}
          >
            {truncate(label)}
          </text>
        );
      })}
      {end < threads.length ? (
        <text attributes={DIM}>↓ {threads.length - end} more</text>
      ) : null}
      {focused && !filter && threads.length > 0 ? (
        <text attributes={DIM}>type to filter</text>
      ) : null}
    </box>
  );
}

export function StatusLine({
  manifest,
  origin,
  phase,
  reattaching,
  error,
  root,
  hint,
}: {
  manifest: string;
  origin: string;
  phase: string;
  reattaching: boolean;
  error: string | null;
  root: string;
  /** What the keys do right now — see `hint` in `app.tsx`. */
  hint?: string;
}) {
  return (
    <box flexDirection="column">
      {error ? <text fg="red">{error}</text> : null}
      {/* A reattach is a materially different claim from a live run: the
          original was torn down when the connection dropped, so this is showing
          what landed rather than a reply still being written. */}
      {reattaching ? <text fg="yellow">rejoining the thread…</text> : null}
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={DIM}>
          {manifest} · {origin} · {root}
          {phase && phase !== 'idle' ? ` · ${phase}` : ''}
        </text>
        {hint ? <text attributes={DIM}>{`  ${hint}`}</text> : null}
      </box>
    </box>
  );
}
