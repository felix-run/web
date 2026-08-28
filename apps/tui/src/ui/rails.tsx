/**
 * The thread list and the status line — everything on screen that is not the
 * conversation itself.
 */

import type { ThreadMeta } from '@felix/client';
import { Box, Text } from 'ink';

export function ThreadRail({
  threads,
  activeId,
  cursor,
  focused,
}: {
  threads: ThreadMeta[];
  activeId: string;
  cursor: number;
  focused: boolean;
}) {
  return (
    <Box
      flexDirection="column"
      width={26}
      marginRight={2}
      borderStyle="round"
      borderColor={focused ? 'green' : 'gray'}
      paddingX={1}
    >
      <Text dimColor>threads</Text>
      {threads.length === 0 ? <Text dimColor>(none yet)</Text> : null}
      {threads.slice(0, 20).map((thread, i) => {
        const active = thread.id === activeId;
        return (
          <Text
            key={thread.id}
            color={focused && i === cursor ? 'green' : undefined}
            bold={active}
            wrap="truncate"
          >
            {active ? '• ' : '  '}
            {thread.title || 'Untitled'}
            {thread.onServer === false ? ' *' : ''}
          </Text>
        );
      })}
    </Box>
  );
}

export function StatusLine({
  manifest,
  origin,
  phase,
  streaming,
  reattaching,
  error,
  root,
}: {
  manifest: string;
  origin: string;
  phase: string;
  streaming: boolean;
  reattaching: boolean;
  error: string | null;
  root: string;
}) {
  return (
    <Box flexDirection="column">
      {error ? <Text color="red">{error}</Text> : null}
      {/* A reattach is a materially different claim from a live run: the
          original was torn down when the connection dropped, so this is showing
          what landed rather than a reply still being written. */}
      {reattaching ? <Text color="yellow">rejoining the thread…</Text> : null}
      <Box>
        <Text dimColor>
          {manifest} · {origin} · {root}
          {phase && phase !== 'idle' ? ` · ${phase}` : ''}
          {streaming ? ' · esc to stop' : ''}
        </Text>
      </Box>
    </Box>
  );
}
