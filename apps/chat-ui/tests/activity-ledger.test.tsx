/** @vitest-environment happy-dom */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityLedger, repricedRoutes } from '../src/components/harness/activity-ledger';
import { middleTruncate } from '../src/lib/format';
import {
  buildLedger,
  cutTurns,
  filterLedger,
  foldRoutine,
  money,
  NO_THREAD,
  resolveWindow,
  toolTally,
} from '../src/lib/ledger';
import { ShellProvider, type ShellValue } from '../src/shell-context';
import type { AuditEvent, UsageThreadItem } from '../src/types';

/**
 * The Activity page as a ledger: one entry per thread.
 *
 * It replaced two tabs split by route, Events (`/audit`) and Usage (`/usage`),
 * which made the operator join them by eye — and could not be joined, because
 * no usage row said which thread it was. What is pinned here is what made the
 * old page wrong: a failure read alone, out of its turn; a cost nobody could
 * attribute; and a feed that was sixty Tab stops long.
 */

const MIN = 60_000;
const now = Date.now();

const ev = (over: Partial<AuditEvent> & { id: string }): AuditEvent => ({
  tenant_id: 'default',
  ts: now - 10 * MIN,
  event_type: 'tool_call',
  manifest_id: 'quick',
  principal_subj: 'local-dev',
  status: 'ok',
  payload: {},
  ...over,
});

const spend = (over: Partial<UsageThreadItem> & { thread_id: string }): UsageThreadItem => ({
  calls: 3,
  tokens_input: 10,
  tokens_output: 100,
  cache_creation: 0,
  cache_read: 0,
  cost_usd: 0.42,
  first_ts: now - 20 * MIN,
  last_ts: now - 5 * MIN,
  ...over,
});

/** One turn on `thread-a`: asked, a call failed, the turn ended badly. */
const failingTurn = [
  ev({
    id: 'u1',
    ts: now - 12 * MIN,
    event_type: 'user_input',
    payload: { user_input: 'fix the changelog', thread_id: 'default:thread-a' },
  }),
  ev({
    id: 't1',
    ts: now - 11 * MIN,
    status: 'error',
    payload: { tool: 'edit_file', error_code: 'invalid_arguments', thread_id: 'default:thread-a' },
  }),
  ev({
    id: 'f1',
    ts: now - 10 * MIN,
    event_type: 'final_response',
    status: 'error',
    payload: { chars: 31, thread_id: 'default:thread-a' },
  }),
];

describe('buildLedger', () => {
  it('files events under the thread suffix, newest activity first, with no-thread last', () => {
    const ledger = buildLedger(
      [
        ...failingTurn,
        ev({
          id: 'b1',
          ts: now - 2 * MIN,
          payload: { tool: 'read', thread_id: 'default:thread-b' },
        }),
        ev({ id: 's1', ts: now - MIN, event_type: 'inbound_screening', payload: {} }),
      ],
      null,
    );
    // The screening event is the newest thing here and still sorts last: it is not
    // a conversation, and ranking it among them would say it was one.
    expect(ledger.map((t) => t.id)).toEqual(['thread-b', 'thread-a', NO_THREAD]);
    expect(ledger[2].loose.map((e) => e.id)).toEqual(['s1']);
  });

  it('cuts a thread into turns at each user_input, and keeps a turn begun before the window', () => {
    const turns = cutTurns([
      ev({ id: 'x1', ts: now - 30 * MIN, payload: { tool: 'tail_of_last_night' } }),
      ...failingTurn,
    ]);
    // Newest turn first; the events inside it in the order they happened.
    expect(turns.map((t) => t.id)).toEqual(['u1', 'x1']);
    expect(turns[0].events.map((e) => e.id)).toEqual(['u1', 't1', 'f1']);
    expect(turns[0].prompt).toBe('fix the changelog');
    expect(turns[0].worst).toBe('error');
    expect(turns[1].partial).toBe(true);
    expect(turns[1].open).toBe(true);
  });

  it('puts the spend on the thread it ran on, whichever spelling the id arrives in', () => {
    const ledger = buildLedger(failingTurn, [
      spend({ thread_id: 'default:thread-a', cost_usd: 1 }),
      spend({ thread_id: 'thread-a', cost_usd: 0.5, calls: 1 }),
      spend({ thread_id: 'default:only-spent', last_ts: now - MIN }),
    ]);
    const a = ledger.find((t) => t.id === 'thread-a');
    expect(a?.spend?.cost_usd).toBeCloseTo(1.5);
    expect(a?.spend?.calls).toBe(4);
    // A thread that spent in the window but has no audited event in it still
    // gets an entry: its cost is real.
    expect(ledger[0].id).toBe('only-spent');
    expect(ledger[0].turns).toEqual([]);
  });

  it('ranks a broken call above a refused one', () => {
    const [t] = buildLedger(
      [
        ev({ id: 'd', status: 'denied', payload: { thread_id: 'x' } }),
        ev({ id: 'e', status: 'error', payload: { thread_id: 'x' } }),
      ],
      null,
    );
    expect(t.worst).toBe('error');
    expect(t.failures).toHaveLength(2);
  });
});

/**
 * A sixty-seven-call turn drew every call, and the two that failed were a scroll
 * below a column of OK. Routine runs fold; failures and turn boundaries never do.
 */
describe('foldRoutine', () => {
  const ok = (id: string, tool: string) => ev({ id, payload: { tool } });
  it('folds a run of routine events and leaves failures and boundaries standing', () => {
    const segs = foldRoutine([
      ok('1', 'run'),
      ok('2', 'run'),
      ev({ id: 's', event_type: 'skill_activation', payload: {} }),
      ok('3', 'edit_file'),
      ev({ id: 'x', status: 'error', payload: { tool: 'edit_file' } }),
      ok('4', 'read'),
      ok('5', 'read'),
      ev({ id: 'f', event_type: 'final_response' }),
    ]);
    expect(segs.map((s) => (s.kind === 'fold' ? `fold:${s.events.length}` : s.event.id))).toEqual([
      'fold:4',
      'x',
      // Two routine rows are cheaper to draw than a fold that hides them.
      '4',
      '5',
      'f',
    ]);
  });

  it('tallies a fold by tool, most-called first', () => {
    expect(toolTally([ok('1', 'run'), ok('2', 'read'), ok('3', 'run')])).toBe('run ×2 · read');
  });
});

describe('filterLedger', () => {
  const ledger = buildLedger(
    [
      ...failingTurn,
      ev({ id: 'ok', payload: { tool: 'read', thread_id: 'default:calm' } }),
      ev({
        id: 'deny',
        event_type: 'policy_deny',
        status: 'denied',
        payload: { tool: 'publish', control: 'approvals', thread_id: 'default:gated' },
      }),
    ],
    null,
  );

  it('chooses threads, so a failure keeps its turn around it', () => {
    const only = filterLedger(ledger, { failuresOnly: true, layer: 'any' });
    expect(only.map((t) => t.id).sort()).toEqual(['gated', 'thread-a']);
    // The whole turn comes with it, not the red row alone.
    expect(only.find((t) => t.id === 'thread-a')?.turns[0].events).toHaveLength(3);
  });

  it('narrows to threads holding a denial by one layer', () => {
    expect(
      filterLedger(ledger, { failuresOnly: false, layer: 'approvals' }).map((t) => t.id),
    ).toEqual(['gated']);
    expect(filterLedger(ledger, { failuresOnly: false, layer: 'limits' })).toEqual([]);
  });
});

describe('resolveWindow', () => {
  it('measures from the last visit when there is a recent one', () => {
    expect(resolveWindow('last', now, now - 3 * 60 * MIN)).toEqual({
      since: now - 3 * 60 * MIN,
      fellBack: false,
    });
  });

  it('falls back to a day, and says it did, with no visit or a stale one', () => {
    expect(resolveWindow('last', now, null)).toEqual({
      since: now - 24 * 60 * MIN,
      fellBack: true,
    });
    expect(resolveWindow('last', now, now - 40 * 24 * 60 * MIN).fellBack).toBe(true);
    expect(resolveWindow('7d', now, null)).toEqual({
      since: now - 7 * 24 * 60 * MIN,
      fellBack: false,
    });
  });
});

describe('money', () => {
  it('holds a column at cents, and does not round a real cost to nothing', () => {
    expect(money(60.771)).toBe('$60.77');
    expect(money(0.0781)).toBe('$0.08');
    expect(money(0.00252)).toBe('< $0.01');
    expect(money(0)).toBe('$0.00');
    expect(money(1234.5)).toBe('$1,234.50');
  });
});

describe('repricedRoutes', () => {
  it('names each route priced as another model once', () => {
    const row = (model_id: string, wire_model_id: string) =>
      ({ model_id, wire_model_id }) as Parameters<typeof repricedRoutes>[0][number];
    expect(
      repricedRoutes([
        row('sonnet', 'claude-sonnet-4-5'),
        row('sonnet', 'claude-sonnet-4-5'),
        row('haiku', 'haiku'),
      ]),
    ).toEqual([{ model: 'sonnet', wire: 'claude-sonnet-4-5' }]);
  });
});

describe('middleTruncate', () => {
  it('leaves an id that fits alone', () => {
    expect(middleTruncate('thread-abc', 20)).toBe('thread-abc');
  });

  it('keeps both ends of a long one, at exactly the budget', () => {
    const cut = middleTruncate('3f2a9c1e-7b4d-4e21-9a0c-a1b2c3d4e5f6', 20);
    expect(cut).toHaveLength(20);
    expect(cut.startsWith('3f2a9c1e')).toBe(true);
    expect(cut.endsWith('c3d4e5f6')).toBe(true);
  });
});

/* ------------------------------------------------------------------ page */

const wire = (e: AuditEvent) => {
  const { payload, ...rest } = e;
  return { ...rest, payload_json: payload };
};

function stubHarness({
  events,
  threads = [],
  threadsStatus = 200,
}: {
  events: AuditEvent[];
  threads?: UsageThreadItem[];
  threadsStatus?: number;
}) {
  const totals = {
    calls: 9,
    tokens_input: 30,
    tokens_output: 300,
    cache_creation: 0,
    cache_read: 0,
    cost_usd: 1.26,
  };
  const spy = vi.fn(async (input: unknown) => {
    const url = String(input);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.includes('/api/audit')) {
      const rows = events.map(wire);
      return json({ items: rows, events: rows, next_cursor: null });
    }
    if (url.includes('/api/usage/threads')) {
      return threadsStatus === 200
        ? json({ since_ms: 0, until_ms: now, items: threads, totals, truncated: false })
        : json({ detail: 'Not Found' }, threadsStatus);
    }
    if (url.includes('/api/usage/summary')) {
      return json({
        since_ms: 0,
        until_ms: now,
        items: [{ manifest_id: 'quick', model_id: 'sonnet', day: '2026-10-08', ...totals }],
        totals,
      });
    }
    if (url.includes('/api/usage')) return json({ items: [], next_cursor: null });
    return json({});
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

const auditCalls = (spy: ReturnType<typeof stubHarness>) =>
  spy.mock.calls.filter((c) => String(c[0]).includes('/api/audit')).length;

function mount() {
  const shell = {
    threads: [
      {
        id: 'thread-a',
        title: 'Changelog cleanup',
        manifest: 'quick',
        updatedAt: now,
        named: true,
      },
      { id: 'thread-b', title: 'Read the docs', manifest: 'quick', updatedAt: now, named: true },
    ],
  } as unknown as ShellValue;
  return render(
    <MemoryRouter initialEntries={['/harness/activity']}>
      <ShellProvider value={shell}>
        <ActivityLedger />
      </ShellProvider>
    </MemoryRouter>,
  );
}

const rowFor = (name: RegExp) =>
  screen.findByRole('button', { name, expanded: false } as Parameters<typeof screen.findByRole>[1]);

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the ledger page', () => {
  it('names each thread, what failed on it and what it cost, on one row', async () => {
    stubHarness({
      events: [
        ...failingTurn,
        ev({
          id: 'b1',
          ts: now - 2 * MIN,
          payload: { tool: 'read', thread_id: 'default:thread-b' },
        }),
      ],
      threads: [spend({ thread_id: 'default:thread-a', cost_usd: 1.2 })],
    });
    mount();

    const a = await rowFor(/Changelog cleanup/);
    // The failure in words: the tool and why, not a bare red dot.
    expect(a.textContent).toContain('edit_file bad arguments');
    expect(a.textContent).toContain('$1.20');
    expect(a.textContent).toContain('Failed');
    const b = await rowFor(/Read the docs/);
    expect(b.textContent).toContain('OK');
    // Newest activity first.
    const rows = document.querySelectorAll('[data-ledger-row]');
    expect(rows[0]).toBe(b);
    // The header and the account sentence both carry the failing count.
    expect(await screen.findAllByText('1 with failures', { selector: 'span' })).toHaveLength(2);
  });

  it('is one Tab stop, moved with the arrow keys, opened and closed from the keyboard', async () => {
    const user = userEvent.setup();
    stubHarness({
      events: [
        ...failingTurn,
        ev({
          id: 'b1',
          ts: now - 2 * MIN,
          payload: { tool: 'read', thread_id: 'default:thread-b' },
        }),
      ],
    });
    mount();
    await rowFor(/Changelog cleanup/);
    const rows = [...document.querySelectorAll<HTMLElement>('[data-ledger-row]')];
    expect(rows.map((r) => r.getAttribute('tabindex'))).toEqual(['0', '-1']);

    rows[0].focus();
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(rows[1]);

    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(rows[1].getAttribute('aria-expanded')).toBe('true'));
    // The turn reads as asked, then what was done, in order — the failed call
    // before the reply it spoiled.
    const heading = await screen.findByRole('heading', { name: 'fix the changelog' });
    const turn = heading.closest('section') as HTMLElement;
    const order = within(turn)
      .getAllByRole('button')
      .map((b) => b.textContent ?? '');
    expect(order[0]).toContain('edit_file');
    expect(order[1]).toContain('Assistant reply');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(rows[1].getAttribute('aria-expanded')).toBe('false'));
  });

  it('closes an open event with Escape and leaves its thread open', async () => {
    const user = userEvent.setup();
    stubHarness({ events: failingTurn });
    mount();
    const thread = await rowFor(/Changelog cleanup/);
    await user.click(thread);
    const turn = (await screen.findByRole('heading', { name: 'fix the changelog' })).closest(
      'section',
    ) as HTMLElement;
    const call = within(turn).getByRole('button', { name: /edit_file/ });
    await user.click(call);
    await waitFor(() => expect(call.getAttribute('aria-expanded')).toBe('true'));
    // The failed turn explains itself as one, now that it can be opened.
    const reply = within(turn).getByRole('button', { name: /Assistant reply/ });
    await user.click(reply);
    expect(await screen.findByText(/not cleanly/)).toBeTruthy();

    reply.focus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(reply.getAttribute('aria-expanded')).toBe('false'));
    expect(thread.getAttribute('aria-expanded')).toBe('true');
  });

  it('holds still while a thread is open, says so at the top, and catches up on close', async () => {
    const user = userEvent.setup();
    const spy = stubHarness({ events: failingTurn });
    mount();
    const thread = await rowFor(/Changelog cleanup/);
    await user.click(thread);
    expect(await screen.findByText(/Paused while a thread is open/)).toBeTruthy();
    const before = auditCalls(spy);
    await user.click(thread);
    await waitFor(() => expect(auditCalls(spy)).toBeGreaterThan(before));
    expect(screen.queryByText(/Paused while a thread is open/)).toBeNull();
  });

  it('asks for the window since the last visit, and says when there was none', async () => {
    const spy = stubHarness({ events: failingTurn });
    localStorage.setItem('felix.activity.lastVisit', String(now - 90 * MIN));
    mount();
    await rowFor(/Changelog cleanup/);
    const audit = spy.mock.calls.map((c) => String(c[0])).find((u) => u.includes('/api/audit'));
    expect(new URL(audit ?? '', 'http://x').searchParams.get('since')).toBe(String(now - 90 * MIN));
    expect(screen.getByText(/Since your last visit/)).toBeTruthy();

    cleanup();
    localStorage.clear();
    stubHarness({ events: failingTurn });
    mount();
    expect(await screen.findByText(/no earlier visit from this browser/)).toBeTruthy();
  });

  it('stamps the visit on the way out, so the next one measures from it', async () => {
    stubHarness({ events: failingTurn });
    const { unmount } = mount();
    await rowFor(/Changelog cleanup/);
    unmount();
    expect(Number(localStorage.getItem('felix.activity.lastVisit'))).toBeGreaterThanOrEqual(now);
  });

  it('on a harness with no spend per thread, shows no cost and says why', async () => {
    stubHarness({ events: failingTurn, threadsStatus: 404 });
    mount();
    const a = await rowFor(/Changelog cleanup/);
    expect(a.textContent).not.toMatch(/\$/);
    expect(await screen.findByText(/records spend without the thread it ran on/)).toBeTruthy();
    // The window's total still stands.
    expect(screen.getByRole('heading', { name: 'Where the spend went' })).toBeTruthy();
  });

  it('keeps the event row vocabulary: mono tool names, a receding turn frame, the payload', async () => {
    const user = userEvent.setup();
    stubHarness({ events: failingTurn });
    mount();
    await user.click(await rowFor(/Changelog cleanup/));
    const turn = (await screen.findByRole('heading', { name: 'fix the changelog' })).closest(
      'section',
    ) as HTMLElement;
    const tool = within(turn).getByText('edit_file', { selector: 'span' });
    expect(tool.className).toMatch(/font-mono/);
    expect(tool.className).toMatch(/text-state-failed/);
    // The frame recedes — regular weight, sans — even when it is the failed row.
    const frame = within(turn).getByText('Assistant reply', { selector: 'span' });
    expect(frame.className).not.toMatch(/font-medium|font-mono/);

    await user.click(within(turn).getByRole('button', { name: /edit_file/ }));
    const detail = await screen.findByText('Payload');
    expect(within(detail.parentElement as HTMLElement).getByText('error_code')).toBeTruthy();
  });
});
