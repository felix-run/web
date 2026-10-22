// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { resetSkillQueryClient } from '../src/components/skills/query-root';
import { ThemeProvider } from '../src/components/theme-provider';
import { resetSharedPolls } from '../src/hooks/useSharedPoll';
import { resetHarnessHealth, transientKind } from '../src/lib/harness-health';
import { resetPresence } from '../src/lib/presence';
import { resetPanes } from '../src/lib/side-pane';

/**
 * One cause, one line.
 *
 * Observed live while the harness answered 429 `rate_limited`: `/harness/skills`
 * drew six red bordered boxes, each with its own raw `skill-library/review: 429`
 * and its own Try again, while the sidebar silently showed "Older 1" for a tenant
 * with fifty threads and the header titled the thread with its raw id. These pin
 * the rule that replaced both: a read that failed for a reason waiting cures is
 * said once, by the shell, over panels that keep what they had — and red stays
 * for the failures that waiting will not cure.
 */

type Route = (url: string) => Response | undefined;
let route: Route = () => undefined;

function stubFetch() {
  const fn = vi.fn(async (input: unknown) => {
    const url = String(input);
    const answered = route(url);
    if (answered) return answered;
    if (url.includes('/chat/sessions?')) {
      return new Response(JSON.stringify({ sessions: [] }), { status: 200 });
    }
    if (url.includes('/approvals')) {
      return new Response(JSON.stringify({ requests: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ items: [], requests: [], events: [] }), { status: 200 });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const limited = () => new Response('{"error":"rate_limited"}', { status: 429 });

function mount(at: string) {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={[at]}>
        <ThemeProvider>
          <TooltipProvider>
            <App />
          </TooltipProvider>
        </ThemeProvider>
      </MemoryRouter>
    </StrictMode>,
  );
}

const healthLines = () => document.querySelectorAll('[data-slot="harness-health"]');
const indexRow = () => document.querySelector<HTMLElement>('[data-slot="thread-index-status"]');

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  // Harness view: every page, but no Debug — so no raw status text.
  localStorage.setItem('felix.view', 'harness');
  resetPresence();
  resetHarnessHealth();
  resetSharedPolls();
  resetSkillQueryClient();
  route = () => undefined;
  stubFetch();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetPanes();
  resetHarnessHealth();
  document.body.innerHTML = '';
});

describe('which failures are transient', () => {
  it('names a rate limit, an unavailable harness and no answer at all, and nothing else', () => {
    expect(transientKind(new Error('chat/sessions: 429'))).toBe('rate_limited');
    expect(transientKind(Object.assign(new Error('x'), { status: 503 }))).toBe('unavailable');
    expect(transientKind(new TypeError('Failed to fetch'))).toBe('unreachable');
    // A fault in the client is not an outage, however it is spelled.
    expect(transientKind(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(
      null,
    );
    expect(transientKind(new Error('skill-library: 500'))).toBe(null);
    expect(transientKind(new Error('skill-library: 403'))).toBe(null);
    expect(transientKind(new DOMException('aborted', 'AbortError'))).toBe(null);
  });
});

describe('the thread index under a 429', () => {
  const server = Array.from({ length: 6 }, (_, i) => ({
    id: `thread-${i}`,
    name: `Remembered thread ${i}`,
    updatedAt: Date.now() - (i + 1) * 3_600_000,
  }));

  it('keeps the list this tab last read, says so under Threads, and offers Retry', async () => {
    // The tab read the index before this reload; the reload meets the 429.
    sessionStorage.setItem(
      'felix.threadIndex',
      JSON.stringify({ at: Date.now() - 180_000, rows: server }),
    );
    route = (url) => (url.includes('/chat/sessions?') ? limited() : undefined);
    mount('/t/thread-2');

    await waitFor(() => expect(indexRow()).not.toBeNull());
    const row = indexRow() as HTMLElement;
    expect(row.textContent).toMatch(/Couldn't refresh the harness's threads/);
    expect(row.textContent).toMatch(/showing its list from 3m ago/);
    // Neutral: a 429 passes, and it is asked again on a backoff.
    expect(row.className).not.toMatch(/state-failed/);
    expect(within(row).getByRole('button', { name: 'Retry' })).toBeTruthy();

    // The whole remembered list, not the one thread this browser sent to.
    const list = document.querySelector('[data-slot="thread-list"]') as HTMLElement;
    for (const t of server.slice(0, 3)) expect(list.textContent).toContain(t.name);
    // And the header names the thread rather than printing its id.
    const title = document.querySelector('[data-slot="thread-title"]') as HTMLElement;
    expect(title.textContent).toContain('Remembered thread 2');

    // One shell line for the cause, neutral.
    expect(healthLines()).toHaveLength(1);
    expect(healthLines()[0]?.textContent).toMatch(/The harness is shedding load/);
  });

  it("says the list is this browser's alone when the tab has nothing remembered", async () => {
    localStorage.setItem(
      'felix.threads',
      JSON.stringify([{ id: 'only-local', title: 'Sent from here', manifest: '', updatedAt: 1 }]),
    );
    route = (url) => (url.includes('/chat/sessions?') ? limited() : undefined);
    mount('/t/only-local');

    await waitFor(() => expect(indexRow()).not.toBeNull());
    // Not "Older 1" as though that were the tenant's whole history.
    expect(indexRow()?.textContent).toMatch(
      /Couldn't load the harness's threads.*showing this browser's 1/,
    );
  });

  it('clears the row and the shell line once the index answers', async () => {
    let failing = true;
    route = (url) => (url.includes('/chat/sessions?') && failing ? limited() : undefined);
    mount('/t/clears');
    await waitFor(() => expect(indexRow()).not.toBeNull());
    expect(healthLines()).toHaveLength(1);

    failing = false;
    fireEvent.click(within(indexRow() as HTMLElement).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(indexRow()).toBeNull());
    await waitFor(() => expect(healthLines()).toHaveLength(0));
    // And the good read is what a later failure falls back to.
    expect(sessionStorage.getItem('felix.threadIndex')).toMatch(/"rows":\[\]/);
  });
});

describe('/harness/skills under a 429', () => {
  it('draws one shell line and no red section boxes', async () => {
    route = (url) =>
      url.includes('/skill-library') || url.includes('/manifests') || url.includes('/api/skills/')
        ? limited()
        : undefined;
    mount('/harness/skills');

    await waitFor(() => expect(healthLines()).toHaveLength(1));
    // Give every section's read time to land and fail.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const main = document.querySelector('main') as HTMLElement;
    expect(within(main).queryAllByRole('alert')).toHaveLength(0);
    expect(within(main).queryAllByRole('button', { name: 'Try again' })).toHaveLength(0);
    expect(main.querySelector('[class*="state-failed"]')).toBeNull();
    // No raw endpoint text outside Debug.
    expect(document.body.textContent).not.toMatch(/429/);
    expect(healthLines()[0]?.textContent).toMatch(/The harness is shedding load/);
    expect(healthLines()[0]?.textContent).toMatch(/nothing has loaded from it yet/);
    expect(
      within(healthLines()[0] as HTMLElement).getByRole('button', { name: 'Retry' }),
    ).toBeTruthy();
  });

  it('shows the raw text in Debug, on the one line', async () => {
    localStorage.setItem('felix.view', 'debug');
    route = (url) => (url.includes('/skill-library') ? limited() : undefined);
    mount('/harness/skills');
    await waitFor(() => expect(healthLines()[0]?.textContent).toMatch(/429/));
  });

  it('clears the line when Retry finds the harness answering', async () => {
    let failing = true;
    route = (url) => (url.includes('/skill-library') && failing ? limited() : undefined);
    mount('/harness/skills');
    await waitFor(() => expect(healthLines()).toHaveLength(1));

    failing = false;
    fireEvent.click(within(healthLines()[0] as HTMLElement).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(healthLines()).toHaveLength(0));
  });

  it.each([
    [500, 'a server fault'],
    [403, 'a refusal'],
  ])('still shows a %i (%s) in the section, in red', async (status) => {
    route = (url) =>
      url.includes('/skill-library')
        ? new Response('{"error":"nope","message":"nope"}', { status })
        : undefined;
    mount('/harness/skills');
    const main = () => document.querySelector('main') as HTMLElement;
    // A 5xx is retried once (`query-root.tsx`), a second away, before it is said.
    await waitFor(() => expect(within(main()).queryAllByRole('alert').length).toBeGreaterThan(0), {
      timeout: 4000,
    });
    // Not a passing failure, so not the shell's line.
    expect(healthLines()).toHaveLength(0);
  });
});
