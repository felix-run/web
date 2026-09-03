/**
 * The thread list and the status line — everything on screen that is not the
 * conversation itself.
 *
 * `railWindow` survives the renderer change untouched: it is pure arithmetic
 * with its own test. A `scrollbox` could window the rail natively, but the rail
 * is *selected* rather than scrolled — the cursor is the thing that has to stay
 * on screen, which is exactly what this function is for and what a scroll
 * offset is not.
 */

import type { ThreadMeta } from '@felix/client';
import { oneLine } from '../text.js';
import { BOLD, DIM, type Theme } from '../theme.js';

/**
 * The most thread rows the rail will draw, however tall the terminal is.
 *
 * The floor matters more than the ceiling: this was a flat 20, and a rail
 * asking for 20 rows in a 24-row terminal does not shrink or scroll — it is
 * drawn *over* the composer and the status line, which is a client that looks
 * broken on the most common terminal size there is. `App` passes what actually
 * fits; this is only the point past which more rows stop helping.
 */
export const RAIL_ROWS_MAX = 20;

/**
 * Rows the rail's chrome takes whatever the list holds: two borders, the
 * header, both "N more" markers and the filter hint.
 */
const RAIL_CHROME = 6;

/** The composer and the status line, which are drawn below the rail. */
const BELOW_RAIL = 6;

/**
 * How many thread rows fit in a terminal this tall.
 *
 * Never fewer than three: below that the rail is not a list any more, and at
 * that point the honest thing is a cramped rail rather than one that has
 * silently eaten the prompt.
 */
export function railRows(height: number): number {
  return Math.max(3, Math.min(RAIL_ROWS_MAX, height - RAIL_CHROME - BELOW_RAIL));
}

/** Inner width of the rail, less its border and padding. */
const RAIL_TEXT = 22;

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
  rows = RAIL_ROWS_MAX,
  theme,
  onPick,
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
  /** Thread rows to draw — what the terminal has room for, from `App`. */
  rows?: number;
  theme: Theme;
  /**
   * Clicking a row opens it. Mouse reporting is on by default, so the wheel
   * already scrolls and a drag already selects — a rail you can see and cannot
   * click is the odd one out, not the feature.
   */
  onPick?: (id: string) => void;
}) {
  const all = total ?? threads.length;
  const { start, end } = railWindow(threads.length, cursor, rows);

  return (
    <box
      flexDirection="column"
      width={26}
      // Sized to its rows, not to the row it sits in. A flex row stretches its
      // children by default, which drew the rail's border down the whole screen
      // with twelve empty rows under the last thread.
      alignSelf="flex-start"
      marginRight={2}
      border
      borderStyle="rounded"
      borderColor={focused ? theme.ready : theme.faint}
      paddingLeft={1}
      paddingRight={1}
    >
      <text attributes={DIM}>
        {oneLine(filter ? `/${filter} · ${threads.length}/${all}` : 'threads', RAIL_TEXT)}
      </text>
      {all === 0 ? <text attributes={DIM}>(none yet)</text> : null}
      {all > 0 && threads.length === 0 ? <text attributes={DIM}>no match · esc clears</text> : null}
      {start > 0 ? <text attributes={DIM}>↑ {start} more</text> : null}
      {threads.slice(start, end).map((thread, i) => {
        const index = start + i;
        const active = thread.id === activeId;
        const label = `${active ? '• ' : '  '}${thread.title || 'Untitled'}${
          thread.onServer === false ? ' *' : ''
        }`;
        return (
          /* An OpenTUI renderable, not a DOM node: there is no accessibility
             tree to add a role to. What the rule is really after — the same
             action reachable from the keyboard — holds, because `tab` focuses
             the rail and `enter` opens the row under the cursor. */
          // biome-ignore lint/a11y/noStaticElementInteractions: terminal renderable, keyboard path is tab + enter
          <text
            key={thread.id}
            fg={focused && index === cursor ? theme.ready : undefined}
            attributes={active ? BOLD : undefined}
            onMouseDown={onPick ? () => onPick(thread.id) : undefined}
          >
            {oneLine(label, RAIL_TEXT)}
          </text>
        );
      })}
      {end < threads.length ? <text attributes={DIM}>↓ {threads.length - end} more</text> : null}
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
  width,
  theme,
}: {
  manifest: string;
  origin: string;
  phase: string;
  reattaching: boolean;
  error: string | null;
  root: string;
  /** What the keys do right now — see `hint` in `app.tsx`. */
  hint?: string;
  /** Terminal columns, so the two halves can be cut rather than wrapped. */
  width: number;
  theme: Theme;
}) {
  // One row, two columns, and it has to stay one row: a status line that wraps
  // pushes the composer up the screen every time the path is long. The
  // renderer's own `truncate` needs a bounded width to cut against, which this
  // row does not have, so the cut is made here where the width is known.
  const keys = hint ? `  ${hint}` : '';
  const state = `${manifest} · ${origin} · ${root}${phase && phase !== 'idle' ? ` · ${phase}` : ''}`;
  const room = Math.max(8, width - keys.length - 2);
  const left = state.length > room ? `${state.slice(0, room - 1)}…` : state;

  return (
    <box flexDirection="column">
      {error ? <text fg={theme.failed}>{error}</text> : null}
      {/* A reattach is a materially different claim from a live run: the
          original was torn down when the connection dropped, so this is showing
          what landed rather than a reply still being written. */}
      {reattaching ? <text fg={theme.running}>rejoining the thread…</text> : null}
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={DIM}>{left}</text>
        {keys ? <text attributes={DIM}>{keys}</text> : null}
      </box>
    </box>
  );
}
