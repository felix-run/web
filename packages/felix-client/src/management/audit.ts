/**
 * The activity feed and the per-tool rollups (`GET /audit`, `GET /audit/metrics`).
 *
 * `AuditEvent` and `AuditEventWire` share this file deliberately:
 * `scripts/check-payload-shapes.mjs` resolves an `extends` clause only within
 * the source it is reading, and the wire type is `Omit<AuditEvent, 'payload'>`.
 * Split them and the guard stops resolving the parent.
 */

import type { FelixHttp } from '../http';

/**
 * The four audit event types the harness actually writes.
 *
 * `emit_agent_audit` is the only writer, and it has three call sites: the ReAct
 * loop brackets a turn with `user_input` / `final_response`, and the tool runner
 * emits `tool_call`, or `policy_deny` when a wrapper refused the call. Anything
 * else on this list would be an invention.
 *
 * Kept as a value rather than a bare union so the Inspector can iterate it, and
 * kept narrow on purpose: `event_type` stays `string` on the row below, because
 * a harness that gains a fifth type must still render rather than crash.
 */
export const AUDIT_EVENT_TYPES = [
  'user_input',
  'tool_call',
  'policy_deny',
  'final_response',
] as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

/**
 * One row from GET /audit, as the app consumes it.
 *
 * The wire spells two of these differently — `payload_json` and `principal_subj`
 * — and `listAudit` renames them on the way in. Before it did, `payload` was
 * `undefined` on every row the harness has ever returned, so the tool name and
 * the summary line silently rendered as nothing at all. See `AuditEventWire`.
 */
export interface AuditEvent {
  id: string;
  tenant_id: string;
  ts: number;
  /** One of `AUDIT_EVENT_TYPES` in practice; widened so an unknown type renders. */
  event_type: string;
  manifest_id: string;
  principal_subj: string;
  /** `ok` | `error` | `denied` in practice — audit rows are written after the fact. */
  status: string;
  payload: Record<string, unknown>;
}

/** GET /audit exactly as it arrives, before `listAudit` normalises the two names. */
export interface AuditEventWire extends Omit<AuditEvent, 'payload'> {
  payload_json?: Record<string, unknown>;
  /** Tolerated so a harness that ever renames it back does not blank the feed. */
  payload?: Record<string, unknown>;
}

/**
 * One per-tool rollup row from GET /audit/metrics.
 *
 * The harness aggregates `tool_call` audit events by tool name and returns them already
 * summed and sorted by `calls` descending, so the client does no folding of its own.
 * `avg_latency_ms` is a true mean (harness-side `latency_ms_sum / calls`), not a
 * max across buckets.
 */
export interface ToolMetricsRow {
  tool: string;
  calls: number;
  errors: number;
  avg_latency_ms: number;
}

/** GET /audit/metrics response. `window_since` is the epoch-ms floor the rollup covers. */
export interface ToolMetrics {
  tools: ToolMetricsRow[];
  window_since: number;
}

/**
 * GET /audit → newest-first activity feed (`user_input`, `tool_call`, `policy_deny`,
 * `final_response`).
 *
 * The rename is the point of this function. The harness serialises the payload as
 * `payload_json`, and the route aliases only the *envelope* — it returns `items` and
 * `events` side by side so a client reading either works — which made the row shape
 * look settled when it was not. Reading `e.payload` off the raw row yields `undefined`
 * for every event the harness has ever written, and because the old type asserted the
 * field existed, nothing failed: the tool name fell back to the manifest id and the
 * summary line rendered as an empty string on every row.
 *
 * `event_type` and `status` are both server-side filters, so the panel narrows the
 * query rather than the rendered slice. `limit` is capped at 500 upstream.
 */

export function createAuditClient(http: FelixHttp) {
  const { chatFetch } = http;

  async function listAudit(
    opts: { status?: string; eventType?: string; limit?: number } = {},
  ): Promise<AuditEvent[]> {
    const q = new URLSearchParams();
    if (opts.status) q.set('status', opts.status);
    if (opts.eventType) q.set('event_type', opts.eventType);
    q.set('limit', String(opts.limit ?? 50));
    const res = await chatFetch(`/audit?${q}`);
    if (!res.ok) throw new Error(`audit: ${res.status}`);
    const body = (await res.json()) as { events?: AuditEventWire[] };
    return (body.events ?? []).map((e) => ({
      ...e,
      payload: e.payload_json ?? e.payload ?? {},
    }));
  }

  /**
   * GET /audit/metrics → tool-call rollups for a window. Aggregates `tool_call`
   * audit rows by `(tool, transport, status, error_code)`; defaults to the last
   * hour server-side. We pass an explicit `since` so the panel window is stable.
   */
  async function getToolMetrics(
    opts: { sinceMs?: number; limit?: number } = {},
  ): Promise<ToolMetrics> {
    const q = new URLSearchParams();
    if (opts.sinceMs) q.set('since', String(Date.now() - opts.sinceMs));
    q.set('limit', String(opts.limit ?? 200));
    const res = await chatFetch(`/audit/metrics?${q}`);
    if (!res.ok) throw new Error(`metrics: ${res.status}`);
    return (await res.json()) as ToolMetrics;
  }

  return {
    listAudit,
    getToolMetrics,
  };
}
