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
 *
 * Two of the three now delegate their input to a renderable rather than reading
 * keys themselves. The agent's question was the last surface here holding a
 * `useState` cursor it walked by hand and a string it appended characters to —
 * which is the deficiency the composer's own header describes being fixed by
 * moving to a `textarea`, on the one prompt that never got the same treatment.
 */

import { type PendingApproval, summarizeToolArgs } from '@felix/client';
import type { PendingUiRequest } from '@felix/protocol';
import type { KeyEvent } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { writeDiff } from '../approval.js';
import { DIM, type Theme } from '../theme.js';

/** Options shown at once before the list scrolls inside the banner. */
const SELECT_ROWS = 8;

export function ApprovalPrompt({
  pending,
  onDecide,
  theme,
}: {
  pending: PendingApproval;
  onDecide: (status: 'approved' | 'denied') => void;
  theme: Theme;
}) {
  useKeyboard((key: KeyEvent) => {
    const name = key.name?.toLowerCase();
    if (name !== 'y' && name !== 'n') return;
    key.preventDefault();
    onDecide(name === 'y' ? 'approved' : 'denied');
  });

  const diff = writeDiff(pending);
  const summary = summarizeToolArgs(pending.toolName, pending.args);
  return (
    <box
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={theme.blocked}
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={theme.blocked}>approval · {pending.toolName}</text>
      {diff ? (
        <>
          {/*
            Evidence, then the decision. The keys stay below the payload — an
            approval you answer before seeing what it does is not one — and the
            diff is capped so they cannot be pushed off the bottom of the
            screen, which is an approval you cannot answer at all.
          */}
          {/* The patch's own `---`/`+++` header is metadata to the renderer and
              is never drawn, so the path has to be said here or the banner
              names a change without naming what it changes. */}
          <text attributes={DIM}>
            {diff.isNew ? 'creates ' : 'changes '}
            {diff.path}
          </text>
          <diff diff={diff.patch} view="unified" showLineNumbers height={diff.rows} />
          {diff.omitted > 0 ? (
            <text attributes={DIM}>… {diff.omitted} more line(s) not shown</text>
          ) : null}
        </>
      ) : (
        <text>{summary.split('\n').slice(0, 6).join('\n')}</text>
      )}
      <text attributes={DIM}>y approve · n deny</text>
    </box>
  );
}

export function UiPrompt({
  pending,
  busy,
  onRespond,
  onCancel,
  theme,
}: {
  pending: PendingUiRequest;
  busy: boolean;
  onRespond: (value: unknown) => void;
  onCancel: () => void;
  theme: Theme;
}) {
  const options = pending.options ?? [];

  /**
   * Only the keys the *banner* owns: `esc` to cancel, and `y`/`n` for a
   * confirm, which has no renderable of its own.
   *
   * The select and input kinds used to be answered from here too — a `cursor`
   * in `useState` walked by hand on every arrow, and a string that characters
   * were appended to one at a time. `esc` stays global because a global handler
   * runs *before* the focused renderable and can take the key outright, which
   * is the only way to cancel out of an input that would otherwise treat it as
   * its own.
   */
  useKeyboard((key: KeyEvent) => {
    if (busy) return;
    const name = key.name ?? '';
    if (name === 'escape') {
      key.preventDefault();
      onCancel();
      return;
    }
    if (pending.kind !== 'confirm') return;
    const lower = name.toLowerCase();
    if (lower !== 'y' && lower !== 'n') return;
    key.preventDefault();
    onRespond(lower === 'y');
  });

  return (
    <box
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={theme.blocked}
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={theme.blocked}>{pending.prompt}</text>
      {pending.kind === 'select' ? (
        <select
          focused={!busy}
          // `SelectOption` names the visible half `name` and keeps `value` for
          // what gets sent, which is the same split the wire makes.
          options={options.map((option) => ({
            name: option.label,
            description: '',
            value: option.value,
          }))}
          showDescription={false}
          wrapSelection
          // Sized to the list so the banner does not reserve rows for options
          // that do not exist, and capped so a long list scrolls rather than
          // pushing the composer off the screen.
          height={Math.max(1, Math.min(options.length, SELECT_ROWS))}
          showScrollIndicator={options.length > SELECT_ROWS}
          onSelect={(_index, option) => onRespond(option?.value ?? '')}
        />
      ) : pending.kind === 'confirm' ? (
        <text attributes={DIM}>y yes · n no · esc cancel</text>
      ) : (
        // A real editor: a cursor, word motion, undo, and a paste that arrives
        // whole. The version this replaces read single-character key names, so
        // pasting a branch name put nothing in the field at all.
        <input focused={!busy} placeholder="type an answer · enter sends" onSubmit={onRespond} />
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
  theme,
}: {
  summary: string;
  onAnswer: (ok: boolean) => void;
  theme: Theme;
}) {
  useKeyboard((key: KeyEvent) => {
    const name = key.name?.toLowerCase();
    if (name !== 'y' && name !== 'n') return;
    key.preventDefault();
    onAnswer(name === 'y');
  });

  return (
    // A column, not a row. The summary ends in an **absolute** path — that is
    // the whole point of it — and beside a second text in a row, a path longer
    // than the remaining width wraps *around* the keys: `write
    // /Users/blake/Projects/felix-web/apps/tui/src/y allow · n` on one line and
    // `ui/some/deeply/nested/file.tsx?  refuse` on the next. Unreadable, on the
    // one prompt in this client that authorizes a write to your disk.
    <box
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={theme.danger}
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={theme.danger}>{summary}?</text>
      {/* Their own row, and never a `bottomTitle`: a title too long for the
          border is dropped silently, and the keys that answer this must not be
          the thing that disappears on a narrow terminal. */}
      <text attributes={DIM}>y allow · n refuse</text>
    </box>
  );
}
