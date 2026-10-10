import { useSyncExternalStore } from 'react';
import type { DenialRecord } from '@/lib/denials';
import type { ToolCall } from '@/types';

/**
 * What the transcript on screen knows about its denied calls, for the tool card
 * to read.
 *
 * A small store rather than props, because the card sits three components below
 * the workbench and only the workbench knows the thread, the approval rows and
 * the composer; and rather than a context provider, because wrapping the
 * conversation in one re-indented the whole transcript for one value. There is
 * one transcript on screen, so there is one value. Unset (a card rendered on its
 * own, as the tests do), a denied card says *Denied* and offers nothing, which
 * is the honest floor.
 */
export interface DenialContextValue {
  /** The approval row matched to this card, when the match is certain. */
  recordOf(tool: ToolCall): DenialRecord | null;
  /** Put a request to try again in the composer, or `null` when this card offers none. */
  askAgainFor(tool: ToolCall): (() => void) | null;
}

let current: DenialContextValue | null = null;
const listeners = new Set<() => void>();

/** Publish the transcript's denials; `null` when it unmounts. */
export function setDenials(value: DenialContextValue | null): void {
  current = value;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const snapshot = () => current;

export function useDenial(tool: ToolCall): {
  record: DenialRecord | null;
  askAgain: (() => void) | null;
} {
  const ctx = useSyncExternalStore(subscribe, snapshot, snapshot);
  return { record: ctx?.recordOf(tool) ?? null, askAgain: ctx?.askAgainFor(tool) ?? null };
}
