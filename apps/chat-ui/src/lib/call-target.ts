import { describeGate } from '@felix/client';

/** Argument keys that name what a call acts on, for tools with no sentence of their own. */
const TARGET_KEYS = ['path', 'file_path', 'url', 'query', 'target', 'command', 'name'] as const;

/**
 * What one tool call acts on, as a single line, or `null` when nothing names it.
 *
 * `describeGate` gives the three client tools their sentence (it is
 * `summarizeToolArgs` without the pretty-printed JSON fallback, which is right
 * for a card and wrong for one line). Any other tool gets the first argument
 * that names a target. Shared by the run readout's in-flight line and the
 * attention line's queue rows, so a call is described the same way in both.
 */
export function callTarget(name: string, args: Record<string, unknown>): string | null {
  const gate = describeGate(name, args);
  if (gate !== name) return gate;
  const key = TARGET_KEYS.find((k) => typeof args[k] === 'string' && args[k] !== '');
  return key ? String(args[key]) : null;
}
