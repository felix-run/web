// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { ThemeProvider } from '../src/components/theme-provider';
import { resetPresence } from '../src/lib/presence';

/**
 * Loading a thread whose durable run is still going rejoins the run.
 *
 * The harness names the run on the snapshot (`activeRun`, felix-run/felix#533), because its
 * `phase` reads `idle` throughout a durable run and the run's token was otherwise only in the
 * response that started it. Before that, a reload showed a thread that looked finished while
 * the run went on, and the next message started a second run beside it. A harness that sends
 * no `activeRun` key cannot say, so this browser's own record of a run it started answers.
 */

const RECORD = 'felix.durableRuns';

let polled: string[];

function stubHarness(snapshot: Record<string, unknown>) {
  polled = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/chat/runs/')) {
        polled.push(url);
        return new Response(JSON.stringify({ status: 'running' }), { status: 200 });
      }
      if (/\/chat\/sessions\/thread-a(\?|$)/.test(url)) {
        return new Response(
          JSON.stringify({ id: 'tenant:thread-a', transcript: [], ...snapshot }),
          {
            status: 200,
          },
        );
      }
      if (url.includes('/chat/sessions') || url.includes('/approvals')) {
        return new Response(JSON.stringify({ sessions: [], items: [], requests: [] }), {
          status: 200,
        });
      }
      return new Response('{}', { status: 200 });
    }),
  );
}

function mount(at: string) {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <ThemeProvider>
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('felix.apiKey', 'test');
  resetPresence();
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('a thread whose durable run is still going', () => {
  it('is rejoined from the snapshot, and reads as running', async () => {
    stubHarness({ phase: 'idle', activeRun: { resumeToken: 'fib_live', status: 'running' } });
    mount('/t/thread-a');

    await waitFor(() => expect(polled.some((u) => u.includes('/chat/runs/fib_live'))).toBe(true));
    expect(await screen.findByText('Background · running…')).toBeTruthy();
  });

  it('is not rejoined when the harness says there is none, and a stale record goes', async () => {
    localStorage.setItem(
      RECORD,
      JSON.stringify({ 'thread-a': { token: 'fib_old', at: Date.now() } }),
    );
    stubHarness({ phase: 'idle', activeRun: null });
    mount('/t/thread-a');

    await waitFor(() => expect(localStorage.getItem(RECORD)).toBeNull());
    expect(polled).toEqual([]);
  });

  it("falls back to this browser's record on a harness that cannot say", async () => {
    localStorage.setItem(
      RECORD,
      JSON.stringify({ 'thread-a': { token: 'fib_mine', at: Date.now() } }),
    );
    stubHarness({ phase: 'idle' });
    mount('/t/thread-a');

    await waitFor(() => expect(polled.some((u) => u.includes('/chat/runs/fib_mine'))).toBe(true));
  });
});
