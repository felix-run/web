import { isFailure, tsToMs } from '@/components/inspector/primitives';
import { eventOutcome, isFailureOutcome, type OutcomeEvent } from '@/lib/audit-outcome';

/**
 * What the sidebar's glances read, apart from the pages that also read it.
 *
 * The Jobs and Activity pages share their polls with the rail's glance under
 * these keys, and the rail is in the entry chunk while the pages load with
 * `/harness`. Kept in their own module so the glance does not pull either page
 * in with it — importing `failing` from `jobs-sheet.tsx` was enough to put the
 * whole workbench in every first load.
 */

/** The key the Jobs page and the rail's glance share their `listJobs` read under. */
export const JOBS_POLL_KEY = 'jobs';

/** A job whose last run did not succeed. */
export function failing(j: { last_status?: string | null; last_error?: string | null }): boolean {
  return Boolean(j.last_error) || (j.last_status != null && isFailure(j.last_status));
}

/**
 * How many events the window covers. This is a request cap, not a total, and the
 * footer has to say so: `/audit` returns no count of what it did not send, so the
 * honest phrasing is "the last 60" rather than a number that looks like a census.
 * Upstream allows up to 500.
 */
export const ACTIVITY_FETCH = 60;

/**
 * The rail's Activity glance counts failures in this window, where the page counts
 * them over its last `ACTIVITY_FETCH` events — on a quiet tenant those span weeks,
 * and one old failure kept the rail red for all of them. The header states both
 * so the two numbers cannot read as a contradiction.
 */
export const ACTIVITY_GLANCE_MS = 24 * 60 * 60 * 1000;
export const ACTIVITY_GLANCE_SPAN = '24h';

/**
 * Failures in the Activity page glance's window, which ends at `now`.
 *
 * Read as the page reads them (`eventOutcome`): an approval's denial is not a
 * failure, and nor is the reply the harness marks `error` after one. Counting both
 * put `Activity · 2 failed` in red beside a thread where someone had declined one
 * write. A reply is read among its thread's events, the nearest the glance has to
 * its turn.
 */
export function recentFailures(events: (OutcomeEvent & { ts: number })[], now: number): number {
  const since = now - ACTIVITY_GLANCE_MS;
  const byThread = new Map<unknown, OutcomeEvent[]>();
  for (const e of events) {
    const k = e.payload?.thread_id ?? null;
    byThread.set(k, [...(byThread.get(k) ?? []), e]);
  }
  return events.filter(
    (e) =>
      e.ts != null &&
      tsToMs(e.ts) >= since &&
      isFailureOutcome(eventOutcome(e, byThread.get(e.payload?.thread_id ?? null))),
  ).length;
}

/**
 * The rail's Skills glance: drafts waiting for review, read on their own slow
 * poll. The Skills page reads the same queue through its Query cache, which
 * lives in the lazy library chunk — sharing a key would pull that chunk into
 * the entry, which is the mistake this module exists to prevent.
 */
export const SKILL_QUEUE_POLL_KEY = 'skill-review-queue';

/** How many drafts the glance reads; a fuller queue says `100+`. */
export const SKILL_QUEUE_GLANCE_LIMIT = 100;

/** The key Activity and the rail's glance share their audit read under. */
export const AUDIT_POLL_KEY = `audit:${ACTIVITY_FETCH}`;
