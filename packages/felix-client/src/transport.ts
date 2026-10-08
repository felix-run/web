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
  sniffImageType,
  type ThinkingLevel,
  type ThreadHistory,
} from '@felix/protocol';
import { type ApprovalRequest, isLapsedApproval } from './approvals';
import { IdempotencyKeyReusedError, LeaseRefusedError, StreamInProgressError } from './errors';
import { createHttp, type FelixClientOptions } from './http';
import { createManagementClient } from './management';
import type { SessionSummary } from './session-log';
import { threadSuffix } from './session-log';

export interface StreamHandlers {
  onEvent: (event: StreamEvent) => void | Promise<void>;
  /**
   * Each `id:` the stream stamps — the thread's next session sequence, carried
   * by structural frames only. Hand the newest back as `Last-Event-ID` to
   * `GET /chat/stream/{thread_id}` to reattach after a dropped connection.
   */
  onCursor?: (lastEventId: string) => void;
  /** Every chunk, keep-alive comments included; see `ReadSseOptions.onActivity`. */
  onActivity?: (info: { keepAlive: boolean }) => void;
  /**
   * The harness answered 200 and the body is about to be read. `replayed` is its
   * `Idempotent-Replayed: true`: this is a resend under a key whose first request
   * already ended, and the body is that request's record, not a new turn — its
   * session events as `session_event` frames, its error frame if it had one, then
   * `[DONE]`. Called before the first frame, so a caller can prepare to fold them.
   */
  onOpen?: (info: { replayed: boolean }) => void;
}

export interface StreamArgs {
  manifest: string;
  messages: ChatMessage[];
  threadId?: string;
  signal?: AbortSignal;
  /**
   * Sent as `Idempotency-Key`, so a resend of the same message never runs a
   * second turn (`felix-run/felix#488`). One per logical message, reused only
   * with a byte-identical body — the harness fingerprints the body and answers a
   * different one under the same key with `422 idempotency_key_reused`. Needs
   * `threadId`: the harness scopes the key to the thread and refuses one without.
   */
  idempotencyKey?: string;
}

/** One row of `GET /chat/sessions` as the harness sends it — guarded by check-payload-shapes. */
export interface RawSessionRow {
  id?: string;
  sessionName?: string | null;
  createdAt?: number;
  updatedAt?: number;
  parentSessionId?: string | null;
  preview?: string | null;
  manifest?: string | null;
}

export type { FelixClientOptions };

/** `POST /chat/sessions/lease`'s answer, or `{ ok: false, error }` for its 409. */
export interface LeaseAcquireResult {
  ok: boolean;
  /** This hold's own token. An observer's is never the exclusive one. */
  token?: string;
  error?: string;
  /** The mode the hold was granted in. */
  mode?: 'exclusive' | 'shared';
  /** Another holder drives the thread: a `shared` hold granted here is read-only. */
  held_by_other?: boolean;
  renewed?: boolean;
}

/** `GET /chat/sessions/{thread_id}/lease` — the harness's `LeaseStatusOut`. */
export interface LeaseStatus {
  /** An exclusive holder is driving the thread. */
  locked: boolean;
  /** Anyone holds the thread, exclusively or as an observer. */
  attached: boolean;
  /** The exclusive holder; null when only observers hold it. */
  holder_id: string | null;
  mode: 'exclusive' | 'shared' | null;
  observers: number;
  /** Every live observer, by holder id, with its own expiry (epoch ms). */
  observer_holds: Array<{ holder_id: string; expires_at: number }>;
  expires_at: number | null;
  token_hint: string | null;
}

/** One `/v1/models` row, as the harness builds it in `felix/usage/catalog.py`. */
interface RawModelEntry {
  id: string;
  felix?: {
    providerModel?: string | null;
    contextWindow?: number | null;
    starters?: unknown;
    greeting?: unknown;
  } | null;
}

/** `metadata.greeting`: what a client says on an empty thread. Plain text. */
export interface ManifestGreeting {
  headline: string;
  /** Absent means the client says which agent this is itself. */
  subtitle?: string;
}

/** One `metadata.starters` entry: a prompt a client may offer on an empty thread. */
export interface ManifestStarter {
  title: string;
  /** Sent verbatim when chosen. */
  prompt: string;
}

/**
 * A manifest as the agent picker sees it.
 *
 * Not covered by `check-payload-shapes`: `/v1/models` is built by
 * `model_catalog_entry` and patched imperatively in `catalog_from_manifest`,
 * neither of which is a `store.py` row serializer the recorder reads, so there
 * is nothing recorded to guard this against.
 */
export interface ManifestEntry {
  /** The manifest name — what `/chat/stream` takes as `manifest`. */
  id: string;
  /**
   * The provider model the manifest runs on (`spec.model.id`), present only
   * when it differs from the manifest name. `null` on the wire means "same as
   * the name"; both that and an absent key arrive here as `undefined`.
   */
  providerModel?: string;
  /**
   * `felix.contextWindow`, when sent: the window compaction uses — the
   * manifest's `spec.session.context_window_tokens`, else the provider model's
   * own. A harness older than `felix-run/felix@3c12f56` computed it from the
   * manifest *name* instead, so it read 128k for any manifest whose name was
   * not itself a model id; do not trust it against one.
   */
  contextWindow?: number;
  /**
   * `felix.starters`: the manifest's own starter prompts, in its order. The
   * harness sends a list — empty when the manifest declares none — from
   * `felix-run/felix#384`, so `undefined` here means a harness older than
   * that, and `[]` means one that has nothing to offer for this agent.
   * Entries without a non-empty `title` and `prompt` are dropped.
   */
  starters?: ManifestStarter[];
  /**
   * `felix.greeting` (`felix-run/felix#386`): the manifest's own empty-thread
   * headline and subtitle. Absent when the manifest declares none, the harness
   * predates the key, or the value is malformed — in every case the client's
   * default greeting stands, so the three need no telling apart.
   */
  greeting?: ManifestGreeting;
}

function toGreeting(raw: unknown): ManifestGreeting | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const { headline, subtitle } = raw as { headline?: unknown; subtitle?: unknown };
  if (typeof headline !== 'string' || !headline) return undefined;
  return typeof subtitle === 'string' && subtitle ? { headline, subtitle } : { headline };
}

function toStarters(raw: unknown): ManifestStarter[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.flatMap((s) =>
    s && typeof s.title === 'string' && s.title && typeof s.prompt === 'string' && s.prompt
      ? [{ title: s.title, prompt: s.prompt }]
      : [],
  );
}

function toManifestEntry(raw: RawModelEntry): ManifestEntry {
  const entry: ManifestEntry = { id: raw.id };
  const provider = raw.felix?.providerModel;
  if (typeof provider === 'string' && provider && provider !== raw.id) {
    entry.providerModel = provider;
  }
  const tokens = raw.felix?.contextWindow;
  if (typeof tokens === 'number' && tokens > 0) entry.contextWindow = tokens;
  const starters = toStarters(raw.felix?.starters);
  if (starters) entry.starters = starters;
  const greeting = toGreeting(raw.felix?.greeting);
  if (greeting) entry.greeting = greeting;
  return entry;
}

export type FelixClient = ReturnType<typeof createFelixClient>;

export function createFelixClient(opts: FelixClientOptions) {
  // One wrapper for both halves of the surface. Destructured under their own
  // names because `scripts/check-api-drift.mjs` matches the helper *name* at the
  // call site — renaming them here would take all 28 routes out of the check.
  const http = createHttp(opts);
  const { baseUrl: base, chatFetch, rawFetch, detailOf } = http;

  /**
   * `X-Felix-Lease-Token` for a request that drives `threadId`, when the caller
   * holds a lease there (`FelixClientOptions.leaseToken`). Whatever token it
   * holds, observer or exclusive: the harness decides, not this client.
   */
  const leaseHeader = (threadId: string | undefined): Record<string, string> => {
    const token = threadId ? opts.leaseToken?.(threadId) : undefined;
    return token ? { 'x-felix-lease-token': token } : {};
  };

  /**
   * A driving route's `409 lease_read_only` / `lease_held` is "this client is
   * watching", not a failure: tell the caller once, then throw the typed error
   * every call site can recognise. Any other 409 falls through to the route's
   * own handling. Read from a clone so that handling can still read the body.
   */
  const refuseIfLease = async (
    res: Response,
    route: string,
    threadId: string | undefined,
  ): Promise<void> => {
    if (res.status !== 409 || !threadId) return;
    const detail = await res
      .clone()
      .json()
      .then(
        (b: unknown) => (b as { detail?: unknown } | null)?.detail,
        () => undefined,
      );
    if (detail !== 'lease_read_only' && detail !== 'lease_held') return;
    opts.onLeaseRefused?.(threadId, detail);
    throw new LeaseRefusedError(route, threadId, detail);
  };

  /**
   * GET /v1/models → each manifest with what the harness says about it.
   *
   * The route answers with OpenAI model objects whose `id` is the manifest
   * name, plus a `felix` block. Only what a picker can use is kept, and every
   * field past `id` is optional: an older harness sends no `felix` block, and
   * a manifest that failed to resolve is still listed with whatever could be
   * derived from its name alone. A plain function rather than a method so
   * `listManifests` can share it without depending on how it was called.
   */
  async function listManifestEntries(signal?: AbortSignal): Promise<ManifestEntry[]> {
    const res = await chatFetch('/v1/models', { signal });
    if (!res.ok) throw new Error(`models: ${res.status}`);
    const body = (await res.json()) as { data?: RawModelEntry[] };
    return (body.data ?? []).map(toManifestEntry);
  }

  return {
    // The management half — audit, usage, memory, plans, artifacts. Spread
    // first; there are no name collisions with the chat verbs below, and
    // `pollDurableRun`'s `this.getDurableRun` still resolves to this literal.
    ...createManagementClient(http),

    /** The origin every call above is made against, for a client that reports it. */
    baseUrl: base,

    listManifestEntries,

    /** GET /v1/models → manifest names only, for a caller that needs no more. */
    async listManifests(signal?: AbortSignal): Promise<string[]> {
      return (await listManifestEntries(signal)).map((m) => m.id);
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
      const keyed = args.idempotencyKey && args.threadId ? args.idempotencyKey : undefined;
      const res = await chatFetch('/chat/stream', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...leaseHeader(args.threadId),
          ...(keyed ? { 'idempotency-key': keyed } : {}),
        },
        body: JSON.stringify({
          manifest: args.manifest,
          messages: args.messages,
          ...(args.threadId ? { thread_id: args.threadId } : {}),
        }),
        signal: args.signal,
      });

      await refuseIfLease(res, 'chat/stream', args.threadId);
      if (keyed && (res.status === 409 || res.status === 422)) {
        // The lease's 409s were taken above; these are the key's own answers.
        const detail = await res
          .clone()
          .json()
          .then(
            (b: unknown) => (b as { detail?: unknown } | null)?.detail,
            () => undefined,
          );
        if (res.status === 409 && detail === 'idempotency_in_progress') {
          throw new StreamInProgressError(args.threadId ?? '');
        }
        if (res.status === 422 && detail === 'idempotency_key_reused') {
          throw new IdempotencyKeyReusedError();
        }
      }
      if (!res.ok || !res.body) {
        throw new Error(`chat/stream: ${res.status} ${await detailOf(res)}`);
      }

      handlers.onOpen?.({
        replayed: res.headers.get('idempotent-replayed')?.toLowerCase() === 'true',
      });
      let failed = false;
      const finished = await readSseStream(
        res,
        (ev) => {
          if (ev.event === 'on_error') failed = true;
          return handlers.onEvent(ev);
        },
        { onCursor: handlers.onCursor, onActivity: handlers.onActivity },
      );
      // A keyed send has a resend to fall back on, so a body that stopped short of
      // `[DONE]` is reported as the drop it was rather than as a finished turn —
      // unless it had already said how the turn ended, with its error frame.
      if (keyed && !finished && !failed) {
        throw new Error('chat/stream: the stream ended before [DONE]');
      }
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

      await readSseStream(res, handlers.onEvent, {
        onCursor: handlers.onCursor,
        onActivity: handlers.onActivity,
      });
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
        headers: { 'content-type': 'application/json', ...leaseHeader(args.threadId) },
        body: JSON.stringify({
          thread_id: args.threadId,
          tool_call_id: args.toolCallId,
          content: args.content,
          error: args.error ?? false,
        }),
      });
      await refuseIfLease(res, 'tool_result', args.threadId);
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
        headers: { 'content-type': 'application/json', ...leaseHeader(args.threadId) },
        body: JSON.stringify({
          manifest: args.manifest,
          messages: args.messages,
          ...(args.threadId ? { thread_id: args.threadId } : {}),
        }),
        signal: args.signal,
      });

      await refuseIfLease(res, 'chat', args.threadId);
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
        headers: { 'content-type': 'application/json', ...leaseHeader(args.threadId) },
        body: JSON.stringify({
          thread_id: args.threadId,
          text: args.text,
          kind: args.kind ?? 'steer',
        }),
      });
      await refuseIfLease(res, 'steer', args.threadId);
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
        headers: { 'content-type': 'application/json', ...leaseHeader(threadId) },
        body: JSON.stringify({ thread_id: threadId }),
      });
      await refuseIfLease(res, 'abort', threadId);
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
        headers: { 'content-type': 'application/json', ...leaseHeader(args.threadId) },
        body: JSON.stringify({
          thread_id: args.threadId,
          manifest: args.manifest,
          ...(args.model ? { model: args.model } : {}),
        }),
      });
      await refuseIfLease(res, 'continue', args.threadId);
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
        headers: { 'content-type': 'application/json', ...leaseHeader(args.threadId) },
        body: JSON.stringify({
          thread_id: args.threadId,
          thinking_level: args.thinkingLevel,
        }),
      });
      await refuseIfLease(res, 'thinking', args.threadId);
      if (!res.ok) throw new Error(`thinking: ${res.status} ${await detailOf(res)}`);
    },

    /**
     * POST /chat/sessions/lease — take or renew a hold on a thread.
     *
     * `exclusive` drives the thread and is `409 lease_held` while another holder
     * has it. `shared` always succeeds, with an observer token of its own, and
     * `held_by_other: true` when someone else is driving (`felix-run/felix#479`).
     * Renewing either kind needs that hold's `token`; the holder id alone is
     * `lease_held`. A 409 comes back as `{ ok: false, error }` rather than a throw,
     * because losing the race is an answer, not a failure.
     */
    async acquireSessionLease(args: {
      threadId: string;
      holderId: string;
      mode?: 'exclusive' | 'shared';
      ttlSeconds?: number;
      token?: string;
    }): Promise<LeaseAcquireResult> {
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
      return (await res.json()) as LeaseAcquireResult;
    },

    /**
     * GET /chat/sessions/{thread_id}/lease — who holds the thread: the exclusive
     * holder (`holder_id`, only while one drives it) and every observer.
     */
    async getSessionLease(threadId: string): Promise<LeaseStatus> {
      const res = await chatFetch(`/chat/sessions/${encodeURIComponent(threadId)}/lease`);
      if (!res.ok) throw new Error(`lease: ${res.status} ${await detailOf(res)}`);
      return (await res.json()) as LeaseStatus;
    },

    /**
     * POST /chat/sessions/lease/release — drop the one hold `token` names.
     *
     * The token is required: the harness answers `403 token_required` without
     * one, because a holder id is published and cannot be what releases a hold.
     * `holderId`, when sent, must be that hold's. `409 lease_contended` means a
     * Redis race kept it from landing. All of it is swallowed: a release is
     * best-effort, and the hold lapses on its own TTL.
     *
     * `keepalive` lets the request outlive the page that sent it — a tab
     * closing releases its hold this way. It goes through the same wrapper as
     * every other call (unlike `sendBeacon`, which cannot set headers), so the
     * credential is still attached.
     */
    async releaseSessionLease(args: {
      threadId: string;
      holderId?: string;
      token: string;
      keepalive?: boolean;
    }): Promise<void> {
      try {
        await chatFetch('/chat/sessions/lease/release', {
          method: 'POST',
          ...(args.keepalive ? { keepalive: true } : {}),
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            thread_id: args.threadId,
            ...(args.holderId ? { holder_id: args.holderId } : {}),
            token: args.token,
          }),
        });
      } catch {
        // best-effort on tab close / process exit
      }
    },

    /**
     * GET /chat/sessions — every thread the harness holds for this tenant.
     *
     * The authoritative thread index. A client may still keep its own copy, as a
     * cache and as the record of threads the harness has never seen.
     *
     * `preview` and `manifest` arrived with `felix-run/felix#521`; an older
     * harness sends neither, and they read as `null`.
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
        preview: row.preview?.trim() || null,
        manifest: row.manifest?.trim() || null,
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
        headers: { 'content-type': 'application/json', ...leaseHeader(threadId) },
        body: JSON.stringify({ thread_id: threadId, name }),
      });
      await refuseIfLease(res, 'sessions/name', threadId);
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
        headers: { 'content-type': 'application/json', ...leaseHeader(threadId) },
        body: JSON.stringify({ thread_id: threadId, manifest }),
      });
      await refuseIfLease(res, 'chat/compact', threadId);
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
        headers: { 'content-type': 'application/json', ...leaseHeader(args.threadId) },
        body: JSON.stringify({
          thread_id: args.threadId,
          event_id: args.eventId,
          label: args.label,
        }),
      });
      await refuseIfLease(res, 'sessions/label', args.threadId);
      if (!res.ok) throw new Error(`sessions/label: ${res.status} ${await detailOf(res)}`);
    },
    /**
     * POST /chat/sessions/feedback — rate an assistant turn, or clear it with
     * `null`. 404 for an event the thread does not have, 400 for one that is not
     * an assistant message. Each change is also a `turn_feedback` audit event.
     */
    async setSessionFeedback(args: {
      threadId: string;
      eventId: string;
      rating: 'up' | 'down' | null;
      note?: string;
    }): Promise<void> {
      const res = await chatFetch('/chat/sessions/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          thread_id: args.threadId,
          event_id: args.eventId,
          rating: args.rating,
          ...(args.note ? { note: args.note.slice(0, 1000) } : {}),
        }),
      });
      if (!res.ok) throw new Error(`sessions/feedback: ${res.status} ${await detailOf(res)}`);
    },
    /**
     * POST /files — store an image and get the id a message can reference as
     * `felix-file://<id>`. The harness checks the bytes against `mediaType`, caps
     * them at `MAX_UPLOAD_BYTES` (400 over it), and answers 409 when the tenant's
     * quota is full and 503 when no object store is configured.
     */
    async uploadFile(args: {
      data: string;
      mediaType: string;
      filename?: string;
    }): Promise<{ fileId: string; mediaType: string; sizeBytes: number }> {
      const res = await chatFetch('/files', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          data: args.data,
          media_type: args.mediaType,
          ...(args.filename ? { filename: args.filename.slice(0, 255) } : {}),
        }),
      });
      if (!res.ok) throw new Error(`files: ${res.status} ${await detailOf(res)}`);
      const raw = (await res.json()) as { file_id: string; media_type: string; size_bytes: number };
      return { fileId: raw.file_id, mediaType: raw.media_type, sizeBytes: raw.size_bytes };
    },

    /**
     * GET /files/{file_id} — a stored upload's bytes, base64, for drawing it again.
     * The response names no media type (the default store discards it), so it is
     * read off the bytes the way the harness reads it; `undefined` for bytes that
     * are none of the four types it stores.
     */
    async getFile(fileId: string): Promise<{ data: string; mediaType: string | undefined }> {
      const res = await chatFetch(`/files/${encodeURIComponent(fileId)}`);
      if (!res.ok) throw new Error(`files: ${res.status} ${await detailOf(res)}`);
      const raw = (await res.json()) as { data: string };
      return { data: raw.data, mediaType: sniffImageType(raw.data) };
    },

    async rewindChat(args: {
      threadId: string;
      eventId: string;
      summarize?: boolean;
      manifest?: string;
    }): Promise<{ ok: boolean; leaf_id?: string }> {
      const res = await chatFetch('/chat/rewind', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...leaseHeader(args.threadId) },
        body: JSON.stringify({
          thread_id: args.threadId,
          event_id: args.eventId,
          summarize: args.summarize ?? false,
          ...(args.manifest ? { manifest: args.manifest } : {}),
        }),
      });
      await refuseIfLease(res, 'rewind', args.threadId);
      if (!res.ok) throw new Error(`rewind: ${res.status} ${await detailOf(res)}`);
      return (await res.json()) as { ok: boolean; leaf_id?: string };
    },

    /** POST /chat/ui — answer a select/confirm/input prompt. */
    async respondUiRequest(args: {
      requestId: string;
      /** The thread the prompt was asked on (`PendingUiRequest.threadId`). */
      threadId: string;
      value?: unknown;
      cancelled?: boolean;
      note?: string;
    }): Promise<void> {
      const res = await chatFetch('/chat/ui', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...leaseHeader(args.threadId) },
        body: JSON.stringify({
          thread_id: args.threadId,
          request_id: args.requestId,
          value: args.value,
          cancelled: args.cancelled ?? false,
          note: args.note ?? '',
        }),
      });
      await refuseIfLease(res, 'ui', args.threadId);
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

    /**
     * DELETE /chat/history/{thread_id} → erase the server transcript.
     *
     * Best-effort by default: clearing a thread or resetting it before a
     * regenerate goes on whether or not the harness agreed, and the local copy
     * is what the operator sees. `reportFailure` is for a caller that has told
     * the operator the thread is gone — deleting it from a list — and must say
     * so when the harness refused, or it reappears on the next refresh.
     */
    async deleteThreadHistory(
      threadId: string,
      { reportFailure = false }: { reportFailure?: boolean } = {},
    ): Promise<void> {
      try {
        const res = await rawFetch(`/chat/history/${encodeURIComponent(threadId)}`, {
          method: 'DELETE',
          headers: leaseHeader(threadId),
        });
        // A refusal reaches `onLeaseRefused` first.
        await refuseIfLease(res, 'history', threadId);
        if (!res.ok && reportFailure) {
          throw new Error(`chat/history: ${res.status} ${await detailOf(res)}`);
        }
      } catch (err) {
        if (reportFailure) throw err;
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
      // Normalised here, where every other thread id a client holds is: the wire
      // spells them `{tenant}:{suffix}` and clients send and store the suffix.
      // Left raw, a caller building `/t/{thread_id}` would produce an address the
      // harness rejects for containing a colon.
      // A pending row past its deadline is dropped here, where both the engine
      // and the attention line read it — see `isLapsedApproval`.
      const now = Date.now();
      return (body.requests ?? [])
        .filter((row) => !isLapsedApproval(row, now))
        .map((row) => (row.thread_id ? { ...row, thread_id: threadSuffix(row.thread_id) } : row));
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
