/**
 * The three things a run can block on, as one banner each.
 *
 * All three take the keyboard until answered, because that is what "the run is
 * waiting" means — and all three must be answerable, since a client that leaves
 * one hanging stalls the conversation with nothing on screen to explain it.
 */

import { type PendingApproval, summarizeToolArgs } from '@felix/client';
import type { PendingUiRequest } from '@felix/protocol';
import { Box, Text, useInput } from 'ink';
import { useState } from 'react';

export function ApprovalPrompt({
  pending,
  onDecide,
}: {
  pending: PendingApproval;
  onDecide: (status: 'approved' | 'denied') => void;
}) {
  useInput((input) => {
    const key = input.toLowerCase();
    if (key === 'y') onDecide('approved');
    if (key === 'n') onDecide('denied');
  });

  const summary = summarizeToolArgs(pending.toolName, pending.args);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow">approval · {pending.toolName}</Text>
      <Text>{summary.split('\n').slice(0, 6).join('\n')}</Text>
      {pending.before != null ? (
        <Text dimColor>replaces {pending.before.length} chars already in that file</Text>
      ) : null}
      <Text dimColor>y approve · n deny</Text>
    </Box>
  );
}

export function UiPrompt({
  pending,
  busy,
  onRespond,
  onCancel,
}: {
  pending: PendingUiRequest;
  busy: boolean;
  onRespond: (value: unknown) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const [cursor, setCursor] = useState(0);
  const options = pending.options ?? [];

  useInput(
    (input, key) => {
      if (key.escape) {
        onCancel();
        return;
      }
      if (pending.kind === 'confirm') {
        if (input.toLowerCase() === 'y') onRespond(true);
        if (input.toLowerCase() === 'n') onRespond(false);
        return;
      }
      if (pending.kind === 'select') {
        if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
        if (key.downArrow) setCursor((c) => Math.min(options.length - 1, c + 1));
        if (key.return) onRespond(options[cursor]?.value ?? '');
        return;
      }
      if (key.return) {
        onRespond(text);
        return;
      }
      if (key.backspace || key.delete) {
        setText((t) => t.slice(0, -1));
        return;
      }
      if (!key.ctrl && !key.meta && input) setText((t) => t + input);
    },
    { isActive: !busy },
  );

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1}>
      <Text color="magenta">{pending.prompt}</Text>
      {pending.kind === 'select' ? (
        options.map((opt: { value: string; label: string }, i: number) => (
          <Text key={opt.value} color={i === cursor ? 'magenta' : undefined}>
            {i === cursor ? '❯ ' : '  '}
            {opt.label}
          </Text>
        ))
      ) : pending.kind === 'confirm' ? (
        <Text dimColor>y yes · n no · esc cancel</Text>
      ) : (
        <Box>
          <Text>{'> '}</Text>
          <Text>{text}</Text>
          <Text inverse> </Text>
        </Box>
      )}
      {busy ? <Text dimColor>sending…</Text> : null}
    </Box>
  );
}

/**
 * The local confirmation before a client tool writes.
 *
 * Unlike the two above this is *not* the harness waiting — it is this process
 * deciding whether to touch the user's disk. The run is still blocked behind it
 * either way, which is why the executor's own timeout answers if nobody does.
 */
export function WritePrompt({
  summary,
  onAnswer,
}: {
  summary: string;
  onAnswer: (ok: boolean) => void;
}) {
  useInput((input) => {
    const key = input.toLowerCase();
    if (key === 'y') onAnswer(true);
    if (key === 'n') onAnswer(false);
  });

  return (
    <Box borderStyle="round" borderColor="red" paddingX={1}>
      <Text color="red">{summary}? </Text>
      <Text dimColor>y allow · n refuse</Text>
    </Box>
  );
}
