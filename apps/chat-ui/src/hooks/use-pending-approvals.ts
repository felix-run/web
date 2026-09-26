import type { ApprovalRequest } from '@felix/client';
import { useCallback, useEffect, useState } from 'react';
import { listApprovals } from '@/api';

/** Slow: a TTL is minutes long, and this runs for the life of the tab. */
export const PENDING_APPROVALS_POLL_MS = 10_000;

/**
 * The tenant's pending approvals, as last seen, and whether that is still true.
 *
 * `pending` is the **last list that arrived**, not the list as of now: a failed
 * tick keeps it rather than clearing it, because an approval that was waiting a
 * minute ago has not stopped waiting because a request failed. `error` is set by
 * the latest failed tick and cleared by the next good one, and `lastOkAt` is when
 * a list last arrived — null until one ever has. A consumer that claims "nothing
 * is waiting" must check both: an empty list nobody has refreshed is not an
 * answer, it is the absence of one. The attention line said all-clear for as long
 * as the harness was answering this route with 429, which is the failure this
 * shape exists to make impossible to render by accident.
 */
export interface PendingApprovals {
  pending: ApprovalRequest[];
  error: unknown;
  lastOkAt: number | null;
  refresh: () => void;
}

/**
 * Deliberately not `usePoll`.
 *
 * That hook skips ticks while the tab is hidden, which is right for a reference
 * panel nothing depends on while nobody is looking, and exactly wrong here: a
 * hidden tab is the case this poll exists to serve. It is the in-viewport half of
 * a pair whose other half is `presence.ts`, and both have to keep counting.
 *
 * Owned by the shell, once per tab, and handed to both of its readers — the
 * attention line and the thread list's blocked marker — so the two cannot
 * disagree about which threads are waiting and the tab pays for one poll.
 */
export function usePendingApprovals(): PendingApprovals {
  const [pending, setPending] = useState<ApprovalRequest[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);

  const refresh = useCallback(() => {
    void listApprovals('pending')
      .then((rows) => {
        setPending(rows);
        setError(null);
        setLastOkAt(Date.now());
      })
      // No toast: the harness being unreachable is already reported by the
      // composer's connection hint and by every call the operator makes on
      // purpose, and a toast per failed background tick would be a second,
      // louder channel for something they did not ask for. Not silent, though —
      // the failure is state, and the line says it in words.
      .catch((err: unknown) => setError(err ?? new Error('approvals poll failed')));
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, PENDING_APPROVALS_POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  return { pending, error, lastOkAt, refresh };
}
