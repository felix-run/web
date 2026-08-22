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
    if (status === 'completed' || status === 'succeeded' || status === 'failed' || status === 'error') {
      return run;
    }
    if (run.error) return run;
    await new Promise((r) => setTimeout(r, interval));
  }
}
