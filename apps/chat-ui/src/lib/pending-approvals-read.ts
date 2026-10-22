/**
 * One `GET /approvals?status=pending` for everything that asks while it is in flight.
 *
 * The list is tenant-wide, and several things read it on their own clocks: the attention
 * line's poll (`usePendingApprovals`, every 10s, for the whole tenant), and every live
 * engine adopting its thread's rows (`engine.syncApprovals`, every 2.5s while anything
 * runs). The engines' ticks fire together, as does everything on load and on return to the
 * page, so with N runs in this tab that was N+1 identical requests at once. Each reader
 * filters the same rows for itself, so one answer serves them all.
 *
 * Only a read still in flight is shared, never a finished one: a caller asking after an
 * answer arrived — a refresh after a decision the harness refused, say — wants the list as
 * it is now, not as it was a moment ago.
 */
import type { ApprovalRequest } from '@felix/client';
import { listApprovals } from '@/api';

let inFlight: Promise<ApprovalRequest[]> | null = null;

export function readPendingApprovals(): Promise<ApprovalRequest[]> {
  if (inFlight) return inFlight;
  const read = listApprovals('pending');
  inFlight = read;
  const done = () => {
    if (inFlight === read) inFlight = null;
  };
  read.then(done, done);
  return read;
}

/** The next read asks the harness, even with one in flight. For a decision just made. */
export function forgetPendingApprovalsRead(): void {
  inFlight = null;
}
