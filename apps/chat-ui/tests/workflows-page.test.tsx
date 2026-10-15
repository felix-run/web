/** @vitest-environment happy-dom */

import { TooltipProvider } from '@felix/ui/tooltip';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Workflows page against a mocked API: the list, a workflow's definition with its problems, a
 * run's states on the same nodes with the waiting approval decided in place, and Run now — which
 * must start the revision on screen and say what the harness refused, in its own terms.
 */

beforeAll(() => {
  // React Flow measures nodes; happy-dom has no ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);
beforeEach(() => {
  vi.resetModules();
});

const port = (name: string, over: Record<string, unknown> = {}) => ({
  name,
  type: 'string',
  schema: { type: 'string' },
  control: false,
  required: false,
  ...over,
});

const WORKFLOW = {
  id: 'triage',
  version: 3,
  revision: 'g1.3',
  created_at: 1,
  updated_at: Date.now() - 60_000,
  updated_by: 'ops',
  definition: {
    name: 'Triage issue',
    inputs: { issue: { type: 'string' }, priority: { type: 'integer' } },
    steps: [
      {
        id: 'classify',
        kind: 'agent_turn',
        config: { manifest: 'quick', prompt: 'Label {{ issue }}' },
      },
      { id: 'approve', kind: 'approval', config: { prompt: 'Ship it?' } },
    ],
    edges: [
      { source: { step: 'trigger', port: 'issue' }, target: { step: 'classify', port: 'issue' } },
      { source: { step: 'classify', port: 'text' }, target: { step: 'approve', port: 'payload' } },
    ],
  },
  ports: {
    trigger: { inputs: [], outputs: [port('issue'), port('priority', { type: 'integer' })] },
    classify: { inputs: [port('issue', { required: true })], outputs: [port('text')] },
    approve: {
      inputs: [port('payload', { type: 'any', schema: {} })],
      outputs: [port('approved', { control: true }), port('denied', { control: true })],
    },
  },
  problems: [] as { code: string; message: string; step?: string }[],
};

const RUN = {
  id: 'run0123456789abcdef0123456789ab',
  workflow_id: 'triage',
  revision: 'g1.3',
  status: 'waiting',
  trigger: 'manual',
  started_by: 'ops',
  fiber_id: 'f',
  error: '',
  expires_at: Date.now() + 3600_000,
  version: 4,
  created_at: Date.now() - 30_000,
  updated_at: Date.now(),
  finished_at: null,
  inputs: { issue: 'crash' },
  untrusted_inputs: [],
  steps: {
    classify: {
      status: 'completed',
      inputs: { issue: 'crash' },
      outputs: { text: 'a bug' },
      thread_id: 'default:workflow:r:classify',
    },
    approve: { status: 'waiting', approval_id: 'appr-1', inputs: { payload: 'a bug' } },
  },
};

/** The classify step's child run, as `GET …/steps/classify/thread` answers it. */
const TRANSCRIPT = {
  transcript: [
    { id: 'e1', seq: 1, kind: 'message', role: 'user', content: 'Label crash' },
    { id: 'e2', seq: 2, kind: 'message', role: 'assistant', content: 'Looks like a bug.' },
  ],
};

const APPROVAL = {
  id: 'appr-1',
  tenant_id: 'default',
  manifest_id: '',
  tool_name: 'workflow:triage.approve',
  call_signature: 'run:approve',
  args: { payload: 'a bug' },
  principal_subj: 'ops',
  status: 'pending',
  created_at: Date.now(),
  decided_at: null,
  decided_by: '',
  decision_note: '',
  edited_args: null,
  rule_id: '',
  ttl_seconds: 600,
  expires_at: Date.now() + 600_000,
  consumed_at: null,
  reason: 'Ship it?',
};

/**
 * A node by its step id. React Flow hides nodes until it has measured them, and happy-dom measures
 * nothing, so they are found by the flow's own test id and checked by the label a reader hears.
 */
async function node(id: string): Promise<HTMLElement> {
  return screen.findByTestId(`rf__node-${id}`);
}

async function page(
  address: string,
  opts: {
    workflow?: unknown;
    startWorkflowRun?: (...a: unknown[]) => Promise<unknown>;
    getWorkflowRun?: (...a: unknown[]) => Promise<unknown>;
    getWorkflowStepThread?: (...a: unknown[]) => Promise<unknown>;
    runs?: unknown[];
  } = {},
) {
  const decideApproval = vi.fn().mockResolvedValue({});
  const startWorkflowRun = vi.fn(opts.startWorkflowRun ?? (() => Promise.resolve(RUN)));
  const api = await vi.importActual<typeof import('../src/api')>('../src/api');
  vi.doMock('../src/api', () => ({
    WorkflowRouteError: api.WorkflowRouteError,
    listWorkflows: vi.fn().mockResolvedValue([
      {
        id: 'triage',
        name: 'Triage issue',
        description: 'Label and route new issues',
        version: 3,
        revision: 'g1.3',
        step_count: 2,
        updated_at: Date.now(),
        updated_by: 'ops',
      },
    ]),
    getWorkflow: vi.fn().mockResolvedValue(opts.workflow ?? WORKFLOW),
    listWorkflowRuns: vi
      .fn()
      .mockResolvedValue(
        opts.runs ?? [{ ...RUN, step_statuses: { classify: 'completed', approve: 'waiting' } }],
      ),
    getWorkflowRun: vi.fn(opts.getWorkflowRun ?? (() => Promise.resolve(RUN))),
    startWorkflowRun,
    getWorkflowStepThread: vi.fn(opts.getWorkflowStepThread ?? (() => Promise.resolve(TRANSCRIPT))),
    cancelWorkflowRun: vi.fn().mockResolvedValue({ ...RUN, status: 'cancelling' }),
    decideApproval,
  }));
  const shell = await import('../src/shell-context');
  const markDecided = vi.fn();
  vi.spyOn(shell, 'useOptionalShell').mockReturnValue({
    tenantApprovals: { pending: [APPROVAL], markDecided, refresh: vi.fn() },
  } as never);
  const { WorkflowsPage } = await import('../src/components/workflows/workflows-page');
  const getRun = (await import('../src/api')).getWorkflowRun as ReturnType<typeof vi.fn>;
  render(
    // The app's root provides tooltips; a transcript's turns use them.
    <TooltipProvider>
      <MemoryRouter initialEntries={[address]}>
        <WorkflowsPage />
      </MemoryRouter>
    </TooltipProvider>,
  );
  const getThread = (await import('../src/api')).getWorkflowStepThread as ReturnType<typeof vi.fn>;
  return { decideApproval, startWorkflowRun, markDecided, getRun, getThread };
}

describe('the list', () => {
  it('lists each workflow with its id, size and who saved it, linked to its graph', async () => {
    await page('/harness/workflows');
    const link = await screen.findByRole('link', { name: /Triage issue/ });
    expect(link.getAttribute('href')).toContain('workflow=triage');
    expect(link.textContent).toContain('2 steps');
    expect(screen.getByText('1 workflow')).toBeTruthy();
  });
});

describe('the definition', () => {
  it('draws every step with its ports, and lists the problems that stop it running', async () => {
    const broken = {
      ...WORKFLOW,
      problems: [
        { code: 'unconnected_input', message: 'classify.issue is not connected', step: 'classify' },
      ],
    };
    await page('/harness/workflows?workflow=triage', { workflow: broken });
    const classify = await node('classify');
    expect(classify.getAttribute('aria-label')).toBe('classify, agent turn, 1 problem');
    expect(within(classify).getByText('quick')).toBeTruthy();
    expect(screen.getByText('classify.issue is not connected')).toBeTruthy();
    // A workflow with problems cannot be run from here, and says why where a reader can reach it.
    const runNow = screen.getByRole('button', { name: /Run now/ });
    expect(runNow.getAttribute('aria-disabled')).toBe('true');
    const reason = document.getElementById(runNow.getAttribute('aria-describedby') ?? '');
    expect(reason?.textContent).toContain('Fix 1 problem first');
    fireEvent.click(runNow);
    expect(screen.queryByRole('button', { name: /Start run/ })).toBeNull();
    // Only the count is the failed chip; the name stays neutral.
    // The node's chip and the header's value: both in words.
    expect(screen.getAllByText('1 problem')).toHaveLength(2);
  });
});

describe('a run', () => {
  it('puts each step state on its node and decides the waiting approval in place', async () => {
    const { decideApproval, markDecided } = await page(
      '/harness/workflows?workflow=triage&view=run',
    );
    await waitFor(async () =>
      expect((await node('classify')).getAttribute('aria-label')).toBe(
        'classify, agent turn, status completed',
      ),
    );
    expect((await node('approve')).getAttribute('aria-label')).toBe(
      'approve, approval, status waiting',
    );
    // The run readout and the gate: amber is a person being asked.
    expect(screen.getAllByText('Waiting on you').length).toBeGreaterThan(0);
    fireEvent.click(await screen.findByRole('button', { name: /^Approve/ }));
    await waitFor(() =>
      expect(decideApproval).toHaveBeenCalledWith('appr-1', { status: 'approved' }),
    );
    expect(markDecided).toHaveBeenCalledWith('appr-1');
  });

  it('shows what a selected step received and produced, and its transcript', async () => {
    const { getThread } = await page('/harness/workflows?workflow=triage&view=run');
    await waitFor(async () =>
      expect((await node('classify')).getAttribute('aria-label')).toContain('status'),
    );
    fireEvent.click(await node('classify'));
    expect(await screen.findByText('Received')).toBeTruthy();
    expect(screen.getByText('Produced')).toBeTruthy();
    // Read under the run, by step: no chat route can open a step's thread.
    expect(await screen.findByText('Looks like a bug.')).toBeTruthy();
    expect(screen.getByText('Label crash')).toBeTruthy();
    expect(getThread).toHaveBeenCalledWith('triage', RUN.id, 'classify');
  });

  it('says a step has nothing to read yet rather than failing', async () => {
    const api = await vi.importActual<typeof import('../src/api')>('../src/api');
    await page('/harness/workflows?workflow=triage&view=run', {
      getWorkflowStepThread: () =>
        Promise.reject(new api.WorkflowRouteError(404, 'not_found', 'not_found')),
    });
    await waitFor(async () =>
      expect((await node('classify')).getAttribute('aria-label')).toContain('status'),
    );
    fireEvent.click(await node('classify'));
    expect(await screen.findByText('Nothing in it yet.')).toBeTruthy();
  });
});

describe('Run now', () => {
  it('builds a field per input and starts the revision on screen with typed values', async () => {
    const { startWorkflowRun } = await page('/harness/workflows?workflow=triage');
    fireEvent.click(await screen.findByRole('button', { name: /Run now/ }));
    fireEvent.change(screen.getByRole('textbox', { name: /issue/ }), {
      target: { value: 'App crashes' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /priority/ }), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /Start run/ }));
    await waitFor(() =>
      expect(startWorkflowRun).toHaveBeenCalledWith(
        'triage',
        { issue: 'App crashes', priority: 2 },
        'g1.3',
      ),
    );
  });

  it('refuses a value that is not what the input declares, before asking the harness', async () => {
    const { startWorkflowRun } = await page('/harness/workflows?workflow=triage');
    fireEvent.click(await screen.findByRole('button', { name: /Run now/ }));
    fireEvent.change(screen.getByRole('textbox', { name: /priority/ }), {
      target: { value: '2.5' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Start run/ }));
    expect(await screen.findByText('Expected a whole number.')).toBeTruthy();
    expect(startWorkflowRun).not.toHaveBeenCalled();
  });

  it('says a co-author saved since, in words, when the harness answers workflow_changed', async () => {
    const api = await vi.importActual<typeof import('../src/api')>('../src/api');
    await page('/harness/workflows?workflow=triage', {
      startWorkflowRun: () =>
        Promise.reject(
          new api.WorkflowRouteError(412, 'workflow_changed', { error: 'workflow_changed' }),
        ),
    });
    fireEvent.click(await screen.findByRole('button', { name: /Run now/ }));
    fireEvent.change(screen.getByRole('textbox', { name: /priority/ }), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /Start run/ }));
    expect(await screen.findByText(/was saved again since this page loaded it/)).toBeTruthy();
  });
});

describe('keyboard and links', () => {
  it('opens a step in the inspector when it is selected with Enter, not only clicked', async () => {
    await page('/harness/workflows?workflow=triage');
    const classify = await node('classify');
    classify.focus();
    fireEvent.keyDown(classify, { key: 'Enter' });
    expect(await screen.findByText('Label {{ issue }}')).toBeTruthy();
  });

  it('keeps the agent the harness pages are looking at across its links', async () => {
    await page('/harness/workflows?agent=cowork');
    const link = await screen.findByRole('link', { name: /Triage issue/ });
    expect(link.getAttribute('href')).toContain('agent=cowork');
  });
});

describe('a run that is not there', () => {
  it('stops asking for it after the harness says it is gone', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const api = await vi.importActual<typeof import('../src/api')>('../src/api');
      const { getRun } = await page('/harness/workflows?workflow=triage&view=run&run=gone', {
        getWorkflowRun: () =>
          Promise.reject(new api.WorkflowRouteError(404, 'not_found', 'not_found')),
      });
      await waitFor(() => expect(getRun).toHaveBeenCalled());
      const asked = getRun.mock.calls.length;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(getRun.mock.calls.length).toBe(asked);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Run now and a choice', () => {
  it('refuses a case nobody chose rather than send the empty string', async () => {
    const workflow = {
      ...WORKFLOW,
      definition: {
        ...WORKFLOW.definition,
        inputs: { kind: { type: 'string', enum: ['bug', 'feature'] } },
      },
    };
    const { startWorkflowRun } = await page('/harness/workflows?workflow=triage', { workflow });
    fireEvent.click(await screen.findByRole('button', { name: /Run now/ }));
    fireEvent.click(screen.getByRole('button', { name: /Start run/ }));
    expect(await screen.findByText('Expected one of bug, feature.')).toBeTruthy();
    expect(startWorkflowRun).not.toHaveBeenCalled();
  });
});
