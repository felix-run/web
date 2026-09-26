// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatElapsed,
  Inspector,
  inFlightTool,
  runState,
  threadTokens,
} from '../src/components/inspector/inspector';
import { ShellProvider, type ShellValue } from '../src/shell-context';

/**
 * The right rail is headed "This run", and two things keep that heading true.
 *
 * The readout above the tabs is derived from the shell alone, so it must state
 * the run's state in words (never colour alone), say so at rest, and never
 * present a partial token sum as the thread's total. And the Approvals tab is a
 * tenant-wide `/approvals` list, so it must not re-offer the approval the
 * transcript banner already owns — the banner came by frame and carries the diff
 * and the reason; a second Approve button here would be the weaker of two for
 * one call — while still passing the row's deadline to the cards it does draw.
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
    approvalQueue: [],
    bannerOwned: [],
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

describe('the approvals tab', () => {
  it('points at the banner for an approval the banner owns instead of re-offering it', async () => {
    stub([approval({ id: 'a1' }), approval({ id: 'a2', tool_name: 'local_shell', args: {} })]);
    mount({ bannerOwned: ['a1'] });

    await screen.findByRole('button', { name: 'Approve local_shell' });
    expect(screen.queryByRole('button', { name: 'Approve write_file' })).toBeNull();
    expect(screen.getByText(/deciding in the banner below the transcript/)).toBeTruthy();
    // One card, not two: the owned row costs a line, not a decision surface.
    expect(screen.getAllByRole('button', { name: 'Deny' })).toHaveLength(1);
  });

  it("passes the row's deadline, and the frame's reason when this tab saw one", async () => {
    stub([approval({ id: 'a2', expires_at: Date.now() + 90_000 })]);
    mount({
      approvalQueue: [
        {
          approvalId: 'a2',
          toolName: 'write_file',
          args: { path: 'notes.md' },
          reason: 'Confirm writes to the workspace',
        },
      ],
    });

    await screen.findByRole('button', { name: 'Approve write_file' });
    expect(screen.getByText(/Denied automatically in 1:(29|30)/)).toBeTruthy();
    expect(screen.getByText('Confirm writes to the workspace')).toBeTruthy();
  });

  it('says every tab is tenant-wide, because no route takes a thread filter', async () => {
    stub([]);
    mount();
    expect(await screen.findByText('All threads')).toBeTruthy();
  });
});

describe('the run readout', () => {
  it('states the resting case rather than rendering nothing', () => {
    stub([]);
    mount();
    const r = within(readout());
    expect(r.getByRole('status').textContent).toBe('Idle');
    expect(r.getByText('No run in this tab yet')).toBeTruthy();
    expect(r.getByText('None reported on this thread')).toBeTruthy();
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
    expect(threadTokens(turns)).toEqual({ input: 100, output: 20, reported: 1, floor: true });
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
