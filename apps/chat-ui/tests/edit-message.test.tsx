// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { act, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { ThemeProvider } from '../src/components/theme-provider';
import { Toaster } from '../src/components/toaster';

/**
 * Editing a sent message is a rewind and a send, and both halves are easy to get
 * subtly wrong in a way nothing on screen reports: rewind to the edited message
 * itself and the original stays in the model's context; replay the history and
 * the server log holds it twice. So these assert on the requests — where the
 * leaf was moved to, and that only the new text was sent — as well as on what is
 * drawn.
 */

const THREAD = 'edit-thread';

/** The harness's snapshot: two exchanges, each event linked to the one before. */
const snapshot = {
  id: `default:${THREAD}`,
  leafId: 'a2',
  transcript: [
    { id: 'u1', seq: 1, kind: 'message', role: 'user', content: 'first question', metadata: {} },
    {
      id: 'a1',
      seq: 2,
      kind: 'message',
      role: 'assistant',
      content: 'first answer',
      metadata: { parent_id: 'u1' },
    },
    {
      id: 'u2',
      seq: 3,
      kind: 'message',
      role: 'user',
      content: 'second question',
      metadata: { parent_id: 'a1' },
    },
    {
      id: 'a2',
      seq: 4,
      kind: 'message',
      role: 'assistant',
      content: 'answer to the original',
      metadata: { parent_id: 'u2' },
    },
  ],
};

function sse(frames: unknown[]) {
  const body = frames.map((f) => `data: ${JSON.stringify(f)}`).join('\n\n');
  return new Response(`${body}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function stubFetch(stream: () => Response | Promise<Response> = () =>
  sse([{ event: 'text_delta', data: { delta: 'answer to the edit' } }])) {
  const fn = vi.fn(async (input: unknown, _init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/chat/stream')) return stream();
    if (url.endsWith(`/chat/sessions/${THREAD}`)) {
      return new Response(JSON.stringify(snapshot), { status: 200 });
    }
    if (url.includes('/chat/rewind')) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (url.includes('/chat/sessions')) {
      return new Response(JSON.stringify({ sessions: [], items: [] }), { status: 200 });
    }
    if (url.includes('/approvals'))
      return new Response(JSON.stringify({ requests: [] }), { status: 200 });
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const bodiesTo = (fn: ReturnType<typeof stubFetch>, route: string) =>
  fn.mock.calls
    .filter(([url]) => String(url).includes(route))
    .map(([, init]) => JSON.parse(String(init?.body ?? '{}')));

const shown = () => document.body.textContent ?? '';

function mount() {
  render(
    <MemoryRouter initialEntries={[`/t/${THREAD}`]}>
      <ThemeProvider>
        <TooltipProvider>
          <App />
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

const editButtons = () => [
  ...document.querySelectorAll<HTMLButtonElement>('button[aria-label="Edit this message"]'),
];

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('editing a sent message', () => {
  it('branches from the message before it and sends only the new text', async () => {
    const fetch = stubFetch();
    mount();
    await waitFor(() => expect(shown()).toContain('answer to the original'));

    // The first message has nothing before it to branch from, so only the
    // second offers the action.
    await waitFor(() => expect(editButtons()).toHaveLength(1));
    await act(async () => void (await userEvent.click(editButtons()[0]!)));

    const box = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Edit message"]');
    expect(box?.value).toBe('second question');
    await act(async () => {
      await userEvent.clear(box!);
      await userEvent.type(box!, 'a better question');
      await userEvent.keyboard('{Enter}');
    });

    await waitFor(() => expect(shown()).toContain('answer to the edit'));
    expect(shown()).not.toContain('answer to the original');
    expect(shown()).toContain('a better question');

    // The leaf goes to the edited message's parent, not to the message itself —
    // rewinding to `u2` would leave the original in the model's context.
    expect(bodiesTo(fetch, '/chat/rewind')).toEqual([
      expect.objectContaining({ event_id: 'a1', thread_id: THREAD }),
    ]);
    // Felix replays history server-side; the turn carries only the new message.
    const [streamed] = bodiesTo(fetch, '/chat/stream');
    expect(streamed.messages).toEqual([{ role: 'user', content: 'a better question' }]);
  });

  it('sends nothing when the text is unchanged or the edit is cancelled', async () => {
    const fetch = stubFetch();
    mount();
    await waitFor(() => expect(editButtons()).toHaveLength(1));
    await act(async () => void (await userEvent.click(editButtons()[0]!)));
    await act(async () => void (await userEvent.keyboard('{Enter}')));
    await act(async () => void (await userEvent.keyboard('{Escape}')));

    expect(document.querySelector('textarea[aria-label="Edit message"]')).toBeNull();
    expect(bodiesTo(fetch, '/chat/rewind')).toEqual([]);
    expect(bodiesTo(fetch, '/chat/stream')).toEqual([]);
    expect(shown()).toContain('answer to the original');
  });

  it('offers Restore once the reply has landed, and restores to the original leaf', async () => {
    // Held open until released, the way a real reply takes longer than a toast lives.
    let release: () => void = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    const fetch = stubFetch(async () => {
      await held;
      return sse([{ event: 'text_delta', data: { delta: 'answer to the edit' } }]);
    });
    mount();
    await waitFor(() => expect(editButtons()).toHaveLength(1));
    await act(async () => void (await userEvent.click(editButtons()[0]!)));
    const box = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Edit message"]');
    await act(async () => {
      await userEvent.clear(box!);
      await userEvent.type(box!, 'a better question');
      await userEvent.keyboard('{Enter}');
    });

    const restore = () =>
      [...document.querySelectorAll('button')].find((b) => b.textContent === 'Restore original');
    await waitFor(() => expect(bodiesTo(fetch, '/chat/stream')).toHaveLength(1));
    // While the reply is still being written, Restore could not act — so it is not offered.
    expect(restore()).toBeUndefined();

    await act(async () => release());
    await waitFor(() => expect(shown()).toContain('answer to the edit'));
    await waitFor(() => expect(restore()).toBeDefined());
    await act(async () => void (await userEvent.click(restore()!)));

    // The second rewind puts the leaf back where it was before the edit.
    await waitFor(() =>
      expect(bodiesTo(fetch, '/chat/rewind').map((b) => b.event_id)).toEqual(['a1', 'a2']),
    );
  });
});
