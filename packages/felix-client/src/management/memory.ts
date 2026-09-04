/**
 * What the agent has stored across sessions (`/memory`).
 *
 * The harness builds this as an operator surface: when a run starts answering
 * from a fact that is stale, wrong, or was extracted from a hostile tool result,
 * someone has to be able to find that fact and remove it without a database
 * console. `DELETE` is soft — the row becomes `forgotten` and drops out of
 * recall rather than being erased, which is why the UI says "forget".
 *
 * Reads need the `memory:read` scope and writes `memory:write`, so a 403 here
 * means the key is too narrow rather than that the store is empty — the two look
 * identical without the message `describeError` writes. These routes are also
 * newer than the rest of the surface, so a 404 means the harness predates them.
 */

import type { FelixHttp } from '../http';

/** One row from GET /memory, or GET /memory/as-of/{turn_seq}. */
export interface MemoryRecord {
  id: string;
  kind: string;
  content: string;
  manifest_id?: string;
  topic_key?: string;
  importance?: number;
  /** `active`, or `forgotten` once DELETE has been called — the delete is soft. */
  status?: string;
  /** Set when a later memory replaced this one. */
  superseded_by?: string | null;
  /** Turn sequence this was learned at, and the one that retired it. */
  origin_seq?: number | null;
  superseded_seq?: number | null;
  created_at?: number;
  last_used_at?: number | null;
  metadata?: Record<string, unknown>;
}

/**
 * One hit from GET /memory/search — a *different* shape from the list row, not a
 * subset with extras: no timestamps or status, plus the two fields that only
 * ranking produces.
 */
export interface MemoryHit {
  id: string;
  content: string;
  kind: string;
  score: number;
  topic_key?: string;
  importance?: number;
  /**
   * Which retrievers found this, e.g. `["fts"]` or `["fts", "vector"]`.
   *
   * The reason a result looks wrong is usually which channel produced it, and
   * that is invisible everywhere else — so it is rendered rather than dropped.
   */
  channels?: string[];
}

/** GET /memory → what the agent has stored, newest first. */

export function createMemoryClient(http: FelixHttp) {
  const { chatFetch } = http;

  async function listMemories(
    opts: { manifestId?: string; kind?: string; limit?: number } = {},
  ): Promise<MemoryRecord[]> {
    const q = new URLSearchParams();
    if (opts.manifestId) q.set('manifest_id', opts.manifestId);
    if (opts.kind) q.set('kind', opts.kind);
    q.set('limit', String(opts.limit ?? 50));
    const res = await chatFetch(`/memory?${q}`);
    if (!res.ok) throw new Error(`memory: ${res.status}`);
    const body = (await res.json()) as { items?: MemoryRecord[] };
    return body.items ?? [];
  }

  /**
   * GET /memory/search → the same hybrid ranking the agent sees.
   *
   * The point of exposing this is reproducibility: an operator can ask what the
   * agent would have recalled, and each hit reports which retriever found it.
   */
  async function searchMemories(
    query: string,
    opts: { manifestId?: string; kind?: string; limit?: number } = {},
  ): Promise<MemoryHit[]> {
    const q = new URLSearchParams({ q: query });
    if (opts.manifestId) q.set('manifest_id', opts.manifestId);
    if (opts.kind) q.set('kind', opts.kind);
    q.set('limit', String(opts.limit ?? 8));
    const res = await chatFetch(`/memory/search?${q}`);
    if (!res.ok) throw new Error(`memory/search: ${res.status}`);
    const body = (await res.json()) as { items?: MemoryHit[] };
    return body.items ?? [];
  }

  /**
   * GET /memory/as-of/{turn_seq} → what was believed at a past turn, including
   * facts since superseded.
   *
   * Read-only by design on the harness side: rewinding memory would be a
   * data-loss primitive on a shared multi-tenant table, and session rewind is
   * deliberately non-destructive.
   */
  async function memoriesAsOf(
    turnSeq: number,
    opts: { manifestId?: string; kind?: string; limit?: number } = {},
  ): Promise<MemoryRecord[]> {
    const q = new URLSearchParams();
    if (opts.manifestId) q.set('manifest_id', opts.manifestId);
    if (opts.kind) q.set('kind', opts.kind);
    q.set('limit', String(opts.limit ?? 200));
    const res = await chatFetch(`/memory/as-of/${encodeURIComponent(String(turnSeq))}?${q}`);
    if (!res.ok) throw new Error(`memory/as-of: ${res.status}`);
    const body = (await res.json()) as { items?: MemoryRecord[] };
    return body.items ?? [];
  }

  /**
   * DELETE /memory/{id} → stop the agent recalling this.
   *
   * A soft delete: the row moves to `status: "forgotten"` and drops out of recall
   * and the default listing, rather than being erased. Called "forget" throughout
   * the UI for that reason — promising deletion would overstate what happens.
   */
  async function forgetMemory(id: string): Promise<void> {
    const res = await chatFetch(`/memory/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`memory/forget: ${res.status} ${detail.slice(0, 200)}`);
    }
  }

  /**
   * POST /memory → store a fact directly, without waiting for the agent to learn it.
   *
   * The harness calls this a prompt-injection ingress in as many words, and it is
   * right: whatever lands here is text the model will read back later, from a
   * store the operator cannot otherwise write to. That is the point — a
   * correction, a standing instruction, a fact the agent keeps getting wrong —
   * and it is also why the panel says so above the field rather than presenting
   * this as a note-taking box.
   *
   * `content` is bounded at 4000 chars upstream and `topic_key` at 200; both are
   * enforced here too, because a 422 for a length the form could have checked is
   * a worse answer than not sending it.
   */
  async function addMemory(input: {
    content: string;
    kind?: string;
    manifestId?: string;
    topicKey?: string;
    importance?: number;
  }): Promise<{ id: string; status: string }> {
    const res = await chatFetch('/memory', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content: input.content,
        kind: input.kind || 'fact',
        manifest_id: input.manifestId ?? '',
        topic_key: input.topicKey ?? '',
        importance: input.importance ?? 0.5,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`memory/write: ${res.status} ${detail.slice(0, 200)}`);
    }
    return (await res.json()) as { id: string; status: string };
  }

  return {
    listMemories,
    searchMemories,
    memoriesAsOf,
    forgetMemory,
    addMemory,
  };
}
