/**
 * What a client may conclude from `GET /chat/runs/{resume_token}`.
 *
 * The harness decides when a durable run is over (`FIBER_TERMINAL_STATUSES` in
 * `durability/fibers.py`: `completed`, `failed`, `expired`, `dead`) and its run view
 * puts an `error` on only some of those — `expired` carries none. So "over" and "did it
 * finish" are two questions, answered here once for every poller.
 */
import type { DurableRun } from '@felix/protocol';

/**
 * Statuses a run never leaves. The harness's four, plus spellings an older or other
 * harness has used (`succeeded`, `error`, `cancelled`), plus `missing` — this client's
 * word for a run the harness answered 404 for.
 */
const TERMINAL = new Set([
  'completed',
  'succeeded',
  'failed',
  'error',
  'expired',
  'dead',
  'cancelled',
  'canceled',
  'missing',
]);

/** Consecutive failed reads `pollDurableRun` rides out before it gives up. */
export const MAX_POLL_FAILURES = 5;

/** A non-2xx from `/chat/runs`, carrying the status so a poller can tell 404 from a blip. */
export class DurableRunFetchError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'DurableRunFetchError';
  }
}

/** True once the run has reached a status it will never leave. */
export function isDurableRunOver(run: DurableRun): boolean {
  if (run.error) return true;
  return TERMINAL.has((run.status ?? '').toLowerCase());
}

/**
 * Why a finished run produced no answer, in words for the person waiting on it — or
 * null when it completed. The harness's own `error` wins when it sent one.
 */
export function durableRunFailure(run: DurableRun): string | null {
  const status = (run.status ?? '').toLowerCase();
  if (!run.error && (status === 'completed' || status === 'succeeded')) return null;
  if (run.error) return run.error;
  switch (status) {
    case 'expired':
      return 'The run reached its time limit and was stopped before it finished. Anything it wrote before then is kept.';
    case 'cancelled':
    case 'canceled':
      return 'The run was cancelled before it finished.';
    case 'dead':
      return 'The run failed repeatedly and was stopped.';
    default:
      return `The run ended without an answer (${status || 'unknown status'}).`;
  }
}
