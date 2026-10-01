import { useCallback, useMemo, useState } from 'react';
import type { FileUIPart } from '@/lib/ai-types';

/**
 * A message written while a run was going, held here until it is sent.
 *
 * Held in the tab rather than handed to the harness, and that is the point.
 * `POST /chat/steer` is the only queue the harness offers, and it offers no way
 * back: a queued steer or follow-up cannot be listed, edited or withdrawn. A
 * steer also cancels the run's remaining tool calls the moment it lands. So
 * Enter mid-run used to interrupt tools the operator could not see, with a
 * message they could no longer change. Holding it here keeps every one of
 * those decisions open until the operator makes it.
 */
export type QueuedMessage = { id: string; text: string; files: FileUIPart[] };

type ThreadQueue = { items: QueuedMessage[]; paused: boolean };

const EMPTY: ThreadQueue = { items: [], paused: false };

/**
 * One queue per thread, so leaving a thread mid-run neither loses what was
 * queued on it nor sends it into the thread being entered.
 *
 * `paused` is the queue's own state, not the run's: it is set when the
 * operator stops a run or a run fails — a queued "now do the next step" sent
 * after either would be the client deciding to carry on for them — and it is
 * cleared only by the operator.
 */
export function useMessageQueue(threadId: string) {
  const [queues, setQueues] = useState<Record<string, ThreadQueue>>({});
  const current = queues[threadId] ?? EMPTY;

  const update = useCallback(
    (fn: (q: ThreadQueue) => ThreadQueue) =>
      setQueues((all) => ({ ...all, [threadId]: fn(all[threadId] ?? EMPTY) })),
    [threadId],
  );

  const enqueue = useCallback(
    (message: Omit<QueuedMessage, 'id'>) =>
      update((q) => ({ ...q, items: [...q.items, { ...message, id: crypto.randomUUID() }] })),
    [update],
  );

  /** Take one message out of the queue, for the caller to send or edit. */
  const take = useCallback(
    (id: string): QueuedMessage | undefined => {
      const found = current.items.find((m) => m.id === id);
      if (found) update((q) => ({ ...q, items: q.items.filter((m) => m.id !== id) }));
      return found;
    },
    [current.items, update],
  );

  /** Put a message back at the front — a send that failed keeps its place. */
  const restore = useCallback(
    (message: QueuedMessage) =>
      update((q) =>
        q.items.some((m) => m.id === message.id) ? q : { ...q, items: [message, ...q.items] },
      ),
    [update],
  );

  const move = useCallback(
    (id: string, delta: -1 | 1) =>
      update((q) => {
        const from = q.items.findIndex((m) => m.id === id);
        const to = from + delta;
        if (from < 0 || to < 0 || to >= q.items.length) return q;
        const items = [...q.items];
        [items[from], items[to]] = [items[to], items[from]];
        return { ...q, items };
      }),
    [update],
  );

  const setPaused = useCallback((paused: boolean) => update((q) => ({ ...q, paused })), [update]);
  const clear = useCallback(() => update(() => EMPTY), [update]);

  return useMemo(
    () => ({
      items: current.items,
      paused: current.paused,
      enqueue,
      take,
      restore,
      move,
      setPaused,
      clear,
    }),
    [current, enqueue, take, restore, move, setPaused, clear],
  );
}

export type MessageQueue = ReturnType<typeof useMessageQueue>;
