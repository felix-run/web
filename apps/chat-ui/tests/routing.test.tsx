// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { MemoryRouter, type NavigateFunction, useLocation, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { ThemeProvider } from '../src/components/theme-provider';
import { loadTurns } from '../src/lib/threads';
import type { Turn } from '../src/types';

/**
 * The address, and what the shell does about it.
 *
 * The router is not decoration here: it decides which thread the engine is
 * pointed at, and it introduced a way for one thread's transcript to be written
 * under another's key that did not exist while thread changes only ever happened
 * inside a click handler. These pin the three rules that are easy to break from
 * outside `app-shell.tsx` — `/` resolving to a concrete thread, a link
 * reaching the thread it names, and a thread change never taking the previous
 * transcript with it.
 */

/** Everything the shell fetches on mount, answered with an empty success. */
function stubFetch() {
  const fn = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('/chat/sessions')) {
      return new Response(JSON.stringify({ sessions: [], items: [] }), { status: 200 });
    }
    if (url.includes('/approvals')) {
      return new Response(JSON.stringify({ requests: [] }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/**
 * Reports the live address out of the router, and hands the test a way to change
 * it that does not go through any of the shell's own handlers — which is what
 * Back, Forward and a pasted link all are.
 */
let address = '';
let go: NavigateFunction = () => {};
function Probe() {
  address = useLocation().pathname;
  go = useNavigate();
  return null;
}

function mount(at: string) {
  address = '';
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={[at]}>
        <Probe />
        <ThemeProvider>
          <TooltipProvider>
            <App />
          </TooltipProvider>
        </ThemeProvider>
      </MemoryRouter>
    </StrictMode>,
  );
}

const turn = (content: string): Turn => ({ id: crypto.randomUUID(), role: 'user', content });
const seed = (threadId: string, turns: Turn[]) =>
  localStorage.setItem(`felix.turns:${threadId}`, JSON.stringify(turns));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  stubFetch();
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('the address is the thread', () => {
  it('replaces / with a concrete thread, so a reload resumes instead of minting a second one', async () => {
    mount('/');
    await waitFor(() => expect(address).toMatch(/^\/t\/[0-9a-f-]{36}$/));
  });

  it('renders the transcript of the thread the link names', async () => {
    seed('linked-thread', [turn('what the link should reach')]);
    mount('/t/linked-thread');
    await waitFor(() => expect(document.body.textContent).toContain('what the link should reach'));
  });

  /**
   * The one this repo would otherwise have found in production.
   *
   * `turns` lags a thread change that came from outside the app's own handlers,
   * so the persistence effect runs once with the *new* thread id and the *old*
   * thread's transcript still in hand. Without the guard in `app-shell.tsx` that
   * write lands, and the load that follows reads it straight back — so the
   * thread you navigated to shows the conversation you navigated away from, and
   * its own is gone.
   */
  it('does not file one thread transcript under another on a link-driven change', async () => {
    seed('thread-a', [turn('belongs to A')]);
    seed('thread-b', [turn('belongs to B')]);

    mount('/t/thread-a');
    await waitFor(() => expect(document.body.textContent).toContain('belongs to A'));

    await act(async () => {
      go('/t/thread-b');
    });

    await waitFor(() => expect(document.body.textContent).toContain('belongs to B'));
    expect(loadTurns('thread-b').map((t) => t.content)).toEqual(['belongs to B']);
    expect(loadTurns('thread-a').map((t) => t.content)).toEqual(['belongs to A']);
  });

  /**
   * The same misfiling, reached the other way — and the one that actually
   * happened, on the first real page load after the router went in.
   *
   * The engine is seeded during render so the first paint is not an empty
   * transcript, and it used to take that seed from `felix.threadId`: the thread
   * this tab was last on, which was the right answer only while that key was
   * what chose the thread. With the address choosing instead, a fresh `/`
   * inherited the previous thread's transcript — and StrictMode's second run of
   * the persistence effect, closing over that first render, then wrote it out
   * under the new thread's key.
   *
   * This asserts the property, not either mechanism: the shell now both seeds
   * from the address and persists from current engine state, and either alone
   * closes this hole. `StrictMode` here is not decoration — without it the
   * second run never happens and the original bug does not reproduce.
   */
  it('does not inherit the last thread this tab was on when / mints a new one', async () => {
    localStorage.setItem('felix.threadId', 'thread-from-yesterday');
    seed('thread-from-yesterday', [turn('yesterday')]);

    mount('/');
    await waitFor(() => expect(address).toMatch(/^\/t\//));
    const minted = address.replace('/t/', '');

    expect(minted).not.toBe('thread-from-yesterday');
    expect(document.body.textContent).not.toContain('yesterday');
    expect(loadTurns(minted)).toEqual([]);
    expect(loadTurns('thread-from-yesterday').map((t) => t.content)).toEqual(['yesterday']);
  });

  /**
   * The tab remembers its last thread so a reload on `/harness` can return to it
   * (`src/lib/tab-thread.ts`). That memory must not become the chooser the old
   * `felix.threadId` key was: `/` asks for a new thread, and gets one.
   */
  it('does not let the tab-scoped memory choose the thread / mints', async () => {
    sessionStorage.setItem('felix.tabThread', 'thread-this-tab-left');
    seed('thread-this-tab-left', [turn('left behind')]);
    const fetched = vi.mocked(fetch);

    mount('/');
    await waitFor(() => expect(address).toMatch(/^\/t\//));
    const minted = address.replace('/t/', '');

    expect(minted).not.toBe('thread-this-tab-left');
    expect(document.body.textContent).not.toContain('left behind');
    expect(loadTurns(minted)).toEqual([]);
    // Not even for a render: holding it would take its lease and hydrate it, and
    // a lease is how another tab on that thread learns it has been displaced.
    const touched = fetched.mock.calls.filter(([input, init]) =>
      `${String(input)} ${String(init?.body ?? '')}`.includes('thread-this-tab-left'),
    );
    expect(touched).toEqual([]);
  });
});

/**
 * Opening a thread lands at its outcome. The route does not remount between
 * threads, and the transcript's stick-to-bottom lock used to outlive the thread
 * it described: scrolled up in one, the next opened at the same offset, which on
 * a longer transcript is mid-prompt. happy-dom has no layout to scroll, so what
 * is pinned is the mechanism — each thread gets its own scroller, and so its own
 * lock — rather than a `scrollTop`.
 */
describe('the transcript on a thread change', () => {
  it("gives each thread a fresh scroller rather than the last thread's lock", async () => {
    seed('thread-a', [turn('belongs to A')]);
    seed('thread-b', [turn('belongs to B')]);
    mount('/t/thread-a');
    await waitFor(() => expect(document.body.textContent).toContain('belongs to A'));
    const before = document.querySelector('[data-slot="conversation"]');
    expect(before).not.toBeNull();

    await act(async () => {
      go('/t/thread-b');
    });
    await waitFor(() => expect(document.body.textContent).toContain('belongs to B'));
    expect(document.querySelector('[data-slot="conversation"]')).not.toBe(before);
  });
});

/**
 * The header's Session menu names the thread by its id. It drew
 * `threadId.slice(0, 8)` — `self-pr-` for every `self-pr-*` thread, and that
 * fragment was the item's entire accessible name. It was also a disabled row,
 * so the id could be read and never copied out.
 */
describe('the header names the thread', () => {
  it('keeps the end of the id, where ids differ, and the whole id for a reader', async () => {
    mount('/t/self-pr-306');
    await waitFor(() => expect(address).toBe('/t/self-pr-306'));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Session' }));
    const item = await screen.findByRole('menuitem', { name: 'Copy thread id self-pr-306' });
    expect(item.textContent).toContain('self-pr-306');
    expect(item.getAttribute('aria-disabled')).toBeNull();
    // Closed before teardown: an open menu's `pointer-events` lock on <body>
    // outlives the next mount and refuses its clicks.
    await user.keyboard('{Escape}');
  });

  it('copies the whole id, not the truncated one on screen', async () => {
    mount('/t/self-pr-306');
    await waitFor(() => expect(address).toBe('/t/self-pr-306'));
    // After `setup()`, which installs its own clipboard stub over `navigator`.
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    await user.click(screen.getByRole('button', { name: 'Session' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Copy thread id self-pr-306' }));
    expect(writeText).toHaveBeenCalledWith('self-pr-306');
  });

  /**
   * A menu named Session opened on a View group. Session's verbs come first now,
   * then View, then Theme under a label of its own — the Verbose checkbox and the
   * theme radios had run together as one unlabelled list.
   */
  it('opens on Session, then View, then a labelled Theme group', async () => {
    mount('/t/self-pr-306');
    await waitFor(() => expect(address).toBe('/t/self-pr-306'));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Session' }));
    const menu = await screen.findByRole('menu');
    const rows = Array.from(
      menu.querySelectorAll<HTMLElement>(
        '[data-slot="dropdown-menu-label"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]',
      ),
    ).map((el) => el.getAttribute('aria-label') ?? el.textContent);
    expect(rows).toEqual([
      'Session',
      'Continue run',
      'Copy thread id self-pr-306',
      'View',
      'Verbose tools',
      'Theme',
      'Light',
      'Dark',
      'System',
    ]);
    await user.keyboard('{Escape}');
  });

  it('offers nothing to continue on an empty thread', async () => {
    mount('/t/empty-thread');
    await waitFor(() => expect(address).toBe('/t/empty-thread'));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Session' }));
    const item = await screen.findByRole('menuitem', { name: 'Continue run' });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    await user.keyboard('{Escape}');
  });
});
