/**
 * The three things a run can block on, as one banner each.
 *
 * All three take the keyboard until answered, because that is what "the run is
 * waiting" means — and all three must be answerable, since a client that leaves
 * one hanging stalls the conversation with nothing on screen to explain it.
 *
 * Still exactly one on screen at a time. `useKeyboard` is a global
 * subscription, so two mounted banners means one `y` answers both — the same
 * hazard Ink's `useInput` had, for the same reason. What is new is that a
 * handler can `preventDefault`, so the banner that answers a key also stops it
 * reaching the composer behind it.
 */

import { type PendingApproval, summarizeToolArgs } from '@felix/client';
import type { PendingUiRequest } from '@felix/protocol';
import type { KeyEvent } from '@opentui/core';
import { createTextAttributes } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { useState } from 'react';

const DIM = createTextAttributes({ dim: true });

export function ApprovalPrompt({
  pending,
  onDecide,
}: {
  pending: PendingApproval;
  onDecide: (status: 'approved' | 'denied') => void;
}) {
  useKeyboard((key: KeyEvent) => {
    const name = key.name?.toLowerCase();
    if (name !== 'y' && name !== 'n') return;
    key.preventDefault();
    onDecide(name === 'y' ? 'approved' : 'denied');
  });

  const summary = summarizeToolArgs(pending.toolName, pending.args);
  return (
    <box
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor="yellow"
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg="yellow">approval · {pending.toolName}</text>
      <text>{summary.split('\n').slice(0, 6).join('\n')}</text>
      {pending.before != null ? (
        <text attributes={DIM}>replaces {pending.before.length} chars already in that file</text>
      ) : null}
      <text attributes={DIM}>y approve · n deny</text>
    </box>
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

  useKeyboard((key: KeyEvent) => {
    if (busy) return;
    const name = key.name ?? '';
    if (name === 'escape') {
      key.preventDefault();
      onCancel();
      return;
    }
    if (pending.kind === 'confirm') {
      const lower = name.toLowerCase();
      if (lower !== 'y' && lower !== 'n') return;
      key.preventDefault();
      onRespond(lower === 'y');
      return;
    }
    if (pending.kind === 'select') {
      if (name === 'up') {
        key.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
      }
      if (name === 'down') {
        key.preventDefault();
        setCursor((c) => Math.min(options.length - 1, c + 1));
      }
      if (name === 'return') {
        key.preventDefault();
        onRespond(options[cursor]?.value ?? '');
      }
      return;
    }
    if (name === 'return') {
      key.preventDefault();
      onRespond(text);
      return;
    }
    if (name === 'backspace' || name === 'delete') {
      key.preventDefault();
      setText((t) => t.slice(0, -1));
      return;
    }
    if (key.ctrl || key.meta || name.length !== 1) return;
    key.preventDefault();
    setText((t) => t + name);
  });

  return (
    <box
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor="magenta"
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg="magenta">{pending.prompt}</text>
      {pending.kind === 'select' ? (
        options.map((opt: { value: string; label: string }, i: number) => (
          <text key={opt.value} fg={i === cursor ? 'magenta' : undefined}>
            {i === cursor ? '❯ ' : '  '}
            {opt.label}
          </text>
        ))
      ) : pending.kind === 'confirm' ? (
        <text attributes={DIM}>y yes · n no · esc cancel</text>
      ) : (
        <box flexDirection="row">
          <text>{'> '}</text>
          <text>{text}</text>
        </box>
      )}
      {busy ? <text attributes={DIM}>sending…</text> : null}
    </box>
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
  useKeyboard((key: KeyEvent) => {
    const name = key.name?.toLowerCase();
    if (name !== 'y' && name !== 'n') return;
    key.preventDefault();
    onAnswer(name === 'y');
  });

  return (
    <box
      flexDirection="row"
      border
      borderStyle="rounded"
      borderColor="red"
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg="red">{summary}? </text>
      <text attributes={DIM}>y allow · n refuse</text>
    </box>
  );
}
