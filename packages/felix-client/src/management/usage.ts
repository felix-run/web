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
