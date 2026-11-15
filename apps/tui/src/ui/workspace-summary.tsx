import type { Turn } from '@felix/client';
import { useMemo } from 'react';
import { oneLine } from '../text.js';
import { BOLD, DIM, type Theme } from '../theme.js';
import { summarizeWorkspace } from '../workspace-summary.js';

export function WorkspaceResults({ turn, theme }: { turn: Turn; theme: Theme }) {
  const summary = useMemo(() => summarizeWorkspace(turn), [turn]);
  if (!summary) return null;
  const groups = [
    ['File operations', summary.files, theme.ready],
    ['Commands completed', summary.commands, theme.ready],
    ['Issues', summary.issues, theme.failed],
    ['Unconfirmed operations', summary.unconfirmed, theme.blocked],
    ['Plan steps remaining', summary.remaining, theme.blocked],
  ] as const;
  const outcome = summary.issues.length
    ? theme.failed
    : summary.unconfirmed.length || summary.remaining.length
      ? theme.blocked
      : theme.ready;
  return (
    <box
      flexDirection="column"
      marginTop={1}
      paddingLeft={2}
      border={['left']}
      borderColor={outcome}
    >
      <text fg={outcome} attributes={BOLD}>
        Workspace results
      </text>
      {groups.map(([label, entries, color]) =>
        entries.length ? (
          <box key={label} flexDirection="column">
            <text fg={color}>{`${label}: ${entries.length}`}</text>
            <text attributes={DIM}>
              {entries
                .slice(0, 6)
                .map((entry) => `  ${oneLine(entry, 160)}`)
                .join('\n')}
            </text>
            {entries.length > 6 ? (
              <text
                attributes={DIM}
              >{`  … ${entries.length - 6} more; see tool results above`}</text>
            ) : null}
          </box>
        ) : null,
      )}
    </box>
  );
}
