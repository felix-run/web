import { reportReachability } from '@/lib/connection';
/**
 * Thin client for the Felix surfaces the chat UI uses, all reached same-origin
 * under /api/* (Vite proxy in dev, proxy Worker in prod):
 *
 *   GET  /api/v1/models      → manifest list for the switcher
 *   POST /api/chat/stream    → SSE token stream + inline tool events (+ per-turn
 *                              token usage on the terminal on_chain_end frame)
 *   GET  /api/audit          → activity feed (Inspector)
 *   GET  /api/audit/metrics  → tool-call rollups (Inspector → Metrics)
 *   GET  /api/approvals      → pending HITL approvals (Inspector)
 *   POST /api/approvals/:id/decide → approve / deny
 *   GET  /api/plans          → plan/step progress (Inspector)
 *
 * The Inspector endpoints are tenant-scoped; an anonymous dev caller resolves
 * to tenant `default`, so they read back exactly what anonymous chat turns
 * produce. Behind real auth, send an Authorization header (see README).
 */

import { readSseStream } from '@felix/protocol';
import { authHeaders, handleUnauthorized } from './lib/auth';
import { threadSuffix } from './lib/threads';
import type {
  AgentCard,
  ApprovalRequest,
  AuditEvent,
  AuditEventWire,
  ChatMessage,
  EvalDataset,
  EvalDatasetItem,
  EvalRun,
  EvalRunSummary,
  JobRecord,
  JobRun,
  ManifestPointer,
  ManifestSummary,
  ManifestVersionRow,
  MemoryHit,
  MemoryRecord,
  Plan,
  ResolvedManifest,
  Rubric,
  SessionSnapshot,
  SessionSummary,
  StreamEvent,
  ThinkingLevel,
  ThreadHistory,
  ToolMetrics,
  UsageEvent,
} from './types';

/**
 * `fetch` for `/api/*` with the shared-key header attached. A 401 means the
 * key is missing/wrong/rotated — drop it and re-prompt (handleUnauthorized)
 * before the caller's own error handling runs.
 */
async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(input, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), ...authHeaders() },
    });
  } catch (err) {
    // `fetch` rejects only when the request never reached anything: DNS, TLS, a
    // refused connection, a dropped link. That is the one case that means the
    // harness is not there. An abort is the caller changing its mind, not a
    // connectivity fact, so it is left alone.
    if (!(err instanceof DOMException && err.name === 'AbortError')) {
      reportReachability(false);
    }
    throw err;
  }
  // Any reply at all, a 500 included, means something is listening.
  reportReachability(true);
  if (res.status === 401) handleUnauthorized();
  return res;
}

/** GET /v1/models → manifest names for the dropdown. */
export async function listManifests(signal?: AbortSignal): Promise<string[]> {
  const res = await apiFetch('/api/v1/models', { signal });
  if (!res.ok) throw new Error(`models: ${res.status}`);
  const body = (await res.json()) as { data?: Array<{ id: string }> };
  return (body.data ?? []).map((m) => m.id);
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

/**
 * POST /chat/stream and dispatch each frame. Resolves when the server emits
 * `data: [DONE]`. The SSE framing (one event per `\n\n`) is decoded with a carry
 * buffer so events split across network chunks are not dropped — same discipline
 * the harness uses on its own SSE reads.
 *
 * `readSseStream` also folds the harness's `event: error` frame into an
 * `on_error` event, so a stream that fails after its 200 arrives here as an
 * event rather than as silence.
 */
export async function streamChat(args: StreamArgs, handlers: StreamHandlers): Promise<void> {
  const res = await apiFetch('/api/chat/stream', {
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
    const detail = await res.text().catch(() => '');
    throw new Error(`chat/stream: ${res.status} ${detail.slice(0, 200)}`);
  }

  await readSseStream(res, handlers.onEvent, { onCursor: handlers.onCursor });
}

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
export async function resumeStream(
  args: { threadId: string; lastEventId?: string; signal?: AbortSignal },
  handlers: StreamHandlers,
): Promise<void> {
  const res = await apiFetch(`/api/chat/stream/${encodeURIComponent(args.threadId)}`, {
    // The harness reads the header, and falls back to a `last_event_id` query
    // param. The header is the standard spelling, and keeps the cursor out of
    // request URLs and therefore out of access logs.
    headers: args.lastEventId ? { 'last-event-id': args.lastEventId } : {},
    signal: args.signal,
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(`chat/stream/${args.threadId}: ${res.status} ${detail.slice(0, 200)}`);
  }

  await readSseStream(res, handlers.onEvent, { onCursor: handlers.onCursor });
}

// --- Inspector REST helpers ---

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
export async function listAudit(
  opts: { status?: string; eventType?: string; limit?: number } = {},
): Promise<AuditEvent[]> {
  const q = new URLSearchParams();
  if (opts.status) q.set('status', opts.status);
  if (opts.eventType) q.set('event_type', opts.eventType);
  q.set('limit', String(opts.limit ?? 50));
  const res = await apiFetch(`/api/audit?${q}`);
  if (!res.ok) throw new Error(`audit: ${res.status}`);
  const body = (await res.json()) as { events?: AuditEventWire[] };
  return (body.events ?? []).map((e) => ({
    ...e,
    payload: e.payload_json ?? e.payload ?? {},
  }));
}

/** GET /approvals?status=… → human-in-the-loop queue. */
export async function listApprovals(
  status: ApprovalRequest['status'] = 'pending',
): Promise<ApprovalRequest[]> {
  const res = await apiFetch(`/api/approvals?status=${status}`);
  if (!res.ok) throw new Error(`approvals: ${res.status}`);
  const body = (await res.json()) as { requests?: ApprovalRequest[] };
  return body.requests ?? [];
}

/** POST /approvals/:id/decide → approve or deny a gated tool call. */
export async function decideApproval(
  id: string,
  decision: {
    status: 'approved' | 'denied';
    note?: string;
    edited_args?: Record<string, unknown>;
  },
): Promise<ApprovalRequest> {
  const res = await apiFetch(`/api/approvals/${encodeURIComponent(id)}/decide`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(decision),
  });
  if (!res.ok) throw new Error(`decide: ${res.status}`);
  return (await res.json()) as ApprovalRequest;
}

/** GET /usage → paginated token meter events. */
export async function listUsage(
  opts: { limit?: number; cursor?: string; manifest_id?: string } = {},
): Promise<{ items: UsageEvent[]; next_cursor: string | null }> {
  const q = new URLSearchParams();
  q.set('limit', String(opts.limit ?? 50));
  if (opts.cursor) q.set('cursor', opts.cursor);
  if (opts.manifest_id) q.set('manifest_id', opts.manifest_id);
  const res = await apiFetch(`/api/usage?${q}`);
  if (!res.ok) throw new Error(`usage: ${res.status}`);
  return (await res.json()) as { items: UsageEvent[]; next_cursor: string | null };
}

/** POST /chat/tool_result — complete a client-executed tool pause. */
export async function postToolResult(args: {
  threadId: string;
  toolCallId: string;
  content: string;
  error?: boolean;
}): Promise<void> {
  const res = await apiFetch('/api/chat/tool_result', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      thread_id: args.threadId,
      tool_call_id: args.toolCallId,
      content: args.content,
      error: args.error ?? false,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`tool_result: ${res.status} ${detail.slice(0, 200)}`);
  }
}

export interface DurableRun {
  status?: string;
  resume_token?: string;
  fiber_id?: string;
  final?: ChatMessage | { role?: string; content?: string };
  error?: string;
}

/** POST /chat — durable manifests return 202 + resume_token. */
export async function startChat(args: {
  manifest: string;
  messages: ChatMessage[];
  threadId?: string;
  signal?: AbortSignal;
}): Promise<{ kind: 'done'; final: ChatMessage } | { kind: 'durable'; resumeToken: string }> {
  const res = await apiFetch('/api/chat', {
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

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`chat: ${res.status} ${detail.slice(0, 200)}`);
  }

  const body = (await res.json()) as { final?: ChatMessage };
  return {
    kind: 'done',
    final: body.final ?? { role: 'assistant', content: '' },
  };
}

export async function getDurableRun(resumeToken: string): Promise<DurableRun> {
  const res = await apiFetch(`/api/chat/runs/${encodeURIComponent(resumeToken)}`);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`chat/runs: ${res.status} ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as DurableRun;
}

export async function pollDurableRun(
  resumeToken: string,
  opts: {
    signal?: AbortSignal;
    intervalMs?: number;
    onTick?: (run: DurableRun) => void;
  } = {},
): Promise<DurableRun> {
  const interval = opts.intervalMs ?? 1500;
  while (true) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const run = await getDurableRun(resumeToken);
    opts.onTick?.(run);
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
}

export async function steerChat(args: {
  threadId: string;
  text: string;
  kind?: 'steer' | 'follow_up';
}): Promise<void> {
  const res = await apiFetch('/api/chat/steer', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      thread_id: args.threadId,
      text: args.text,
      kind: args.kind ?? 'steer',
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`steer: ${res.status} ${detail.slice(0, 200)}`);
  }
}

/** GET /chat/sessions/{thread_id} — authoritative snapshot (truth over local cache). */
export async function getSessionSnapshot(threadId: string): Promise<SessionSnapshot | null> {
  try {
    const res = await fetch(`/api/chat/sessions/${encodeURIComponent(threadId)}`, {
      headers: authHeaders(),
    });
    if (!res.ok) return null;
    return (await res.json()) as SessionSnapshot;
  } catch {
    return null;
  }
}

/** POST /chat/abort — cancel the in-flight server run. */
export async function abortChat(threadId: string): Promise<void> {
  const res = await apiFetch('/api/chat/abort', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ thread_id: threadId }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`abort: ${res.status} ${detail.slice(0, 200)}`);
  }
}

/** POST /chat/continue — resume after abort/error without a new user message. */
export async function continueChat(args: {
  threadId: string;
  manifest: string;
  model?: string;
}): Promise<unknown> {
  const res = await apiFetch('/api/chat/continue', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      thread_id: args.threadId,
      manifest: args.manifest,
      ...(args.model ? { model: args.model } : {}),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`continue: ${res.status} ${detail.slice(0, 200)}`);
  }
  return res.json();
}

/** POST /chat/thinking — set live thinking level for the thread. */
export async function setThinkingLevel(args: {
  threadId: string;
  thinkingLevel: ThinkingLevel;
}): Promise<void> {
  const res = await apiFetch('/api/chat/thinking', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      thread_id: args.threadId,
      thinking_level: args.thinkingLevel,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`thinking: ${res.status} ${detail.slice(0, 200)}`);
  }
}

/** POST /chat/sessions/lease — exclusive/shared attach for multi-tab. */
export async function acquireSessionLease(args: {
  threadId: string;
  holderId: string;
  mode?: 'exclusive' | 'shared';
  ttlSeconds?: number;
  token?: string;
}): Promise<{ ok: boolean; token?: string; error?: string }> {
  const res = await apiFetch('/api/chat/sessions/lease', {
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
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`lease: ${res.status} ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as { ok: boolean; token?: string };
}

/** POST /chat/sessions/lease/release */
export async function releaseSessionLease(args: {
  threadId: string;
  holderId?: string;
  token?: string;
}): Promise<void> {
  try {
    await apiFetch('/api/chat/sessions/lease/release', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        thread_id: args.threadId,
        ...(args.holderId ? { holder_id: args.holderId } : {}),
        ...(args.token ? { token: args.token } : {}),
      }),
    });
  } catch {
    // best-effort on tab close / navigate
  }
}

/**
 * GET /chat/sessions — every thread the harness holds for this tenant.
 *
 * The authoritative thread index. `src/lib/threads.ts` still keeps a
 * localStorage copy, but as a cache and as the only record of which manifest a
 * thread used — the harness does not track that.
 *
 * Ids arrive tenant-prefixed and are stripped here, so callers only ever see the
 * suffix they are allowed to send back.
 */
export async function listSessions(): Promise<SessionSummary[]> {
  const res = await apiFetch('/api/chat/sessions');
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
}

interface RawSessionRow {
  id?: string;
  sessionName?: string | null;
  createdAt?: number;
  updatedAt?: number;
  parentSessionId?: string | null;
}

/**
 * POST /chat/sessions/name — give a thread a durable name.
 *
 * Also appends a `session_info` event to the transcript, so the rename is part
 * of the session log rather than only metadata.
 */
export async function renameSession(threadId: string, name: string): Promise<void> {
  const res = await apiFetch('/api/chat/sessions/name', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ thread_id: threadId, name }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`sessions/name: ${res.status} ${detail.slice(0, 200)}`);
  }
}

/**
 * POST /chat/fork — branch a thread into a new one.
 *
 * The write half of rewind: rewind moves this thread's leaf, fork copies up to
 * an event into a *separate* thread and leaves the original where it was. The
 * new thread records the original as its parent.
 *
 * `fromEventId` defaults to the whole thread.
 */
export async function forkSession(args: {
  threadId: string;
  newThreadId: string;
  fromEventId?: string;
}): Promise<{ leaf_id?: string }> {
  const res = await apiFetch('/api/chat/fork', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      thread_id: args.threadId,
      new_thread_id: args.newThreadId,
      ...(args.fromEventId ? { from_event_id: args.fromEventId } : {}),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`chat/fork: ${res.status} ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as { leaf_id?: string };
}

/**
 * POST /chat/compact — summarise the thread's older context now.
 *
 * The agent loop does this on its own when the window fills; this is the manual
 * trigger. It needs a manifest because the compaction strategy and the model
 * that writes the summary both come from one.
 */
export async function compactSession(threadId: string, manifest: string): Promise<void> {
  const res = await apiFetch('/api/chat/compact', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ thread_id: threadId, manifest }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`chat/compact: ${res.status} ${detail.slice(0, 200)}`);
  }
}

/**
 * GET /chat/sessions/{id}/export — the active branch as JSONL.
 *
 * Returns the text rather than triggering the download, so the caller decides
 * what to do with it. Only the active branch: a rewound-away sibling is not
 * included, which matches what the transcript shows.
 */
export async function exportSession(threadId: string): Promise<string> {
  const res = await apiFetch(`/api/chat/sessions/${encodeURIComponent(threadId)}/export`);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`sessions/export: ${res.status} ${detail.slice(0, 200)}`);
  }
  return await res.text();
}

// --- Long-term memory (/memory) ---
//
// Reads need the `memory:read` scope and writes `memory:write`, so a 403 here
// means the key is too narrow rather than that the store is empty — the two look
// identical without the message `describeError` writes. These routes are also
// newer than the rest of the surface, so a 404 means the harness predates them.

/** GET /memory → what the agent has stored, newest first. */
export async function listMemories(
  opts: { manifestId?: string; kind?: string; limit?: number } = {},
): Promise<MemoryRecord[]> {
  const q = new URLSearchParams();
  if (opts.manifestId) q.set('manifest_id', opts.manifestId);
  if (opts.kind) q.set('kind', opts.kind);
  q.set('limit', String(opts.limit ?? 50));
  const res = await apiFetch(`/api/memory?${q}`);
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
export async function searchMemories(
  query: string,
  opts: { manifestId?: string; kind?: string; limit?: number } = {},
): Promise<MemoryHit[]> {
  const q = new URLSearchParams({ q: query });
  if (opts.manifestId) q.set('manifest_id', opts.manifestId);
  if (opts.kind) q.set('kind', opts.kind);
  q.set('limit', String(opts.limit ?? 8));
  const res = await apiFetch(`/api/memory/search?${q}`);
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
export async function memoriesAsOf(
  turnSeq: number,
  opts: { manifestId?: string; kind?: string; limit?: number } = {},
): Promise<MemoryRecord[]> {
  const q = new URLSearchParams();
  if (opts.manifestId) q.set('manifest_id', opts.manifestId);
  if (opts.kind) q.set('kind', opts.kind);
  q.set('limit', String(opts.limit ?? 200));
  const res = await apiFetch(`/api/memory/as-of/${encodeURIComponent(String(turnSeq))}?${q}`);
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
export async function forgetMemory(id: string): Promise<void> {
  const res = await apiFetch(`/api/memory/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`memory/forget: ${res.status} ${detail.slice(0, 200)}`);
  }
}

/** GET /chat/sessions/search — full-text hits across the tenant's event log. */
export async function searchSessions(
  q: string,
  limit = 20,
): Promise<Array<{ thread_id: string; content: string; event_id?: string; rank?: number }>> {
  const query = q.trim();
  if (!query) return [];
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const res = await apiFetch(`/api/chat/sessions/search?${params}`);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`search: ${res.status} ${detail.slice(0, 200)}`);
  }
  const body = (await res.json()) as {
    hits?: Array<{ thread_id: string; content: string; event_id?: string; rank?: number }>;
  };
  return body.hits ?? [];
}

/** POST /chat/rewind — set the active leaf to an earlier event. */
export async function rewindChat(args: {
  threadId: string;
  eventId: string;
  summarize?: boolean;
  manifest?: string;
}): Promise<{ ok: boolean; leaf_id?: string }> {
  const res = await apiFetch('/api/chat/rewind', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      thread_id: args.threadId,
      event_id: args.eventId,
      summarize: args.summarize ?? false,
      ...(args.manifest ? { manifest: args.manifest } : {}),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`rewind: ${res.status} ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as { ok: boolean; leaf_id?: string };
}

/** POST /chat/ui — answer a select/confirm/input prompt. */
export async function respondUiRequest(args: {
  requestId: string;
  value?: unknown;
  cancelled?: boolean;
  note?: string;
}): Promise<void> {
  const res = await apiFetch('/api/chat/ui', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      request_id: args.requestId,
      value: args.value,
      cancelled: args.cancelled ?? false,
      note: args.note ?? '',
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`ui: ${res.status} ${detail.slice(0, 200)}`);
  }
}

/** GET /plans → plan/step progress (populated by the `deep` pattern). */
export async function listPlans(limit = 25): Promise<Plan[]> {
  const res = await apiFetch(`/api/plans?limit=${limit}`);
  if (!res.ok) throw new Error(`plans: ${res.status}`);
  const body = (await res.json()) as { plans?: Plan[] };
  return body.plans ?? [];
}

/**
 * GET /audit/metrics → tool-call rollups for a window. Aggregates `tool_call`
 * audit rows by `(tool, transport, status, error_code)`; defaults to the last
 * hour server-side. We pass an explicit `since` so the panel window is stable.
 */
export async function getToolMetrics(
  opts: { sinceMs?: number; limit?: number } = {},
): Promise<ToolMetrics> {
  const q = new URLSearchParams();
  if (opts.sinceMs) q.set('since', String(Date.now() - opts.sinceMs));
  q.set('limit', String(opts.limit ?? 200));
  const res = await apiFetch(`/api/audit/metrics?${q}`);
  if (!res.ok) throw new Error(`metrics: ${res.status}`);
  return (await res.json()) as ToolMetrics;
}

// --- Eval harness (/eval) ---

async function evalFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(`/api/eval${path}`, init);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`eval ${path}: ${res.status} ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/** GET /eval/datasets → the tenant's golden datasets. */
export async function listEvalDatasets(): Promise<EvalDataset[]> {
  const body = await evalFetch<{ items?: EvalDataset[]; datasets?: EvalDataset[] }>('/datasets');
  return body.items ?? body.datasets ?? [];
}

/**
 * PUT /eval/datasets/{name} → upsert a dataset *whole*. The harness has no
 * per-item route: `items` replaces the dataset's contents on every write.
 */
export async function putEvalDataset(
  name: string,
  description = '',
  items: Array<{ user_input: string; rubric: Rubric }> = [],
): Promise<EvalDataset> {
  return evalFetch<EvalDataset>(`/datasets/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ description, items }),
  });
}

/** GET /eval/datasets/{name} → the dataset with its items. */
export async function getEvalDataset(
  name: string,
): Promise<EvalDataset & { items: EvalDatasetItem[] }> {
  const body = await evalFetch<EvalDataset & { items?: EvalDatasetItem[] }>(
    `/datasets/${encodeURIComponent(name)}`,
  );
  return { ...body, items: body.items ?? [] };
}

/** Items in a dataset — read from the dataset itself; there is no /items route. */
export async function listEvalItems(dataset: string): Promise<EvalDatasetItem[]> {
  return (await getEvalDataset(dataset)).items;
}

/**
 * Append one item. Datasets are written whole, so this is a read-modify-write:
 * fetch current items, append, PUT the result back.
 */
export async function addEvalItem(
  dataset: string,
  item: { user_input: string; rubric: Rubric },
): Promise<EvalDataset> {
  const current = await getEvalDataset(dataset);
  const items = [
    ...current.items.map((i) => ({ user_input: i.user_input, rubric: i.rubric })),
    item,
  ];
  return putEvalDataset(dataset, current.description ?? '', items);
}

/**
 * POST /eval/datasets/{name}/run → replay the dataset against a manifest and
 * judge each item. Returns the summary; per-item scores come back via
 * getEvalRun(run_id). `deterministic_judge` skips the LLM judge and scores with
 * rubric heuristics only — the path CI uses.
 */
export async function runEvalDataset(
  dataset: string,
  candidateManifest: string,
  deterministicJudge = false,
): Promise<EvalRunSummary> {
  return evalFetch<EvalRunSummary>(`/datasets/${encodeURIComponent(dataset)}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      candidate_manifest: candidateManifest,
      deterministic_judge: deterministicJudge,
    }),
  });
}

/** GET /eval/runs?dataset=… → runs newest first. */
export async function listEvalRuns(dataset?: string, limit = 25): Promise<EvalRun[]> {
  const q = new URLSearchParams({ limit: String(limit) });
  if (dataset) q.set('dataset', dataset);
  const body = await evalFetch<{ items?: EvalRun[]; runs?: EvalRun[] }>(`/runs?${q}`);
  return body.items ?? body.runs ?? [];
}

/** GET /eval/runs/{id} → one run with per-item scores. */
export async function getEvalRun(id: string): Promise<EvalRun> {
  return evalFetch<EvalRun>(`/runs/${encodeURIComponent(id)}`);
}

// --- Manifest lifecycle (/manifests) ---
//
// Writes require the `manifests:write` scope. With FELIX_AUTH_MODE=none the
// harness skips scope checks entirely, so local dev drives the full lifecycle
// unauthenticated.
//
// The harness exposes no version *list* route: `GET /manifests` returns active
// pointers, and a specific version is read with `GET /manifests/{name}?version=N`.

async function manifestFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(`/api/manifests${path}`, init);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`manifests ${path}: ${res.status} ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/** GET /manifests → tenant-managed manifests (active pointer + canary state). */
export async function listTenantManifests(): Promise<ManifestSummary[]> {
  const body = await manifestFetch<{ items?: ManifestSummary[]; manifests?: ManifestSummary[] }>(
    '',
  );
  return body.items ?? body.manifests ?? [];
}

/**
 * GET /manifests/{name} → resolved manifest + which layer it came from.
 *
 * `threadId` is the thread-id *suffix*, and it is what makes `variant`
 * meaningful: canary assignment is a server-side hash over the thread, so the
 * harness answers `stable` for every caller that does not name one.
 */
export async function getResolvedManifest(
  name: string,
  opts: { version?: number; threadId?: string } = {},
): Promise<ResolvedManifest> {
  const q = new URLSearchParams();
  if (opts.version) q.set('version', String(opts.version));
  if (opts.threadId) q.set('thread_id', opts.threadId);
  // One flat template on purpose: check-api-drift extracts route strings by
  // regex, and a nested template literal truncates the path it sees.
  const qs = q.toString();
  const suffix = qs ? `?${qs}` : '';
  return manifestFetch<ResolvedManifest>(`/${encodeURIComponent(name)}${suffix}`);
}

/**
 * PUT /manifests/{name} → append a new version and activate it. The body's
 * `metadata.name` must equal `name` or the harness answers 400 `name_mismatch`.
 */
export async function createManifestVersion(
  name: string,
  manifest: unknown,
  comment = '',
): Promise<ManifestVersionRow> {
  return manifestFetch<ManifestVersionRow>(`/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ manifest, comment }),
  });
}

/**
 * POST /manifests/{name}/rollback → flip the active pointer to `version`.
 * This is the harness's activate: the route name reflects its common use, but
 * it activates any version, forward or back.
 */
export async function activateManifestVersion(
  name: string,
  version: number,
  comment = 'activate',
): Promise<ManifestPointer> {
  return manifestFetch<ManifestPointer>(`/${encodeURIComponent(name)}/rollback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version, comment }),
  });
}

/** POST /manifests/{name}/canary → route `weight`% of traffic to `version` (null clears). */
export async function setManifestCanary(
  name: string,
  canaryVersion: number | null,
  canaryWeight: number,
): Promise<ManifestPointer> {
  return manifestFetch<ManifestPointer>(`/${encodeURIComponent(name)}/canary`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ canary_version: canaryVersion, canary_weight: canaryWeight }),
  });
}

/**
 * DELETE /manifests/{name}/canary → clear the canary. The harness drops the
 * canary version and zeroes its weight together; there is no "keep it pinned at
 * 0%" variant.
 */
export async function clearManifestCanary(name: string): Promise<ManifestPointer> {
  return manifestFetch<ManifestPointer>(`/${encodeURIComponent(name)}/canary`, {
    method: 'DELETE',
  });
}

// --- Scheduled jobs (/jobs) ---
//
// The worker's `run_scheduled_jobs` cron invokes each job's manifest on its
// schedule — which needs felix-scheduler running alongside felix-worker. There
// is no run-now route; inspect `listJobRuns` for what the sweep has done.

async function jobsFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(`/api/jobs${path}`, init);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`jobs ${path}: ${res.status} ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/** GET /jobs → the tenant's persistent job registry. */
export async function listJobs(): Promise<JobRecord[]> {
  const body = await jobsFetch<{ items?: JobRecord[]; jobs?: JobRecord[] }>('');
  return body.items ?? body.jobs ?? [];
}

/** PUT /jobs/{name} → create or update a job. Empty `schedule` = never swept. */
export async function upsertJob(job: {
  name: string;
  schedule?: string;
  manifest_id?: string;
  payload?: Record<string, unknown>;
  enabled?: boolean;
}): Promise<JobRecord> {
  const { name, schedule = '', manifest_id = '', payload = {}, enabled = true } = job;
  return jobsFetch<JobRecord>(`/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ schedule, manifest_id, payload, enabled }),
  });
}

/** GET /jobs/{name}/runs → recent runs of one job, newest first. */
export async function listJobRuns(name: string, limit = 20): Promise<JobRun[]> {
  const body = await jobsFetch<{ items?: JobRun[] }>(
    `/${encodeURIComponent(name)}/runs?limit=${limit}`,
  );
  return body.items ?? [];
}

/** DELETE /jobs/{name} → remove a job from the registry. */
export async function deleteJob(name: string): Promise<void> {
  await jobsFetch<{ status: string }>(`/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

// --- A2A discovery card (/.well-known/agent-card.json) ---

/**
 * GET /.well-known/agent-card.json → the orchestrator's A2A discovery document
 * for its *default* manifest (protocols, endpoints, declared capabilities). The
 * route is public (auth middleware skips /.well-known/*).
 */
export async function getAgentCard(): Promise<AgentCard> {
  const res = await apiFetch('/api/.well-known/agent-card.json');
  if (!res.ok) throw new Error(`agent-card: ${res.status}`);
  return (await res.json()) as AgentCard;
}

// --- Thread history (/chat/history/{thread_id}) ---

/**
 * GET /chat/history/{thread_id} → the server-side checkpointed transcript.
 * Anonymous callers get this only in local dev (the harness adds a dev
 * fallthrough); behind auth it 401s. We use a bare fetch (not apiFetch) so a 401
 * doesn't trip the shared-key reset/reload — any non-OK simply means "no server
 * history", and the caller falls back to the localStorage transcript.
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
export async function getThreadHistory(
  threadId: string,
  opts: { limit?: number; beforeSeq?: number } = {},
): Promise<ThreadHistory | null> {
  const query = new URLSearchParams();
  if (opts.limit !== undefined) query.set('limit', String(opts.limit));
  if (opts.beforeSeq !== undefined) query.set('before_seq', String(opts.beforeSeq));
  const qs = query.toString();
  try {
    const res = await fetch(
      `/api/chat/history/${encodeURIComponent(threadId)}${qs ? `?${qs}` : ''}`,
      { headers: authHeaders() },
    );
    if (!res.ok) return null;
    return (await res.json()) as ThreadHistory;
  } catch {
    return null;
  }
}

/** DELETE /chat/history/{thread_id} → erase the server transcript. Best-effort. */
export async function deleteThreadHistory(threadId: string): Promise<void> {
  try {
    await fetch(`/api/chat/history/${encodeURIComponent(threadId)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
  } catch {
    // best-effort; the local copy is the source of truth in the demo
  }
}
