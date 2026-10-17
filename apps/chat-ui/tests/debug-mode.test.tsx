// @vitest-environment happy-dom
import type { UsageEvent } from '@felix/client';
import { TooltipProvider } from '@felix/ui/tooltip';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { findSlashCommand, matchSlashCommands } from '../src/components/chat/slash-commands';
import { debugReport, redact, threadCalls } from '../src/components/inspector/debug-section';
import { ThemeProvider } from '../src/components/theme-provider';
import { resetPresence } from '../src/lib/presence';
import type { ClientDiagnostics } from '../src/shell-context';

/**
 * The View setting is a ladder. Everyday is the daily surface; harness view
 * brings the operator's surfaces back; debug adds the plumbing. What is pinned
 * here is the line between each: the instrument, the harness's pages and the
 * header's mechanics are harness view's, the badge and the Debug tab are debug's,
 * and what waits on a person — here, a skill draft — is everyone's.
 */

let drafts: unknown[] = [];

function stubFetch() {
  const fn = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('/skill-library/-/review')) {
      return new Response(JSON.stringify({ items: drafts, next_cursor: null }), { status: 200 });
    }
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

const harnessNav = () => document.querySelector('nav[aria-label="Harness"]');
const instrumentToggle = () => document.querySelector('header [aria-label="This thread"]');

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetPresence();
  drafts = [];
  stubFetch();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const debugBadge = () => document.querySelector('header [data-slot="debug-mode"]');

async function choose(user: ReturnType<typeof userEvent.setup>, level: RegExp) {
  await user.click(await screen.findByRole('button', { name: 'Session' }));
  await user.click(await screen.findByRole('menuitemradio', { name: level }));
}

describe('everyday, the daily surface', () => {
  it('has no instrument, no harness pages and no mode badge', async () => {
    mount('/t/daily');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Session' })).toBeTruthy());
    expect(instrumentToggle()).toBeNull();
    expect(harnessNav()).toBeNull();
    expect(debugBadge()).toBeNull();
    expect(document.querySelector('[data-slot="skill-drafts"]')).toBeNull();
  });

  it('keeps one door to the harness: skill drafts, only while they wait', async () => {
    drafts = [{ name: 'triage', version: 'v2' }];
    mount('/t/daily');
    const row = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-slot="skill-drafts"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(row.textContent).toContain('Skill drafts');
    expect(row.textContent).toContain('1 waiting');
    expect(row.querySelector('a')?.getAttribute('href')).toBe('/harness/skills');
    // Still not the other pages: those are harness view's, or `/harness`'s.
    expect(harnessNav()).toBeNull();
  });
});

describe('harness view', () => {
  it('brings the instrument and the harness pages, and no Debug badge', async () => {
    mount('/t/daily');
    const user = userEvent.setup();
    await choose(user, /^Harness view/);
    await waitFor(() => expect(harnessNav()).not.toBeNull());
    expect(instrumentToggle()).not.toBeNull();
    expect(debugBadge()).toBeNull();
    expect(localStorage.getItem('felix.view')).toBe('harness');
  });

  it('is a level below debug, which adds the badge', async () => {
    localStorage.setItem('felix.view', 'harness');
    mount('/t/daily');
    const user = userEvent.setup();
    await choose(user, /^Harness \+ debug/);
    await waitFor(() => expect(debugBadge()).not.toBeNull());

    // The badge goes back to the level debug came from: harness view, here.
    await user.click(screen.getByRole('button', { name: 'Debug on, turn off' }));
    await waitFor(() => expect(debugBadge()).toBeNull());
    expect(harnessNav()).not.toBeNull();
    expect(localStorage.getItem('felix.view')).toBe('harness');
  });

  it('turning debug off from everyday goes back to everyday', async () => {
    mount('/t/daily');
    const user = userEvent.setup();
    await choose(user, /^Harness \+ debug/);
    await waitFor(() => expect(debugBadge()).not.toBeNull());
    await user.click(screen.getByRole('button', { name: 'Debug on, turn off' }));
    await waitFor(() => expect(harnessNav()).toBeNull());
    expect(instrumentToggle()).toBeNull();
    expect(localStorage.getItem('felix.view')).toBe('everyday');
  });

  it('starts a browser that had Debug or Verbose on at debug, and drops the old keys', async () => {
    localStorage.setItem('felix.debug', '1');
    localStorage.setItem('felix.verbose', '1');
    mount('/t/daily');
    await waitFor(() => expect(debugBadge()).not.toBeNull());
    expect(localStorage.getItem('felix.view')).toBe('debug');
    expect(localStorage.getItem('felix.debug')).toBeNull();
    expect(localStorage.getItem('felix.verbose')).toBeNull();
  });

  it('is offered on /harness too, which it governs', async () => {
    mount('/harness/memory');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'View' }));
    expect(await screen.findByRole('menuitemradio', { name: /^Harness view/ })).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: /^Everyday/ })).toBeTruthy();
    await user.keyboard('{Escape}');
  });
});

describe('/view and /debug', () => {
  // The order of the rungs. In Chrome, `/view` once stepped from a stale level
  // (the composer held an earlier render's handler) and went from harness view
  // to everyday; happy-dom does not reproduce that, so this pins the order only.
  it('steps from the level as it stands, one rung per command', async () => {
    mount('/t/daily');
    const user = userEvent.setup();
    const box = await screen.findByRole('textbox', { name: /Message Felix/ });
    const run = async (cmd: string) => {
      await user.click(box);
      await user.type(box, cmd);
      await user.keyboard('{Enter}');
    };
    await run('/view');
    await waitFor(() => expect(localStorage.getItem('felix.view')).toBe('harness'));
    await run('/view');
    await waitFor(() => expect(localStorage.getItem('felix.view')).toBe('debug'));
    await run('/debug');
    await waitFor(() => expect(localStorage.getItem('felix.view')).toBe('harness'));
  });

  it('has /view for the ladder, and /debug under the name Verbose had', () => {
    expect(findSlashCommand('view')?.action).toBe('view');
    expect(findSlashCommand('debug')?.action).toBe('debug');
    expect(findSlashCommand('verbose')?.action).toBe('debug');
    expect(matchSlashCommands('verb').map((c) => c.name)).toEqual(['debug']);
  });
});

const CLIENT: ClientDiagnostics = {
  at: Date.UTC(2026, 9, 10, 12),
  threadId: 'abc',
  holderId: 'holder-1',
  lease: { mode: 'exclusive', heldByOther: false, token: 'lease-secret-token-0123' },
  manifest: 'cowork',
  threadAgent: 'cowork',
  canary: null,
  leaf: 'ev-9',
  turns: 4,
  harnessReachable: true,
  engines: [],
};

function usage(over: Partial<UsageEvent>): UsageEvent {
  return {
    id: 'u',
    tenant_id: 't',
    ts: 1_760_000_000,
    manifest_id: 'cowork',
    model_id: 'claude',
    kind: 'chat',
    tokens_input: 10,
    tokens_output: 5,
    cache_creation: 0,
    cache_read: 0,
    meta_json: {},
    ...over,
  };
}

describe('the Debug tab', () => {
  it("keeps only this thread's calls, whatever the harness answered for", () => {
    const rows = [
      usage({ id: '1', thread_id: 'tenant:abc' }),
      usage({ id: '2', thread_id: 'tenant:other' }),
      usage({ id: '3', thread_id: '' }),
    ];
    const kept = threadCalls(rows, 'abc');
    expect(kept !== 'unattributed' && kept.map((r) => r.id)).toEqual(['1']);
  });

  it('says a harness that attributes nothing does not, rather than listing none', () => {
    expect(threadCalls([usage({ id: '1' })], 'abc')).toBe('unattributed');
    expect(threadCalls([], 'abc')).toEqual([]);
  });

  it('never puts the lease token in the report', () => {
    const report = debugReport(CLIENT, [usage({ id: '1', thread_id: 'tenant:abc' })], {
      origin: 'https://felix.test',
      userAgent: 'test',
    });
    expect(report).not.toContain('lease-secret-token-0123');
    expect(report).toContain(redact('lease-secret-token-0123'));
    expect(report).toContain('Thread `abc` on `cowork`, 4 turns');
    const json = JSON.parse(report.slice(report.indexOf('{'), report.lastIndexOf('}') + 1));
    expect(json.at).toBe('2026-10-10T12:00:00.000Z');
    expect(json.leaf).toBe('ev-9');
    expect(json.calls).toHaveLength(1);
  });
});
