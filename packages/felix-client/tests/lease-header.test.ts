import { describe, expect, it, vi } from 'vitest';
import { isLeaseRefusal, LeaseRefusedError } from '../src/errors';
import { createFelixClient } from '../src/transport';

/**
 * `X-Felix-Lease-Token` on the routes that drive a thread (`felix-run/felix#479`).
 *
 * The harness checks the header on fifteen operations, and only when it is
 * present — so a client method that forgets it is not refused, it is simply
 * unguarded, and nothing at all reports that. Each method that reaches one of
 * those routes is listed here with the thread it should key the token on.
 */

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function client(respond: (url: string) => Response = () => new Response('{}', { status: 200 })) {
  const seen: Seen[] = [];
  const refused: Array<[string, string]> = [];
  const fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    seen.push({
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return respond(url);
  });
  const felix = createFelixClient({
    baseUrl: 'http://felix.test',
    fetch: fetch as unknown as typeof globalThis.fetch,
    leaseToken: (threadId) => (threadId === 't1' ? 'tok-t1' : undefined),
    onLeaseRefused: (threadId, code) => refused.push([threadId, code]),
  });
  return { felix, seen, refused };
}

const sse = () =>
  new Response('data: [DONE]\n\n', {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });

type Felix = ReturnType<typeof createFelixClient>;

/** Every driving method, by the route it reaches. */
const DRIVING: Array<[string, (f: Felix) => Promise<unknown>]> = [
  [
    '/chat/stream',
    (f) => f.streamChat({ manifest: 'm', messages: [], threadId: 't1' }, { onEvent: () => {} }),
  ],
  ['/chat', (f) => f.startChat({ manifest: 'm', messages: [], threadId: 't1' })],
  ['/chat/continue', (f) => f.continueChat({ threadId: 't1', manifest: 'm' })],
  ['/chat/abort', (f) => f.abortChat('t1')],
  ['/chat/rewind', (f) => f.rewindChat({ threadId: 't1', eventId: 'e1' })],
  ['/chat/steer', (f) => f.steerChat({ threadId: 't1', text: 'go' })],
  ['/chat/tool_result', (f) => f.postToolResult({ threadId: 't1', toolCallId: 'c', content: '' })],
  ['/chat/ui', (f) => f.respondUiRequest({ threadId: 't1', requestId: 'r', value: 1 })],
  ['/chat/sessions/name', (f) => f.renameSession('t1', 'n')],
  ['/chat/sessions/label', (f) => f.setSessionLabel({ threadId: 't1', eventId: 'e', label: 'l' })],
  ['/chat/thinking', (f) => f.setThinkingLevel({ threadId: 't1', thinkingLevel: 'high' })],
  ['/chat/compact', (f) => f.compactSession('t1', 'm')],
  ['/chat/history/t1', (f) => f.deleteThreadHistory('t1')],
];

describe('the lease token on driving requests', () => {
  it.each(DRIVING)('%s carries the token the caller holds for the thread', async (route, call) => {
    const { felix, seen } = client((url) =>
      url.endsWith('/chat/stream') ? sse() : new Response('{}'),
    );
    await call(felix);
    const request = seen.find((s) => s.url === `http://felix.test${route}`);
    expect(request?.headers['x-felix-lease-token']).toBe('tok-t1');
  });

  it('sends no header for a thread the caller holds nothing on', async () => {
    const { felix, seen } = client();
    await felix.compactSession('t2', 'm');
    expect(seen[0]?.headers).not.toHaveProperty('x-felix-lease-token');
  });

  it('does not send it on a read, or on a fork, which the harness leaves unguarded', async () => {
    const { felix, seen } = client();
    await felix.getSessionSnapshot('t1');
    await felix.forkSession({ threadId: 't1', newThreadId: 't3' });
    for (const s of seen) expect(s.headers).not.toHaveProperty('x-felix-lease-token');
  });
});

describe('a refusal', () => {
  const refuse = (detail: string) => () =>
    new Response(JSON.stringify({ detail }), { status: 409 });

  it('is a LeaseRefusedError, reported to onLeaseRefused first', async () => {
    const { felix, refused } = client(refuse('lease_read_only'));
    const err = await felix.compactSession('t1', 'm').catch((e: unknown) => e);
    expect(isLeaseRefusal(err)).toBe(true);
    expect(err).toBeInstanceOf(LeaseRefusedError);
    expect(err).toMatchObject({ code: 'lease_read_only', threadId: 't1' });
    expect(refused).toEqual([['t1', 'lease_read_only']]);
  });

  it('reports lease_held the same way, even from a best-effort delete', async () => {
    const { felix, refused } = client(refuse('lease_held'));
    await felix.deleteThreadHistory('t1');
    expect(refused).toEqual([['t1', 'lease_held']]);
  });

  it('leaves any other 409 to the route', async () => {
    const { felix, refused } = client(refuse('idempotency_in_progress'));
    const err = await felix
      .startChat({ manifest: 'm', messages: [], threadId: 't1' })
      .catch((e: unknown) => e);
    expect(isLeaseRefusal(err)).toBe(false);
    expect(String(err)).toContain('409');
    expect(refused).toEqual([]);
  });
});
