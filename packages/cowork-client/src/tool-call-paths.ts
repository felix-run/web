/**
 * The paths a tool call already named.
 *
 * Prose says `foo.md`. The tool call that created it said `/home/lars/foo.md`.
 * Without that, a bare name can only be resolved against the indexed workspace —
 * so a file the agent wrote somewhere else, or wrote just now, either resolves
 * to the wrong `foo.md` or to nothing at all.
 *
 * These are hints, not answers: the resolver still has to match one against the
 * mention. What they add is the full path, which the message itself never
 * carries.
 *
 * ## Why only paths with a directory
 *
 * A bare name from a tool call tells the resolver nothing the basename index
 * does not already know. A path with a `/` is the entire point — it is what
 * disambiguates `foo.md` from the other three.
 */

import { findFileMentions } from './file-mentions';

/** Ceilings, so a large tool payload cannot stall a render. */
const MAX_STRINGS = 24;
const MAX_STRING_LENGTH = 4_000;
const MAX_DEPTH = 2;

/**
 * Every path-shaped string in a tool call's arguments.
 *
 * The same prose heuristic runs over each string, so the exclusions that keep
 * version numbers and hostnames out of the transcript keep them out of here too
 * — arguments carry plenty of both.
 */
export function collectToolCallPaths(args: unknown): string[] {
  const strings: string[] = [];

  const walk = (value: unknown, depth: number): void => {
    if (strings.length >= MAX_STRINGS) return;
    if (typeof value === 'string') {
      strings.push(value.slice(0, MAX_STRING_LENGTH));
      return;
    }
    if (value === null || typeof value !== 'object') return;
    // An array does not count as a level: `{ edits: [{ path }] }` is an
    // ordinary shape, and charging it a level would put the path out of reach.
    if (Array.isArray(value)) {
      for (const child of value) walk(child, depth);
      return;
    }
    if (depth >= MAX_DEPTH) return;
    for (const child of Object.values(value)) walk(child, depth + 1);
  };
  walk(args, 0);

  const paths = new Set<string>();
  for (const text of strings) {
    for (const mention of findFileMentions(text)) {
      if (mention.path.includes('/')) paths.add(mention.path);
    }
  }
  return [...paths];
}
