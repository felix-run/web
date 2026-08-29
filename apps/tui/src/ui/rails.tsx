/**
 * The thread list and the status line — everything on screen that is not the
 * conversation itself.
 */

import type { ThreadMeta } from '@felix/client';
import { Box, Text } from 'ink';

/** Rows the rail draws at once. */
const RAIL_ROWS = 20;

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
    <Box
      flexDirection="column"
      width={26}
      marginRight={2}
      borderStyle="round"
      borderColor={focused ? 'green' : 'gray'}
      paddingX={1}
    >
      <Text dimColor wrap="truncate">
        {filter ? `/${filter} · ${threads.length}/${all}` : 'threads'}
      </Text>
      {all === 0 ? <Text dimColor>(none yet)</Text> : null}
      {all > 0 && threads.length === 0 ? <Text dimColor>no match · esc clears</Text> : null}
      {start > 0 ? <Text dimColor>↑ {start} more</Text> : null}
      {threads.slice(start, end).map((thread, i) => {
        const index = start + i;
        const active = thread.id === activeId;
        return (
          <Text
            key={thread.id}
            color={focused && index === cursor ? 'green' : undefined}
            bold={active}
            wrap="truncate"
          >
            {active ? '• ' : '  '}
            {thread.title || 'Untitled'}
            {thread.onServer === false ? ' *' : ''}
          </Text>
        );
      })}
      {end < threads.length ? <Text dimColor>↓ {threads.length - end} more</Text> : null}
      {focused && !filter && threads.length > 0 ? <Text dimColor>type to filter</Text> : null}
    </Box>
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
    <Box flexDirection="column">
      {error ? <Text color="red">{error}</Text> : null}
      {/* A reattach is a materially different claim from a live run: the
          original was torn down when the connection dropped, so this is showing
          what landed rather than a reply still being written. */}
      {reattaching ? <Text color="yellow">rejoining the thread…</Text> : null}
      <Box justifyContent="space-between">
        <Text dimColor wrap="truncate">
          {manifest} · {origin} · {root}
          {phase && phase !== 'idle' ? ` · ${phase}` : ''}
        </Text>
        {hint ? <Text dimColor wrap="truncate">{`  ${hint}`}</Text> : null}
      </Box>
    </Box>
  );
}
