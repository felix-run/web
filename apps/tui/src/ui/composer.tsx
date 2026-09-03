/**
 * The input line — a real editor now, rather than a string with a cursor drawn
 * after it.
 *
 * The Ink version hand-rolled everything: no cursor, no selection, no way to
 * write a second line except handing the whole thing to `$EDITOR`. This is a
 * `textarea` over an edit buffer that already has word motion, line kills,
 * selection and undo, so none of that is our code any more.
 *
 * Two things it still owns, because they are policy rather than editing:
 *
 * **Enter sends.** The renderer's defaults are the opposite of a chat prompt —
 * `return` inserts a newline and `meta+return` submits. They are a plain array,
 * so `CHAT_BINDINGS` states what this prompt means instead: Enter sends,
 * shift+Enter opens a line. Shift+Enter needs the kitty keyboard protocol,
 * which is the only way a terminal reports that modifier on Enter at all; a
 * terminal without it keeps Enter-sends and loses only the second line.
 *
 * **A paste is not typing, and never a send.** The paste event carries bytes
 * with the newlines intact, and left alone the buffer strips them and runs the
 * last word of one line into the first of the next. It is preventable, which is
 * the hook: intercept, flatten, insert that instead.
 *
 * While a run is live, Enter *steers* rather than starting a turn, and the
 * placeholder says so — typing into a busy agent and having nothing happen is
 * the failure people report as "it froze".
 */

import type { KeyBinding, KeyEvent, TextareaRenderable } from '@opentui/core';
import { useKeyboard, usePaste } from '@opentui/react';
import { useRef, useState } from 'react';
import type { Theme } from '../theme.js';

/** Any newline, and any run of them, however the source spelled it. */
const HAS_NEWLINE = /[\r\n]/;
const NEWLINES = /[\r\n]+/g;
const TRAILING_SPACE = /\s+$/;

/**
 * A pasted paragraph becomes one line.
 *
 * The newlines in a paste are joined with spaces rather than dropped, which
 * would run the last word of one line into the first of the next. The trailing
 * newline almost every copied block carries is not a word boundary, so it goes.
 *
 * A paste is not typing: what was copied as prose is sent as prose. Newlines
 * typed deliberately, with shift+Enter, are kept — that is the difference.
 */
export function flattenPaste(text: string): string {
  if (!HAS_NEWLINE.test(text)) return text;
  return text.replace(NEWLINES, ' ').replace(TRAILING_SPACE, '');
}

/**
 * What Enter means here.
 *
 * `linefeed` is bound to `newline` deliberately: a terminal that ignores
 * bracketed paste delivers a pasted block as raw bytes with LF in them, and
 * with LF bound to submit that paste sends itself halfway through.
 */
const CHAT_BINDINGS: KeyBinding[] = [
  { name: 'return', action: 'submit' },
  { name: 'kpenter', action: 'submit' },
  { name: 'return', shift: true, action: 'newline' },
  { name: 'linefeed', action: 'newline' },
];

export interface ComposerProps {
  streaming: boolean;
  disabled: boolean;
  onSubmit: (text: string) => void;
  /** Previously submitted lines, oldest first. */
  history?: string[];
  /** Hand the line to an editor; resolves with the edit, or nothing. */
  onEdit?: (value: string) => Promise<string | undefined>;
  hint?: string;
  theme: Theme;
}

export function Composer({
  streaming,
  disabled,
  onSubmit,
  history = [],
  onEdit,
  hint,
  theme,
}: ComposerProps) {
  const ref = useRef<TextareaRenderable>(null);
  /** The editor owns the terminal while this is true; nothing else may. */
  const [editing, setEditing] = useState(false);
  /** Index into `history`, or null while editing the draft. */
  const recalled = useRef<number | null>(null);
  const draft = useRef('');

  const active = !disabled && !editing;
  const read = () => ref.current?.plainText ?? '';
  const write = (text: string) => ref.current?.setText(text);

  const submit = () => {
    const text = read().trim();
    if (!text) return;
    write('');
    recalled.current = null;
    draft.current = '';
    onSubmit(text);
  };

  /**
   * A global handler sees the key before the focused renderable does and can
   * take it outright, which is the whole reason history and the editor hotkey
   * can live beside a textarea that would otherwise consume them.
   *
   * History is only offered while the draft is a single line. In a one-line
   * prompt ↑ could only ever mean "the last thing I sent"; here it also means
   * "up a line", and the cursor has the better claim the moment there is a line
   * to move to.
   */
  useKeyboard((key: KeyEvent) => {
    if (!active) return;
    if (key.ctrl && key.name === 'e') {
      key.preventDefault();
      if (!onEdit) return;
      setEditing(true);
      void onEdit(read())
        .then((next) => {
          if (next !== undefined) write(next);
        })
        .finally(() => setEditing(false));
      return;
    }
    if (key.name !== 'up' && key.name !== 'down') return;
    const value = read();
    if (HAS_NEWLINE.test(value)) return;

    if (key.name === 'up') {
      if (!history.length) return;
      key.preventDefault();
      if (recalled.current === null) draft.current = value;
      const next =
        recalled.current === null ? history.length - 1 : Math.max(0, recalled.current - 1);
      recalled.current = next;
      write(history[next] ?? '');
      return;
    }
    if (recalled.current === null) return;
    key.preventDefault();
    // Past the newest entry is the draft again, not a wrap around.
    if (recalled.current >= history.length - 1) {
      recalled.current = null;
      write(draft.current);
      return;
    }
    recalled.current += 1;
    write(history[recalled.current] ?? '');
  });

  /**
   * A paste is never a send. The text lands in the prompt and waits for Enter —
   * what reaches the model has to be what was read on screen, and a copied
   * block ending in a newline would otherwise submit itself unseen.
   */
  usePaste((event) => {
    if (!active) return;
    const raw = new TextDecoder().decode(Uint8Array.from(Array.from(event.bytes)));
    event.preventDefault();
    const flat = flattenPaste(raw);
    if (flat) ref.current?.insertText(flat);
  });

  return (
    // Framed, because an unframed prompt does not read as somewhere you type —
    // it reads as the last line of the transcript. The border also gives the
    // hint somewhere to live that is not a row of its own: `bottomTitle` costs
    // nothing vertically, where the old inline hint cost a line the
    // conversation could have had.
    <box
      flexDirection="row"
      // Never give ground to the transcript. The transcript grows to fill, and
      // with a conversation longer than the screen it will take these rows too:
      // the input line vanishes and the marker is squashed into the bottom
      // border, leaving a box you cannot type in and no sign of why.
      flexShrink={0}
      border
      borderStyle="rounded"
      borderColor={active ? theme.ready : theme.faint}
      bottomTitle={hint ?? ''}
      bottomTitleAlignment="left"
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={streaming ? theme.running : theme.ready}>{streaming ? '⇥ ' : '> '}</text>
      <textarea
        ref={ref}
        focused={active}
        flexGrow={1}
        height={2}
        wrapMode="word"
        keyBindings={CHAT_BINDINGS}
        onSubmit={submit}
      />
    </box>
  );
}
