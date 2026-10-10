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
 * Debug off is the daily surface; debug on brings the mechanism back. What is
 * pinned here is the line between them: the instrument, the harness's pages and
 * the header's mechanics leave with debug, and what waits on a person — here, a
 * skill draft — does not.
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

describe('debug off, the daily surface', () => {
  it('has no instrument, no harness pages and no mode badge', async () => {
    mount('/t/daily');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Session' })).toBeTruthy());
    expect(instrumentToggle()).toBeNull();
    expect(harnessNav()).toBeNull();
    expect(document.querySelector('header [data-slot="debug-mode"]')).toBeNull();
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
    // Still not the eight pages.
    expect(harnessNav()).toBeNull();
  });

  it('comes on from the Session menu, and is remembered under its own key', async () => {
    localStorage.setItem('felix.verbose', '0');
    mount('/t/daily');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Session' }));
    await user.click(await screen.findByRole('menuitemcheckbox', { name: /Debug/ }));
    await waitFor(() => expect(harnessNav()).not.toBeNull());
    expect(instrumentToggle()).not.toBeNull();
    expect(document.querySelector('header [data-slot="debug-mode"]')).not.toBeNull();
    expect(localStorage.getItem('felix.debug')).toBe('1');
    expect(localStorage.getItem('felix.verbose')).toBeNull();

    // The badge is the way back out.
    await user.click(screen.getByRole('button', { name: 'Debug on, turn off' }));
    await waitFor(() => expect(harnessNav()).toBeNull());
    expect(instrumentToggle()).toBeNull();
  });

  it('is offered on /harness too, which it governs', async () => {
    mount('/harness/memory');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'View' }));
    expect(await screen.findByRole('menuitemcheckbox', { name: /Debug/ })).toBeTruthy();
    await user.keyboard('{Escape}');
  });
});

describe('/debug', () => {
  it('answers to the name Verbose had', () => {
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
