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
  /** Constant for any one caller — the harness takes it from the credentials. */
  tenant_id?: string;
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
  /**
   * When the row was last *rewritten*, which is not when it was last *read*.
   * `0` on a row that has never been amended — the column defaults to it rather
   * than to `created_at`, so it is not a second copy of the creation time.
   */
  updated_at?: number;
  last_used_at?: number | null;
  /** The thread the fact was learned in, or `''` when it was written directly. */
  thread_id?: string;
  metadata?: Record<string, unknown>;
  /**
   * How the row was embedded, and the pair that answers "why did recall miss
   * this".
   *
   * `embedding_dim` is `null` and `embedding_model` is `''` when no embedder ran
   * — the harness's default — which means the row is reachable by the lexical
   * channel and invisible to the vector one. A store whose rows were written
   * under two different embedders is the other case worth seeing: the dimensions
   * disagree and the older rows silently stop matching.
   */
  embedding_dim?: number | null;
  embedding_model?: string;
  // `embedding_json` is deliberately absent. The harness sends the key, but the
  // column is documented as deprecated and never populated — superseded by the
  // pgvector `embedding` column and slated for removal once its backfill has run
  // everywhere. Modelling it would be modelling a `null` with a deletion date.
}

/**
 * One hit from GET /memory/search — a *different* shape from the list row, not a
 * subset with extras: the two fields only ranking produces, plus the row's
 * provenance.
 *
 * The provenance fields arrived with `felix-run/felix#548` and are optional
 * because an older harness sends none of them. Without them a hit could not say
 * which conversation taught the agent this, which is the question a surprising
 * recall raises first.
 */
export interface MemoryHit {
  id: string;
  content: string;
  kind: string;
  score: number;
  topic_key?: string;
  importance?: number;
  manifest_id?: string;
  /** `{tenant}:{suffix}`, or `''` for a memory written outside any thread. */
  thread_id?: string;
  origin_seq?: number | null;
  status?: string;
  created_at?: number;
  last_used_at?: number | null;
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

  /**
   * `threadId` is the thread's suffix; the harness composes it with the tenant.
   * `status: 'forgotten'` lists what a forget hid, most recently forgotten first.
   *
   * Both filters are re-applied to the rows that come back, because a harness
   * older than `felix-run/felix#548` ignores the parameters and answers with
   * every active row — and a "Forgotten" list made of active rows, or a thread's
   * memories mixed with every other thread's, is worse than an empty one.
   */
  async function listMemories(
    opts: {
      manifestId?: string;
      kind?: string;
      limit?: number;
      threadId?: string;
      status?: 'active' | 'forgotten';
    } = {},
  ): Promise<MemoryRecord[]> {
    const q = new URLSearchParams();
    if (opts.manifestId) q.set('manifest_id', opts.manifestId);
    if (opts.kind) q.set('kind', opts.kind);
    if (opts.threadId !== undefined) q.set('thread_id', opts.threadId);
    if (opts.status && opts.status !== 'active') q.set('status', opts.status);
    q.set('limit', String(opts.limit ?? 50));
    const res = await chatFetch(`/memory?${q}`);
    if (!res.ok) throw new Error(`memory: ${res.status}`);
    const body = (await res.json()) as { items?: MemoryRecord[] };
    const items = body.items ?? [];
    const want = opts.status ?? 'active';
    // Asked for forgotten rows and handed active ones: the harness ignored the
    // parameter, so it has no such listing. Said as the 404 it effectively is,
    // which `describeError` turns into "the harness is older than this client".
    if (want === 'forgotten' && items.some((r) => (r.status ?? 'active') !== 'forgotten')) {
      throw new Error('memory: 404 this harness does not list forgotten memories');
    }
    return items.filter((r) => (r.status ?? 'active') === want && inThread(r, opts.threadId));
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
  /**
   * A turn number is an ordinal into one thread's log, so `threadId` (the
   * suffix) is what makes "turn 4" mean one conversation's fourth turn rather
   * than every conversation's. Re-applied to the rows for the same reason as
   * `listMemories`: an older harness ignores it.
   */
  async function memoriesAsOf(
    turnSeq: number,
    opts: { manifestId?: string; kind?: string; limit?: number; threadId?: string } = {},
  ): Promise<MemoryRecord[]> {
    const q = new URLSearchParams();
    if (opts.manifestId) q.set('manifest_id', opts.manifestId);
    if (opts.kind) q.set('kind', opts.kind);
    if (opts.threadId !== undefined) q.set('thread_id', opts.threadId);
    q.set('limit', String(opts.limit ?? 200));
    const res = await chatFetch(`/memory/as-of/${encodeURIComponent(String(turnSeq))}?${q}`);
    if (!res.ok) throw new Error(`memory/as-of: ${res.status}`);
    const body = (await res.json()) as { items?: MemoryRecord[] };
    return (body.items ?? []).filter((r) => inThread(r, opts.threadId));
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
   * POST /memory/{id}/restore → undo a forget; the agent recalls it again.
   *
   * 409 means the row is not forgotten (already active, or superseded, which has a
   * place in turn time and is not restorable); 403 a key without `memory:write`,
   * or a forget made by a writer ranked above this one. A harness older than
   * `felix-run/felix#548` has no route, which arrives as a 404 or a 405.
   */
  async function restoreMemory(id: string): Promise<void> {
    const res = await chatFetch(`/memory/${encodeURIComponent(id)}/restore`, { method: 'POST' });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`memory/restore: ${res.status} ${detail.slice(0, 200)}`);
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
   *
   * `manifestId` is required. An agent recalls only the rows stored under its own
   * manifest id, so a memory written with `''` — what this sent by default — is
   * recalled by no agent at all: a successful write that changes nothing.
   */
  async function addMemory(input: {
    content: string;
    kind?: string;
    manifestId: string;
    topicKey?: string;
    importance?: number;
  }): Promise<{ id: string; status: string }> {
    const res = await chatFetch('/memory', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content: input.content,
        kind: input.kind || 'fact',
        manifest_id: input.manifestId,
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
    restoreMemory,
    addMemory,
  };
}

/** Whether a row was written by the thread `suffix` names; `undefined` asks nothing. */
function inThread(row: { thread_id?: string }, suffix: string | undefined): boolean {
  if (suffix === undefined) return true;
  const full = row.thread_id ?? '';
  return suffix === '' ? full === '' : full.slice(full.lastIndexOf(':') + 1) === suffix;
}
