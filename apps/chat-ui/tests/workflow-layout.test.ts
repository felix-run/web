import { describe, expect, it } from 'vitest';
import {
  COL_WIDTH,
  levelsOf,
  neighbourOf,
  nodeIdsOf,
  ORIGIN,
  orderLevels,
  positionsOf,
  TRIGGER,
  wireState,
  wiresOf,
  wireTaken,
} from '../src/lib/workflow-layout';
import type { WorkflowDefinition, WorkflowRun } from '../src/types';

/**
 * Where a workflow's nodes land, and which wires a run took. The canvas reads every one of these
 * on each poll, so a regression here is a graph that rearranges itself, or a run that claims a
 * path it never followed.
 */

const edge = (s: string, sp: string, t: string, tp: string) => ({
  source: { step: s, port: sp },
  target: { step: t, port: tp },
});

/** issue → classify → route: bug → fix, feature → note; classify.summary also feeds both. */
const TRIAGE: WorkflowDefinition = {
  name: 'Triage',
  inputs: { issue: { type: 'string' } },
  steps: [
    { id: 'classify', kind: 'agent_turn' },
    { id: 'route', kind: 'branch' },
    { id: 'fix', kind: 'agent_turn' },
    { id: 'note', kind: 'agent_turn' },
  ],
  edges: [
    edge(TRIGGER, 'issue', 'classify', 'issue'),
    edge('classify', 'label', 'route', 'value'),
    edge('route', 'bug', 'fix', 'when'),
    edge('route', 'feature', 'note', 'when'),
    edge('classify', 'summary', 'fix', 'summary'),
    edge('classify', 'summary', 'note', 'summary'),
  ],
};

describe('layering', () => {
  it('puts each node one column right of its furthest source, so every wire points rightwards', () => {
    const levels = levelsOf(nodeIdsOf(TRIAGE), wiresOf(TRIAGE));
    expect(Object.fromEntries(levels)).toEqual({
      trigger: 0,
      classify: 1,
      route: 2,
      fix: 3,
      note: 3,
    });
  });

  it('draws a cyclic draft instead of recursing forever', () => {
    const cyclic: WorkflowDefinition = {
      name: 'Loop',
      steps: [
        { id: 'a', kind: 'branch' },
        { id: 'b', kind: 'branch' },
      ],
      edges: [edge('a', 'true', 'b', 'when'), edge('b', 'true', 'a', 'when')],
    };
    const levels = levelsOf(nodeIdsOf(cyclic), wiresOf(cyclic));
    expect([...levels.keys()].sort()).toEqual(['a', 'b', 'trigger']);
  });

  it('orders a column by its neighbours, so a fan out does not cross itself', () => {
    const fan: WorkflowDefinition = {
      name: 'Fan',
      steps: [
        { id: 'top', kind: 'branch' },
        { id: 'bottom', kind: 'branch' },
        { id: 'after_bottom', kind: 'branch' },
        { id: 'after_top', kind: 'branch' },
      ],
      edges: [
        edge(TRIGGER, 'x', 'top', 'value'),
        edge(TRIGGER, 'x', 'bottom', 'value'),
        edge('top', 'true', 'after_top', 'when'),
        edge('bottom', 'true', 'after_bottom', 'when'),
      ],
    };
    const ids = nodeIdsOf(fan);
    const wires = wiresOf(fan);
    const columns = orderLevels(ids, wires, levelsOf(ids, wires));
    expect(columns[2]).toEqual(['after_top', 'after_bottom']);
  });
});

describe('positions', () => {
  it('keeps a position saved with the definition, and lays out only what was never placed', () => {
    const saved: WorkflowDefinition = {
      ...TRIAGE,
      steps: (TRIAGE.steps ?? []).map((s) =>
        s.id === 'route' ? { ...s, position: { x: 900, y: 7 } } : s,
      ),
    };
    const at = positionsOf(saved);
    expect(at.get('route')).toEqual({ x: 900, y: 7 });
    expect(at.get('classify')?.x).toBe(ORIGIN.x + COL_WIDTH);
    // Tidy lays out everything again, the saved position included.
    expect(positionsOf(saved, { fresh: true }).get('route')?.x).toBe(ORIGIN.x + 2 * COL_WIDTH);
  });
});

function run(steps: WorkflowRun['steps']): WorkflowRun {
  return {
    id: 'r',
    workflow_id: 'triage',
    revision: 'g.1',
    status: 'completed',
    trigger: 'manual',
    started_by: 'ops',
    fiber_id: 'f',
    error: '',
    expires_at: 0,
    version: 1,
    created_at: 0,
    updated_at: 0,
    finished_at: 0,
    inputs: {},
    untrusted_inputs: [],
    steps,
  };
}

describe('the path a run took', () => {
  const wires = Object.fromEntries(
    wiresOf(TRIAGE).map((w) => [`${w.source}.${w.sourcePort}->${w.target}`, w]),
  );
  const finished = run({
    classify: { status: 'completed', outputs: { label: 'bug', summary: 'crash' } },
    route: { status: 'completed', outputs: {}, fired: ['bug'] },
    fix: { status: 'completed', outputs: { text: 'done' } },
    note: { status: 'skipped' },
  });

  it('takes a control wire only when its port fired', () => {
    expect(wireTaken(wires['route.bug->fix'], finished, true)).toBe(true);
    expect(wireTaken(wires['route.feature->note'], finished, true)).toBe(false);
  });

  it('takes a data wire only when its source finished and produced that port', () => {
    expect(wireTaken(wires['classify.summary->fix'], finished, false)).toBe(true);
    const unfinished = run({ classify: { status: 'running' } });
    expect(wireTaken(wires['classify.summary->fix'], unfinished, false)).toBe(false);
    const withoutPort = run({ classify: { status: 'completed', outputs: { label: 'bug' } } });
    expect(wireTaken(wires['classify.summary->fix'], withoutPort, false)).toBe(false);
  });

  it('always takes the workflow inputs', () => {
    expect(wireTaken(wires['trigger.issue->classify'], run({}), false)).toBe(true);
  });
});

describe('what a run did with a wire', () => {
  const wires = Object.fromEntries(
    wiresOf(TRIAGE).map((w) => [`${w.source}.${w.sourcePort}->${w.target}`, w]),
  );

  it('says a wire the run has not reached is ahead, not passed by', () => {
    const early = run({ classify: { status: 'running' }, route: { status: 'pending' } });
    expect(wireState(wires['classify.label->route'], early, false)).toBe('ahead');
    expect(wireState(wires['route.bug->fix'], early, true)).toBe('ahead');
  });

  it('says a wire out of a failed step, or into a skipped one, was passed by', () => {
    const failed = run({ classify: { status: 'failed' }, route: { status: 'pending' } });
    expect(wireState(wires['classify.label->route'], failed, false)).toBe('passed');
    const skipped = run({ route: { status: 'running' }, note: { status: 'skipped' } });
    expect(wireState(wires['route.feature->note'], skipped, true)).toBe('passed');
  });
});

describe('arrow keys', () => {
  const at = positionsOf(TRIAGE);
  const wires = wiresOf(TRIAGE);

  it('follows a wire right and left, choosing the neighbour level with it', () => {
    expect(neighbourOf(at, wires, TRIGGER, 'right')).toBe('classify');
    // classify feeds route, fix and note; route sits level with it, so right goes there.
    expect(neighbourOf(at, wires, 'classify', 'right')).toBe('route');
    expect(neighbourOf(at, wires, 'route', 'left')).toBe('classify');
    expect(neighbourOf(at, wires, TRIGGER, 'left')).toBeNull();
  });

  it('moves up and down within a column, and nowhere past its ends', () => {
    const fix = at.get('fix') as { y: number };
    const note = at.get('note') as { y: number };
    const [upper, lower] = fix.y < note.y ? ['fix', 'note'] : ['note', 'fix'];
    expect(neighbourOf(at, wires, upper, 'down')).toBe(lower);
    expect(neighbourOf(at, wires, lower, 'up')).toBe(upper);
    expect(neighbourOf(at, wires, lower, 'down')).toBeNull();
  });
});
