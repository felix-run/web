// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../src/components/theme-provider';
import { Toaster } from '../src/components/toaster';
import { resetReachability } from '../src/lib/connection';
import { leaseServer, type StreamRequest } from './lease-server';

/**
 * A message whose send failed, kept and resent under its `Idempotency-Key`
 * (`felix-run/felix#488`), through the whole shell with `fetch` stubbed at the
 * transport.
 *
 * A send that fails with no answer, a 5xx or a dropped stream may or may not
 * have reached the thread, and the client cannot tell which. Before keys it lost
 * the text rather than risk sending it twice. Now every streamed send carries a
 * key minted with the message; a failure hands the message back; and sending it
 * again unchanged reuses the key with the same body, so the harness answers from
 * the first attempt instead of running a second turn.
 */

let App: ComponentType;

beforeAll(async () => {
  App = (await import('../src/App')).default;
});

function mount(at: string) {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <ThemeProvider>
        <TooltipProvider>
          <App />
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

const composer = () => document.querySelector('textarea') as HTMLTextAreaElement | null;
const transcript = () => document.querySelector('[data-slot="conversation"]')?.textContent ?? '';
const times = (text: string) => transcript().split(text).length - 1;

async function type(text: string) {
  await waitFor(() => expect(composer()?.disabled).toBe(false));
  await act(async () => {
    await userEvent.type(composer() as HTMLTextAreaElement, text);
    await userEvent.keyboard('{Enter}');
  });
}

/** Press Enter on whatever the composer holds — the resend of a kept message. */
async function resend() {
  await act(async () => {
    (composer() as HTMLTextAreaElement).focus();
    await userEvent.keyboard('{Enter}');
  });
}

const sse = (body: string, headers: Record<string, string> = {}) =>
  new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream', ...headers },
  });
const frame = (f: unknown) => `data: ${JSON.stringify(f)}\n\n`;
const DONE = 'data: [DONE]\n\n';
const replayed = { 'idempotent-replayed': 'true' };
/** A stream cut off mid-reply: a 200, some of the answer, and no `[DONE]`. */
const dropped = () => sse(frame({ event: 'text_delta', data: { delta: 'half of an ans' } }));
const message = (seq: number, role: string, content: string) => ({
  event: 'session_event',
  data: { id: `ev-${seq}`, seq, kind: 'message', role, content },
});

/** Every `/chat/stream` POST the server saw, in order. */
function recorder() {
  const seen: StreamRequest[] = [];
  return {
    seen,
    keys: () => seen.map((r) => r.headers['idempotency-key']),
    /** Answer each request with the next reply in turn; an Error is a request that got none. */
    answer(replies: Array<Response | Error | ((req: StreamRequest) => Response)>) {
      return (req: StreamRequest) => {
        seen.push(req);
        const next = replies.shift() ?? sse(DONE);
        if (next instanceof Error) throw next;
        return typeof next === 'function' ? next(req) : next;
      };
    },
  };
}

const READY = (server: ReturnType<typeof leaseServer>, thread: string) =>
  waitFor(() => expect(server.leases.get(thread)?.mode).toBe('exclusive'));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(async () => {
  cleanup();
  // Module state, like the keeper: a request that never got an answer marks the
  // harness unreachable until one does, and that must not leak into the next test.
  resetReachability();
  await new Promise((r) => setTimeout(r, 80));
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('every streamed send', () => {
  it('carries an Idempotency-Key of its own', async () => {
    const r = recorder();
    const server = leaseServer({ stream: r.answer([]) });
    mount('/t/thread-keys');
    await READY(server, 'thread-keys');

    await type('first message');
    await waitFor(() => expect(r.seen).toHaveLength(1));
    await type('second message');
    await waitFor(() => expect(r.seen).toHaveLength(2));

    const [a, b] = r.keys();
    expect(a).toMatch(/^[!-~]{1,255}$/);
    expect(b).toMatch(/^[!-~]{1,255}$/);
    expect(a).not.toBe(b);
  });
});

describe('a send that failed', () => {
  it('comes back to the composer, and its resend replays the first attempt once', async () => {
    const r = recorder();
    const server = leaseServer({
      stream: r.answer([
        dropped(),
        sse(
          frame(message(0, 'user', 'keep me safe')) +
            frame(message(1, 'assistant', 'the reply that landed')) +
            DONE,
          replayed,
        ),
      ]),
    });
    mount('/t/thread-r');
    await READY(server, 'thread-r');

    await type('keep me safe');
    await waitFor(() => expect(composer()?.value).toBe('keep me safe'));
    expect(
      await screen.findByText(
        'Your message is back in the composer. Send it again to retry; it will not be sent twice.',
      ),
    ).toBeTruthy();
    // In one place at a time: back in the composer, not on screen as sent — and
    // nor is the half a reply the dropped stream had shown.
    expect(times('keep me safe')).toBe(0);
    expect(times('half of an ans')).toBe(0);
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      'The connection dropped before the reply finished.',
    );

    await resend();
    await waitFor(() => expect(times('the reply that landed')).toBe(1));
    expect(times('keep me safe')).toBe(1);
    await waitFor(() => expect(composer()?.value).toBe(''));

    expect(r.seen).toHaveLength(2);
    expect(r.keys()[1]).toBe(r.keys()[0]);
    expect(r.seen[1]?.body).toBe(r.seen[0]?.body);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows the error a replay ends in', async () => {
    const r = recorder();
    const server = leaseServer({
      stream: r.answer([
        new Response('bad gateway', { status: 502 }),
        sse(
          frame(message(0, 'user', 'and then it broke')) +
            'event: error\ndata: {"error":{"message":"model gateway said no","type":"stream_error"}}\n\n' +
            DONE,
          replayed,
        ),
      ]),
    });
    mount('/t/thread-e');
    await READY(server, 'thread-e');

    await type('and then it broke');
    await waitFor(() => expect(composer()?.value).toBe('and then it broke'));
    await resend();

    await waitFor(() =>
      expect(document.querySelector('[role="alert"]')?.textContent).toBe('model gateway said no'),
    );
    expect(times('and then it broke')).toBe(1);
  });

  it('reattaches when the first attempt is still streaming', async () => {
    const r = recorder();
    const server = leaseServer({
      stream: r.answer([
        new Response('upstream timed out', { status: 504 }),
        new Response(JSON.stringify({ detail: 'idempotency_in_progress' }), { status: 409 }),
      ]),
    });
    // The reattach: the thread as the harness has it, the first attempt's turn in it.
    const leased = globalThis.fetch;
    const resumed: string[] = [];
    vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if ((init?.method ?? 'GET') === 'GET' && url.includes('/chat/stream/')) {
        resumed.push(url);
        return sse(
          frame({
            event: 'snapshot',
            data: {
              phase: 'idle',
              transcript: [
                message(0, 'user', 'still going').data,
                message(1, 'assistant', 'its own reply').data,
              ],
            },
          }) + DONE,
        );
      }
      return leased(input as RequestInfo, init);
    });
    mount('/t/thread-p');
    await READY(server, 'thread-p');

    await type('still going');
    await waitFor(() => expect(composer()?.value).toBe('still going'));
    await resend();

    await waitFor(() => expect(times('its own reply')).toBe(1));
    expect(resumed.some((u) => u.endsWith('/chat/stream/thread-p'))).toBe(true);
    expect(times('still going')).toBe(1);
    expect(r.keys()[1]).toBe(r.keys()[0]);
  });

  it('keeps the text and says so when the harness refuses the key, then sends it anew', async () => {
    const r = recorder();
    const server = leaseServer({
      stream: r.answer([
        dropped(),
        new Response(JSON.stringify({ detail: 'idempotency_key_reused' }), { status: 422 }),
      ]),
    });
    mount('/t/thread-422');
    await READY(server, 'thread-422');

    await type('refused key');
    await waitFor(() => expect(composer()?.value).toBe('refused key'));
    await resend();

    await waitFor(() =>
      expect(document.querySelector('[role="alert"]')?.textContent).toContain('nothing was sent'),
    );
    await waitFor(() => expect(composer()?.value).toBe('refused key'));
    expect(
      await screen.findByText(
        'Your message is back in the composer. Sending it again sends it as a new message.',
      ),
    ).toBeTruthy();

    await resend();
    await waitFor(() => expect(r.seen).toHaveLength(3));
    expect(r.keys()[2]).not.toBe(r.keys()[0]);
  });

  it('is a new message once edited, under a new key', async () => {
    const r = recorder();
    const server = leaseServer({ stream: r.answer([new TypeError('Failed to fetch')]) });
    mount('/t/thread-edit');
    await READY(server, 'thread-edit');

    await type('draft one');
    await waitFor(() => expect(composer()?.value).toBe('draft one'));
    // No answer at all marks the harness unreachable, and the composer holds the
    // message until something gets through; the browser coming back online is that.
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await act(async () => {
      await userEvent.type(composer() as HTMLTextAreaElement, ', revised');
      await userEvent.keyboard('{Enter}');
    });

    await waitFor(() => expect(r.seen).toHaveLength(2));
    expect(JSON.parse(r.seen[1]?.body ?? '{}').messages[0].content).toBe('draft one, revised');
    expect(r.keys()[1]).not.toBe(r.keys()[0]);
  });
});

describe('a queued message', () => {
  it('has its key from when it was queued, and keeps it through a failed send', async () => {
    // The first run stays open until the test ends it, so a second message queues.
    const enc = new TextEncoder();
    let finish: () => void = () => {};
    const r = recorder();
    const server = leaseServer({
      stream: r.answer([
        () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(c) {
                finish = () => {
                  c.enqueue(enc.encode(DONE));
                  c.close();
                };
              },
            }),
            { status: 200, headers: { 'content-type': 'text/event-stream' } },
          ),
        dropped(),
        sse(frame(message(2, 'user', 'queued next')) + DONE, replayed),
      ]),
    });
    const tray = () => document.querySelector('section[aria-label="Queued messages"]');
    mount('/t/thread-q');
    await READY(server, 'thread-q');

    await type('first');
    await waitFor(() => expect(r.seen).toHaveLength(1));
    await act(async () => {
      await userEvent.type(composer() as HTMLTextAreaElement, 'queued next');
      await userEvent.keyboard('{Enter}');
    });
    await waitFor(() => expect(tray()?.textContent).toContain('queued next'));
    await act(async () => finish());

    // Drained, dropped, and back at the head of the queue, paused by the failure.
    await waitFor(() => expect(r.seen).toHaveLength(2));
    await waitFor(() => expect(tray()?.textContent).toContain('Paused'));
    expect(tray()?.textContent).toContain('queued next');

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
    });
    await waitFor(() => expect(r.seen).toHaveLength(3));
    await waitFor(() => expect(tray()).toBeNull());

    const [first, queued, again] = r.keys();
    expect(queued).toBeTruthy();
    expect(queued).not.toBe(first);
    expect(again).toBe(queued);
    expect(r.seen[2]?.body).toBe(r.seen[1]?.body);
    expect(times('queued next')).toBe(1);
  });
});
