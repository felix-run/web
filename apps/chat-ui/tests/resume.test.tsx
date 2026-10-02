// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { ThemeProvider } from '../src/components/theme-provider';
import { onResume } from '../src/lib/resume';

/**
 * Coming back to a page a phone suspended.
 *
 * Nothing runs while it is away — the approval polls' timers are frozen with
 * everything else — so the return is the moment to ask again, not the next tick
 * of a poll that may be most of an interval off. These pin the signal and the
 * first thing the shell does with it. What the engine does with a silent stream
 * is pinned in `@felix/client`'s engine tests, at the wire.
 */

let visibility: DocumentVisibilityState = 'visible';
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });

function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  visibility = 'visible';
});

describe('onResume', () => {
  it('reports one return for the signals that arrive together, with how long it was away', () => {
    vi.useFakeTimers();
    const calls: number[] = [];
    const stop = onResume(({ hiddenForMs }) => calls.push(hiddenForMs));

    setVisibility('hidden');
    vi.advanceTimersByTime(90_000);
    setVisibility('visible');
    window.dispatchEvent(new Event('online'));
    vi.advanceTimersByTime(1_000);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toBeGreaterThanOrEqual(90_000);
    stop();
  });

  it('counts a page restored from the back/forward cache, and not an ordinary load', () => {
    vi.useFakeTimers();
    const calls: number[] = [];
    const stop = onResume(({ hiddenForMs }) => calls.push(hiddenForMs));

    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }));
    vi.advanceTimersByTime(1_000);
    expect(calls).toHaveLength(0);

    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    vi.advanceTimersByTime(1_000);
    expect(calls).toHaveLength(1);
    stop();
  });
});

describe('the shell on return', () => {
  it('asks about approvals at once instead of waiting out the poll', async () => {
    const asked: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes('/approvals')) {
          asked.push(Date.now());
          return new Response(JSON.stringify({ requests: [] }), { status: 200 });
        }
        if (url.includes('/chat/sessions')) {
          return new Response(JSON.stringify({ sessions: [], items: [] }), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      }),
    );
    render(
      <MemoryRouter initialEntries={['/t/resume-test']}>
        <ThemeProvider>
          <TooltipProvider>
            <App />
          </TooltipProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );
    // Let mount's own requests land, well inside the poll's first interval.
    await new Promise((r) => setTimeout(r, 300));
    const before = asked.length;
    const returnedAt = Date.now();

    setVisibility('hidden');
    setVisibility('visible');

    const deadline = Date.now() + 1_500;
    while (asked.length === before && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(asked.length).toBeGreaterThan(before);
    // Sooner than any interval could have produced it.
    expect((asked.at(-1) ?? 0) - returnedAt).toBeLessThan(1_000);
  });
});
