// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter, type NavigateFunction, useLocation, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { PageHeader, Panel, PanelBody, READING_MEASURE } from '../src/components/harness/panel';
import { ThemeProvider } from '../src/components/theme-provider';
import { HARNESS_DESTINATIONS } from '../src/routes/harness';

/**
 * `/harness`, the second top-level address.
 *
 * Two things here are worth a test rather than a look. Every destination has to
 * *render* — the nav is built from the same list as the routes, so a broken panel
 * is a dead entry in a nav that still advertises it, and the first version of this
 * layout threw on mount for all eight because a `||` between two `useMatch` calls
 * made the second a conditional hook.
 *
 * And the shell must not treat this address as a thread. That is the whole reason
 * the engine sits above the `<Outlet/>`: an operator can walk away from the
 * transcript to read the harness and come back to a run that never stopped.
 */

function stubFetch() {
  const fn = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('/chat/sessions')) {
      return new Response(JSON.stringify({ sessions: [], items: [] }), { status: 200 });
    }
    if (url.includes('/approvals')) {
      return new Response(JSON.stringify({ requests: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ items: [], requests: [], events: [] }), { status: 200 });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

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

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  stubFetch();
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('the harness address', () => {
  it.each(
    HARNESS_DESTINATIONS.map((d) => [d.path, d.label] as const),
  )('renders /harness/%s without throwing', async (path, label) => {
    mount(`/harness/${path}`);
    await waitFor(() => expect(address).toBe(`/harness/${path}`));
    // The app-level boundary replaces everything with this when a render throws.
    expect(document.body.textContent).not.toContain("hit an error it can't recover");
    // And the panel's own boundary catches a throw inside just that destination.
    expect(document.body.textContent).not.toContain('This panel failed to render');
    expect(document.body.textContent).toContain(label);
  });

  it('offers every destination in the nav, so none is reachable only by typing', async () => {
    mount('/harness');
    await waitFor(() => expect(document.body.textContent).toContain('Memory'));
    const hrefs = [...document.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    for (const { path } of HARNESS_DESTINATIONS) {
      expect(hrefs).toContain(`/harness/${path}`);
    }
  });

  /**
   * The regression that shipped for exactly one commit.
   *
   * The shell redirected to a freshly minted thread whenever the URL carried
   * none, which was indistinguishable from correct while `/` was the only such
   * address. The moment a second one existed, opening it bounced the operator to
   * a new thread — and minting a thread resets the engine, so any run in flight
   * died on the way.
   */
  it('does not treat itself as a thread: no redirect, and the run keeps its thread', async () => {
    mount('/t/keep-me');
    await waitFor(() => expect(address).toBe('/t/keep-me'));

    await act(async () => {
      go('/harness/ledger');
    });

    await waitFor(() => expect(document.body.textContent).toContain('Ledger'));
    expect(address).toBe('/harness/ledger');

    // The header's own way back still names the thread the tab was on.
    const back = [...document.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(back).toContain('/t/keep-me');
  });

  /**
   * The same rule, across a reload. A cold load on `/harness` has no thread "the
   * tab was already on" in memory, so the shell minted one and Chat led to an
   * empty thread rather than back to the one the operator left. The tab's last
   * thread is kept in `sessionStorage` — per tab, and read only where the address
   * names no thread and is not `/`.
   */
  it('returns Chat to the thread this tab was on after a reload on /harness', async () => {
    const first = mount('/t/before-reload');
    await waitFor(() => expect(address).toBe('/t/before-reload'));
    first.unmount();

    // The reload: a new shell, the same tab.
    mount('/harness/ledger');
    await waitFor(() => expect(document.body.textContent).toContain('Ledger'));
    const hrefs = [...document.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/t/before-reload');
  });

  it('still mints on a cold /harness load in a tab that has been on no thread', async () => {
    mount('/harness/ledger');
    await waitFor(() => expect(document.body.textContent).toContain('Ledger'));
    const chat = [...document.querySelectorAll('a')]
      .map((a) => a.getAttribute('href'))
      .find((h) => h?.startsWith('/t/'));
    expect(chat).toMatch(/^\/t\/[0-9a-f-]{36}$/);
  });

  /**
   * The wordmark is the one element that should not move between the two
   * addresses. The workspace toggle before it exists only on a thread, so on
   * `/harness` the wordmark slid ~36px left. happy-dom lays nothing out, so what
   * is pinned is that the same 32px slot precedes it on both.
   */
  it('keeps the slot before the wordmark on both addresses', async () => {
    const slot = () =>
      document.querySelector('header h1')?.parentElement?.previousElementSibling ?? null;
    mount('/t/steady');
    await waitFor(() => expect(address).toBe('/t/steady'));
    expect(slot()?.classList.contains('size-8')).toBe(true);

    await act(async () => {
      go('/harness/ledger');
    });
    await waitFor(() => expect(address).toBe('/harness/ledger'));
    expect(slot()?.classList.contains('size-8')).toBe(true);
  });

  it("carries the visible Ledger half's value in the page header, not a second poll's", async () => {
    mount('/harness/ledger');
    // Reported up from the Activity half's own `/audit` poll; the halves draw no
    // heading of their own, so without the sink this value had nowhere to go.
    await waitFor(() => {
      const header = document.querySelector('main header');
      expect(header?.textContent).toContain('Ledger');
      expect(header?.textContent).toContain('0 events · 0 failed');
    });
  });

  it.each(
    HARNESS_DESTINATIONS.map((d) => [d.path] as const),
  )('holds /harness/%s to the reading measure, header row and body alike', async (path) => {
    // The measure is the default, not an opt-in. The Ledger opted in and the
    // four workbenches did not, so their labels sat ~1200px from their values —
    // the fault the constant was written to fix, on every page that forgot it.
    mount(`/harness/${path}`);
    await waitFor(() => expect(document.querySelector('main header')).not.toBeNull());
    const header = document.querySelector('main header') as HTMLElement;
    expect(header.firstElementChild?.className).toContain(READING_MEASURE);
    // The Ledger's halves measure themselves inside their tab panels, once their
    // first poll has answered; every other page's body carries it under the
    // scroller from the first render.
    await waitFor(() =>
      expect(header.nextElementSibling?.querySelector(`.${READING_MEASURE}`)).not.toBeNull(),
    );
  });

  it("keeps the Ledger's switch inside the measured header row", async () => {
    mount('/harness/ledger');
    await waitFor(() => expect(document.querySelector('main [role="tablist"]')).not.toBeNull());
    const row = document.querySelector('main header')?.firstElementChild;
    expect(row?.contains(document.querySelector('main [role="tablist"]'))).toBe(true);
  });

  it('lets a page opt out with fullBleed, and only then', () => {
    render(
      <MemoryRouter>
        <Panel fullBleed>
          <PageHeader icon={<span />} title="Wide" />
          <PanelBody>rows</PanelBody>
        </Panel>
      </MemoryRouter>,
    );
    expect(document.querySelector('header')?.firstElementChild?.className).not.toContain(
      READING_MEASURE,
    );
    expect(document.querySelector(`.${READING_MEASURE}`)).toBeNull();
  });

  it('groups the nav into records and workbenches', async () => {
    mount('/harness/memory');
    await waitFor(() => expect(document.querySelector('nav[aria-label="Harness"]')).not.toBeNull());
    const groups = [...document.querySelectorAll('nav[aria-label="Harness"] ul')];
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['Records', 'Workbenches']);
    const inGroup = (i: number) =>
      // The label is the link's first span; a glance value may follow it.
      [...(groups[i]?.querySelectorAll('a') ?? [])].map(
        (a) => a.querySelector('span')?.textContent,
      );
    expect(inGroup(0)).toEqual(['Memory', 'Corpus', 'Skills', 'Ledger']);
    expect(inGroup(1)).toEqual(['Manifests', 'Jobs', 'Eval', 'Agent']);
  });

  it('walks the nav with the arrow keys, wrapping at either end', async () => {
    mount('/harness/memory');
    await waitFor(() =>
      expect(document.querySelector('nav[aria-label="Harness"] a')).not.toBeNull(),
    );
    const links = [...document.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Harness"] a')];
    const nav = document.querySelector('nav[aria-label="Harness"]') as HTMLElement;
    links[0]?.focus();
    fireEvent.keyDown(nav, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(links[1]);
    fireEvent.keyDown(nav, { key: 'End' });
    expect(document.activeElement).toBe(links[links.length - 1]);
    fireEvent.keyDown(nav, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(links[0]);
    fireEvent.keyDown(nav, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(links[links.length - 1]);
  });

  /**
   * Jobs' rows are read across too — name, schedule, manifest, Runs at the far
   * end — and its New job button sat ~1200px from the empty-state sentence that
   * names it. The page holds header and rows to one measure now, like the Ledger.
   */
  it('holds Jobs to the reading measure, header and rows alike', async () => {
    mount('/harness/jobs');
    const header = () => document.querySelector('main header')?.firstElementChild;
    await waitFor(() => expect(header()?.textContent).toContain('New job'));
    expect(header()?.className).toContain(READING_MEASURE);
    const empty = await waitFor(() => {
      const p = [...document.querySelectorAll('main p')].find((el) =>
        el.textContent?.startsWith('No jobs yet'),
      );
      expect(p).toBeTruthy();
      return p as HTMLElement;
    });
    expect(empty.closest(`.${READING_MEASURE}`)).not.toBeNull();
  });

  it('puts the destination in a main landmark, outside the nav', async () => {
    mount('/harness/jobs');
    await waitFor(() => expect(document.querySelector('main h2')).not.toBeNull());
    const main = document.querySelector('main') as HTMLElement;
    expect(main.querySelector('h2')?.textContent).toBe('Jobs');
    expect(main.querySelector('nav[aria-label="Harness"]')).toBeNull();
  });
});
