// @vitest-environment happy-dom

import { formatElapsed } from '@felix/client';
import { TooltipProvider } from '@felix/ui/tooltip';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Inspector,
  inFlightTool,
  runState,
  threadTokens,
} from '../src/components/inspector/inspector';
import { ShellProvider, type ShellValue } from '../src/shell-context';

/**
 * The right rail's readout is headed "This run", and two things keep that heading true.
 *
 * The readout above the tabs is derived from the shell alone, so it must state
 * the run's state in words (never colour alone), say so at rest, and never
 * present a partial token sum as the thread's total. And it decides nothing: the
 * Approvals tab it used to carry drew a second live card for every approval the
 * attention line already offered, so one call had two Approve buttons and two
 * countdowns. Approvals are the attention line's and the banner's alone.
 */

const approval = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  tenant_id: 't',
  manifest_id: 'cowork',
  tool_name: 'write_file',
  call_signature: 'sig',
  args: { path: 'notes.md' },
  principal_subj: 'dev',
  status: 'pending',
  created_at: Date.now(),
  decided_at: null,
  decided_by: '',
  decision_note: '',
  edited_args: null,
  rule_id: 'workspace-write',
  ttl_seconds: 600,
  expires_at: Date.now() + 600_000,
  consumed_at: null,
  ...over,
});

function stub(rows: unknown[]) {
  const fn = vi.fn(async (input: unknown) =>
    String(input).includes('/approvals')
      ? new Response(JSON.stringify({ requests: rows }), { status: 200 })
      : new Response(JSON.stringify({}), { status: 200 }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

function shell(over: Partial<ShellValue> = {}): ShellValue {
  return {
    turns: [],
    streaming: false,
    reattaching: false,
    error: null,
    sessionPhase: null,
    skills: null,
    pending: null,
    queueLength: 0,
    runClock: { startedAt: null, endedAt: null },
    uiPrompt: null,
    threadId: 'here',
    threads: [],
    ...over,
  } as ShellValue;
}

function mount(over: Partial<ShellValue> = {}) {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <ShellProvider value={shell(over)}>
          <Inspector open onClose={() => {}} />
        </ShellProvider>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

const readout = () => screen.getByRole('region', { name: 'Run status' });

beforeEach(() => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the instrument and approvals', () => {
  it('offers no decision, and asks the harness for none, even with a call waiting', async () => {
    const fetch = stub([approval()]);
    mount();
    // Let any tab that mounted on open issue its first request.
    await screen.findByRole('tab', { name: 'Plans' });
    expect(screen.queryByRole('tab', { name: 'Approvals' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Approve/ })).toBeNull();
    expect(fetch.mock.calls.some(([url]) => String(url).includes('/approvals'))).toBe(false);
  });

  /**
   * Each part says its own scope. "This run" heads the readout; each tab's first
   * line says whose rows it lists. Changes comes first and open, because it reads
   * the transcript rather than the harness, so opening the rail asks for nothing.
   */
  it('opens on this thread’s changes, below the run and apart from it', async () => {
    const fetch = stub([]);
    mount();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Changes', 'Plans', 'Tools']);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    expect(readout().contains(screen.getByRole('tablist'))).toBe(false);
    expect(screen.getByRole('heading', { name: 'This run' })).toBeTruthy();
    expect(await screen.findByText('This thread · from its tool calls')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Harness' })).toBeNull();
    expect(fetch.mock.calls.some(([url]) => String(url).includes('/plans'))).toBe(false);
  });

  it('labels the tool metrics as every thread’s', async () => {
    stub([]);
    mount();
    await userEvent.click(screen.getByRole('tab', { name: 'Tools' }));
    expect(await screen.findByText('All threads · last 60 minutes')).toBeTruthy();
  });

  it('says why the tool metrics are empty on a thread that has run tools', async () => {
    stub([]);
    mount({
      turns: [
        {
          id: 't1',
          role: 'assistant',
          content: 'done',
          tools: [{ name: 'read_file', input: { path: 'a.md' }, done: true }],
        },
      ] as ShellValue['turns'],
    });
    await userEvent.click(screen.getByRole('tab', { name: 'Tools' }));
    expect(
      await screen.findByText('No tool calls on any thread in the last 60 minutes.'),
    ).toBeTruthy();
    expect(screen.queryByText(/Ask the agent to use a tool/)).toBeNull();
  });
});

describe('the run readout', () => {
  it('states the resting case rather than rendering nothing', () => {
    stub([]);
    mount();
    const r = within(readout());
    expect(r.getByRole('status').textContent).toBe('Idle');
    expect(r.getByText('No runs on this thread yet')).toBeTruthy();
    expect(r.getByText('None yet')).toBeTruthy();
  });

  /**
   * A thread opened from history, which this tab never ran.
   *
   * It used to say "No run in this tab yet" and "None reported on this thread"
   * above dozens of completed turns: true of the tab, and useless to someone
   * coming back to the thread. What the loaded history does say is quoted; what
   * it does not — a duration — is not invented.
   */
  it('reads a thread it never ran from the history it loaded', () => {
    stub([]);
    mount({
      threads: [
        { id: 'here', title: 'x', manifest: 'cowork', updatedAt: Date.now() - 2 * 86_400_000 },
      ],
      turns: [
        { id: 'u1', role: 'user', content: 'one' },
        { id: 'a1', role: 'assistant', content: 'answered', usage: { input: 1200, output: 80 } },
        { id: 'u2', role: 'user', content: 'two' },
        { id: 'a2', role: 'assistant', content: 'after tools', tools: [] },
      ] as ShellValue['turns'],
    });
    const r = within(readout());
    expect(r.getByText('2d ago')).toBeTruthy();
    expect(r.queryByText(/No run/)).toBeNull();
    expect(r.getByText('1,200')).toBeTruthy();
    expect(r.getByText('(floor)', { exact: false })).toBeTruthy();
  });

  it('says usage was not recorded rather than that there was none', () => {
    stub([]);
    mount({
      turns: [
        { id: 'u1', role: 'user', content: 'one' },
        { id: 'a1', role: 'assistant', content: 'durable answer' },
      ] as ShellValue['turns'],
    });
    const r = within(readout());
    expect(r.getByText('Not recorded for the turn here')).toBeTruthy();
    expect(r.getByText('Not run from this tab')).toBeTruthy();
  });

  it('shows a live run with the open tool and its target', () => {
    stub([]);
    mount({
      streaming: true,
      runClock: { startedAt: Date.now() - 65_000, endedAt: null },
      turns: [
        { id: 'u', role: 'user', content: 'go' },
        {
          id: 'a',
          role: 'assistant',
          content: '',
          tools: [
            { name: 'read_file', input: { path: 'a.md' }, done: true },
            { name: 'write_file', input: { path: 'notes.md', content: 'hello' }, done: false },
          ],
        },
      ] as ShellValue['turns'],
    });
    const r = within(readout());
    expect(r.getByRole('status').textContent).toBe('Running');
    expect(r.getByText('write_file')).toBeTruthy();
    expect(r.getByText('Write notes.md (5 chars)')).toBeTruthy();
    expect(r.getByText(/^1:0[56]$/)).toBeTruthy();
  });

  it('says waiting on you, in words, while an approval blocks the run', () => {
    stub([]);
    mount({
      streaming: true,
      pending: { approvalId: 'a1', toolName: 'local_shell', args: { command: 'ls' } },
    });
    const r = within(readout());
    expect(r.getByRole('status').textContent).toBe('Waiting on you');
    expect(r.getByText('Shell: ls')).toBeTruthy();
  });
});

describe('the readout helpers', () => {
  it('ranks blocked over running and failed only at rest', () => {
    const base = {
      pending: null,
      uiPrompt: null,
      streaming: false,
      reattaching: false,
      error: null,
    };
    expect(runState(base)).toBe('idle');
    expect(runState({ ...base, streaming: true, error: 'x' })).toBe('running');
    expect(runState({ ...base, error: 'x' })).toBe('failed');
    expect(runState({ ...base, streaming: true, reattaching: true })).toBe('rejoining');
    expect(
      runState({
        ...base,
        streaming: true,
        pending: { approvalId: 'a', toolName: 't', args: {} },
      }),
    ).toBe('blocked');
  });

  it('marks a token sum a floor when any assistant turn reported no usage', () => {
    const turns = [
      { id: '1', role: 'assistant', content: 'hydrated, no usage' },
      { id: '2', role: 'assistant', content: 'streamed', usage: { input: 100, output: 20 } },
    ] as ShellValue['turns'];
    expect(threadTokens(turns)).toEqual({
      input: 100,
      output: 20,
      reported: 1,
      missing: 1,
      floor: true,
    });
    expect(threadTokens(turns.slice(1)).floor).toBe(false);
  });

  it('names an unknown tool by its target argument, and nothing when it has none', () => {
    const open = (input: unknown) =>
      [
        { id: 'a', role: 'assistant', content: '', tools: [{ name: 'fetch', input, done: false }] },
      ] as ShellValue['turns'];
    expect(inFlightTool(open({ url: 'https://x.test' }))).toEqual({
      name: 'fetch',
      target: 'https://x.test',
    });
    expect(inFlightTool(open({ n: 1 }))).toEqual({ name: 'fetch', target: null });
    expect(inFlightTool([])).toBeNull();
  });

  it('formats elapsed time as a stopwatch', () => {
    expect(formatElapsed(42_400)).toBe('42s');
    expect(formatElapsed(187_000)).toBe('3:07');
    expect(formatElapsed(3_729_000)).toBe('1:02:09');
  });
});

/**
 * Plans are this thread's (`/plans?thread_id=`, felix-run/felix#463). A harness
 * older than that ignores the parameter and answers for the whole tenant, and
 * the only evidence either way is a `thread_id` on each row — so the line says
 * "This thread" when the rows prove it and "All threads" when they cannot.
 */
describe('the plans tab', () => {
  const plan = (id: string, thread?: string) => ({
    id,
    tenant_id: 'default',
    manifest_id: 'deep',
    ...(thread === undefined ? {} : { thread_id: thread }),
    created_at: 1,
    updated_at: 2,
    plan: { title: `Plan ${id}`, steps: [{ id: '1', title: 'Step', status: 'pending' }] },
  });
  const openPlans = () => userEvent.click(screen.getByRole('tab', { name: 'Plans' }));
  function stubPlans(rows: unknown[]) {
    const fn = vi.fn(async (input: unknown) =>
      String(input).includes('/plans')
        ? new Response(JSON.stringify({ items: rows }), { status: 200 })
        : new Response(JSON.stringify({}), { status: 200 }),
    );
    vi.stubGlobal('fetch', fn);
    return fn;
  }

  it('asks for this thread’s plans, by suffix', async () => {
    const fetch = stubPlans([]);
    mount({ threadId: 'here' });
    await openPlans();
    await screen.findByText(/No plans on this thread/);
    const url = String(fetch.mock.calls.find(([u]) => String(u).includes('/plans'))?.[0]);
    expect(new URL(url, 'http://x').searchParams.get('thread_id')).toBe('here');
  });

  it('says "This thread" when every row names it', async () => {
    stubPlans([plan('p1', 'default:here')]);
    mount({ threadId: 'here' });
    await openPlans();
    expect(await screen.findByText('This thread · newest 25')).toBeTruthy();
    expect(screen.getByText('Plan p1')).toBeTruthy();
  });

  it('says "All threads" when the harness did not filter', async () => {
    // An older harness: no `thread_id` on the rows, and the list is the tenant's.
    stubPlans([plan('p1'), plan('p2')]);
    mount({ threadId: 'here' });
    await openPlans();
    expect(await screen.findByText('All threads · newest 25')).toBeTruthy();
  });
});
