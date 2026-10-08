// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { ThemeProvider } from '../src/components/theme-provider';
import { uploadImages } from '../src/lib/image-upload';
import { loadTurns } from '../src/lib/threads';
import type { ImageAttachment, Turn } from '../src/types';

// The upload is the window under test: held open by the test, so the operator
// can switch threads between the click and the run starting.
vi.mock('../src/lib/image-upload', async (original) => ({
  ...(await original<typeof import('../src/lib/image-upload')>()),
  uploadImages: vi.fn(),
}));

/**
 * Leaving a thread does not stop its run.
 *
 * Clicking another conversation in the sidebar used to call `stopRun` — a
 * `POST /chat/abort` and an aborted stream — so a run in flight died the moment
 * the operator looked elsewhere. And hanging up without the abort would have
 * been no better: the harness tears down a run whose client closes the stream.
 * These pin the replacement at the wire: no abort, the stream left open, the
 * run's client tool answered for *its* thread, its lease kept until it settles,
 * its reply landing in its own transcript, and the thread switched to working
 * as an ordinary one.
 */

type Call = { url: string; body: Record<string, unknown> };

/** A stream the test drives frame by frame and ends, erroring on abort as a browser's does. */
function openStream(signal?: AbortSignal | null) {
  const enc = new TextEncoder();
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  let aborted = false;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
      signal?.addEventListener('abort', () => {
        aborted = true;
        c.error(new DOMException('aborted', 'AbortError'));
      });
    },
  });
  const frame = (event: string, data: Record<string, unknown>) =>
    ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ event, data })}\n\n`));
  return {
    response: new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    get aborted() {
      return aborted;
    },
    frame,
    finish(text: string) {
      frame('text_delta', { delta: text });
      ctrl.enqueue(enc.encode('data: [DONE]\n\n'));
      ctrl.close();
    },
  };
}

function stubFetch() {
  const calls: Call[] = [];
  const streams: ReturnType<typeof openStream>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      let body: Record<string, unknown> = {};
      try {
        body = init?.body ? JSON.parse(String(init.body)) : {};
      } catch {
        /* not JSON */
      }
      calls.push({ url, body });
      if (url.endsWith('/chat/stream')) {
        const s = openStream(init?.signal);
        streams.push(s);
        return s.response;
      }
      if (url.endsWith('/chat/sessions/lease')) {
        return new Response(JSON.stringify({ ok: true, token: `tok-${String(body.thread_id)}` }), {
          status: 200,
        });
      }
      if (url.includes('/chat/sessions')) {
        return new Response(JSON.stringify({ sessions: [], items: [] }), { status: 200 });
      }
      if (url.includes('/approvals')) {
        return new Response(JSON.stringify({ requests: [] }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }),
  );
  return {
    calls,
    streams,
    posted: (path: string) => calls.filter((c) => c.url.endsWith(path)),
  };
}

let address = '';
function Probe() {
  address = useLocation().pathname;
  return null;
}

function mount(at: string) {
  render(
    <MemoryRouter initialEntries={[at]}>
      <Probe />
      <ThemeProvider>
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

const turn = (content: string): Turn => ({ id: crypto.randomUUID(), role: 'user', content });

function seedThread(id: string, title: string) {
  localStorage.setItem(`felix.turns:${id}`, JSON.stringify([turn(title)]));
  const index = JSON.parse(localStorage.getItem('felix.threads') ?? '[]');
  index.push({ id, title, manifest: 'cowork', updatedAt: Date.now() });
  localStorage.setItem('felix.threads', JSON.stringify(index));
}

const composer = () => document.querySelector('textarea') as HTMLTextAreaElement;

async function type(text: string) {
  await waitFor(() => expect(composer()).toBeTruthy());
  await act(async () => {
    await userEvent.type(composer(), text);
    await userEvent.keyboard('{Enter}');
  });
}

/** The sidebar row for a thread, by the title it is listed under. */
const row = (title: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button[title]')].find(
    (b) => b.getAttribute('title') === title,
  );

async function open(title: string) {
  const target = await waitFor(() => {
    const b = row(title);
    expect(b).toBeTruthy();
    return b!;
  });
  await act(async () => void (await userEvent.click(target)));
}

const releasesOf = (net: ReturnType<typeof stubFetch>, thread: string) =>
  net.posted('/chat/sessions/lease/release').filter((c) => c.body.thread_id === thread);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  // Unmounted, so this file's holds on the module-scoped lease keeper go with it.
  cleanup();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('a run when the operator switches threads', () => {
  it('keeps going on its own thread, and the thread switched to works', async () => {
    const net = stubFetch();
    seedThread('thread-b', 'b history');
    mount('/t/thread-a');

    await type('question for A');
    await waitFor(() => expect(net.streams).toHaveLength(1));
    const streamA = net.streams[0]!;
    await act(async () => streamA.frame('text_delta', { delta: 'partial A… ' }));
    await waitFor(() => expect(document.body.textContent).toContain('partial A…'));

    await open('b history');
    await waitFor(() => expect(address).toBe('/t/thread-b'));
    await waitFor(() => expect(document.body.textContent).toContain('b history'));
    // Not stopped, not hung up on, and nothing of A's on B's screen.
    expect(net.posted('/chat/abort')).toHaveLength(0);
    expect(streamA.aborted).toBe(false);
    expect(document.body.textContent).not.toContain('partial A…');

    // A's run asks the browser for a tool while B is on screen: the answer goes
    // to A, the thread the run belongs to, not to the one showing.
    await act(async () =>
      streamA.frame('tool_request', { id: 'call-1', name: 'list_files', args: {} }),
    );
    await waitFor(() => expect(net.posted('/chat/tool_result')).toHaveLength(1));
    expect(net.posted('/chat/tool_result')[0]!.body).toMatchObject({
      thread_id: 'thread-a',
      tool_call_id: 'call-1',
    });

    // A still drives its thread: its lease outlives the switch.
    await new Promise((r) => setTimeout(r, 30));
    expect(releasesOf(net, 'thread-a')).toHaveLength(0);

    // A finishes in the background; its reply lands in its own transcript.
    await act(async () => streamA.finish('answer for A'));
    await waitFor(() =>
      expect(loadTurns('thread-a').map((t) => t.content)).toContain('partial A… answer for A'),
    );
    expect(loadTurns('thread-b').map((t) => t.content)).toEqual(['b history']);
    expect(document.body.textContent).not.toContain('answer for A');
    // Settled and off screen: the hold goes.
    await waitFor(() => expect(releasesOf(net, 'thread-a')).toHaveLength(1));

    // B works as an ordinary thread.
    await type('question for B');
    await waitFor(() => expect(net.streams).toHaveLength(2));
    expect(net.posted('/chat/stream')[1]!.body).toMatchObject({ thread_id: 'thread-b' });
    await act(async () => net.streams[1]!.finish('answer for B'));
    await waitFor(() => expect(document.body.textContent).toContain('answer for B'));

    // And going back to A shows what its run wrote while nobody was looking.
    await open('question for A');
    await waitFor(() => expect(address).toBe('/t/thread-a'));
    // The tool card sits between the two halves of the reply on screen.
    await waitFor(() => expect(document.body.textContent).toContain('answer for A'));
    expect(document.body.textContent).toContain('partial A…');
    expect(document.body.textContent).not.toContain('answer for B');
    expect(net.posted('/chat/abort')).toHaveLength(0);
  });

  it('is re-adopted live when the operator comes back before it finishes', async () => {
    const net = stubFetch();
    seedThread('thread-b', 'b history');
    mount('/t/thread-a');

    await type('question for A');
    await waitFor(() => expect(net.streams).toHaveLength(1));
    const streamA = net.streams[0]!;

    await open('b history');
    await waitFor(() => expect(address).toBe('/t/thread-b'));
    await act(async () => streamA.frame('text_delta', { delta: 'written while away ' }));

    await open('question for A');
    await waitFor(() => expect(address).toBe('/t/thread-a'));
    // The live engine, not a rebuild from the cache: the delta written while B
    // was on screen is there, and the next ones keep landing.
    await waitFor(() => expect(document.body.textContent).toContain('written while away'));
    await act(async () => streamA.finish('and finished here'));
    await waitFor(() =>
      expect(document.body.textContent).toContain('written while away and finished here'),
    );
    expect(net.posted('/chat/abort')).toHaveLength(0);
  });

  it('still stops when the conversation running it is deleted', async () => {
    const net = stubFetch();
    seedThread('thread-b', 'b history');
    mount('/t/thread-a');

    await type('question for A');
    await waitFor(() => expect(net.streams).toHaveLength(1));
    const streamA = net.streams[0]!;
    await open('b history');
    await waitFor(() => expect(address).toBe('/t/thread-b'));

    const del = await waitFor(() => {
      const b = row('question for A')?.parentElement?.querySelector<HTMLButtonElement>(
        'button[aria-label="Delete thread"]',
      );
      expect(b).toBeTruthy();
      return b!;
    });
    await act(async () => void (await userEvent.click(del)));
    await waitFor(() =>
      expect(net.posted('/chat/abort').map((c) => c.body.thread_id)).toEqual(['thread-a']),
    );
    expect(streamA.aborted).toBe(true);
  });

  /**
   * The window between the click and the run: an image upload. Switching
   * threads there used to prune the engine the message was about to run on, so
   * the run went out on an orphan nothing tracked — and `markSent` read the
   * thread on screen, filing the freshly minted one as a session on the harness.
   */
  it('starts on its own, tracked engine when the operator leaves during the upload', async () => {
    const net = stubFetch();
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }),
    );
    let finishUpload!: (refs: ImageAttachment[]) => void;
    vi.mocked(uploadImages).mockImplementation(
      () =>
        new Promise<ImageAttachment[]>((resolve) => {
          finishUpload = resolve;
        }),
    );
    mount('/t/thread-up');

    const user = userEvent.setup({ delay: null });
    const input = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>('input[type="file"]');
      expect(el).toBeTruthy();
      return el!;
    });
    await act(async () => {
      await user.upload(input, new File(['x'], 'shot.png', { type: 'image/png' }));
    });
    await type('with image');
    await waitFor(() => expect(uploadImages).toHaveBeenCalledTimes(1));

    // Leave for a brand-new thread while the upload is still on the wire.
    const fresh = await waitFor(() => {
      const b = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
        (el) => el.textContent?.trim() === 'New chat' && !el.disabled,
      );
      expect(b).toBeTruthy();
      return b!;
    });
    await act(async () => void (await user.click(fresh)));
    await waitFor(() => expect(address).toMatch(/^\/t\/[0-9a-f-]{36}$/));
    const minted = address.replace('/t/', '');

    await act(async () => finishUpload([{ url: 'felix-file://f1', media_type: 'image/png' }]));
    await waitFor(() => expect(net.streams).toHaveLength(1));
    expect(net.posted('/chat/stream')[0]!.body).toMatchObject({ thread_id: 'thread-up' });
    const streamA = net.streams[0]!;

    // Tracked: its client tool is answered for A, and A's lease is held to the end.
    await act(async () =>
      streamA.frame('tool_request', { id: 'call-up', name: 'list_files', args: {} }),
    );
    await waitFor(() => expect(net.posted('/chat/tool_result')).toHaveLength(1));
    expect(net.posted('/chat/tool_result')[0]!.body).toMatchObject({ thread_id: 'thread-up' });
    await new Promise((r) => setTimeout(r, 30));
    expect(releasesOf(net, 'thread-up')).toHaveLength(0);

    await act(async () => streamA.finish('saw the image'));
    await waitFor(() =>
      expect(loadTurns('thread-up').some((t) => t.content.includes('saw the image'))).toBe(true),
    );
    await waitFor(() => expect(releasesOf(net, 'thread-up')).toHaveLength(1));

    // Nothing asked the harness about the minted thread: it was never sent to.
    const touched = net.calls.filter((c) => `${c.url} ${JSON.stringify(c.body)}`.includes(minted));
    expect(touched).toEqual([]);

    // And A shows the run on return.
    await open('with image');
    await waitFor(() => expect(address).toBe('/t/thread-up'));
    await waitFor(() => expect(document.body.textContent).toContain('saw the image'));
    expect(net.posted('/chat/abort')).toHaveLength(0);
  });
});
