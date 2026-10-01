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
 * Rating an answer (`POST /chat/sessions/feedback`, felix-run/felix#403), and a
 * thumbs-down becoming an eval case. Asserted on the requests: which event the
 * rating names is a plausible, silent failure — rating the question instead of
 * the answer reads back fine and means nothing.
 */

const THREAD = 'fb-thread';

const snapshot = (feedback: Record<string, unknown> = {}) => ({
  id: `default:${THREAD}`,
  leafId: 'a2',
  feedback,
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
      content: 'which file holds the config?',
      metadata: { parent_id: 'a1' },
    },
    {
      id: 'a2',
      seq: 4,
      kind: 'message',
      role: 'assistant',
      content: 'It is in settings.py.',
      metadata: { parent_id: 'u2' },
    },
  ],
});

function stubFetch(opts: { feedback?: Record<string, unknown>; datasetExists?: boolean } = {}) {
  const fn = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.endsWith(`/chat/sessions/${THREAD}`)) return Response.json(snapshot(opts.feedback));
    if (url.includes('/chat/sessions/feedback')) return Response.json({ ok: true });
    if (url.includes('/eval/datasets/chat-feedback') && method === 'GET') {
      return opts.datasetExists
        ? Response.json({ name: 'chat-feedback', description: '', items: [] })
        : new Response('{"detail":"not_found"}', { status: 404 });
    }
    if (url.includes('/eval/datasets/'))
      return Response.json({ name: 'chat-feedback', description: '' });
    if (url.includes('/chat/sessions')) return Response.json({ sessions: [], items: [] });
    if (url.includes('/approvals')) return Response.json({ requests: [] });
    return Response.json({});
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const calls = (fn: ReturnType<typeof stubFetch>, route: string, method = 'POST') =>
  fn.mock.calls
    .filter(([url, init]) => String(url).includes(route) && (init?.method ?? 'GET') === method)
    .map(([, init]) => JSON.parse(String(init?.body ?? '{}')));

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

const buttons = (label: RegExp) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].filter((b) =>
    label.test(b.getAttribute('aria-label') ?? ''),
  );

const markDown = () =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === 'Mark down',
  )!;

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('rating an answer', () => {
  it('rates the answer, not the question, and a second click clears it', async () => {
    const fetch = stubFetch();
    mount();
    await waitFor(() => expect(buttons(/^Good answer/)).toHaveLength(2));

    // The second answer — `a2`, the turn the user is looking at.
    await act(async () => void (await userEvent.click(buttons(/^Good answer/)[1]!)));
    await waitFor(() =>
      expect(calls(fetch, '/chat/sessions/feedback')).toEqual([
        { thread_id: THREAD, event_id: 'a2', rating: 'up' },
      ]),
    );
    expect(buttons(/^Good answer/)[1]?.getAttribute('aria-pressed')).toBe('true');

    await act(async () => void (await userEvent.click(buttons(/^Good answer/)[1]!)));
    await waitFor(() => expect(calls(fetch, '/chat/sessions/feedback').at(-1)?.rating).toBeNull());
  });

  it('draws a rating the snapshot already holds', async () => {
    stubFetch({ feedback: { a1: { rating: 'down', note: 'too vague', at: 1 } } });
    mount();
    await waitFor(() => expect(document.body.textContent).toContain('“too vague”'));
    expect(buttons(/^Bad answer/)[0]?.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('a reply written in this tab', () => {
  it('finds its event id on the harness before rating it', async () => {
    // A streamed reply carries no event ids until the thread is re-read, which is
    // every answer someone rates straight after reading it.
    let written = false;
    const fetch = vi.fn(async (input: unknown, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/chat/stream')) {
        written = true;
        const body =
          'data: {"event":"text_delta","data":{"delta":"It is in settings.py."}}\n\ndata: [DONE]\n\n';
        return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
      }
      if (url.endsWith(`/chat/sessions/${THREAD}`)) {
        const full = snapshot();
        return Response.json(
          written ? { ...full, transcript: full.transcript.slice(2) } : { transcript: [] },
        );
      }
      if (url.includes('/chat/sessions/feedback')) return Response.json({ ok: true });
      if (url.includes('/chat/sessions')) return Response.json({ sessions: [], items: [] });
      if (url.includes('/approvals')) return Response.json({ requests: [] });
      return Response.json({});
    });
    vi.stubGlobal('fetch', fetch);
    mount();

    await waitFor(() => expect(document.querySelector('textarea')).toBeTruthy());
    await act(async () => {
      await userEvent.type(document.querySelector('textarea')!, 'which file holds the config?');
      await userEvent.keyboard('{Enter}');
    });
    await waitFor(() => expect(buttons(/^Good answer/)).toHaveLength(1));
    await act(async () => void (await userEvent.click(buttons(/^Good answer/)[0]!)));

    await waitFor(() =>
      expect(
        fetch.mock.calls
          .filter(([url]) => String(url).includes('/chat/sessions/feedback'))
          .map(([, init]) => JSON.parse(String(init?.body)).event_id),
      ).toEqual(['a2']),
    );
  });
});

describe('a thumbs-down with a note', () => {
  it('becomes an eval case: the question, judged against what was wrong', async () => {
    const fetch = stubFetch({ datasetExists: false });
    mount();
    await waitFor(() => expect(buttons(/^Bad answer/)).toHaveLength(2));
    await act(async () => void (await userEvent.click(buttons(/^Bad answer/)[1]!)));

    await act(async () => {
      await userEvent.type(document.querySelector('#rate-note')!, 'it is in config/app.toml');
      await userEvent.click(document.querySelector('input[type="checkbox"]')!);
      await userEvent.click(markDown());
    });

    await waitFor(() =>
      expect(calls(fetch, '/chat/sessions/feedback')).toEqual([
        { thread_id: THREAD, event_id: 'a2', rating: 'down', note: 'it is in config/app.toml' },
      ]),
    );
    // No such dataset yet, so it is created with the case in it.
    await waitFor(() =>
      expect(calls(fetch, '/eval/datasets/chat-feedback', 'PUT')).toHaveLength(1),
    );
    const [put] = calls(fetch, '/eval/datasets/chat-feedback', 'PUT');
    expect(put.items).toEqual([
      {
        user_input: 'which file holds the config?',
        rubric: {
          llm_judge: true,
          judge_criteria: expect.stringContaining('it is in config/app.toml'),
        },
      },
    ]);
  });

  it('makes no case without a note, since there is nothing to judge against', async () => {
    const fetch = stubFetch();
    mount();
    await waitFor(() => expect(buttons(/^Bad answer/)).toHaveLength(2));
    await act(async () => void (await userEvent.click(buttons(/^Bad answer/)[1]!)));
    expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(true);
    await act(async () => {
      await userEvent.click(markDown());
    });

    await waitFor(() => expect(calls(fetch, '/chat/sessions/feedback')).toHaveLength(1));
    expect(calls(fetch, '/eval/datasets/', 'PUT')).toEqual([]);
  });
});
