/**
 * Getting text out of a full-screen client.
 *
 * The alternate screen is the whole problem. A terminal's own selection reads
 * the rows the *terminal* drew, and inside an alt-screen app those rows belong
 * to the renderer — so dragging across a code block the agent wrote either
 * selects nothing useful or selects whatever the terminal thinks is underneath.
 * The renderer runs its own selection instead, which highlights correctly and
 * then has nowhere to put the result.
 *
 * OSC 52 is the way across: a sequence that hands text to the terminal
 * emulator, which puts it on the system clipboard — and works over ssh, where
 * nothing local can reach the clipboard at all. Not every terminal implements
 * it, and some that do require it to be turned on, so this reports what
 * happened rather than assuming.
 */

/** The slice of `CliRenderer` this needs, so a test does not need a terminal. */
export interface ClipboardTarget {
  isOsc52Supported(): boolean;
  copyToClipboardOSC52(text: string): boolean;
}

export type CopyResult =
  | { status: 'copied'; characters: number }
  | { status: 'empty' }
  | { status: 'unsupported' }
  | { status: 'failed' };

/**
 * Put a selection on the clipboard, and say which of the four things happened.
 *
 * `unsupported` and `failed` are kept apart on purpose: the first is a terminal
 * that never claimed to do this, which is worth saying once and quietly, and
 * the second is one that claimed to and did not, which is worth saying loudly.
 */
export function copyText(target: ClipboardTarget, text: string): CopyResult {
  const trimmed = text.trim();
  if (!trimmed) return { status: 'empty' };
  if (!target.isOsc52Supported()) return { status: 'unsupported' };
  // The sequence is written to the tty, so what is copied is what was selected
  // — no re-encoding, no truncation here. A terminal that caps the payload is
  // making its own decision about a very large selection.
  return target.copyToClipboardOSC52(text)
    ? { status: 'copied', characters: text.length }
    : { status: 'failed' };
}

/** What to put in the status line, or nothing when there is nothing to say. */
export function describeCopy(result: CopyResult): string | null {
  switch (result.status) {
    case 'copied':
      return `copied ${result.characters} character${result.characters === 1 ? '' : 's'}`;
    case 'unsupported':
      return 'this terminal does not accept clipboard writes (OSC 52)';
    case 'failed':
      return 'the terminal refused the clipboard write';
    case 'empty':
      return null;
  }
}
