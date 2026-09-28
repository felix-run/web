// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter, type NavigateFunction, useLocation, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { PageHeader, Panel, PanelBody, READING_MEASURE } from '../src/components/harness/panel';
import { ThemeProvider } from '../src/components/theme-provider';
import { resetPresence } from '../src/lib/presence';
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
  // Presence is module state, and the title is the document's: both outlive a test.
  resetPresence();
  document.title = 'Felix';
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
      expect(header?.textContent).toContain('0 events ·');
      expect(header?.textContent).toContain('0 failed');
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
    // Shown, not only announced: each list is named by a visible label.
    const named = groups.map(
      (g) => document.getElementById(g.getAttribute('aria-labelledby') ?? '')?.textContent,
    );
    expect(named).toEqual(['Records', 'Workbenches']);
    const inGroup = (i: number) =>
      // The label is the link's first span; a glance value may follow it.
      [...(groups[i]?.querySelectorAll('a') ?? [])].map(
        (a) => a.querySelector('span')?.textContent,
      );
    // Agent is a record: it reads the resolved spec and changes nothing.
    expect(inGroup(0)).toEqual(['Memory', 'Corpus', 'Skills', 'Ledger', 'Agent']);
    expect(inGroup(1)).toEqual(['Manifests', 'Jobs', 'Eval']);
  });

  it('names the page in the tab title, and gives it back on the way out', async () => {
    mount('/harness/ledger');
    await waitFor(() => expect(document.title).toBe('Ledger — Felix'));
    await act(async () => {
      go('/harness/memory');
    });
    await waitFor(() => expect(document.title).toBe('Memory — Felix'));
    await act(async () => {
      go('/t/back-again');
    });
    await waitFor(() => expect(document.title).toBe('Felix'));
  });

  it("keeps the Ledger's half in the address, so Usage can be linked", async () => {
    mount('/harness/ledger?view=usage');
    await waitFor(() =>
      expect(document.querySelector('main [role="tab"][aria-selected="true"]')?.textContent).toBe(
        'Usage',
      ),
    );
  });

  it('keeps an accessible name on the Chat door at every width', async () => {
    mount('/harness/memory');
    await waitFor(() => expect(document.querySelector('header a[href^="/t/"]')).not.toBeNull());
    const door = document.querySelector('header a[href^="/t/"]') as HTMLElement;
    // The word is visually hidden below `sm`, never removed: the icon is aria-hidden.
    expect(door.textContent).toContain('Chat');
    expect(door.querySelector('.hidden')).toBeNull();
  });

  it('leaves the conversation controls with the conversation', async () => {
    mount('/harness/memory');
    await waitFor(() => expect(document.querySelector('nav[aria-label="Harness"]')).not.toBeNull());
    expect(document.querySelector('header [aria-label="New chat"]')).toBeNull();
    expect(document.querySelector('header [aria-label="More tools"]')).toBeNull();
  });

  it('lands on the Ledger when wide, and stays the list when narrow', async () => {
    // The Ledger answers "what happened while I was away"; Memory, first in the
    // list, is empty for most tenants.
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('min-width: 768px'),
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    mount('/harness');
    await waitFor(() => expect(address).toBe('/harness/ledger'));
  });

  it("reads Memory's view and turn from the address, so a turn can be linked", async () => {
    mount('/harness/memory?view=asof&turn=12');
    await waitFor(() =>
      expect((document.getElementById('memory-as-of') as HTMLInputElement | null)?.value).toBe(
        '12',
      ),
    );
    expect(
      document.querySelector('[role="group"][aria-label="Memory view"] [aria-pressed="true"]')
        ?.textContent,
    ).toBe('As of');
  });

  it.each([
    ['memory', 'Add memory'],
    ['corpus', 'Add document'],
    ['jobs', 'New job'],
    ['eval', 'New dataset'],
    ['manifests', 'Import'],
  ])('puts /harness/%s create in the header, as one toggle', async (path, name) => {
    // One place for "add" on every page: it lived in four.
    mount(`/harness/${path}`);
    await waitFor(() => expect(document.querySelector('main header')).not.toBeNull());
    const toggle = [...document.querySelectorAll('main header button[aria-expanded]')].find(
      (b) => b.textContent?.trim() === name,
    );
    expect(toggle).toBeTruthy();
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
  });

  it('reads its own agent from the address, not the chat’s', async () => {
    // Inspecting a second agent used to mean changing what the conversation
    // talks to. `?agent=` is the harness's own, and the page asks for that one.
    mount('/harness/agent?agent=deep');
    await waitFor(() =>
      expect(
        vi.mocked(fetch).mock.calls.some((c) => String(c[0]).includes('/manifests/deep')),
      ).toBe(true),
    );
  });

  it('keeps the agent across the nav and across a view change', async () => {
    mount('/harness/memory?agent=deep');
    await waitFor(() =>
      expect(document.querySelector('nav[aria-label="Harness"] a')).not.toBeNull(),
    );
    const hrefs = [...document.querySelectorAll('nav[aria-label="Harness"] a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(hrefs.every((h) => h?.endsWith('?agent=deep'))).toBe(true);

    // Memory writes its own view into the query string; it must not drop the agent.
    const search = [
      ...document.querySelectorAll('[role="group"][aria-label="Memory view"] button'),
    ].find((b) => b.textContent === 'Search') as HTMLElement;
    fireEvent.click(search);
    await waitFor(() => expect(address).toBe('/harness/memory'));
    await waitFor(() =>
      expect(
        [...document.querySelectorAll('nav[aria-label="Harness"] a')].every((a) =>
          a.getAttribute('href')?.endsWith('?agent=deep'),
        ),
      ).toBe(true),
    );
  });

  it('makes every nav link a Tab stop, as links are, with the arrows as an extra', async () => {
    // One roving stop hid seven pages from anyone tabbing, with nothing to say
    // the arrows existed; a list of links is not a composite widget.
    mount('/harness/jobs');
    await waitFor(() =>
      expect(document.querySelector('nav[aria-label="Harness"] a')).not.toBeNull(),
    );
    const links = [...document.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Harness"] a')];
    expect(links.length).toBe(8);
    expect(links.every((a) => a.tabIndex === 0)).toBe(true);
  });

  it('carries failing jobs on the rail, counted as the Jobs page counts them', async () => {
    const base = vi.mocked(fetch).getMockImplementation();
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/jobs')) {
        return new Response(
          JSON.stringify({
            items: [
              { name: 'digest', schedule: '0 9 * * *', manifest_id: 'quick', last_status: 'ok' },
              { name: 'triage', schedule: '', manifest_id: 'quick', last_error: 'boom' },
            ],
          }),
          { status: 200 },
        );
      }
      return base ? base(input) : new Response('{}');
    });
    mount('/harness/memory');
    await waitFor(() => {
      const jobs = [...document.querySelectorAll('nav[aria-label="Harness"] a')].find((a) =>
        a.getAttribute('href')?.startsWith('/harness/jobs'),
      );
      // Shown short; spoken in full, with the label and the count kept apart.
      expect(jobs?.querySelector('[aria-hidden="true"]:not(svg)')?.textContent).toBe('1 failing');
      expect(jobs?.querySelector('.sr-only')?.textContent).toBe(', 1 failing');
    });
  });

  it("says it couldn't check, rather than going blank, when a glance's read fails", async () => {
    // Blank is this rail's all-clear; a failed read must not look like one.
    const base = vi.mocked(fetch).getMockImplementation();
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input).includes('/api/jobs')) {
        return new Response('{"error":"rate_limited"}', { status: 429 });
      }
      return base ? base(input) : new Response('{}');
    });
    mount('/harness/memory');
    await waitFor(() => {
      const jobs = [...document.querySelectorAll('nav[aria-label="Harness"] a')].find((a) =>
        a.getAttribute('href')?.startsWith('/harness/jobs'),
      );
      expect(jobs?.querySelector('.sr-only')?.textContent).toBe(", Couldn't check jobs");
      // Shown as a word, not a bare `?` whose meaning lived only in a hover title.
      expect(jobs?.textContent).toContain('unchecked');
    });
  });

  it('reads jobs once for the page and its glance, not once each', async () => {
    // The rail's `Jobs · N failing` and the Jobs page share one poll.
    mount('/harness/jobs');
    await waitFor(() => expect(document.querySelector('main header')).not.toBeNull());
    await waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.some((c) => String(c[0]).includes('/api/jobs'))).toBe(
        true,
      ),
    );
    const jobReads = vi
      .mocked(fetch)
      .mock.calls.filter((c) => /\/api\/jobs(\?|$)/.test(String(c[0]))).length;
    expect(jobReads).toBe(1);
  });

  it('puts the agent picker only on the pages it scopes', async () => {
    // It headed the nav, where it read as filtering the Ledger and Memory too.
    for (const [path, scoped] of [
      ['skills', true],
      ['eval', true],
      ['agent', true],
      ['ledger', false],
      ['memory', false],
      ['jobs', false],
    ] as const) {
      mount(`/harness/${path}`);
      await waitFor(() => expect(document.querySelector('main header')).not.toBeNull());
      expect(!!document.querySelector('main header #harness-agent')).toBe(scoped);
      expect(document.querySelector('nav[aria-label="Harness"] #harness-agent')).toBeNull();
      cleanup();
    }
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
