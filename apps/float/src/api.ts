import { authHeaders, handleUnauthorized } from './lib/auth';
import type { ChatMessage, StreamEvent } from './types';

async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(input, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), ...authHeaders() },
  });
  if (res.status === 401) handleUnauthorized();
  return res;
}

export async function streamChat(
  args: {
    manifest: string;
    messages: ChatMessage[];
    threadId: string;
    signal?: AbortSignal;
  },
  onEvent: (event: StreamEvent) => void | Promise<void>,
): Promise<void> {
  const res = await apiFetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      manifest: args.manifest,
      messages: args.messages,
      thread_id: args.threadId,
    }),
    signal: args.signal,
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(`chat/stream: ${res.status} ${detail.slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep = buffer.indexOf('\n\n');
    while (sep !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      sep = buffer.indexOf('\n\n');

      const line = frame.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice('data:'.length).trim();
      if (payload === '[DONE]') return;

      try {
        await onEvent(JSON.parse(payload) as StreamEvent);
      } catch {
        // ignore malformed frames
      }
    }
  }
}

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

export async function decideApproval(
  id: string,
  decision: { status: 'approved' | 'denied'; note?: string; edited_args?: Record<string, unknown> },
): Promise<void> {
  const res = await apiFetch(`/api/approvals/${encodeURIComponent(id)}/decide`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(decision),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`decide: ${res.status} ${detail.slice(0, 200)}`);
  }
}

export async function listApprovals(status: 'pending' | 'approved' | 'denied' = 'pending'): Promise<
  Array<{
    id: string;
    tool_name: string;
    args: Record<string, unknown>;
    status: string;
  }>
> {
  const res = await apiFetch(`/api/approvals?status=${status}`);
  if (!res.ok) throw new Error(`approvals: ${res.status}`);
  const body = (await res.json()) as { items?: unknown[]; requests?: unknown[] };
  return (body.requests ?? body.items ?? []) as Array<{
    id: string;
    tool_name: string;
    args: Record<string, unknown>;
    status: string;
  }>;
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

export async function continueChat(args: { threadId: string; manifest: string }): Promise<unknown> {
  const res = await apiFetch('/api/chat/continue', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      thread_id: args.threadId,
      manifest: args.manifest,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`continue: ${res.status} ${detail.slice(0, 200)}`);
  }
  return res.json();
}

export async function setThinkingLevel(args: {
  threadId: string;
  thinkingLevel: string;
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

export async function getSessionSnapshot(
  threadId: string,
): Promise<import('./types').SessionSnapshot | null> {
  try {
    const res = await fetch(`/api/chat/sessions/${encodeURIComponent(threadId)}`, {
      headers: authHeaders(),
    });
    if (!res.ok) return null;
    return (await res.json()) as import('./types').SessionSnapshot;
  } catch {
    return null;
  }
}

export async function acquireSessionLease(args: {
  threadId: string;
  holderId: string;
  mode?: 'exclusive' | 'shared';
  token?: string;
}): Promise<{ ok: boolean; token?: string; error?: string }> {
  const res = await apiFetch('/api/chat/sessions/lease', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      thread_id: args.threadId,
      holder_id: args.holderId,
      mode: args.mode ?? 'exclusive',
      ttl_seconds: 300,
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
    // best-effort
  }
}

/** GET /chat/sessions/search — full-text hits across the tenant event log. */
export async function searchSessions(
  q: string,
  limit = 12,
): Promise<Array<{ thread_id: string; content: string; event_id?: string }>> {
  const query = q.trim();
  if (!query) return [];
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const res = await apiFetch(`/api/chat/sessions/search?${params}`);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`search: ${res.status} ${detail.slice(0, 200)}`);
  }
  const body = (await res.json()) as {
    hits?: Array<{ thread_id: string; content: string; event_id?: string }>;
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

export interface DurableRun {
  status?: string;
  resume_token?: string;
  fiber_id?: string;
  final?: ChatMessage | { role?: string; content?: string };
  error?: string;
}

/** POST /chat — when the manifest is durable, returns 202 + resume_token. */
export async function startChat(args: {
  manifest: string;
  messages: ChatMessage[];
  threadId: string;
  signal?: AbortSignal;
}): Promise<{ kind: 'done'; final: ChatMessage } | { kind: 'durable'; resumeToken: string }> {
  const res = await apiFetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      manifest: args.manifest,
      messages: args.messages,
      thread_id: args.threadId,
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
