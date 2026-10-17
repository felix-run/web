// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { ThemeProvider } from '../src/components/theme-provider';
import { continueOffer } from '../src/lib/continue-run';
import type { Turn } from '../src/types';

/**
 * "Continue run" is `POST /chat/continue`: it picks up a turn that stopped short, and the
 * harness refuses it on a thread with nothing run (`nothing_to_continue`) and on one whose
 * last reply finished (`already_complete`). It used to lead the Session menu on every idle
 * thread, the one item a finished thread could not use. It leads now only when there is
 * something to pick up; otherwise it follows Copy thread id, disabled, saying why — and
 * `/continue` says the same rather than spending a request on the refusal.
 */

const user = (content: string): Turn => ({ id: `u-${content}`, role: 'user', content });
const reply = (over: Partial<Turn> = {}): Turn => ({
  id: 'a',
  role: 'assistant',
  content: 'Done.',
  ...over,
});

describe('continueOffer', () => {
  it('has nothing to continue on an empty thread or after a finished reply', () => {
    expect(continueOffer([], 'idle', null).ok).toBe(false);
    expect(continueOffer([user('hi'), reply()], 'idle', null)).toEqual({
      ok: false,
      reason: 'The last reply finished; there is nothing to pick up.',
    });
  });

  it('offers to pick up a turn that stopped short', () => {
    // Asked, and no reply came.
    expect(continueOffer([user('hi')], 'idle', null).ok).toBe(true);
    // A call still open, or the step limit hit with calls pending.
    const open = { name: 'read_file', input: {}, done: false };
    expect(continueOffer([user('hi'), reply({ tools: [open] })], 'idle', null).ok).toBe(true);
    expect(
      continueOffer([user('hi'), reply({ stop: { reason: 'max_turns' } })], 'idle', null).ok,
    ).toBe(true);
    // Stopped, or failed, whatever the transcript holds.
    expect(continueOffer([user('hi'), reply()], 'aborted', null).ok).toBe(true);
    expect(continueOffer([user('hi'), reply()], 'idle', 'boom').ok).toBe(true);
  });

  it('reads past a note, which is neither side of the conversation', () => {
    const note: Turn = {
      id: 'n',
      role: 'note',
      content: 'edited x',
      note: { role: 'system', inContext: true },
    };
    expect(continueOffer([user('hi'), reply(), note], 'idle', null).ok).toBe(false);
  });
});

const THREAD = 'continue-thread';

function stub(transcript: unknown[]) {
  const fetch = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.endsWith(`/chat/sessions/${THREAD}`))
      return new Response(JSON.stringify({ id: `default:${THREAD}`, transcript }), {
        status: 200,
      });
    if (url.includes('/chat/sessions'))
      return new Response(JSON.stringify({ sessions: [], items: [] }), { status: 200 });
    if (url.includes('/approvals'))
      return new Response(JSON.stringify({ requests: [] }), { status: 200 });
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

function mount() {
  render(
    <MemoryRouter initialEntries={[`/t/${THREAD}`]}>
      <ThemeProvider>
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

const asked = { id: 'u1', seq: 1, kind: 'message', role: 'user', content: 'hi', metadata: {} };
const answered = {
  id: 'a1',
  seq: 2,
  kind: 'message',
  role: 'assistant',
  content: 'Hello.',
  metadata: { parent_id: 'u1' },
};

const sessionRows = () =>
  Array.from(screen.getByRole('menu').querySelectorAll<HTMLElement>('[role="menuitem"]')).map(
    (el) => el.getAttribute('aria-label') ?? el.textContent,
  );

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // An open Radix menu holds `pointer-events: none` on the body; the next test inherits it.
  document.body.removeAttribute('style');
});

describe('the Session menu', () => {
  it('on a finished thread, puts Continue run after Copy thread id, disabled, with why', async () => {
    const fetch = stub([asked, answered]);
    mount();
    await waitFor(() => expect(document.body.textContent).toContain('Hello.'));
    const u = userEvent.setup();
    await u.click(screen.getByRole('button', { name: 'Session' }));
    const item = await screen.findByRole('menuitem', { name: /^Continue run/ });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.textContent).toContain('nothing to pick up');
    expect(sessionRows()[0]).toBe(`Copy thread id ${THREAD}`);
    expect(fetch.mock.calls.some(([url]) => String(url).includes('/chat/continue'))).toBe(false);
  });

  it('leads with it when the last message got no reply', async () => {
    stub([asked]);
    mount();
    await waitFor(() =>
      expect(document.querySelector('[aria-label="Transcript"]')?.textContent).toContain('hi'),
    );
    const u = userEvent.setup();
    await u.click(screen.getByRole('button', { name: 'Session' }));
    const item = await screen.findByRole('menuitem', { name: 'Continue run' });
    expect(item.getAttribute('aria-disabled')).toBeNull();
    expect(sessionRows()[0]).toBe('Continue run');
  });
});
