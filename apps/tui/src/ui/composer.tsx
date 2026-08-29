/**
 * The input line.
 *
 * Ink ships no text input, and `ink-text-input` is a dependency for one
 * controlled string — so this is `useInput` with a cursor. What it does own is
 * the distinction the chat surface actually needs: while a run is live, Enter
 * *steers* rather than starting a turn, and the placeholder says so, because
 * typing into a busy agent and having nothing happen is the failure people
 * report as "it froze".
 *
 * ↑/↓ walk the prompt history. The draft in progress is kept aside on the way
 * in, so stepping back out of history returns what was being typed rather than
 * an empty line.
 */
import { Box, Text, useInput } from 'ink';
import { useState } from 'react';

export interface ComposerProps {
  streaming: boolean;
  disabled: boolean;
  onSubmit: (text: string) => void;
  /** Previously submitted lines, oldest first. */
  history?: string[];
  hint?: string;
}

export function Composer({ streaming, disabled, onSubmit, history = [], hint }: ComposerProps) {
  const [value, setValue] = useState('');
  /** Index into `history`, or null while editing the draft. */
  const [recalled, setRecalled] = useState<number | null>(null);
  const [draft, setDraft] = useState('');

  /**
   * Leaving a recalled entry is a state change; typing inside the draft is not.
   * Setting `recalled` to the null it already holds on every keystroke is the
   * redundant update this repo has already paid for once — React bails out of
   * those but still counts them toward the nested-update limit.
   */
  const edit = (next: (v: string) => string) => {
    if (recalled !== null) setRecalled(null);
    setValue(next);
  };

  useInput(
    (input, key) => {
      if (key.return) {
        const text = value.trim();
        if (!text) return;
        setValue('');
        setRecalled(null);
        setDraft('');
        onSubmit(text);
        return;
      }
      if (key.upArrow) {
        if (!history.length) return;
        if (recalled === null) setDraft(value);
        const next = recalled === null ? history.length - 1 : Math.max(0, recalled - 1);
        setRecalled(next);
        setValue(history[next] ?? '');
        return;
      }
      if (key.downArrow) {
        if (recalled === null) return;
        // Past the newest entry is the draft again, not a wrap around.
        if (recalled >= history.length - 1) {
          setRecalled(null);
          setValue(draft);
          return;
        }
        setRecalled(recalled + 1);
        setValue(history[recalled + 1] ?? '');
        return;
      }
      if (key.backspace || key.delete) {
        edit((v) => v.slice(0, -1));
        return;
      }
      // Ctrl/meta chords belong to the app, not the text.
      if (key.ctrl || key.meta || key.escape || key.tab) return;
      if (key.leftArrow || key.rightArrow) return;
      if (input) edit((v) => v + input);
    },
    { isActive: !disabled },
  );

  return (
    <Box>
      <Text color={streaming ? 'yellow' : 'green'}>{streaming ? '⇥ ' : '> '}</Text>
      <Text>{value}</Text>
      {!disabled ? <Text inverse> </Text> : null}
      {!value && hint ? <Text dimColor>{hint}</Text> : null}
    </Box>
  );
}
