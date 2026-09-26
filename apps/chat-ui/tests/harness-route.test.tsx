// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter, type NavigateFunction, useLocation, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { READING_MEASURE } from '../src/components/harness/panel';
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

  it("holds the Ledger header's switch to the rows' measure, and leaves full-width pages alone", async () => {
    // The Activity/Usage switch sat at the far edge of the pane while the rows it
    // switches stopped at the reading measure. The header row and the rows now
    // read one constant; a page whose rows run full width keeps its controls at
    // the edge those rows reach.
    const row = () => document.querySelector('main header')?.firstElementChild;
    mount('/harness/ledger');
    await waitFor(() => expect(document.querySelector('main [role="tablist"]')).not.toBeNull());
    expect(row()?.className).toContain(READING_MEASURE);
    expect(row()?.contains(document.querySelector('main [role="tablist"]'))).toBe(true);
    cleanup();
    mount('/harness/jobs');
    await waitFor(() => expect(document.querySelector('main header')).not.toBeNull());
    expect(row()?.className).not.toContain(READING_MEASURE);
  });

  it('puts the destination in a main landmark, outside the nav', async () => {
    mount('/harness/jobs');
    await waitFor(() => expect(document.querySelector('main h2')).not.toBeNull());
    const main = document.querySelector('main') as HTMLElement;
    expect(main.querySelector('h2')?.textContent).toBe('Jobs');
    expect(main.querySelector('nav[aria-label="Harness"]')).toBeNull();
  });
});
