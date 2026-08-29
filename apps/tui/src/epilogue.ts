/**
 * What is left on screen after the screen is gone.
 *
 * This is a full-screen client: the terminal is restored on exit and the whole
 * conversation goes with it, including the one thing needed to get back to it.
 * A thread id is not something anyone will have written down, and `--thread` is
 * the flag that takes it.
 *
 * A slot rather than a return value because the exit paths are several — ctrl+c,
 * `/quit`, a failure — and all of them end at the one `exit` in `main.tsx`,
 * which is the only place that can write to a terminal the renderer has given
 * back.
 */

export interface EpilogueSlot {
  text?: string;
}

export interface EpilogueInput {
  threadId: string;
  title?: string;
  /** Nothing was said, so there is nothing to come back to. */
  turns: number;
}

export function formatEpilogue(input: EpilogueInput): string | undefined {
  if (input.turns === 0) return undefined;
  const title = input.title?.trim();
  return [
    title ? `felix: ${title}` : 'felix:',
    `  rejoin with: felix --thread ${input.threadId}`,
  ].join('\n');
}
