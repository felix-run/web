// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { act, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { ThemeProvider } from '../src/components/theme-provider';

/**
 * A message written mid-run waits in the tab rather than steering.
 *
 * Enter during a run used to post `/chat/steer` at once, and a steer cancels
 * the run's remaining tool calls and cannot be withdrawn. These pin the
 * replacement at the wire: what is and is not requested, and when.
 */

type Call = { url: string; body: Record<string, unknown> };

/**
 * A stream the test ends, so a run is in flight for as long as it needs. It
 * errors on abort, as a browser's fetch body does — Stop ends a run that way.
 */
function openStream(signal?: AbortSignal | null) {
  const enc = new TextEncoder();
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
      signal?.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')));
    },
  });
  return {
    response: new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    finish(text: string) {
      ctrl.enqueue(
        enc.encode(`data: ${JSON.stringify({ event: 'text_delta', data: { delta: text } })}\n\n`),
      );
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
    /** The text of each message `/chat/stream` was asked to run. */
    sent: () =>
      calls
        .filter((c) => c.url.endsWith('/chat/stream'))
        .map((c) => {
          const messages = (c.body.messages ?? []) as Array<{ content?: string }>;
          return messages.at(-1)?.content;
        }),
  };
}

function mount() {
  render(
    <MemoryRouter initialEntries={['/']}>
      <ThemeProvider>
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

const composer = () => document.querySelector('textarea') as HTMLTextAreaElement;

async function type(text: string) {
  await waitFor(() => expect(composer()).toBeTruthy());
  await act(async () => {
    await userEvent.type(composer(), text);
    await userEvent.keyboard('{Enter}');
  });
}

const tray = () => document.querySelector('section[aria-label="Queued messages"]');
const button = (label: string) =>
  document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const buttonByText = (text: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('a message written mid-run', () => {
  it('is queued, not steered, and sends when the run finishes', async () => {
    const net = stubFetch();
    mount();
    await type('first');
    await waitFor(() => expect(net.streams).toHaveLength(1));

    await type('second');
    await waitFor(() => expect(tray()?.textContent).toContain('second'));
    expect(net.posted('/chat/steer')).toHaveLength(0);
    expect(composer().value).toBe('');

    await act(async () => net.streams[0].finish('done one'));
    await waitFor(() => expect(net.sent()).toEqual(['first', 'second']));
    await waitFor(() => expect(tray()).toBeNull());
  });

  it('steers only when asked, as a steer, and leaves the queue', async () => {
    const net = stubFetch();
    mount();
    await type('first');
    await waitFor(() => expect(net.streams).toHaveLength(1));
    await type('change course');
    await waitFor(() => expect(tray()).toBeTruthy());

    await act(async () => void (await userEvent.click(button('Steer the run with this now')!)));
    await waitFor(() => expect(net.posted('/chat/steer')).toHaveLength(1));
    expect(net.posted('/chat/steer')[0].body).toMatchObject({
      text: 'change course',
      kind: 'steer',
    });
    await waitFor(() => expect(tray()).toBeNull());

    // Nothing left to send once the run ends: the steer was the message.
    await act(async () => net.streams[0].finish('ok'));
    await new Promise((r) => setTimeout(r, 50));
    expect(net.sent()).toEqual(['first']);
  });

  it('waits after Stop until the operator resumes', async () => {
    const net = stubFetch();
    mount();
    await type('first');
    await waitFor(() => expect(net.streams).toHaveLength(1));
    await type('next step');
    await waitFor(() => expect(tray()).toBeTruthy());

    const stop = await waitFor(() => {
      const b = button('Stop generating') ?? buttonByText('Stop');
      expect(b).toBeTruthy();
      return b!;
    });
    await act(async () => void (await userEvent.click(stop)));
    await waitFor(() => expect(tray()?.textContent).toContain('Paused'));
    await new Promise((r) => setTimeout(r, 50));
    expect(net.sent()).toEqual(['first']);

    await act(async () => void (await userEvent.click(buttonByText('Resume')!)));
    await waitFor(() => expect(net.sent()).toEqual(['first', 'next step']));
  });

  it('goes back to the composer to be edited', async () => {
    const net = stubFetch();
    mount();
    await type('first');
    await waitFor(() => expect(net.streams).toHaveLength(1));
    await type('draft to fix');
    await waitFor(() => expect(tray()).toBeTruthy());

    await act(async () => void (await userEvent.click(button('Edit in the composer')!)));
    await waitFor(() => expect(composer().value).toBe('draft to fix'));
    expect(tray()).toBeNull();
  });
});
