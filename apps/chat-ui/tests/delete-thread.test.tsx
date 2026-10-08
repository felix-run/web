// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { ThemeProvider } from '../src/components/theme-provider';
import { readPins } from '../src/lib/threads';

/**
 * Deleting a thread from the sidebar, as the shell carries it out.
 *
 * Four things the rail cannot see from inside itself: the toast names what went,
 * Undo puts a pin back as well as the transcript (`removeThread` drops the pin),
 * a delete the harness refuses is said rather than swallowed — the thread would
 * otherwise come back on the next refresh with nothing to say why — and deleting
 * the thread on screen goes back to the one the operator came from.
 */

type ToastAction = { label: string; onClick: () => void };
const toasts: Array<{ message: string; action?: ToastAction }> = [];
const errors: string[] = [];

vi.mock('sonner', () => {
  const toast = Object.assign(
    (message: string, opts?: { action?: ToastAction }) => {
      toasts.push({ message, action: opts?.action });
    },
    {
      error: (message: string) => {
        errors.push(message);
      },
      success: () => {},
      dismiss: () => {},
      message: () => {},
    },
  );
  return { toast, Toaster: () => null };
});

let refuseDelete = false;

function stubFetch() {
  const calls: Array<{ url: string; method: string }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method });
      if (url.includes('/chat/history/') && method === 'DELETE') {
        return new Response('{}', { status: refuseDelete ? 500 : 200 });
      }
      if (url.endsWith('/chat/sessions/lease')) {
        return new Response(JSON.stringify({ ok: true, token: 'tok' }), { status: 200 });
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
  return calls;
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

function seed(threads: Array<{ id: string; title: string; updatedAt: number }>) {
  for (const t of threads) {
    localStorage.setItem(
      `felix.turns:${t.id}`,
      JSON.stringify([{ id: crypto.randomUUID(), role: 'user', content: t.title }]),
    );
  }
  localStorage.setItem(
    'felix.threads',
    JSON.stringify(threads.map((t) => ({ ...t, manifest: 'cowork', named: true }))),
  );
}

const row = (title: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button[data-thread-row]')].find(
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

async function deleteRow(title: string) {
  const actions = await waitFor(() => {
    const b = row(title)?.parentElement?.querySelector<HTMLButtonElement>(
      'button[aria-label^="Actions for"]',
    );
    expect(b).toBeTruthy();
    return b!;
  });
  await act(async () => void (await userEvent.click(actions)));
  const del = await screen.findByRole('menuitem', { name: 'Delete' });
  await act(async () => void (await userEvent.click(del)));
}

const now = Date.now();
const THREADS = [
  { id: 'thread-a', title: 'Alpha', updatedAt: now },
  { id: 'thread-c', title: 'Charlie', updatedAt: now - 1000 },
  { id: 'thread-b', title: 'Bravo', updatedAt: now - 2000 },
];

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  toasts.length = 0;
  errors.length = 0;
  refuseDelete = false;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('deleting a thread', () => {
  it('names the thread in the toast, and goes back to the thread it was opened from', async () => {
    stubFetch();
    seed(THREADS);
    mount('/t/thread-b');
    await open('Charlie');
    await waitFor(() => expect(address).toBe('/t/thread-c'));

    await deleteRow('Charlie');
    expect(toasts.at(-1)?.message).toBe('“Charlie” deleted');
    // Back to Bravo, where the operator came from — not Alpha, the newest.
    await waitFor(() => expect(address).toBe('/t/thread-b'));
  });

  it('puts a pin back on Undo, with the thread', async () => {
    stubFetch();
    seed(THREADS);
    localStorage.setItem('felix.pinnedThreads', JSON.stringify(['thread-c']));
    mount('/t/thread-a');

    await deleteRow('Charlie');
    expect(readPins().has('thread-c')).toBe(false);
    await act(async () => toasts.at(-1)?.action?.onClick());
    expect(readPins().has('thread-c')).toBe(true);
  });

  it('says so when the harness refuses the delete, rather than letting it reappear', async () => {
    const calls = stubFetch();
    refuseDelete = true;
    seed(THREADS);
    // The server delete is held back for the undo window; run it now.
    const held: Array<() => void> = [];
    const realSetTimeout = window.setTimeout.bind(window);
    vi.spyOn(window, 'setTimeout').mockImplementation(((
      fn: () => void,
      ms?: number,
      ...rest: unknown[]
    ) => {
      if (ms === 7000) {
        held.push(fn);
        return 0;
      }
      return realSetTimeout(fn, ms, ...rest);
    }) as typeof window.setTimeout);
    mount('/t/thread-a');

    await deleteRow('Charlie');
    expect(held).toHaveLength(1);
    await act(async () => held[0]!());
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('thread-c'))).toBe(true),
    );
    await waitFor(() => expect(errors.length).toBeGreaterThan(0));
    expect(errors.join(' ')).toMatch(/delete this thread on the harness/i);
  });
});
