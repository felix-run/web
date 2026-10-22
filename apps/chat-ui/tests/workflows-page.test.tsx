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

const KINDS = [
  { name: 'agent_turn', label: 'Agent turn', config_schema: {} },
  { name: 'tool_call', label: 'Tool call', config_schema: {} },
  { name: 'approval', label: 'Approval gate', config_schema: {} },
  { name: 'branch', label: 'Branch', config_schema: {} },
];

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
    watchWorkflowRun?: (...a: unknown[]) => Promise<unknown>;
    checkWorkflow?: (...a: unknown[]) => Promise<unknown>;
    saveWorkflow?: (...a: unknown[]) => Promise<unknown>;
    listWorkflowTools?: (...a: unknown[]) => Promise<unknown>;
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
    // A live stream by default: the run as it stands, then open until the page lets it go.
    watchWorkflowRun: vi.fn(
      opts.watchWorkflowRun ??
        ((_id: unknown, _run: unknown, o: unknown) => {
          const { signal, onRun } = o as { signal: AbortSignal; onRun: (r: unknown) => void };
          onRun(RUN);
          return new Promise((resolve) => signal.addEventListener('abort', () => resolve(false)));
        }),
    ),
    startWorkflowRun,
    getWorkflowStepThread: vi.fn(opts.getWorkflowStepThread ?? (() => Promise.resolve(TRANSCRIPT))),
    cancelWorkflowRun: vi.fn().mockResolvedValue({ ...RUN, status: 'cancelling' }),
    decideApproval,
    listWorkflowKinds: vi.fn().mockResolvedValue(KINDS),
    listWorkflowTools: vi.fn(opts.listWorkflowTools ?? (() => Promise.resolve([]))),
    checkWorkflow: vi.fn(
      opts.checkWorkflow ??
        (() => Promise.resolve({ ports: WORKFLOW.ports, problems: WORKFLOW.problems })),
    ),
    saveWorkflow: vi.fn(opts.saveWorkflow ?? (() => Promise.resolve(WORKFLOW))),
    deleteWorkflow: vi.fn().mockResolvedValue(undefined),
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
  const mocked = await import('../src/api');
  return {
    decideApproval,
    startWorkflowRun,
    markDecided,
    getRun,
    getThread,
    saveWorkflow: mocked.saveWorkflow as ReturnType<typeof vi.fn>,
    watch: mocked.watchWorkflowRun as ReturnType<typeof vi.fn>,
    checkWorkflow: mocked.checkWorkflow as ReturnType<typeof vi.fn>,
  };
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
      expect(screen.getByText(/This run is not there/)).toBeTruthy();
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

/** Open a Radix select from the keyboard and pick an option by its text. */
async function choose(trigger: HTMLElement, option: RegExp) {
  fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: option }));
}

describe('the editor', () => {
  it('adds a step from the palette, selects it, and saves over the revision it started from', async () => {
    const { saveWorkflow, checkWorkflow } = await page('/harness/workflows?workflow=triage');
    fireEvent.click(await screen.findByRole('button', { name: 'Approval gate' }));
    // The new step is open in the inspector, and the draft goes to the harness to be checked.
    expect(await screen.findByDisplayValue('approve_2')).toBeTruthy();
    await waitFor(() => expect(checkWorkflow).toHaveBeenCalled());
    expect(screen.getByText('Unsaved')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(saveWorkflow).toHaveBeenCalled());
    const [id, def, precondition] = saveWorkflow.mock.calls[0];
    expect(id).toBe('triage');
    expect(precondition).toEqual({ revision: 'g1.3' });
    expect(def.steps.map((s: { id: string }) => s.id)).toEqual([
      'classify',
      'approve',
      'approve_2',
    ]);
    // Every node is saved where it was drawn, so the next load draws the same graph.
    expect(def.trigger_position).toBeTruthy();
    expect(def.steps.every((s: { position?: unknown }) => s.position)).toBe(true);
  });

  it('saves on ⌘S', async () => {
    const { saveWorkflow } = await page('/harness/workflows?workflow=triage');
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Triage, faster' } });
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    await waitFor(() => expect(saveWorkflow).toHaveBeenCalled());
    expect(saveWorkflow.mock.calls[0][1].name).toBe('Triage, faster');
  });

  it('wires a port from the keyboard, and refuses one whose types the harness says cannot meet', async () => {
    const mismatch = {
      code: 'type_mismatch',
      message: 'integer cannot feed string',
      step: 'classify',
      port: 'issue',
    };
    const { checkWorkflow } = await page('/harness/workflows?workflow=triage', {
      checkWorkflow: (def) =>
        Promise.resolve({
          ports: WORKFLOW.ports,
          problems: (def as { edges: { source: { port: string } }[] }).edges.some(
            (e) => e.source.port === 'priority',
          )
            ? [mismatch]
            : [],
        }),
    });
    await waitFor(async () => expect(await node('classify')).toBeTruthy());
    fireEvent.click(await node('classify'));
    await choose(await screen.findByRole('combobox', { name: 'Connect issue from' }), /priority/);
    expect(await screen.findByRole('status')).toHaveProperty(
      'textContent',
      expect.stringContaining('integer cannot feed string'),
    );
    // Refused, so nothing changed: there is nothing to save.
    expect(screen.queryByText('Unsaved')).toBeNull();
    expect(checkWorkflow).toHaveBeenCalledTimes(1);
  });

  it('removes a deleted step with the wires into and out of it', async () => {
    const { saveWorkflow } = await page('/harness/workflows?workflow=triage');
    fireEvent.click(await node('classify'));
    fireEvent.click(await screen.findByRole('button', { name: /Delete step/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(saveWorkflow).toHaveBeenCalled());
    const def = saveWorkflow.mock.calls[0][1];
    expect(def.steps.map((s: { id: string }) => s.id)).toEqual(['approve']);
    expect(def.edges).toEqual([]);
  });

  it('shows what a save that lost would throw away, and keeps mine over the winner', async () => {
    const api = await vi.importActual<typeof import('../src/api')>('../src/api');
    const theirs = {
      ...WORKFLOW,
      revision: 'g1.4',
      updated_by: 'bea',
      definition: { ...WORKFLOW.definition, name: 'Triage v2' },
    };
    let calls = 0;
    const { saveWorkflow } = await page('/harness/workflows?workflow=triage', {
      saveWorkflow: () =>
        calls++ === 0
          ? Promise.reject(
              new api.WorkflowRouteError(412, 'workflow_changed', {
                error: 'workflow_changed',
                current: theirs,
              }),
            )
          : Promise.resolve({ ...theirs, revision: 'g1.5' }),
    });
    fireEvent.change(await screen.findByLabelText('Description'), {
      target: { value: 'Mine' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    const notice = await screen.findByRole('alert');
    expect(notice.textContent).toContain('Saved elsewhere since you started');
    expect(notice.textContent).toContain('bea');
    expect(notice.textContent).toContain('Name: yours “Triage issue”, theirs “Triage v2”.');
    fireEvent.click(within(notice).getByRole('button', { name: 'Keep mine' }));
    await waitFor(() => expect(saveWorkflow).toHaveBeenCalledTimes(2));
    expect(saveWorkflow.mock.calls[1][2]).toEqual({ revision: 'g1.4' });
    expect(saveWorkflow.mock.calls[1][1].description).toBe('Mine');
  });

  it('takes theirs: the draft goes, and the winner is what is drawn', async () => {
    const api = await vi.importActual<typeof import('../src/api')>('../src/api');
    const theirs = {
      ...WORKFLOW,
      revision: 'g1.4',
      updated_at: Date.now(),
      definition: { ...WORKFLOW.definition, name: 'Triage v2' },
    };
    await page('/harness/workflows?workflow=triage', {
      saveWorkflow: () =>
        Promise.reject(
          new api.WorkflowRouteError(412, 'workflow_changed', {
            error: 'workflow_changed',
            current: theirs,
          }),
        ),
    });
    fireEvent.change(await screen.findByLabelText('Description'), { target: { value: 'Mine' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Take theirs' }));
    expect(await screen.findByDisplayValue('Triage v2')).toBeTruthy();
    expect(screen.queryByText('Unsaved')).toBeNull();
  });
});

describe('the editor, typing', () => {
  it('keeps edits made while a save is in flight, as a draft over what was saved', async () => {
    let finish: (v: unknown) => void = () => {};
    const { saveWorkflow } = await page('/harness/workflows?workflow=triage', {
      saveWorkflow: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    fireEvent.change(await screen.findByLabelText('Description'), { target: { value: 'One' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(saveWorkflow).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'One, then two' } });
    finish({ ...WORKFLOW, revision: 'g1.4', updated_at: Date.now() });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Save/ })).toHaveProperty('disabled', false),
    );
    expect(screen.getByText('Unsaved')).toBeTruthy();
    expect(screen.getByLabelText('Description')).toHaveProperty('value', 'One, then two');
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(saveWorkflow).toHaveBeenCalledTimes(2));
    // Over the revision the first save made, not the one the page loaded.
    expect(saveWorkflow.mock.calls[1][2]).toEqual({ revision: 'g1.4' });
  });

  it('keeps what is typed into a list of cases, trailing comma and all', async () => {
    await page('/harness/workflows?workflow=triage');
    fireEvent.click(await screen.findByRole('button', { name: 'Branch' }));
    const cases = await screen.findByLabelText('Cases');
    cases.focus();
    fireEvent.change(cases, { target: { value: 'bug,' } });
    expect(cases).toHaveProperty('value', 'bug,');
  });

  it('starts no draft for a JSON field passed through unchanged', async () => {
    await page('/harness/workflows?workflow=triage');
    fireEvent.click(await node('classify'));
    const schema = await screen.findByLabelText('Output schema');
    fireEvent.focus(schema);
    fireEvent.blur(schema);
    expect(screen.queryByText('Unsaved')).toBeNull();
  });

  it('says a draft the harness could not check is unchecked, not that it has no problems', async () => {
    const api = await vi.importActual<typeof import('../src/api')>('../src/api');
    await page('/harness/workflows?workflow=triage', {
      checkWorkflow: () => Promise.reject(new api.WorkflowRouteError(422, 'http_422', [])),
    });
    fireEvent.change(await screen.findByLabelText('Description'), { target: { value: 'x' } });
    expect(await screen.findByText('Not checked')).toBeTruthy();
  });

  it('does not send a nameless workflow to be checked, and says why', async () => {
    const { checkWorkflow } = await page('/harness/workflows?workflow=triage');
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: '' } });
    expect(await screen.findByText('A workflow needs a name.')).toBeTruthy();
    expect(screen.queryByText('Unsaved')).toBeNull();
    expect(checkWorkflow).not.toHaveBeenCalled();
  });
});

describe('a new workflow', () => {
  it('is created only where no workflow has its id, with the id taken from its name', async () => {
    const { saveWorkflow } = await page('/harness/workflows');
    fireEvent.click(await screen.findByRole('button', { name: /New workflow/ }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Nightly digest' } });
    expect(screen.getByLabelText('Id')).toHaveProperty('value', 'nightly-digest');
    fireEvent.click(screen.getByRole('button', { name: /Create/ }));
    await waitFor(() => expect(saveWorkflow).toHaveBeenCalled());
    expect(saveWorkflow.mock.calls[0]).toEqual([
      'nightly-digest',
      { name: 'Nightly digest', inputs: {}, steps: [], edges: [] },
      { create: true },
    ]);
  });

  it('says an id is taken in words', async () => {
    const api = await vi.importActual<typeof import('../src/api')>('../src/api');
    await page('/harness/workflows', {
      saveWorkflow: () =>
        Promise.reject(new api.WorkflowRouteError(412, 'workflow_changed', { current: WORKFLOW })),
    });
    fireEvent.click(await screen.findByRole('button', { name: /New workflow/ }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Triage' } });
    fireEvent.click(screen.getByRole('button', { name: /Create/ }));
    expect(await screen.findByText('A workflow with this id exists.')).toBeTruthy();
  });
});

describe('a run, watched', () => {
  const DONE_RUN = {
    ...RUN,
    status: 'completed',
    version: 6,
    steps: { ...RUN.steps, approve: { status: 'completed', fired: ['approved'] } },
  };

  it('moves its nodes as the stream sends each version, with no poll', async () => {
    let send: (run: unknown) => void = () => {};
    const { getRun } = await page('/harness/workflows?workflow=triage&view=run', {
      watchWorkflowRun: (_id, _run, o) => {
        const { signal, onRun } = o as { signal: AbortSignal; onRun: (r: unknown) => void };
        send = onRun;
        return new Promise((resolve) => signal.addEventListener('abort', () => resolve(false)));
      },
    });
    await waitFor(async () =>
      expect((await node('approve')).getAttribute('aria-label')).toContain('status waiting'),
    );
    const reads = getRun.mock.calls.length;
    send(DONE_RUN);
    await waitFor(async () =>
      expect((await node('approve')).getAttribute('aria-label')).toContain('status completed'),
    );
    expect(getRun.mock.calls.length).toBe(reads);
  });

  it('reconnects a dropped stream from the last version it held', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let calls = 0;
      const { watch } = await page('/harness/workflows?workflow=triage&view=run', {
        watchWorkflowRun: (_id, _run, o) => {
          const { signal, onRun } = o as { signal: AbortSignal; onRun: (r: unknown) => void };
          calls += 1;
          if (calls === 1) {
            onRun({ ...RUN, version: 5 });
            return Promise.resolve(false); // the connection dropped
          }
          return new Promise((resolve) => signal.addEventListener('abort', () => resolve(false)));
        },
      });
      await waitFor(() => expect(watch).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(1_500);
      await waitFor(() => expect(watch).toHaveBeenCalledTimes(2));
      expect((watch.mock.calls[1][2] as { after: number }).after).toBe(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks instead, on a harness that has no stream route', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const api = await vi.importActual<typeof import('../src/api')>('../src/api');
      const { getRun } = await page('/harness/workflows?workflow=triage&view=run', {
        watchWorkflowRun: () =>
          Promise.reject(new api.WorkflowRouteError(404, 'Not Found', 'Not Found')),
      });
      await waitFor(() => expect(getRun).toHaveBeenCalled());
      const asked = getRun.mock.calls.length;
      await vi.advanceTimersByTimeAsync(4_500);
      expect(getRun.mock.calls.length).toBeGreaterThan(asked);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the keyboard', () => {
  it('moves along a wire with the arrow keys, opening each step it reaches', async () => {
    await page('/harness/workflows?workflow=triage');
    const classify = await node('classify');
    classify.focus();
    fireEvent.keyDown(classify, { key: 'ArrowRight' });
    expect(await screen.findByDisplayValue('approve')).toBeTruthy();
    fireEvent.keyDown(await node('approve'), { key: 'ArrowLeft' });
    expect(await screen.findByDisplayValue('classify')).toBeTruthy();
  });

  it('undoes and redoes an edit, back to nothing unsaved', async () => {
    await page('/harness/workflows?workflow=triage');
    fireEvent.click(await screen.findByRole('button', { name: 'Branch' }));
    expect(await screen.findByText('Unsaved')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(screen.queryByText('Unsaved')).toBeNull());
    expect(screen.queryByTestId('rf__node-branch')).toBeNull();
    // ⇧⌘Z, from outside any text field.
    fireEvent.keyDown(document.body, { key: 'z', metaKey: true, shiftKey: true });
    expect(await screen.findByTestId('rf__node-branch')).toBeTruthy();
    expect(screen.getByText('Unsaved')).toBeTruthy();
  });

  it('undoes a word typed as one step, not letter by letter', async () => {
    await page('/harness/workflows?workflow=triage');
    const description = await screen.findByLabelText('Description');
    for (const value of ['t', 'ty', 'typ', 'typed']) {
      fireEvent.change(description, { target: { value } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(screen.queryByText('Unsaved')).toBeNull());
    expect(screen.getByLabelText('Description')).toHaveProperty('value', '');
  });

  it('leaves ⌘Z to a text field being typed in', async () => {
    await page('/harness/workflows?workflow=triage');
    const description = await screen.findByLabelText('Description');
    fireEvent.change(description, { target: { value: 'typed' } });
    expect(await screen.findByText('Unsaved')).toBeTruthy();
    fireEvent.keyDown(description, { key: 'z', metaKey: true });
    expect(screen.getByText('Unsaved')).toBeTruthy();
    expect(description).toHaveProperty('value', 'typed');
  });
});

describe('the canvas, full screen and mid-drag', () => {
  it('fills the window on F and gives the sheet back on Escape, but not from a field', async () => {
    await page('/harness/workflows?workflow=triage');
    const description = await screen.findByLabelText('Description');
    const canvas = () => document.querySelector('[data-expanded]');
    fireEvent.keyDown(description, { key: 'f' });
    expect(canvas()).toBeNull();
    fireEvent.keyDown(document.body, { key: 'f' });
    expect(canvas()).not.toBeNull();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(canvas()).toBeNull();
  });

  it('lets a wire be drawn only where the harness could take it', async () => {
    // What a dragged wire's quiet ports are drawn from, and what a drop is refused by.
    const { wireFits } = await import('../src/components/workflows/workflow-canvas');
    const wf = WORKFLOW as unknown as Parameters<typeof wireFits>[0];
    const text = { node: 'classify', port: 'text' };
    expect(wireFits(wf, text, { node: 'approve', port: 'payload' })).toBe(true);
    // A data output into `when`, a control port.
    const gated = {
      ...wf,
      ports: {
        ...wf.ports,
        approve: {
          inputs: [
            ...(wf.ports.approve?.inputs ?? []),
            { ...wf.ports.approve?.inputs[0], name: 'when', control: true },
          ],
          outputs: wf.ports.approve?.outputs ?? [],
        },
      },
    } as typeof wf;
    expect(wireFits(gated, text, { node: 'approve', port: 'when' })).toBe(false);
    // Back into its own step, and so a loop; and into the workflow's inputs.
    expect(wireFits(wf, text, { node: 'classify', port: 'issue' })).toBe(false);
    expect(
      wireFits(wf, { node: 'approve', port: 'approved' }, { node: 'classify', port: 'issue' }),
    ).toBe(false);
    expect(wireFits(wf, text, { node: 'trigger', port: 'issue' })).toBe(false);
  });

  it('draws a wire by class, so a selected one can look selected', async () => {
    // React Flow marks a selected or focused wire with a stylesheet rule; an inline stroke
    // outranked it, and the only way to delete a wire is to select it.
    const { buildEdges } = await import('../src/components/workflows/workflow-canvas');
    const wf = WORKFLOW as unknown as Parameters<typeof buildEdges>[0];
    const run = RUN as unknown as NonNullable<Parameters<typeof buildEdges>[1]>;
    for (const edge of [...buildEdges(wf, null, true), ...buildEdges(wf, run)]) {
      expect(edge.style?.stroke).toBeUndefined();
      expect(edge.className).toMatch(/\bwf-wire wf-wire-(plain|taken|passed)\b/);
    }
    // The classify step completed with `text`, so the run took that wire.
    const taken = buildEdges(wf, run).find((e) => e.source === 'classify');
    expect(taken?.className).toContain('wf-wire-taken');
  });

  it('keeps a node that draws the same as the very object on the canvas', async () => {
    // Every two-second poll rebuilds the nodes; handing React Flow fresh ones redrew every step.
    const { buildNodes, buildEdges, keepNodes, keepEdges } = await import(
      '../src/components/workflows/workflow-canvas'
    );
    const wf = WORKFLOW as unknown as Parameters<typeof buildNodes>[0];
    const run = RUN as unknown as NonNullable<Parameters<typeof buildNodes>[1]>;
    const measured = { width: 288, height: 120 };
    const first = buildNodes(wf, run).map((n) => ({ ...n, measured }));
    // An identical poll changes nothing at all, down to the array.
    expect(keepNodes(first, buildNodes(wf, structuredClone(run)))).toBe(first);
    // A step that moved on is a new node, with what React Flow measured kept; the rest stay.
    const moved = structuredClone(run);
    moved.steps.approve = {
      ...moved.steps.approve,
      status: 'completed',
    } as typeof moved.steps.approve;
    const next = keepNodes(first, buildNodes(wf, moved));
    const at = (id: string) => next.find((n) => n.id === id);
    expect(at('approve')).not.toBe(first.find((n) => n.id === 'approve'));
    expect(at('approve')?.data.status).toBe('completed');
    expect(at('approve')?.measured).toEqual(measured);
    expect(at('classify')).toBe(first.find((n) => n.id === 'classify'));

    const edges = buildEdges(wf, run).map((e) => ({ ...e, selected: e.source === 'classify' }));
    expect(keepEdges(edges, buildEdges(wf, structuredClone(run)))).toBe(edges);
  });

  it('keeps room for a failure under every step of a run, so a failing step moves nothing', async () => {
    const { heightsOf } = await import('../src/components/workflows/workflow-canvas');
    const wf = WORKFLOW as unknown as Parameters<typeof heightsOf>[0];
    const definition = heightsOf(wf);
    const run = heightsOf(wf, false, true);
    expect(run('classify')).toBeGreaterThan(definition('classify'));
    // The inputs never fail.
    expect(run('trigger')).toBe(definition('trigger'));
    // A step whose ports are unknown draws a line in place of them, and is stacked by it.
    const unknown = { ...wf, ports: { trigger: wf.ports.trigger } } as typeof wf;
    expect(heightsOf(unknown)('classify')).toBe(64 + 33);
  });
});

describe('below 1024', () => {
  const real = window.matchMedia;
  beforeEach(() => {
    window.matchMedia = ((query: string) => ({
      matches: query === '(max-width: 1023px)',
      media: query,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
  });
  afterEach(() => {
    window.matchMedia = real;
  });

  it('gives the canvas the sheet, and opens the inspector over it when a step is selected', async () => {
    await page('/harness/workflows?workflow=triage');
    await node('classify');
    expect(screen.queryByRole('complementary', { name: 'Inspector' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(await node('classify'));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByDisplayValue('classify')).toBeTruthy();
  });

  it('adds a step from a palette sheet, then shows it in the inspector', async () => {
    await page('/harness/workflows?workflow=triage');
    fireEvent.click(await screen.findByRole('button', { name: /Add step/ }));
    const palette = await screen.findByRole('dialog');
    fireEvent.click(within(palette).getByRole('button', { name: 'Branch' }));
    await waitFor(() =>
      expect(within(screen.getByRole('dialog')).getByDisplayValue('branch')).toBeTruthy(),
    );
    // Closed, not just covered: a modal sheet over it would hide it from a default query.
    await waitFor(() =>
      expect(screen.queryByRole('navigation', { name: 'Add a step', hidden: true })).toBeNull(),
    );
  });
});
