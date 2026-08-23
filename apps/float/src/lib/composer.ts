/**
 * What a key press in the composer means.
 *
 * Kept apart from `App.tsx` because this is the part that carried the bug: the
 * composer used to be disabled for the whole run, which made Steer — the one
 * control that only exists during a run — unreachable. The rules are small,
 * order-dependent, and worth pinning in tests rather than re-deriving from a
 * chain of conditionals inside a 1,300-line component.
 */
export interface ComposerKey {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  /** True while an IME candidate window is open. */
  isComposing: boolean;
}

export interface ComposerState {
  /** A turn is in flight. */
  streaming: boolean;
  /** The textarea holds something other than whitespace. */
  hasText: boolean;
}

export type ComposerAction =
  /** Let the browser insert a newline. */
  | 'newline'
  /** Swallow the key and do nothing. */
  | 'ignore'
  /** Start a new turn. */
  | 'run'
  /** Redirect the turn already running. */
  | 'steer'
  /** Queue behind the turn already running. */
  | 'follow_up';

export function composerKeyAction(event: ComposerKey, state: ComposerState): ComposerAction {
  // An IME fires Enter to commit a candidate. Acting on it sends a half-typed
  // word and loses the composition, so it is never ours to interpret.
  if (event.isComposing) return 'newline';
  if (event.key !== 'Enter') return 'newline';
  if (event.shiftKey) return 'newline';
  if (!state.hasText) return 'ignore';
  if (!state.streaming) return 'run';
  return event.metaKey || event.ctrlKey ? 'steer' : 'follow_up';
}
