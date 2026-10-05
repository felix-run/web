import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createChatEngine } from '../src/engine';
import { createFelixClient } from '../src/transport';

/**
 * A streamed send under an `Idempotency-Key`, and every answer a resend of it
 * can get (`felix-run/felix#488`):
 *
 * - `200` with `Idempotent-Replayed: true`: the first attempt already ended, and
 *   the body is what *it* appended — `session_event` frames, its error frame if
 *   it had one, then `[DONE]`. Nothing ran for this request;
 * - `409 idempotency_in_progress`: the first attempt is still streaming, and
 *   `GET /chat/stream/{thread_id}` is how to watch it;
 * - `422 idempotency_key_reused`: the key was sent with a different body;
 * - an ordinary stream, when the first attempt appended nothing and freed the key.
 *
 * The transcript assertions are the point. A replay carries the user message the
 * harness stored, so folding it on top of the local copy is the very duplicate
 * the key exists to prevent.
 */

type Reply = Response | (() => Response) | Error;

const stream = (body: string, headers: Record<string, string> = {}) =>
  new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream', ...headers },
  });

const frame = (f: unknown) => `data: ${JSON.stringify(f)}\n\n`;
const DONE = 'data: [DONE]\n\n';

const userEvent = { id: 'e1', seq: 4, kind: 'message', role: 'user', content: 'hello again' };
const replyEvent = { id: 'e2', seq: 5, kind: 'message', role: 'assistant', content: 'the reply' };

const replay = (frames: string) => stream(frames, { 'idempotent-replayed': 'true' });

let sent: Array<{ url: string; method: string; headers: Record<string, string>; body?: string }>;

/** Answer `/chat/stream` POSTs from `replies` in order, and everything else from `other`. */
function harness(replies: Reply[], other: (url: string) => Response = () => new Response('{}')) {
  sent = [];
  const queue = [...replies];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init: RequestInit = {}) => {
      const url = String(input);
      const method = init.method ?? 'GET';
      sent.push({
        url,
        method,
        headers: (init.headers ?? {}) as Record<string, string>,
        body: init.body ? String(init.body) : undefined,
      });
      if (method === 'POST' && url.endsWith('/chat/stream')) {
        const next = queue.shift();
        if (!next) throw new Error('no reply scripted');
        if (next instanceof Error) throw next;
        return typeof next === 'function' ? next() : next;
      }
      return other(url);
    }),
  );
}

const posts = () => sent.filter((r) => r.method === 'POST' && r.url.endsWith('/chat/stream'));

/** An engine on `t1` whose transcript already holds one finished exchange. */
function engine() {
  let n = 0;
  const e = createChatEngine({
    client: createFelixClient({ baseUrl: '/api' }),
    threadId: () => 't1',
    newId: () => `id-${++n}`,
  });
  return e;
}

/** Put one user message and its empty reply on screen, as a client's send does. */
function open(e: ReturnType<typeof engine>, attempt: number) {
  e.setTurns([
    { id: 'old-u', role: 'user', content: 'earlier' },
    { id: 'old-a', role: 'assistant', content: 'earlier reply' },
    { id: `u${attempt}`, role: 'user', content: 'hello again' },
    { id: `a${attempt}`, role: 'assistant', content: '', tools: [] },
  ]);
  return e.send({
    manifest: 'quick',
    messages: [{ role: 'user', content: 'hello again' }],
    assistantId: `a${attempt}`,
    idempotencyKey: 'key-1',
  });
}

const contents = (e: ReturnType<typeof engine>) =>
  e.state.turns.map((t) => `${t.role}:${t.content}`);

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('a keyed send', () => {
  it('carries its key, and a resend carries the same key with the same body', async () => {
    harness([new TypeError('Failed to fetch'), stream(DONE)]);
    const e = engine();
    await open(e, 1);
    await open(e, 2);

    const [first, second] = posts();
    expect(first?.headers['idempotency-key']).toBe('key-1');
    expect(second?.headers['idempotency-key']).toBe('key-1');
    expect(second?.body).toBe(first?.body);
    expect(JSON.parse(String(first?.body))).toEqual({
      manifest: 'quick',
      messages: [{ role: 'user', content: 'hello again' }],
      thread_id: 't1',
    });
  });

  it("resolves 'failed' on a network error, without rejoining the thread", async () => {
    harness([new TypeError('Failed to fetch')]);
    const e = engine();
    expect(await open(e, 1)).toBe('failed');
    // No reattach: a resend under the key is what finds out what landed.
    expect(sent.filter((r) => r.method === 'GET' && r.url.includes('/chat/stream/'))).toEqual([]);
    expect(e.state.error).toContain('Could not reach the Felix harness');
    expect(e.state.streaming).toBe(false);
  });

  it("resolves 'failed' for a 5xx and for a stream that stopped short of [DONE]", async () => {
    harness([
      new Response('upstream gone', { status: 502 }),
      stream(frame({ event: 'text_delta', data: { delta: 'half a' } })),
    ]);
    const e = engine();
    expect(await open(e, 1)).toBe('failed');
    expect(e.state.error).toContain('The harness failed');
    expect(await open(e, 2)).toBe('failed');
    expect(e.state.error).toBe('The connection dropped before the reply finished.');
  });

  it("resolves 'done' for an ordinary stream, which a released key gets", async () => {
    harness([stream(frame({ event: 'text_delta', data: { delta: 'fresh' } }) + DONE)]);
    const e = engine();
    expect(await open(e, 1)).toBe('done');
    expect(contents(e).at(-1)).toBe('assistant:fresh');
  });
});

describe('a keyed stream that said how it ended', () => {
  it("is 'done' when its error frame came before the body stopped", async () => {
    harness([
      stream('event: error\ndata: {"error":{"message":"upstream exploded","type":"api"}}\n\n'),
    ]);
    const e = engine();
    expect(await open(e, 1)).toBe('done');
    expect(e.state.error).toBe('upstream exploded');
  });
});

describe('a resend the harness answers from the first attempt', () => {
  it('folds the replay in place of the local copy, so the exchange is on screen once', async () => {
    harness([
      new TypeError('Failed to fetch'),
      replay(
        frame({ event: 'session_event', data: userEvent }) +
          frame({ event: 'session_event', data: replyEvent }) +
          DONE,
      ),
    ]);
    const e = engine();
    expect(await open(e, 1)).toBe('failed');
    expect(await open(e, 2)).toBe('done');

    expect(contents(e)).toEqual([
      'user:earlier',
      'assistant:earlier reply',
      'user:hello again',
      'assistant:the reply',
    ]);
    expect(e.state.error).toBeNull();
  });

  it('shows the error the first attempt ended in', async () => {
    harness([
      replay(
        frame({ event: 'session_event', data: userEvent }) +
          'event: error\ndata: {"error":{"message":"model gateway said no","type":"stream_error"}}\n\n' +
          DONE,
      ),
    ]);
    const e = engine();
    expect(await open(e, 1)).toBe('done');
    expect(e.state.error).toBe('model gateway said no');
    expect(contents(e).filter((c) => c === 'user:hello again')).toHaveLength(1);
  });
});

describe('a resend while the first attempt is still streaming', () => {
  it('reattaches to the thread instead of starting a turn', async () => {
    const snapshot = {
      phase: 'idle',
      transcript: [
        { id: 'e0', seq: 2, kind: 'message', role: 'user', content: 'earlier' },
        { id: 'e0a', seq: 3, kind: 'message', role: 'assistant', content: 'earlier reply' },
        userEvent,
        replyEvent,
      ],
    };
    harness(
      [new Response(JSON.stringify({ detail: 'idempotency_in_progress' }), { status: 409 })],
      (url) =>
        url.includes('/chat/stream/')
          ? stream(frame({ event: 'snapshot', data: snapshot }) + DONE)
          : new Response(JSON.stringify(snapshot)),
    );
    const e = engine();
    expect(await open(e, 1)).toBe('done');

    expect(sent.some((r) => r.method === 'GET' && r.url.endsWith('/chat/stream/t1'))).toBe(true);
    expect(posts()).toHaveLength(1);
    expect(contents(e)).toEqual([
      'user:earlier',
      'assistant:earlier reply',
      'user:hello again',
      'assistant:the reply',
    ]);
    expect(e.state.error).toBeNull();
  });
});

describe('a resend whose key the harness holds for another body', () => {
  it("resolves 'key_reused' and says nothing was sent", async () => {
    harness([new Response(JSON.stringify({ detail: 'idempotency_key_reused' }), { status: 422 })]);
    const e = engine();
    expect(await open(e, 1)).toBe('key_reused');
    expect(e.state.error).toContain('nothing was sent');
  });
});

describe('a send with no key', () => {
  it('sends no header, and still rejoins the thread when it fails', async () => {
    harness([new TypeError('Failed to fetch')], () =>
      stream(frame({ event: 'snapshot', data: { phase: 'idle', transcript: [] } }) + DONE),
    );
    const e = engine();
    e.setTurns([
      { id: 'u1', role: 'user', content: 'hello' },
      { id: 'a1', role: 'assistant', content: '', tools: [] },
    ]);
    const outcome = await e.send({
      manifest: 'quick',
      messages: [{ role: 'user', content: 'hello' }],
      assistantId: 'a1',
    });
    expect(outcome).toBe('done');
    expect(posts()[0]?.headers).not.toHaveProperty('idempotency-key');
    expect(sent.some((r) => r.method === 'GET' && r.url.endsWith('/chat/stream/t1'))).toBe(true);
  });
});
