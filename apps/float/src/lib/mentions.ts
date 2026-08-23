/**
 * Turning the file names in a message into confirmed, clickable paths.
 *
 * Resolution is deliberately not part of rendering. The scan is cheap and
 * synchronous; confirming a path against the workspace is neither, and a
 * transcript that re-reads the filesystem on every React render during a stream
 * would be unusable. So a message renders as plain text first and the links
 * arrive a beat later, once the workspace has answered.
 */

import { FileMentionResolver, findFileMentions, workspaceSource } from '@felix/cowork-client';
import { useEffect, useState } from 'react';
import { vfs } from '@/lib/client-tools';

/** One resolver per tab, so its index is shared across every message. */
const resolver = new FileMentionResolver(workspaceSource(vfs));

/** Call after a tool runs — the workspace may have gained the file just named. */
export function invalidateMentions(): void {
  resolver.invalidate();
}

/** How many recently-named paths stay available as hints. */
export const HINT_LIMIT = 200;

/**
 * The paths known at each point in a transcript.
 *
 * Entry `i` holds what the agent had already named *before* row `i`. The cutoff
 * is the point: a path from a later tool call must not reach back and claim an
 * earlier mention, or "see foo.md" resolves to a file that did not exist when
 * it was written.
 */
export function hintsByRow(rows: ReadonlyArray<{ paths?: string[] }>): string[][] {
  const out: string[][] = [];
  let known: string[] = [];
  for (const row of rows) {
    out.push(known);
    if (row.paths?.length) known = [...known, ...row.paths].slice(-HINT_LIMIT);
  }
  return out;
}

/** Confirmed mentions for one message: the raw text -> the path it opens. */
export type ResolvedMentions = ReadonlyMap<string, string>;

const EMPTY: ResolvedMentions = new Map();

/**
 * Resolve the mentions in `text`, or nothing while `enabled` is false.
 *
 * Disabled for a message still streaming: it is rewritten on every delta, and
 * half a path resolves to nothing anyway. Links land with the finished message.
 */
export function useFileMentions(
  text: string,
  enabled: boolean,
  hints: readonly string[] = [],
): ResolvedMentions {
  const [resolved, setResolved] = useState<ResolvedMentions>(EMPTY);
  // Hints are rebuilt on every render, so depend on their content rather than
  // the array identity or the effect never settles.
  const hintKey = hints.join('\n');

  useEffect(() => {
    if (!enabled || !text) {
      setResolved(EMPTY);
      return;
    }
    // The cheap synchronous half runs first: most messages name no files at
    // all, and those must not touch the workspace.
    const found = findFileMentions(text);
    if (found.length === 0) {
      setResolved(EMPTY);
      return;
    }

    let cancelled = false;
    const queries = [...new Set(found.map((m) => m.path))];
    void resolver.resolveAll(queries, hintKey ? hintKey.split('\n') : []).then((results) => {
      if (cancelled) return;
      const map = new Map<string, string>();
      results.forEach((result, i) => {
        const query = queries[i];
        const target = result.matches[0];
        if (query && target) map.set(query, target);
      });
      setResolved(map.size ? map : EMPTY);
    });
    return () => {
      cancelled = true;
    };
  }, [text, enabled, hintKey]);

  return resolved;
}
