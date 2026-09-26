/** @vitest-environment happy-dom */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivitySection } from '../src/components/harness/ledger';

/**
 * The Activity feed's keyboard path and its drill-down.
 *
 * Both exist because of the same gap: the rows used to be `<li>` elements with no
 * control in them, so tabbing through the inspector skipped the entire list and
 * landed on the next section header. The feed was mouse-only, and a payload could
 * not be reached at all — the summary line clamped at two lines and stopped there.
 *
 * These assertions are about roles and wiring rather than appearance, because that
 * is the half that breaks silently. A row that stops being a `<button>` still looks
 * exactly like a row.
 */

const auditRow = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  tenant_id: 'default',
  ts: 1787634970831,
  event_type: 'tool_call',
  manifest_id: 'quick',
  principal_subj: 'local-dev',
  status: 'ok',
  payload_json: { tool: 'read_file', tool_call_id: 'tc1' },
  ...over,
});

/** Routes by path so Activity and Approvals can both poll without fighting. */
function stubHarness(events: unknown[]) {
  const spy = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('/api/audit')) {
      return new Response(JSON.stringify({ items: events, events, next_cursor: null }), {
        status: 200,
      });
    }
    return new Response(JSON.stringify({ items: [], requests: [] }), { status: 200 });
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

function renderInspector() {
  // The feed is a `/harness/ledger` half now rather than an inspector row, so this
  // mounts the section itself. `open` is the disclosure state it still carries for
  // the inspector's sake; the keyboard path under test is the same either way.
  return render(<ActivitySection enabled open onToggle={() => {}} />);
}

/** The audit calls only — Approvals polls on its own schedule and would skew a count. */
const auditCalls = (spy: ReturnType<typeof stubHarness>) =>
  spy.mock.calls.filter((c) => String(c[0]).includes('/api/audit')).length;

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Activity rows', () => {
  it('puts every row in the tab order as a real button', async () => {
    stubHarness([auditRow(), auditRow({ id: 'a2', payload_json: { tool: 'shell' } })]);
    renderInspector();

    const rows = await screen.findAllByRole('button', { name: /read_file|shell/ });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      // Native <button> is what buys Enter and Space without reimplementing them,
      // and what keeps the row in the tab order without a tabindex.
      expect(row.tagName).toBe('BUTTON');
      expect(row.hasAttribute('disabled')).toBe(false);
      expect(row.getAttribute('tabindex')).not.toBe('-1');
    }
  });

  it('reaches a row by keyboard alone and opens it with Enter', async () => {
    const user = userEvent.setup();
    stubHarness([auditRow()]);
    renderInspector();

    const row = await screen.findByRole('button', { name: /read_file/ });
    expect(row.getAttribute('aria-expanded')).toBe('false');

    row.focus();
    expect(document.activeElement).toBe(row);

    await user.keyboard('{Enter}');
    await waitFor(() => expect(row.getAttribute('aria-expanded')).toBe('true'));
  });

  it('shows the payload the collapsed row has no room for', async () => {
    const user = userEvent.setup();
    stubHarness([auditRow()]);
    renderInspector();

    const row = await screen.findByRole('button', { name: /read_file/ });
    await user.click(row);

    // The payload the rename recovered, plus the row metadata that never had
    // anywhere to render.
    const detail = await screen.findByText('Payload');
    const pane = detail.parentElement as HTMLElement;
    expect(within(pane).getByText('tool_call_id')).toBeTruthy();
    expect(within(pane).getByText('tc1')).toBeTruthy();
    expect(within(pane).getByText('local-dev')).toBeTruthy();
    expect(within(pane).getByText('a1')).toBeTruthy();
  });

  it('says so when the harness recorded no payload, rather than showing an empty pane', async () => {
    const user = userEvent.setup();
    stubHarness([auditRow({ payload_json: {} })]);
    renderInspector();

    await user.click(await screen.findByRole('button', { name: /Tool call/ }));
    expect(await screen.findByText(/No payload recorded/)).toBeTruthy();
  });

  it('opens one row at a time', async () => {
    const user = userEvent.setup();
    stubHarness([auditRow(), auditRow({ id: 'a2', payload_json: { tool: 'shell' } })]);
    renderInspector();

    const first = await screen.findByRole('button', { name: /read_file/ });
    const second = await screen.findByRole('button', { name: /shell/ });

    await user.click(first);
    await waitFor(() => expect(first.getAttribute('aria-expanded')).toBe('true'));

    await user.click(second);
    await waitFor(() => expect(second.getAttribute('aria-expanded')).toBe('true'));
    expect(first.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('Activity polling while a row is open', () => {
  it('holds the list still, says it is holding, and refetches on close', async () => {
    const user = userEvent.setup();
    const spy = stubHarness([auditRow()]);
    renderInspector();

    const row = await screen.findByRole('button', { name: /read_file/ });
    const before = auditCalls(spy);

    await user.click(row);
    await waitFor(() => expect(row.getAttribute('aria-expanded')).toBe('true'));

    // A list that quietly stops updating looks like a harness that stopped working.
    expect(screen.getByText(/Paused while a row is open/)).toBeTruthy();

    await user.click(row);
    await waitFor(() => expect(auditCalls(spy)).toBeGreaterThan(before));
    expect(screen.queryByText(/Paused while a row is open/)).toBeNull();
  });

  it('closes the drill-down when the filter changes the list underneath it', async () => {
    const user = userEvent.setup();
    stubHarness([
      auditRow(),
      auditRow({ id: 'a2', status: 'error', payload_json: { tool: 'shell' } }),
    ]);
    renderInspector();

    const row = await screen.findByRole('button', { name: /read_file/ });
    await user.click(row);
    await waitFor(() => expect(row.getAttribute('aria-expanded')).toBe('true'));
    // Asserted before the filter click so the check below cannot pass vacuously by
    // never having opened anything in the first place.
    expect(screen.getByText(/Paused while a row is open/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Failures only' }));

    // Otherwise the open row unmounts with `openId` still set: nothing looks
    // expanded and the poll never resumes.
    await waitFor(() => expect(screen.queryByText(/Paused while a row is open/)).toBeNull());
  });
});

/**
 * Which layer refused a call.
 *
 * Every wrapper deny is one `policy_deny`, and until the harness stamped
 * `payload.control` on the row the layer was a Prometheus question. The row
 * carries it now; the feed says it next to the tool, and the filter over the
 * window finds it. The filter is pinned through the pure function rather than
 * the select, because a Radix select in a DOM that lays nothing out proves
 * nothing about the filter and everything about the DOM.
 */
describe('a denial says which layer refused it', () => {
  it('names the layer on the row when the harness recorded it', async () => {
    stubHarness([
      auditRow({
        id: 'd1',
        event_type: 'policy_deny',
        status: 'denied',
        payload_json: { tool: 'write_file', tool_call_id: 'tc9', control: 'approvals' },
      }),
    ]);
    renderInspector();

    const row = await screen.findByRole('button', { name: /write_file/ });
    expect(row.textContent).toMatch(/by an approval/);
  });

  it('says nothing about the layer on a row from a harness that did not stamp it', async () => {
    stubHarness([
      auditRow({
        id: 'd2',
        event_type: 'policy_deny',
        status: 'denied',
        payload_json: { tool: 'write_file', tool_call_id: 'tc9' },
      }),
    ]);
    renderInspector();

    const row = await screen.findByRole('button', { name: /write_file/ });
    expect(row.textContent).not.toMatch(/\bby\b/);
  });

  it('filters the window to denials by one layer, and only denials', async () => {
    const { filterActivity } = await import('../src/components/harness/ledger');
    const rows = [
      auditRow({ id: 'ok', payload_json: { tool: 'read_file', control: 'approvals' } }),
      auditRow({
        id: 'd1',
        event_type: 'policy_deny',
        status: 'denied',
        payload_json: { tool: 'write_file', control: 'approvals' },
      }),
      auditRow({
        id: 'd2',
        event_type: 'policy_deny',
        status: 'denied',
        payload_json: { tool: 'shell', control: 'command' },
      }),
      auditRow({ id: 'd3', event_type: 'policy_deny', status: 'denied', payload_json: {} }),
    ].map((r) => ({ ...r, payload: r.payload_json }));

    const by = (layer: string) =>
      filterActivity(rows, { failuresOnly: false, layer }).map((e) => e.id);
    expect(by('approvals')).toEqual(['d1']);
    expect(by('command')).toEqual(['d2']);
    // No filter keeps everything, including the unstamped denial.
    expect(by('any')).toEqual(['ok', 'd1', 'd2', 'd3']);
    // Both filters compose; a `tool_call` that mentions a layer is not a denial.
    expect(
      filterActivity(rows, { failuresOnly: true, layer: 'approvals' }).map((e) => e.id),
    ).toEqual(['d1']);
  });
});

describe('the row and the window, read at a glance', () => {
  it('sets the tool name in mono and carries the thread beside it', async () => {
    stubHarness([
      auditRow({ payload_json: { tool: 'read_file', thread_id: 'default:thread-abc' } }),
    ]);
    renderInspector();

    const row = await screen.findByRole('button', { name: /read_file/ });
    // A tool name is a quotation of the harness (the Provenance Rule).
    expect(within(row).getByText('read_file').className).toContain('font-mono');
    // The suffix, never `{tenant}:{suffix}`.
    expect(within(row).getByText('thread-abc')).toBeTruthy();
    expect(row.textContent).not.toContain('default:');
  });

  it('counts the window and its failures, and says how to reach the rows it cut', async () => {
    const events = Array.from({ length: 13 }, (_, i) =>
      auditRow({ id: `e${i}`, status: i === 0 ? 'error' : 'ok' }),
    );
    stubHarness(events);
    renderInspector();

    expect(await screen.findByText('13 events · 1 failed')).toBeTruthy();
    expect(
      screen.getByText('Newest 12 of the last 13 events. The filters search all 13.'),
    ).toBeTruthy();
    // The phrasing it replaced said "recent" twice and nothing about the rest.
    expect(document.body.textContent).not.toMatch(/recent events/);
  });
});
