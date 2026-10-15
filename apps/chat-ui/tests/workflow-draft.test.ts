import { describe, expect, it } from 'vitest';
import {
  addInput,
  addStep,
  connect,
  describeDifferences,
  disconnect,
  edgeId,
  inputNameProblem,
  moveNode,
  newStepId,
  placeFor,
  removeInput,
  removeStep,
  renameInput,
  renameStep,
  setInputType,
  stepIdProblem,
  tidy,
  updateStep,
  withPositions,
  wouldCycle,
} from '../src/lib/workflow-draft';
import { COL_WIDTH, ORIGIN, TRIGGER } from '../src/lib/workflow-layout';
import type { WorkflowDefinition } from '../src/types';

/**
 * Every edit the workflow editor makes. A regression here is a draft that loses a wire, keeps one
 * to a step that is gone, or moves nodes the author placed — each of which saves fine and reads as
 * the harness's fault.
 */

const edge = (s: string, sp: string, t: string, tp: string) => ({
  source: { step: s, port: sp },
  target: { step: t, port: tp },
});

/** issue → classify → route (bug → fix) */
const DEF: WorkflowDefinition = {
  name: 'Triage',
  inputs: { issue: { type: 'string' } },
  steps: [
    { id: 'classify', kind: 'agent_turn', config: { manifest: 'quick', prompt: '{{ issue }}' } },
    { id: 'route', kind: 'branch', config: { cases: ['bug'] } },
    { id: 'fix', kind: 'agent_turn' },
  ],
  edges: [
    edge(TRIGGER, 'issue', 'classify', 'issue'),
    edge('classify', 'label', 'route', 'value'),
    edge('route', 'bug', 'fix', 'when'),
  ],
};

describe('ids', () => {
  it('names a new step for its kind, then numbers it', () => {
    expect(newStepId(DEF, 'approval')).toBe('approve');
    const one = addStep(DEF, 'branch', ORIGIN);
    expect(one.id).toBe('branch');
    expect(newStepId(one.def, 'branch')).toBe('branch_2');
    expect(newStepId(DEF, 'acme.Notify-Slack')).toBe('acme_notify_slack');
  });

  it('refuses an id the schema refuses, the trigger, or one taken', () => {
    expect(stepIdProblem(DEF, 'Fix')).toMatch(/lowercase/);
    expect(stepIdProblem(DEF, TRIGGER)).toMatch(/inputs/);
    expect(stepIdProblem(DEF, 'route')).toMatch(/Another step/);
    expect(stepIdProblem(DEF, 'route', 'route')).toBeNull();
    expect(inputNameProblem(DEF, 'when')).toMatch(/control/);
    expect(inputNameProblem(DEF, 'issue')).toMatch(/Another input/);
  });
});

describe('steps', () => {
  it('takes a removed step’s wires with it', () => {
    const next = removeStep(DEF, 'route');
    expect(next.steps?.map((s) => s.id)).toEqual(['classify', 'fix']);
    expect(next.edges?.map(edgeId)).toEqual(['trigger.issue->classify.issue']);
  });

  it('renames a step in every wire that names it', () => {
    const next = renameStep(DEF, 'route', 'decide');
    expect(next.steps?.map((s) => s.id)).toEqual(['classify', 'decide', 'fix']);
    expect(next.edges?.map(edgeId)).toEqual([
      'trigger.issue->classify.issue',
      'classify.label->decide.value',
      'decide.bug->fix.when',
    ]);
  });

  it('places every node once, so a later wire does not move what the author saw', () => {
    const placed = withPositions(DEF);
    expect(placed.trigger_position).toEqual(ORIGIN);
    expect(placed.steps?.every((s) => s.position)).toBe(true);
    // Rewiring changes the layout's columns; the saved positions stay where they were.
    const rewired = connect(placed, edge(TRIGGER, 'issue', 'fix', 'note'));
    expect(withPositions(rewired).steps).toEqual(rewired.steps);
    expect(moveNode(placed, 'fix', { x: 10.4, y: 20.6 }).steps?.[2].position).toEqual({
      x: 10,
      y: 21,
    });
    expect(moveNode(placed, TRIGGER, { x: 1, y: 2 }).trigger_position).toEqual({ x: 1, y: 2 });
  });

  it('lays a moved node out again on Tidy', () => {
    const moved = moveNode(withPositions(DEF), 'route', { x: 900, y: 900 });
    expect(tidy(moved).steps?.[1].position?.x).toBe(ORIGIN.x + 2 * COL_WIDTH);
  });

  it('puts a new step right of the selected one, below anything already there', () => {
    const placed = withPositions(DEF);
    const route = placed.steps?.[1].position as { x: number; y: number };
    const fix = placed.steps?.[2].position as { x: number; y: number };
    const at = placeFor(placed, 'route');
    expect(at.x).toBe(route.x + COL_WIDTH);
    // `fix` already sits there, so the new step goes below it.
    expect(at.x).toBe(fix.x);
    expect(at.y).toBeGreaterThan(fix.y);
  });
});

describe('wires', () => {
  it('replaces what fed a data input, and adds to a step’s when', () => {
    const replaced = connect(DEF, edge(TRIGGER, 'issue', 'route', 'value'));
    expect(replaced.edges?.filter((e) => e.target.step === 'route').map(edgeId)).toEqual([
      'trigger.issue->route.value',
    ]);
    const gated = connect(DEF, edge('classify', 'done', 'fix', 'when'));
    expect(gated.edges?.filter((e) => e.target.port === 'when')).toHaveLength(2);
    expect(connect(DEF, edge('route', 'bug', 'fix', 'when'))).toBe(DEF);
  });

  it('refuses a wire that would close a loop', () => {
    expect(wouldCycle(DEF, 'fix', 'classify')).toBe(true);
    expect(wouldCycle(DEF, 'route', 'route')).toBe(true);
    expect(wouldCycle(DEF, 'classify', 'fix')).toBe(false);
  });

  it('removes wires by their canvas id', () => {
    expect(disconnect(DEF, ['route.bug->fix.when']).edges).toHaveLength(2);
  });
});

describe('workflow inputs', () => {
  it('renames an input in place, with the wires out of it', () => {
    const next = renameInput(addInput(DEF, 'priority'), 'issue', 'report');
    expect(Object.keys(next.inputs ?? {})).toEqual(['report', 'priority']);
    expect(next.edges?.[0].source).toEqual({ step: TRIGGER, port: 'report' });
  });

  it('removes an input with its wires, and types one', () => {
    expect(removeInput(DEF, 'issue').edges?.map(edgeId)).not.toContain(
      'trigger.issue->classify.issue',
    );
    expect(setInputType(DEF, 'issue', 'integer').inputs?.issue).toEqual({ type: 'integer' });
    expect(setInputType(DEF, 'issue', 'any').inputs?.issue).toEqual({});
  });
});

describe('a save that lost', () => {
  it('says what each side would throw away, positions aside', () => {
    const mine = moveNode(removeStep(DEF, 'fix'), 'route', { x: 5, y: 5 });
    const theirs = connect({ ...DEF, name: 'Triage v2' }, edge(TRIGGER, 'issue', 'route', 'value'));
    expect(describeDifferences(mine, theirs)).toEqual([
      'Name: yours “Triage”, theirs “Triage v2”.',
      'Step fix: only in theirs.',
      // Theirs rewired route's input (yours keeps the old wire) and keeps fix's gate.
      '1 wire only in yours.',
      '2 wires only in theirs.',
    ]);
    expect(describeDifferences(DEF, withPositions(DEF))).toEqual([]);
    // Key order is not a difference: Postgres hands a config back in its own order.
    const reordered = updateStep(DEF, 'classify', {
      config: { prompt: '{{ issue }}', manifest: 'quick' },
    });
    expect(describeDifferences(DEF, reordered)).toEqual([]);
  });
});
