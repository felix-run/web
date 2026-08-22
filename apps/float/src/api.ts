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
