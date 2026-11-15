/**
 * What one audit event says happened, in the four words the app uses for a call.
 *
 * The audit row's `status` has three values, and `denied` covers two different
 * things: a control (a policy rule, a limit, a guardrail) refusing a call, and an
 * approval gate saying no. The first is a refusal the operator may need to fix;
 * the second is the gate doing what it is for, usually because a person chose it.
 * The row says which by `payload.control` (`approvals`), so the two are read apart
 * here and drawn apart everywhere: a denial is neutral, never `state-failed`.
 *
 * The other trap is the turn's own `final_response`. The harness writes it as
 * `error` when the run's last tool batch held any refused call (`any_denied` in
 * `patterns/react.py`), so one declined write made a thread read *Failed* twice:
 * once for the denial, once for "the turn". From `felix-run/felix@c779e48` the row
 * carries `denied_calls`, and a reply marked `error` because of a denial is read
 * as what it is, a reply after a denial, not a second failure.
 *
 * Light on purpose: the sidebar's Activity glance reads it, and that is in the
 * entry chunk.
 */

/** The fields this reads, so the glance can pass its narrower rows. */
export interface OutcomeEvent {
  event_type?: string;
  status: string;
  payload?: Record<string, unknown> | null;
}

/**
 * - `ok` — went through, or is not an outcome at all (a sign-in's `stored`).
 * - `denied` — an approval gate said no, a person or its deadline. Neutral.
 * - `refused` — another control stopped it before it ran. Red.
 * - `error` — it broke. Red.
 * - `after-denial` — a `final_response` the harness marked `error` only because
 *   the run's last calls were denied or refused. Not counted on its own.
 */
export type EventOutcome = 'ok' | 'denied' | 'refused' | 'error' | 'after-denial';

/** An approval gate's no, as the audit row records it. */
export function isApprovalDenial(e: OutcomeEvent): boolean {
  return e.status === 'denied' && e.payload?.control === 'approvals';
}

/**
 * The outcome of `e`. `siblings` are the other events of its turn, when known:
 * a harness older than `denied_calls` writes none, and then a reply marked
 * `error` in a turn holding a denial and no broken call is read as following it.
 */
export function eventOutcome(e: OutcomeEvent, siblings?: readonly OutcomeEvent[]): EventOutcome {
  if (e.status === 'denied') return isApprovalDenial(e) ? 'denied' : 'refused';
  if (e.status !== 'error' && e.status !== 'failed') return 'ok';
  if (e.event_type !== 'final_response') return 'error';
  const counted = e.payload?.denied_calls;
  if (typeof counted === 'number') return counted > 0 ? 'after-denial' : 'error';
  if (!siblings) return 'error';
  const broke = siblings.some(
    (s) =>
      s !== e &&
      s.event_type !== 'final_response' &&
      (s.status === 'error' || s.status === 'failed'),
  );
  return !broke && siblings.some((s) => s.status === 'denied') ? 'after-denial' : 'error';
}

/** Something went wrong: a broken call or a control's refusal. Never a denial. */
export function isFailureOutcome(o: EventOutcome): boolean {
  return o === 'error' || o === 'refused';
}
