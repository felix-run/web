/**
 * The prompt that stands between the model and your disk.
 *
 * A client tool wants to write; the executor awaits this promise, so the prompt
 * *is* the run. It must therefore never outlive the call that raised it. The
 * tool's own deadline resolves the promise the engine is waiting on but cannot
 * cancel the work — so a prompt left on screen would still write, minutes after
 * the model was told the tool timed out and moved on. This one answers itself
 * first, and is cancelled outright whenever the run is stopped.
 *
 * Lifted out of `app.tsx` unchanged. It is the smallest piece of that file with
 * the sharpest correctness story and it had no test of its own, which is a bad
 * combination for the one surface that authorizes writing to a real filesystem.
 */

import { useCallback, useRef, useState } from 'react';

/**
 * How long a write prompt may stand.
 *
 * Under `DEFAULT_CLIENT_TOOL_TIMEOUT_MS` (30s) on purpose: the executor's
 * deadline resolves the engine's promise but cannot stop the write, so this has
 * to be the one that fires first.
 */
export const WRITE_PROMPT_MS = 25_000;

export interface WriteGate {
  /** The summary on screen, or `null` when nothing is being asked. */
  prompt: string | null;
  /** Answer the standing prompt. */
  answer(ok: boolean): void;
  /** Ask, and resolve when a key or the deadline answers. Passed to the workspace. */
  confirm(summary: string): Promise<boolean>;
  /** Stopping the run takes the prompt with it — and refuses the write. */
  cancel(): void;
}

export function useWriteGate(timeoutMs = WRITE_PROMPT_MS): WriteGate {
  const [prompt, setPrompt] = useState<string | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const answer = useCallback((ok: boolean) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    resolver.current?.(ok);
    resolver.current = null;
    setPrompt(null);
  }, []);

  const confirm = useCallback(
    (summary: string) =>
      new Promise<boolean>((resolve) => {
        // A second request while one is pending refuses the first rather than
        // orphaning its resolver.
        resolver.current?.(false);
        if (timer.current) clearTimeout(timer.current);
        resolver.current = resolve;
        setPrompt(summary);
        timer.current = setTimeout(() => {
          resolver.current = null;
          timer.current = null;
          setPrompt(null);
          resolve(false);
        }, timeoutMs);
      }),
    [timeoutMs],
  );

  const cancel = useCallback(() => {
    if (resolver.current) answer(false);
  }, [answer]);

  return { prompt, answer, confirm, cancel };
}
