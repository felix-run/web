// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, type NavigateFunction, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { ThemeProvider } from '../src/components/theme-provider';
import type { Turn } from '../src/types';

/**
 * Which agent a thread is talking to, as the composer says it.
 *
 * The harness keeps no manifest per thread; the local index (`felix.threads`) is
 * the only record, written on every send. These pin that the picker follows that
 * record when the tab moves to a thread, that what it shows is what the next send
 * carries, and that the composer says so when the two stop agreeing — or when
 * there is no record to agree with.
 */

let requests: { url: string; body: unknown }[] = [];

function stubFetch() {
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      let body: unknown = null;
      if (typeof init?.body === 'string') {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      }
      requests.push({ url, body });
      if (url.endsWith('/v1/models')) {
        return new Response(
          JSON.stringify({ object: 'list', data: [{ id: 'cowork' }, { id: 'research' }] }),
          { status: 200 },
        );
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
}

let go: NavigateFunction = () => {};
function Probe() {
  go = useNavigate();
  return null;
}

function mount(at: string) {
  return render(
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

/** A thread this browser has sent to: its transcript, and the index row naming its agent. */
function seedThread(id: string, manifest: string, content: string) {
  localStorage.setItem(`felix.turns:${id}`, JSON.stringify([turn(content)]));
  const index = JSON.parse(localStorage.getItem('felix.threads') ?? '[]');
  index.push({ id, title: content, manifest, updatedAt: Date.now() });
  localStorage.setItem('felix.threads', JSON.stringify(index));
}

const trigger = () => screen.findByRole('combobox', { name: 'Choose agent' });
/** The picker's list arrived, so the trigger is showing a resolved choice. */
const modelsLoaded = () =>
  waitFor(() => expect(requests.some((r) => r.url.endsWith('/v1/models'))).toBe(true));

/**
 * The list has not only been asked for but applied: the picker offers both
 * agents. Closed again afterwards so the test starts from a resting composer.
 */
async function listApplied() {
  const user = userEvent.setup({ delay: null });
  await waitFor(async () => {
    (await trigger()).focus();
    await user.keyboard('{Enter}');
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });
  await user.keyboard('{Escape}');
}

beforeEach(() => {
  localStorage.clear();
  // The tab's last choice, which a past thread's own agent should win over.
  localStorage.setItem('felix.manifest', 'cowork');
  stubFetch();
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe("a thread's agent", () => {
  it('is what the picker shows on reaching the thread, and follows a change of thread', async () => {
    seedThread('thread-r', 'research', 'asked research');
    seedThread('thread-c', 'cowork', 'asked cowork');

    mount('/t/thread-r');
    await modelsLoaded();
    await waitFor(async () => expect((await trigger()).textContent).toBe('research'));

    await act(async () => {
      go('/t/thread-c');
    });
    await waitFor(async () => expect((await trigger()).textContent).toBe('cowork'));
  });

  it('is what the next send carries, not only what the picker draws', async () => {
    seedThread('thread-r', 'research', 'asked research');
    mount('/t/thread-r');
    await modelsLoaded();
    await waitFor(async () => expect((await trigger()).textContent).toBe('research'));

    const user = userEvent.setup({ delay: null });
    await user.type(screen.getByRole('textbox', { name: 'Message Felix' }), 'again{Enter}');
    await waitFor(() => expect(requests.some((r) => r.url.endsWith('/chat/stream'))).toBe(true));
    const sent = requests.find((r) => r.url.endsWith('/chat/stream'));
    expect(sent?.body).toMatchObject({ manifest: 'research' });
  });

  it('is not restored when this harness does not list it', async () => {
    // Reached after `/v1/models` has answered, so nothing corrects it later. The
    // trigger alone cannot show this: it falls back to its first option for a
    // value it does not list, which is exactly how a send would carry a name the
    // picker was not drawing.
    seedThread('thread-c', 'cowork', 'asked cowork');
    seedThread('thread-gone', 'retired-agent', 'asked a retired agent');
    mount('/t/thread-c');
    await modelsLoaded();
    await waitFor(async () => expect((await trigger()).textContent).toBe('cowork'));
    await listApplied();

    await act(async () => {
      go('/t/thread-gone');
    });
    await waitFor(() => expect(document.body.textContent).toContain('asked a retired agent'));
    const user = userEvent.setup({ delay: null });
    await user.type(screen.getByRole('textbox', { name: 'Message Felix' }), 'again{Enter}');
    await waitFor(() => expect(requests.some((r) => r.url.endsWith('/chat/stream'))).toBe(true));
    expect(requests.find((r) => r.url.endsWith('/chat/stream'))?.body).toMatchObject({
      manifest: 'cowork',
    });
  });

  it('leaves the selection alone on a thread with no record', async () => {
    // Turns cached, no index row: a thread the harness knows and this browser never sent to.
    localStorage.setItem('felix.turns:thread-x', JSON.stringify([turn('from elsewhere')]));
    localStorage.setItem('felix.manifest', 'research');
    mount('/t/thread-x');
    await modelsLoaded();
    await waitFor(async () => expect((await trigger()).textContent).toBe('research'));
  });
});
