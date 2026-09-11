/** The token meter (`GET /usage`). */

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

  return {
    listUsage,
  };
}
