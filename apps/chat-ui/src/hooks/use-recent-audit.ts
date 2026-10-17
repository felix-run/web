import { listAudit } from '@/api';
import { useSharedPoll } from '@/hooks/useSharedPoll';
import { ACTIVITY_FETCH, AUDIT_ERRORS_POLL_KEY, AUDIT_POLL_KEY } from '@/lib/harness-glances';

/**
 * The newest `ACTIVITY_FETCH` audit events, on the one shared 30s poll.
 *
 * Three things read it: the sidebar's Activity glance, the thread rows' *Failed*
 * mark and the Jobs page's per-job outcome. One key, so they cost one request
 * between them and cannot disagree about what failed. A key must always mean the
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
