/** The token meter — `GET /usage` for rows, `GET /usage/summary` for spend. */

import type { FelixHttp } from '../http';

/** One row from GET /usage. */
export interface UsageEvent {
  id: string;
  tenant_id: string;
  ts: number;
  manifest_id: string;
  model_id: string;
  kind: string;
  tokens_input: number;
  tokens_output: number;
  cache_creation: number;
  cache_read: number;
  /**
   * The provider's own id, which is what the row was **priced** by.
   *
   * `model_id` is the logical route name the operator configured and is what
   * gets reported; this is what the pricing catalog keys on. They differ on any
   * custom route, and when they were one argument every such route priced at the
   * catalog default — so a row where they disagree is worth being able to see.
   */
  wire_model_id?: string;
  /**
   * Dollars, fixed at write time — the one moment the wire id, the rates and any
   * `spec.model.price` override are all in hand.
   *
   * **`0` does not mean free.** A model with no entry in the catalog is metered
   * but unpriced: the tokens count against the token caps while the spend they
   * represent is recorded as zero, and `limits.max_cost_usd` fails open for it.
   * The harness counts that as `felix_model_unpriced`. So a zero next to a
   * non-zero token count is a configuration gap, not a free turn, and anything
   * summing this column is summing an underestimate.
   */
  cost_usd?: number;
  meta_json: Record<string, unknown>;
}

/**
 * One bucket from `GET /usage/summary` — spend for one manifest, model and UTC day.
 *
 * Mirrors `felix/usage/store.py:_summary_item_dict` and is guarded against it by
 * `pnpm check-payload-shapes`.
 */
export interface UsageSummaryItem {
  manifest_id: string;
  model_id: string;
  /** UTC date, `YYYY-MM-DD`. Both arms of the store bucket by this. */
  day: string;
  calls: number;
  tokens_input: number;
  tokens_output: number;
  cache_creation: number;
  cache_read: number;
  /** Dollars. The same "`0` does not mean free" caveat as `UsageEvent.cost_usd`. */
  cost_usd: number;
}

/**
 * The totals block, which is every summed column of an item without the three that
 * group it.
 *
 * **Derived from `UsageSummaryItem` rather than declared**, and not for brevity:
 * `_summary_totals_dict` builds its dict imperatively, so the contract recorder
 * lists it as `unreadable` and a `GUARDED` entry naming it would fail by design —
 * a guard that silently checks nothing is worse than none. Deriving instead means
 * the guarded item shape is the only place these field names exist, so drift in
 * the harness reaches this type through the one entry that *can* be checked.
 */
export type UsageSummaryTotals = Pick<
  UsageSummaryItem,
  'calls' | 'tokens_input' | 'tokens_output' | 'cache_creation' | 'cache_read' | 'cost_usd'
>;

/** `GET /usage/summary` — spend over a window, grouped and totalled by the harness. */
export interface UsageSummary {
  /** Inclusive lower bound, epoch ms. Echoed back so a caller can label the window it got. */
  since_ms: number;
  /** Exclusive upper bound, epoch ms. */
  until_ms: number;
  items: UsageSummaryItem[];
  totals: UsageSummaryTotals;
}

/** GET /usage → paginated token meter events. */

export function createUsageClient(http: FelixHttp) {
  const { chatFetch } = http;

  async function listUsage(
    opts: { limit?: number; cursor?: string; manifest_id?: string } = {},
  ): Promise<{ items: UsageEvent[]; next_cursor: string | null }> {
    const q = new URLSearchParams();
    q.set('limit', String(opts.limit ?? 50));
    if (opts.cursor) q.set('cursor', opts.cursor);
    if (opts.manifest_id) q.set('manifest_id', opts.manifest_id);
    const res = await chatFetch(`/usage?${q}`);
    if (!res.ok) throw new Error(`usage: ${res.status}`);
    return (await res.json()) as { items: UsageEvent[]; next_cursor: string | null };
  }

  /**
   * `GET /usage/summary` — spend over a window, grouped by manifest, model and day.
   *
   * The window is the harness's to choose: with no bounds it answers for the last
   * thirty days and echoes the range it used. That is the difference from summing
   * `listUsage` in the client, which can only ever total the page it fetched.
   */
  async function getUsageSummary(
    opts: { since_ms?: number; until_ms?: number; manifest_id?: string } = {},
  ): Promise<UsageSummary> {
    const q = new URLSearchParams();
    if (opts.since_ms !== undefined) q.set('since_ms', String(opts.since_ms));
    if (opts.until_ms !== undefined) q.set('until_ms', String(opts.until_ms));
    if (opts.manifest_id) q.set('manifest_id', opts.manifest_id);
    // `?${q}` unconditionally, the same shape `listUsage` uses. Built any other
    // way the path stops being a literal, and `check-api-drift` — which reads the
    // string that follows the helper name — extracts `/usage/summary{}` and fails
    // against a route that is fine. An empty query string is harmless.
    const res = await chatFetch(`/usage/summary?${q}`);
    if (!res.ok) throw new Error(`usage summary: ${res.status}`);
    return (await res.json()) as UsageSummary;
  }

  return {
    listUsage,
    getUsageSummary,
  };
}
