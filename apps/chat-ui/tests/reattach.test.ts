import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reattachThread } from '../src/lib/reattach';

/**
 * Rejoining a thread after its stream dropped.
 *
 * The behaviour worth pinning is not "does it parse a snapshot" — it is the two
 * decisions the loop makes that nothing else in the app makes: whether a clean
 * end means the thread is finished (it does not; the harness closes an idle
 * reattach after ~300s and expects the client back), and that a failed recovery
 * never becomes the error the user sees, because a specific message about the
 * lost stream is more useful than a generic one about the retry.
 */

/** A Response streaming exactly these SSE frames. */
function sse(body: string) {
  return new Response(new Blob([body]).stream(), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

const snapshotFrame = (phase: string) =>
  `id: 3\ndata: ${JSON.stringify({
    event: 'snapshot',
    data: {
      id: 't1',
      phase,
      transcript: [
        { id: 'e1', seq: 1, kind: 'message', role: 'user', content: 'hello' },
        { id: 'e2', seq: 2, kind: 'message', role: 'assistant', content: 'partial answer' },
      ],
      leafId: 'e2',
    },
  })}\n\n`;

const sessionEventFrame = (seq: number, content: string) =>
  `id: ${seq + 1}\ndata: ${JSON.stringify({
    event: 'session_event',
    data: { seq, kind: 'message', role: 'assistant', content },
  })}\n\n`;

const DONE = 'data: [DONE]\n\n';

/** Queue of responses, newest request takes the next one. */
function stubFetch(responses: Array<Response | Error>) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const spy = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      headers: Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [
          k.toLowerCase(),
          v,
        ]),
      ),
    });
    const next = responses.shift();
    if (!next) return new Response('{}', { status: 200 });
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal('fetch', spy);
  return calls;
}

const noWait = async () => {};

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('reattachThread', () => {
  it('rebuilds the transcript from a cold snapshot and stops once idle', async () => {
    // Reattach stream, then the phase check that decides whether to go again.
    stubFetch([sse(snapshotFrame('idle') + DONE), new Response(JSON.stringify({ phase: 'idle' }))]);

    const rendered: unknown[][] = [];
    await reattachThread({
      threadId: 't1',
      onTurns: (turns) => rendered.push(turns),
      wait: noWait,
    });

    expect(rendered.length).toBeGreaterThan(0);
    const last = rendered.at(-1) as Array<{ role: string; content: string }>;
    expect(last.map((t) => [t.role, t.content])).toEqual([
      ['user', 'hello'],
      ['assistant', 'partial answer'],
    ]);
  });

  it('sends the cursor as Last-Event-ID when one is known', async () => {
    const calls = stubFetch([sse(DONE), new Response(JSON.stringify({ phase: 'idle' }))]);

    await reattachThread({ threadId: 't1', lastEventId: '42', onTurns: () => {}, wait: noWait });

    expect(calls[0]?.url).toContain('/api/chat/stream/t1');
    expect(calls[0]?.headers['last-event-id']).toBe('42');
  });

  it('omits Last-Event-ID for a cold reattach', async () => {
    const calls = stubFetch([sse(DONE), new Response(JSON.stringify({ phase: 'idle' }))]);

    await reattachThread({ threadId: 't1', onTurns: () => {}, wait: noWait });

    expect(calls[0]?.headers['last-event-id']).toBeUndefined();
  });

  // The harness closing an idle reattach is routine, not terminal. Treating
  // [DONE] as "the thread is finished" would abandon a run still in progress.
  it('reattaches again when the stream ends but the thread is still working', async () => {
    const calls = stubFetch([
      sse(snapshotFrame('turn') + DONE),
      new Response(JSON.stringify({ phase: 'turn' })), // still working → go again
      sse(snapshotFrame('idle') + DONE),
      new Response(JSON.stringify({ phase: 'idle' })), // finished → stop
    ]);

    await reattachThread({ threadId: 't1', onTurns: () => {}, wait: noWait });

    const streamCalls = calls.filter((c) => c.url.includes('/chat/stream/'));
    expect(streamCalls).toHaveLength(2);
  });

  it('folds session events in after a snapshot without duplicating a replayed seq', async () => {
    stubFetch([
      sse(
        snapshotFrame('turn') +
          sessionEventFrame(2, 'partial answer') + // already in the snapshot
          sessionEventFrame(3, 'the rest of it') +
          DONE,
      ),
      new Response(JSON.stringify({ phase: 'idle' })),
    ]);

    const rendered: unknown[][] = [];
    await reattachThread({
      threadId: 't1',
      onTurns: (turns) => rendered.push(turns),
      wait: noWait,
    });

    const last = rendered.at(-1) as Array<{ role: string; content: string }>;
    expect(last.filter((t) => t.content === 'partial answer')).toHaveLength(1);
    expect(last.some((t) => t.content === 'the rest of it')).toBe(true);
  });

  it('does not surface a failed reattach as an error', async () => {
    stubFetch([new Error('network still down'), new Response(JSON.stringify({ phase: 'idle' }))]);

    await expect(
      reattachThread({ threadId: 't1', onTurns: () => {}, wait: noWait }),
    ).resolves.toBeUndefined();
  });

  it('gives up rather than looping forever on a thread that never leaves working', async () => {
    // Always working, always ends: the attempt budget is the only thing stopping this.
    const spy = vi.fn(async (input: unknown) =>
      String(input).includes('/chat/stream/')
        ? sse(snapshotFrame('turn') + DONE)
        : new Response(JSON.stringify({ phase: 'turn' })),
    );
    vi.stubGlobal('fetch', spy);

    await reattachThread({ threadId: 't1', onTurns: () => {}, wait: noWait });

    const streamCalls = spy.mock.calls.filter(([u]) => String(u).includes('/chat/stream/'));
    expect(streamCalls.length).toBeGreaterThan(1);
    expect(streamCalls.length).toBeLessThanOrEqual(6);
  });

  it('stops immediately when the caller has aborted', async () => {
    const spy = vi.fn(async () => sse(DONE));
    vi.stubGlobal('fetch', spy);
    const ctrl = new AbortController();
    ctrl.abort();

    await reattachThread({
      threadId: 't1',
      signal: ctrl.signal,
      onTurns: () => {},
      wait: noWait,
    });

    expect(spy).not.toHaveBeenCalled();
  });

  it('passes non-reattach frames to onEvent so a stream error is still reported', async () => {
    stubFetch([
      sse('event: error\ndata: {"error":{"message":"reattach blew up","type":"stream_error"}}\n\n'),
      new Response(JSON.stringify({ phase: 'idle' })),
    ]);

    const seen: Array<{ event: string }> = [];
    await reattachThread({
      threadId: 't1',
      onTurns: () => {},
      onEvent: (ev) => {
        seen.push(ev as { event: string });
      },
      wait: noWait,
    });

    expect(seen).toEqual([
      { event: 'on_error', data: { message: 'reattach blew up', type: 'stream_error' } },
    ]);
  });
});
