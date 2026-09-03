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

/**
 * The picker's width, and the text that fits inside it.
 *
 * Wider than the old rail because it no longer competes with the conversation
 * for the same row — it is drawn over it — so a thread title can be read rather
 * than guessed at from its first twenty characters.
 */
const PICKER_WIDTH = 46;
const PICKER_TEXT = PICKER_WIDTH - 4;

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

/**
 * The thread picker, over the conversation rather than beside it.
 *
 * This was a permanent left-hand column: twenty-eight of a hundred columns,
 * always, for something you reach for occasionally — and only drawn at all
 * above ninety columns, so the client had two different shapes depending on the
 * terminal. An overlay costs nothing until it is open, is the same at every
 * width, and gives the conversation the whole screen the rest of the time.
 *
 * It is `position: "absolute"` with a `zIndex`, which takes it out of the
 * column flow entirely — a sibling of the transcript rather than a row in it,
 * so opening it does not reflow the conversation underneath.
 */
export function ThreadPicker({
  threads,
  activeId,
  cursor,
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
  /** The live filter text, so a picker narrowed to nothing explains itself. */
  filter?: string;
  /** Rows before filtering, so "3/40" is sayable. */
  total?: number;
  /** Thread rows to draw — what the terminal has room for, from `App`. */
  rows?: number;
  theme: Theme;
  onPick?: (id: string) => void;
}) {
  const all = total ?? threads.length;
  const { start, end } = railWindow(threads.length, cursor, rows);

  return (
    <box
      position="absolute"
      left={2}
      top={1}
      width={PICKER_WIDTH}
      zIndex={10}
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={theme.ready}
      // The count goes in the frame, where a header row used to be, and the
      // keys go in the bottom edge. Both were rows of the list before.
      title={filter ? `/${filter} · ${threads.length}/${all}` : ` threads · ${all} `}
      bottomTitle=" ↑↓ move · enter open · type to filter · esc close "
      paddingLeft={1}
      paddingRight={1}
      // Opaque, or the conversation shows through the gaps between rows.
      backgroundColor={theme.surface}
    >
      {all === 0 ? <text attributes={DIM}>(none yet)</text> : null}
      {all > 0 && threads.length === 0 ? (
        <text attributes={DIM}>no match · esc clears the filter</text>
      ) : null}
      {start > 0 ? <text attributes={DIM}>↑ {start} more</text> : null}
      {threads.slice(start, end).map((thread, i) => {
        const index = start + i;
        const active = thread.id === activeId;
        const selected = index === cursor;
        const label = `${active ? '• ' : '  '}${thread.title || 'Untitled'}${
          thread.onServer === false ? ' *' : ''
        }`;
        return (
          /* An OpenTUI renderable, not a DOM node: there is no accessibility
             tree to add a role to. What the rule is really after — the same
             action reachable from the keyboard — holds, because the picker is
             opened by `tab` and answered with the arrows and `enter`. */
          // biome-ignore lint/a11y/noStaticElementInteractions: terminal renderable, keyboard path is tab + enter
          <text
            key={thread.id}
            fg={selected ? theme.ready : undefined}
            attributes={active ? BOLD : undefined}
            onMouseDown={onPick ? () => onPick(thread.id) : undefined}
          >
            {/* The marker is added *after* truncation: `oneLine` trims, which
                would eat the two spaces that keep unselected rows aligned under
                the selected one. */}
            {selected ? '▶ ' : '  '}
            {oneLine(label, PICKER_TEXT - 2)}
          </text>
        );
      })}
      {end < threads.length ? <text attributes={DIM}>↓ {threads.length - end} more</text> : null}
    </box>
  );
}

/**
 * The origin without the scheme, which is the same on every line of every
 * terminal and tells nobody anything.
 */
function shortOrigin(origin: string): string {
  return origin.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/**
 * The working directory's last segment.
 *
 * This is the directory the *model* can write to, so it has to be identifiable
 * — and the leading path is the half a person recognises least. The absolute
 * path is still shown in full at the moment it matters, on the prompt that asks
 * before a write.
 */
function basename(path: string): string {
  const parts = path.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || path;
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
  //
  // Both halves are shortened before the cut rather than after it. A full
  // origin and an absolute path spend forty columns on two things whose useful
  // part is at the end, and then the cut takes the end: `/Users/blake…` names
  // no directory at all. The scheme and the parent directories are the parts a
  // person already knows.
  const keys = hint ? `  ${hint}` : '';
  const state = `${manifest} · ${shortOrigin(origin)} · ${basename(root)}${
    phase && phase !== 'idle' ? ` · ${phase}` : ''
  }`;
  const room = Math.max(8, width - keys.length - 2);
  const left = state.length > room ? `${state.slice(0, room - 1)}…` : state;

  return (
    // Same reason as the composer: the transcript must not be able to take
    // these rows.
    <box flexDirection="column" flexShrink={0}>
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
