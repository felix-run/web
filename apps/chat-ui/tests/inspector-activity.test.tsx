/** @vitest-environment happy-dom */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Inspector } from '../src/components/inspector/inspector';

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
  return render(<Inspector open onClose={() => {}} skills={null} onSuggest={() => {}} />);
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
