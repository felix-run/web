import type { ApprovalRequest } from '@felix/client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { listApprovals } from '@/api';
import { rememberDecidedHere } from '@/lib/denials';

/** Slow: a TTL is minutes long, and this runs for the life of the tab. */
export const PENDING_APPROVALS_POLL_MS = 10_000;

/**
 * How long a decision this tab made outranks a poll that still lists the row.
 *
 * Three ticks: long enough to cover a poll already in flight when the decision
 * was posted and the harness's own write, short enough that a row the harness
 * genuinely still holds — `create_pending` reuses one pending row for every
 * byte-identical call, so an id can come back — is offered again within a tick
 * or two rather than hidden for good.
 */
export const DECIDED_GRACE_MS = 30_000;

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
  /**
   * Failed ticks in a row since the last good one. One is usually the harness
   * shedding a burst (a 429) and the next tick answers; a consumer that turns
   * red on the first cried wolf every time. Two is a failure worth a colour.
   */
  failures: number;
  refresh: () => void;
  /**
   * Record that this tab just decided an approval, after the decision succeeded.
   *
   * The row leaves `pending` at once, and a poll that still lists it — one
   * already in flight, or the next tick before the harness has written — does not
   * put it back. Without this, deciding from the transcript banner handed the row
   * to the attention line: the banner stopped owning it the moment it was
   * decided, the line's list was up to a poll old, so the line opened itself and
   * offered Approve on a call that had already been answered.
   */
  markDecided: (id: string) => void;
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
  const [failures, setFailures] = useState(0);
  /** Approval id → when this tab decided it. See `markDecided`. */
  const decided = useRef(new Map<string, number>());

  const refresh = useCallback(() => {
    void listApprovals('pending')
      .then((rows) => {
        const now = Date.now();
        for (const [id, at] of decided.current) {
          // Gone from the harness's list, or past the grace: stop overriding it.
          if (now - at >= DECIDED_GRACE_MS || !rows.some((r) => r.id === id)) {
            decided.current.delete(id);
          }
        }
        setPending(rows.filter((r) => !decided.current.has(r.id)));
        setError(null);
        setFailures(0);
        setLastOkAt(Date.now());
      })
      // No toast: the harness being unreachable is already reported by the
      // composer's connection hint and by every call the operator makes on
      // purpose, and a toast per failed background tick would be a second,
      // louder channel for something they did not ask for. Not silent, though —
      // the failure is state, and the line says it in words.
      .catch((err: unknown) => {
        setError(err ?? new Error('approvals poll failed'));
        setFailures((n) => n + 1);
      });
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, PENDING_APPROVALS_POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const markDecided = useCallback((id: string) => {
    decided.current.set(id, Date.now());
    // Every decision this tab makes passes through here, after the harness took
    // it, so this is the evidence a denied card needs to say "Denied by you".
    rememberDecidedHere(id);
    setPending((rows) => rows.filter((r) => r.id !== id));
  }, []);

  return { pending, error, lastOkAt, failures, refresh, markDecided };
}
