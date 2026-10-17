import { listAudit } from '@/api';
import { useSharedPoll } from '@/hooks/useSharedPoll';
import {
  ACTIVITY_FETCH,
  AUDIT_ERRORS_POLL_KEY,
  AUDIT_POLL_KEY,
  glanceWindow,
  mergeReads,
  recentFailures,
} from '@/lib/harness-glances';
import type { FailureTally } from '@/lib/ledger';
import type { AuditEvent } from '@/types';

/**
 * The newest `ACTIVITY_FETCH` audit events, on the one shared 30s poll.
 *
 * The sidebar's Activity glance, the thread rows' *Failed* mark, the Jobs page's
 * per-job outcome and the Activity page's pointer to the week all read it. One
 * key, so they cost one request between them and read the same rows (what each
 * makes of them differs — see `threadOutcomes`). A key must always mean the
 * same fetch (`useSharedPoll`), which is why the fetch lives here and nowhere else.
 */
export function useRecentAudit(enabled = true) {
  return useSharedPoll(AUDIT_POLL_KEY, () => listAudit({ limit: ACTIVITY_FETCH }), {
    enabled,
    intervalMs: 30_000,
  });
}

/**
 * The newest `ACTIVITY_FETCH` events with status `error`, every minute: what lets
 * the glance count a week on a tenant where sixty events of everything are a few
 * hours (`AUDIT_ERRORS_POLL_KEY` says what was measured). A filter the harness
 * applies, so it costs one small response.
 */
export function useRecentErrors(enabled = true) {
  return useSharedPoll(
    AUDIT_ERRORS_POLL_KEY,
    () => listAudit({ status: 'error', limit: ACTIVITY_FETCH }),
    { enabled, intervalMs: 60_000 },
  );
}

/**
 * What failed in the glance's week, in threads (`recentFailures`), from the two
 * shared reads — the sidebar's `Activity · 1 thread failed · 7d`, a job row's
 * week, and the Activity page's pointer to it when its own window holds none.
 * One hook so all three say the same number.
 *
 * Two reads, merged: the newest failures, which reach back the week, and the
 * newest events of every kind, which hold the turns around them and a control's
 * refusals (`AUDIT_ERRORS_POLL_KEY` says why one was not enough). The window is
 * the failures read's, since that is the one counting back that far.
 */
export function useWeekFailures(enabled = true): {
  tally: FailureTally;
  /** Both reads, each event once — for a caller narrowing the tally (a job's threads). */
  events: AuditEvent[];
  /** Where the window starts, which `recentFailures` takes to count a narrower set the same way. */
  since: number;
  /** `7d`, or the shorter stretch the reads reached (`glanceWindow`). */
  span: string;
  /** One reading of both polls: answered only when both have, failed when either did. */
  poll: { data: unknown[] | undefined; error: unknown; lastOkAt: number | null };
} {
  const audit = useRecentAudit(enabled);
  const errors = useRecentErrors(enabled);
  // Measured against the clock at render, which the polls re-run, so a failure
  // ages out within a tick of turning a week old.
  const now = Date.now();
  const covered = glanceWindow(errors.data ?? audit.data ?? [], now);
  const events = mergeReads(errors.data, audit.data);
  const tally = recentFailures(events, now, covered.since);
  return {
    tally,
    events,
    since: covered.since,
    span: covered.span,
    poll: {
      data: audit.data && errors.data ? audit.data : undefined,
      error: audit.error ?? errors.error,
      lastOkAt:
        audit.lastOkAt != null && errors.lastOkAt != null
          ? Math.min(audit.lastOkAt, errors.lastOkAt)
          : null,
    },
  };
}
