/**
 * The chat half of the Felix HTTP surface, with the origin and the credentials
 * left to the caller.
 *
 * There are two very different callers. A browser cannot reach the harness at
 * all — no CORS, no static assets — so chat-ui points this at its own
 * same-origin `/api` prefix and lets the proxy Worker forward upstream, adding
 * `x-chat-key` on the way out. A terminal client has no such restriction: it
 * points at `FELIX_ORIGIN` and sends `Authorization: Bearer` itself. Nothing
 * below knows which of those it is doing.
 *
 * Route literals are written harness-relative (`/chat/stream`, not
 * `/api/chat/stream`) and `chatFetch`/`rawFetch` prepend `baseUrl`. That is also
 * what `scripts/check-api-drift.mjs` reads: it knows both helper names and the
 * bare paths they take, so a route the harness renames still fails CI here.
 */
import {
  type ChatMessage,
  type DurableRun,
  readSseStream,
  type SessionSnapshot,
  type StreamEvent,
  type ThinkingLevel,
  type ThreadHistory,
} from '@felix/protocol';
import type { ApprovalRequest } from './approvals';
import type { SessionSummary } from './session-log';
import { threadSuffix } from './session-log';

export interface FelixClientOptions {
  /**
   * Everything is appended to this: `/api` for a browser going through the
   * proxy Worker, `http://localhost:8080` for a direct caller. No trailing slash.
   */
  baseUrl: string;
  /** Credentials, read per request so a rotated key takes effect without a rebuild. */
  headers?: () => Record<string, string>;
  /**
   * Whether the harness answered at all — any reply, a 500 included, means
   * something is listening. Only a transport-level rejection is `false`.
   */
  onReachability?: (reachable: boolean) => void;
  /** A 401: the key is missing, wrong, or rotated. */
  onUnauthorized?: () => void;
  /** Injectable for tests and for a runtime whose fetch is not global. */
  fetch?: typeof globalThis.fetch;
}

export interface StreamHandlers {
  onEvent: (event: StreamEvent) => void | Promise<void>;
  /**
   * Each `id:` the stream stamps — the thread's next session sequence, carried
   * by structural frames only. Hand the newest back as `Last-Event-ID` to
   * `GET /chat/stream/{thread_id}` to reattach after a dropped connection.
   */
  onCursor?: (lastEventId: string) => void;
}

export interface StreamArgs {
  manifest: string;
  messages: ChatMessage[];
  threadId?: string;
  signal?: AbortSignal;
}

interface RawSessionRow {
  id?: string;
  sessionName?: string | null;
  createdAt?: number;
  updatedAt?: number;
  parentSessionId?: string | null;
}

export type FelixClient = ReturnType<typeof createFelixClient>;

export function createFelixClient(opts: FelixClientOptions) {
  const doFetch = opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const base = opts.baseUrl.replace(/\/+$/, '');
  const auth = () => opts.headers?.() ?? {};

  /**
   * A harness call with credentials attached. A 401 means the key is missing,
   * wrong or rotated — report it before the caller's own error handling runs.
   */
  const chatFetch = async (path: string, init: RequestInit = {}): Promise<Response> => {
    let res: Response;
    try {
      res = await doFetch(base + path, {
        ...init,
        headers: { ...(init.headers as Record<string, string> | undefined), ...auth() },
      });
    } catch (err) {
      // `fetch` rejects only when the request never reached anything: DNS, TLS, a
      // refused connection, a dropped link. That is the one case that means the
      // harness is not there. An abort is the caller changing its mind, not a
      // connectivity fact, so it is left alone.
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        opts.onReachability?.(false);
      }
      throw err;
    }
    // Any reply at all, a 500 included, means something is listening.
    opts.onReachability?.(true);
    if (res.status === 401) opts.onUnauthorized?.();
    return res;
  };

  /**
   * The same call without the 401 handling, for the three routes where a 401
   * means "no server history for you", not "your key is wrong" — running those
   * through `chatFetch` would drop a working key and re-prompt.
   */
  const rawFetch = async (path: string, init: RequestInit = {}): Promise<Response> =>
    doFetch(base + path, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), ...auth() },
    });

  const detailOf = async (res: Response) => (await res.text().catch(() => '')).slice(0, 200);

  return {
    /** The origin every call above is made against, for a client that reports it. */
    baseUrl: base,

    /** GET /v1/models → manifest names for the switcher. */
    async listManifests(signal?: AbortSignal): Promise<string[]> {
      const res = await chatFetch('/v1/models', { signal });
      if (!res.ok) throw new Error(`models: ${res.status}`);
      const body = (await res.json()) as { data?: Array<{ id: string }> };
      return (body.data ?? []).map((m) => m.id);
    },

    /**
     * POST /chat/stream and dispatch each frame. Resolves when the server emits
     * `data: [DONE]`. The SSE framing (one event per `\n\n`) is decoded with a
     * carry buffer so events split across network chunks are not dropped — same
     * discipline the harness uses on its own SSE reads.
     *
     * `readSseStream` also folds the harness's `event: error` frame into an
     * `on_error` event, so a stream that fails after its 200 arrives here as an
     * event rather than as silence.
     */
    async streamChat(args: StreamArgs, handlers: StreamHandlers): Promise<void> {
      const res = await chatFetch('/chat/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          manifest: args.manifest,
          messages: args.messages,
          ...(args.threadId ? { thread_id: args.threadId } : {}),
        }),
        signal: args.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`chat/stream: ${res.status} ${await detailOf(res)}`);
      }

      await readSseStream(res, handlers.onEvent, { onCursor: handlers.onCursor });
    },

    /**
     * GET /chat/stream/{thread_id} — reattach after a dropped connection.
     *
     * Pass the newest `id:` seen on the lost stream (via `StreamHandlers.onCursor`)
     * as `lastEventId` to replay only what was missed; omit it for a cold reattach,
     * which opens with a `snapshot` of the whole thread instead.
     *
     * This does **not** resume the run. A client that hangs up has its run torn
     * down on purpose, so it stops burning tokens; what comes back is the thread as
     * it now stands, plus anything that lands afterwards. Because it tails shared
     * session state rather than one process's output, it works regardless of which
     * replica served the original turn.
     *
     * The harness closes an idle reattach after ~300s rather than holding the
     * connection open, and expects the caller to return with its cursor — so a
     * clean end here is not necessarily the end of the thread's activity.
     */
    async resumeStream(
      args: { threadId: string; lastEventId?: string; signal?: AbortSignal },
      handlers: StreamHandlers,
    ): Promise<void> {
      const res = await chatFetch(`/chat/stream/${encodeURIComponent(args.threadId)}`, {
        // The harness reads the header, and falls back to a `last_event_id` query
        // param. The header is the standard spelling, and keeps the cursor out of
        // request URLs and therefore out of access logs.
        headers: args.lastEventId ? { 'last-event-id': args.lastEventId } : {},
        signal: args.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`chat/stream/${args.threadId}: ${res.status} ${await detailOf(res)}`);
      }

      await readSseStream(res, handlers.onEvent, { onCursor: handlers.onCursor });
    },

    /** POST /chat/tool_result — complete a client-executed tool pause. */
    async postToolResult(args: {
      threadId: string;
      toolCallId: string;
      content: string;
      error?: boolean;
    }): Promise<void> {
      const res = await chatFetch('/chat/tool_result', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          thread_id: args.threadId,
          tool_call_id: args.toolCallId,
          content: args.content,
          error: args.error ?? false,
        }),
      });
      if (!res.ok) throw new Error(`tool_result: ${res.status} ${await detailOf(res)}`);
    },

    /** POST /chat — durable manifests return 202 + resume_token. */
    async startChat(args: {
      manifest: string;
      messages: ChatMessage[];
      threadId?: string;
      signal?: AbortSignal;
    }): Promise<{ kind: 'done'; final: ChatMessage } | { kind: 'durable'; resumeToken: string }> {
      const res = await chatFetch('/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          manifest: args.manifest,
          messages: args.messages,
          ...(args.threadId ? { thread_id: args.threadId } : {}),
        }),
        signal: args.signal,
      });

      if (res.status === 202) {
        const body = (await res.json()) as { resume_token?: string };
        if (!body.resume_token) throw new Error('durable chat missing resume_token');
        return { kind: 'durable', resumeToken: body.resume_token };
      }

      if (!res.ok) throw new Error(`chat: ${res.status} ${await detailOf(res)}`);

      const body = (await res.json()) as { final?: ChatMessage };
      return { kind: 'done', final: body.final ?? { role: 'assistant', content: '' } };
    },

    async getDurableRun(resumeToken: string): Promise<DurableRun> {
      const res = await chatFetch(`/chat/runs/${encodeURIComponent(resumeToken)}`);
      if (!res.ok) throw new Error(`chat/runs: ${res.status} ${await detailOf(res)}`);
      return (await res.json()) as DurableRun;
    },

    async pollDurableRun(
      resumeToken: string,
      pollOpts: {
        signal?: AbortSignal;
        intervalMs?: number;
        onTick?: (run: DurableRun) => void;
      } = {},
    ): Promise<DurableRun> {
      const interval = pollOpts.intervalMs ?? 1500;
      while (true) {
        if (pollOpts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const run = await this.getDurableRun(resumeToken);
        pollOpts.onTick?.(run);
        const status = (run.status || '').toLowerCase();
        if (
          status === 'completed' ||
          status === 'succeeded' ||
          status === 'failed' ||
          status === 'error'
        ) {
          return run;
        }
        if (run.error) return run;
        await new Promise((r) => setTimeout(r, interval));
      }
    },

    async steerChat(args: {
      threadId: string;
      text: string;
      kind?: 'steer' | 'follow_up';
    }): Promise<void> {
      const res = await chatFetch('/chat/steer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          thread_id: args.threadId,
          text: args.text,
          kind: args.kind ?? 'steer',
        }),
      });
      if (!res.ok) throw new Error(`steer: ${res.status} ${await detailOf(res)}`);
    },

    /** GET /chat/sessions/{thread_id} — authoritative snapshot (truth over local cache). */
    async getSessionSnapshot(threadId: string): Promise<SessionSnapshot | null> {
      try {
        const res = await rawFetch(`/chat/sessions/${encodeURIComponent(threadId)}`);
        if (!res.ok) return null;
        return (await res.json()) as SessionSnapshot;
      } catch {
        return null;
      }
    },

    /** POST /chat/abort — cancel the in-flight server run. */
    async abortChat(threadId: string): Promise<void> {
      const res = await chatFetch('/chat/abort', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ thread_id: threadId }),
      });
      if (!res.ok) throw new Error(`abort: ${res.status} ${await detailOf(res)}`);
    },

    /** POST /chat/continue — resume after abort/error without a new user message. */
    async continueChat(args: {
      threadId: string;
      manifest: string;
      model?: string;
    }): Promise<unknown> {
      const res = await chatFetch('/chat/continue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          thread_id: args.threadId,
          manifest: args.manifest,
          ...(args.model ? { model: args.model } : {}),
        }),
      });
      if (!res.ok) throw new Error(`continue: ${res.status} ${await detailOf(res)}`);
      return res.json();
    },

    /** POST /chat/thinking — set live thinking level for the thread. */
    async setThinkingLevel(args: {
      threadId: string;
      thinkingLevel: ThinkingLevel;
    }): Promise<void> {
      const res = await chatFetch('/chat/thinking', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          thread_id: args.threadId,
          thinking_level: args.thinkingLevel,
        }),
      });
      if (!res.ok) throw new Error(`thinking: ${res.status} ${await detailOf(res)}`);
    },

    /** POST /chat/sessions/lease — exclusive/shared attach for multi-client. */
    async acquireSessionLease(args: {
      threadId: string;
      holderId: string;
      mode?: 'exclusive' | 'shared';
      ttlSeconds?: number;
      token?: string;
    }): Promise<{ ok: boolean; token?: string; error?: string }> {
      const res = await chatFetch('/chat/sessions/lease', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          thread_id: args.threadId,
          holder_id: args.holderId,
          mode: args.mode ?? 'exclusive',
          ttl_seconds: args.ttlSeconds ?? 300,
          ...(args.token ? { token: args.token } : {}),
        }),
      });
      if (res.status === 409) {
        const body = (await res.json().catch(() => ({}))) as { detail?: string };
        return { ok: false, error: body.detail || 'lease_held' };
      }
      if (!res.ok) throw new Error(`lease: ${res.status} ${await detailOf(res)}`);
      return (await res.json()) as { ok: boolean; token?: string };
    },

    /** POST /chat/sessions/lease/release */
    async releaseSessionLease(args: {
      threadId: string;
      holderId?: string;
      token?: string;
    }): Promise<void> {
      try {
        await chatFetch('/chat/sessions/lease/release', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            thread_id: args.threadId,
            ...(args.holderId ? { holder_id: args.holderId } : {}),
            ...(args.token ? { token: args.token } : {}),
          }),
        });
      } catch {
        // best-effort on tab close / process exit
      }
    },

    /**
     * GET /chat/sessions — every thread the harness holds for this tenant.
     *
     * The authoritative thread index. A client may still keep its own copy, but
     * as a cache and as the only record of which manifest a thread used — the
     * harness does not track that.
     *
     * Ids arrive tenant-prefixed and are stripped here, so callers only ever see
     * the suffix they are allowed to send back.
     */
    async listSessions(): Promise<SessionSummary[]> {
      const res = await chatFetch('/chat/sessions');
      if (!res.ok) throw new Error(`chat/sessions: ${res.status}`);
      // The route returns the same array under both keys. Read either — a harness
      // that later drops one of them should not empty the sidebar.
      const body = (await res.json()) as {
        sessions?: RawSessionRow[];
        items?: RawSessionRow[];
      };
      const rows = body.sessions ?? body.items ?? [];
      return rows.map((row) => ({
        id: threadSuffix(String(row.id ?? '')),
        name: row.sessionName ?? null,
        createdAt: row.createdAt ?? undefined,
        updatedAt: row.updatedAt ?? undefined,
        parentSessionId: row.parentSessionId ? threadSuffix(row.parentSessionId) : null,
      }));
    },

    /**
     * POST /chat/sessions/name — give a thread a durable name.
     *
     * Also appends a `session_info` event to the transcript, so the rename is part
     * of the session log rather than only metadata.
     */
    async renameSession(threadId: string, name: string): Promise<void> {
      const res = await chatFetch('/chat/sessions/name', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ thread_id: threadId, name }),
      });
      if (!res.ok) throw new Error(`sessions/name: ${res.status} ${await detailOf(res)}`);
    },

    /**
     * POST /chat/fork — branch a thread into a new one.
     *
     * The write half of rewind: rewind moves this thread's leaf, fork copies up to
     * an event into a *separate* thread and leaves the original where it was. The
     * new thread records the original as its parent.
     *
     * `fromEventId` defaults to the whole thread.
     */
    async forkSession(args: {
      threadId: string;
      newThreadId: string;
      fromEventId?: string;
    }): Promise<{ leaf_id?: string }> {
      const res = await chatFetch('/chat/fork', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          thread_id: args.threadId,
          new_thread_id: args.newThreadId,
          ...(args.fromEventId ? { from_event_id: args.fromEventId } : {}),
        }),
      });
      if (!res.ok) throw new Error(`chat/fork: ${res.status} ${await detailOf(res)}`);
      return (await res.json()) as { leaf_id?: string };
    },

    /**
     * POST /chat/compact — summarise the thread's older context now.
     *
     * The agent loop does this on its own when the window fills; this is the manual
     * trigger. It needs a manifest because the compaction strategy and the model
     * that writes the summary both come from one.
     */
    async compactSession(threadId: string, manifest: string): Promise<void> {
      const res = await chatFetch('/chat/compact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ thread_id: threadId, manifest }),
      });
      if (!res.ok) throw new Error(`chat/compact: ${res.status} ${await detailOf(res)}`);
    },

    /**
     * GET /chat/sessions/{id}/export — the active branch as JSONL.
     *
     * Returns the text rather than triggering the download, so the caller decides
     * what to do with it. Only the active branch: a rewound-away sibling is not
     * included, which matches what the transcript shows.
     */
    async exportSession(threadId: string): Promise<string> {
      const res = await chatFetch(`/chat/sessions/${encodeURIComponent(threadId)}/export`);
      if (!res.ok) throw new Error(`sessions/export: ${res.status} ${await detailOf(res)}`);
      return await res.text();
    },

    /** GET /chat/sessions/search — full-text hits across the tenant's event log. */
    async searchSessions(
      q: string,
      limit = 20,
    ): Promise<Array<{ thread_id: string; content: string; event_id?: string; rank?: number }>> {
      const query = q.trim();
      if (!query) return [];
      const params = new URLSearchParams({ q: query, limit: String(limit) });
      const res = await chatFetch(`/chat/sessions/search?${params}`);
      if (!res.ok) throw new Error(`search: ${res.status} ${await detailOf(res)}`);
      const body = (await res.json()) as {
        hits?: Array<{ thread_id: string; content: string; event_id?: string; rank?: number }>;
      };
      return body.hits ?? [];
    },

    /** POST /chat/rewind — set the active leaf to an earlier event. */
    /**
     * POST /chat/sessions/label → name a turn, or clear the name with `null`.
     *
     * The label is stored against the event id in thread meta *and* appended to
     * the transcript as its own event, so it survives a reload and shows up in
     * the session's own history. It comes back on the snapshot as `labels`.
     */
    async setSessionLabel(args: {
      threadId: string;
      eventId: string;
      label: string | null;
    }): Promise<void> {
      const res = await chatFetch('/chat/sessions/label', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          thread_id: args.threadId,
          event_id: args.eventId,
          label: args.label,
        }),
      });
      if (!res.ok) throw new Error(`sessions/label: ${res.status} ${await detailOf(res)}`);
    },
    async rewindChat(args: {
      threadId: string;
      eventId: string;
      summarize?: boolean;
      manifest?: string;
    }): Promise<{ ok: boolean; leaf_id?: string }> {
      const res = await chatFetch('/chat/rewind', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          thread_id: args.threadId,
          event_id: args.eventId,
          summarize: args.summarize ?? false,
          ...(args.manifest ? { manifest: args.manifest } : {}),
        }),
      });
      if (!res.ok) throw new Error(`rewind: ${res.status} ${await detailOf(res)}`);
      return (await res.json()) as { ok: boolean; leaf_id?: string };
    },

    /** POST /chat/ui — answer a select/confirm/input prompt. */
    async respondUiRequest(args: {
      requestId: string;
      value?: unknown;
      cancelled?: boolean;
      note?: string;
    }): Promise<void> {
      const res = await chatFetch('/chat/ui', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          request_id: args.requestId,
          value: args.value,
          cancelled: args.cancelled ?? false,
          note: args.note ?? '',
        }),
      });
      if (!res.ok) throw new Error(`ui: ${res.status} ${await detailOf(res)}`);
    },

    /**
     * GET /chat/history/{thread_id} → the server-side checkpointed transcript.
     * Anonymous callers get this only in local dev (the harness adds a dev
     * fallthrough); behind auth it 401s. This uses `rawFetch` so a 401 does not
     * trip the shared-key reset — any non-OK simply means "no server history",
     * and the caller falls back to its own cached transcript.
     *
     * The response is the *newest* window of the thread, bounded at 5000 events read
     * even when `limit` is omitted, so a long thread can come back truncated with
     * `has_more: true`. Page backwards by passing the previous response's
     * `oldest_seq` as `beforeSeq`.
     *
     * `limit` counts events *read*, not messages returned — the harness filters
     * non-message kinds out of the window after applying it, so a request for 50 can
     * legitimately yield fewer than 50 messages. Values below 1 are a 400.
     *
     * Both params are ignored by a harness predating the paging change, which also
     * omits `oldest_seq` and `has_more` from the response — sending them is safe
     * (FastAPI drops unknown query params), but do not assume they took effect.
     */
    async getThreadHistory(
      threadId: string,
      historyOpts: { limit?: number; beforeSeq?: number } = {},
    ): Promise<ThreadHistory | null> {
      const query = new URLSearchParams();
      if (historyOpts.limit !== undefined) query.set('limit', String(historyOpts.limit));
      if (historyOpts.beforeSeq !== undefined) {
        query.set('before_seq', String(historyOpts.beforeSeq));
      }
      const qs = query.toString();
      try {
        const res = await rawFetch(
          `/chat/history/${encodeURIComponent(threadId)}${qs ? `?${qs}` : ''}`,
        );
        if (!res.ok) return null;
        return (await res.json()) as ThreadHistory;
      } catch {
        return null;
      }
    },

    /** DELETE /chat/history/{thread_id} → erase the server transcript. Best-effort. */
    async deleteThreadHistory(threadId: string): Promise<void> {
      try {
        await rawFetch(`/chat/history/${encodeURIComponent(threadId)}`, { method: 'DELETE' });
      } catch {
        // best-effort; the local copy is the source of truth in the demo
      }
    },

    /**
     * GET /approvals?status=… → the human-in-the-loop queue.
     *
     * Chat, not management: a gated tool blocks the run, and the harness does
     * not reliably announce it on the stream. See `syncApprovals`.
     */
    async listApprovals(status: ApprovalRequest['status'] = 'pending'): Promise<ApprovalRequest[]> {
      const res = await chatFetch(`/approvals?status=${status}`);
      if (!res.ok) throw new Error(`approvals: ${res.status}`);
      const body = (await res.json()) as { requests?: ApprovalRequest[] };
      return body.requests ?? [];
    },

    /** POST /approvals/:id/decide → approve or deny a gated tool call. */
    async decideApproval(
      id: string,
      decision: {
        status: 'approved' | 'denied';
        note?: string;
        edited_args?: Record<string, unknown>;
      },
    ): Promise<ApprovalRequest> {
      const res = await chatFetch(`/approvals/${encodeURIComponent(id)}/decide`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(decision),
      });
      if (!res.ok) throw new Error(`decide: ${res.status}`);
      return (await res.json()) as ApprovalRequest;
    },
  };
}
