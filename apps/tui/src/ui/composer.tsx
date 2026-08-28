/**
 * The input line.
 *
 * Ink ships no text input, and `ink-text-input` is a dependency for one
 * controlled string — so this is `useInput` with a cursor. What it does own is
 * the distinction the chat surface actually needs: while a run is live, Enter
 * *steers* rather than starting a turn, and the placeholder says so, because
 * typing into a busy agent and having nothing happen is the failure people
 * report as "it froze".
 */
import { Box, Text, useInput } from 'ink';
import { useState } from 'react';

export interface ComposerProps {
  streaming: boolean;
  disabled: boolean;
  onSubmit: (text: string) => void;
  hint?: string;
}

export function Composer({ streaming, disabled, onSubmit, hint }: ComposerProps) {
  const [value, setValue] = useState('');

  useInput(
    (input, key) => {
      if (key.return) {
        const text = value.trim();
        if (!text) return;
        setValue('');
        onSubmit(text);
        return;
      }
      if (key.backspace || key.delete) {
        setValue((v) => v.slice(0, -1));
        return;
      }
      // Ctrl/meta chords belong to the app, not the text.
      if (key.ctrl || key.meta || key.escape || key.tab) return;
      if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) return;
      if (input) setValue((v) => v + input);
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
