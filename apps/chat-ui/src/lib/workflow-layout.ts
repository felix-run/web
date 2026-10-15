/**
 * Where a workflow's nodes go on the canvas, and which of its wires a run actually took.
 *
 * Layered left to right by longest path from the workflow's inputs, each column ordered by the
 * barycentre of its neighbours (two sweeps), as durablefibers' pipeline canvas lays out a DAG:
 * the shapes an authored workflow has — a fan out to a branch's cases, a fan back in — untangle
 * without a full Sugiyama pass or a layout dependency. A position saved with the definition
 * wins; the layout only places what was never placed, and never moves a node when a status
 * changes.
 */
import type { WorkflowDefinition, WorkflowRun, WorkflowStepStatus } from '@/types';

/** The non-step node whose outputs are the workflow's inputs (`felix/workflows/schema.py`). */
export const TRIGGER = 'trigger';

export const COL_WIDTH = 340;
/** The gap between two nodes stacked in one column. */
export const ROW_GAP = 40;
/** A node's height when its ports are not known: a header and a couple of rows. */
export const DEFAULT_NODE_HEIGHT = 120;
export const ORIGIN = { x: 40, y: 40 };

export interface Wire {
  id: string;
  source: string;
  sourcePort: string;
  target: string;
  targetPort: string;
}

/** Every wire of a definition, with a stable id: one per port pair (duplicates are refused upstream). */
export function wiresOf(def: WorkflowDefinition): Wire[] {
  return (Array.isArray(def.edges) ? def.edges : []).map((e) => ({
    id: `${e.source.step}.${e.source.port}->${e.target.step}.${e.target.port}`,
    source: e.source.step,
    sourcePort: e.source.port,
    target: e.target.step,
    targetPort: e.target.port,
  }));
}

/**
 * A definition's steps, or none. A stored definition the harness can no longer parse comes back
 * as written, beside an `invalid_definition` problem, so `steps` may not be a list at all.
 */
export function stepsOf(def: WorkflowDefinition): NonNullable<WorkflowDefinition['steps']> {
  return Array.isArray(def.steps) ? def.steps : [];
}

/** The node ids, inputs first: the trigger, then the steps in definition order. */
export function nodeIdsOf(def: WorkflowDefinition): string[] {
  return [TRIGGER, ...stepsOf(def).map((s) => s.id)];
}

/** Levels by longest path from a node with no incoming wire, so a wire always points rightwards. */
export function levelsOf(ids: string[], wires: Wire[]): Map<string, number> {
  const known = new Set(ids);
  const parents = new Map<string, string[]>();
  for (const w of wires) {
    if (!known.has(w.source) || !known.has(w.target) || w.source === w.target) continue;
    const list = parents.get(w.target) ?? [];
    if (!list.includes(w.source)) list.push(w.source);
    parents.set(w.target, list);
  }
  const levels = new Map<string, number>();
  const visit = (id: string, seen: Set<string>): number => {
    const done = levels.get(id);
    if (done !== undefined) return done;
    // A cycle cannot be laid out in layers. The harness reports one as a problem and refuses to
    // run it; here the revisited node is pinned to 0 so a broken draft still draws.
    if (seen.has(id)) return 0;
    seen.add(id);
    const ps = parents.get(id) ?? [];
    const level = ps.length ? Math.max(...ps.map((p) => visit(p, seen) + 1)) : 0;
    seen.delete(id);
    levels.set(id, level);
    return level;
  };
  for (const id of ids) visit(id, new Set());
  return levels;
}

/** Each level ordered to cross as few wires as it can: two barycentre sweeps, forward then back. */
export function orderLevels(ids: string[], wires: Wire[], levels: Map<string, number>): string[][] {
  const columns: string[][] = Array.from({ length: Math.max(0, ...levels.values()) + 1 }, () => []);
  for (const id of ids) columns[levels.get(id) ?? 0].push(id);
  const parentsOf = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();
  for (const w of wires) {
    parentsOf.set(w.target, [...(parentsOf.get(w.target) ?? []), w.source]);
    childrenOf.set(w.source, [...(childrenOf.get(w.source) ?? []), w.target]);
  }
  const rowOf = (col: string[]) => new Map(col.map((id, i) => [id, i]));
  const sortBy = (col: string[], neighbours: Map<string, string[]>, rows: Map<string, number>) => {
    const key = new Map<string, number>();
    for (const id of col) {
      const at = (neighbours.get(id) ?? [])
        .map((n) => rows.get(n))
        .filter((v): v is number => v !== undefined);
      if (at.length) key.set(id, at.reduce((a, b) => a + b, 0) / at.length);
    }
    // Stable: a node with no neighbour in the adjacent column keeps its place relative to the rest.
    return [...col].sort(
      (a, b) => (key.get(a) ?? Number.POSITIVE_INFINITY) - (key.get(b) ?? Number.POSITIVE_INFINITY),
    );
  };
  for (let pass = 0; pass < 2; pass++) {
    for (let l = 1; l < columns.length; l++)
      columns[l] = sortBy(columns[l], parentsOf, rowOf(columns[l - 1]));
    for (let l = columns.length - 2; l >= 0; l--)
      columns[l] = sortBy(columns[l], childrenOf, rowOf(columns[l + 1]));
  }
  return columns;
}

/**
 * Every node's position: the saved one, else the layered layout's. Tidy passes `fresh` to ignore
 * saved ones. `heightOf` is a node's drawn height (its ports decide it), so a column of tall nodes
 * does not overlap; each column is centred against the tallest, so a fan out reads as a fan.
 */
export function positionsOf(
  def: WorkflowDefinition,
  {
    fresh = false,
    heightOf = () => DEFAULT_NODE_HEIGHT,
  }: { fresh?: boolean; heightOf?: (id: string) => number } = {},
): Map<string, { x: number; y: number }> {
  const ids = nodeIdsOf(def);
  const wires = wiresOf(def);
  const columns = orderLevels(ids, wires, levelsOf(ids, wires));
  const span = (col: string[]) =>
    col.reduce((sum, id) => sum + heightOf(id), 0) + ROW_GAP * Math.max(0, col.length - 1);
  const tallest = Math.max(0, ...columns.map(span));
  const laid = new Map<string, { x: number; y: number }>();
  columns.forEach((col, level) => {
    let y = ORIGIN.y + (tallest - span(col)) / 2;
    for (const id of col) {
      laid.set(id, { x: ORIGIN.x + level * COL_WIDTH, y });
      y += heightOf(id) + ROW_GAP;
    }
  });
  if (fresh) return laid;
  const saved = new Map<string, { x: number; y: number } | null | undefined>([
    [TRIGGER, def.trigger_position],
    ...stepsOf(def).map((s) => [s.id, s.position] as const),
  ]);
  return new Map(ids.map((id) => [id, saved.get(id) ?? laid.get(id) ?? ORIGIN]));
}

export type WireState = 'taken' | 'passed' | 'ahead';

/**
 * What a run did with a wire. `taken`: its source finished and produced the port (a data port) or
 * fired it (a control port). `passed`: the run went by it — its source finished without that port,
 * or failed, was skipped or cancelled, or its target was skipped or cancelled. `ahead`: the run has
 * not reached it yet (its source is queued, running or waiting), so nothing about it is known.
 */
export function wireState(wire: Wire, run: WorkflowRun, control: boolean): WireState {
  if (wire.source === TRIGGER) return 'taken';
  const source = run.steps[wire.source];
  const target = run.steps[wire.target];
  if (source?.status === 'completed') {
    const carried = control
      ? (source.fired ?? []).includes(wire.sourcePort)
      : Boolean(source.outputs && wire.sourcePort in source.outputs);
    return carried ? 'taken' : 'passed';
  }
  if (source && ['failed', 'skipped', 'cancelled'].includes(source.status)) return 'passed';
  if (target && (target.status === 'skipped' || target.status === 'cancelled')) return 'passed';
  return 'ahead';
}

/** Whether the run carried a value down this wire. */
export function wireTaken(wire: Wire, run: WorkflowRun, control: boolean): boolean {
  return wireState(wire, run, control) === 'taken';
}

/** A step's state as the canvas words it: the harness's status, never a friendlier one. */
export const STEP_STATE_WORD: Record<WorkflowStepStatus, string> = {
  pending: 'Queued',
  running: 'Running',
  waiting: 'Waiting on you',
  completed: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
  cancelled: 'Cancelled',
};

export type StateTone = 'idle' | 'running' | 'blocked' | 'done' | 'failed';

export function stepTone(status: WorkflowStepStatus): StateTone {
  switch (status) {
    case 'running':
      return 'running';
    case 'waiting':
      return 'blocked';
    case 'completed':
      return 'done';
    case 'failed':
      return 'failed';
    default:
      return 'idle';
  }
}

export type Direction = 'left' | 'right' | 'up' | 'down';

/**
 * Where an arrow key goes from node `from`: right along a wire out of it, left along one into it,
 * up and down to the nearest node in the same column. Of several wired neighbours, the one level
 * with `from` (the nearest in y) — so right, right, right follows a path the way the eye does.
 * `null` when there is nowhere to go, so the key does nothing rather than jump.
 */
export function neighbourOf(
  positions: ReadonlyMap<string, { x: number; y: number }>,
  wires: Wire[],
  from: string,
  direction: Direction,
): string | null {
  const at = positions.get(from);
  if (!at) return null;
  const nearest = (ids: Iterable<string>, score: (p: { x: number; y: number }) => number) => {
    let best: string | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const id of ids) {
      const p = positions.get(id);
      if (!p || id === from) continue;
      const v = score(p);
      if (v < bestScore || (v === bestScore && best !== null && id < best)) {
        best = id;
        bestScore = v;
      }
    }
    return best;
  };
  if (direction === 'right' || direction === 'left') {
    const linked = wires
      .filter((w) => (direction === 'right' ? w.source === from : w.target === from))
      .map((w) => (direction === 'right' ? w.target : w.source));
    return nearest(new Set(linked), (p) => Math.abs(p.y - at.y));
  }
  const below = direction === 'down';
  const column = [...positions.keys()].filter((id) => {
    const p = positions.get(id) as { x: number; y: number };
    return Math.abs(p.x - at.x) < COL_WIDTH / 2 && (below ? p.y > at.y : p.y < at.y);
  });
  return nearest(column, (p) => Math.abs(p.y - at.y));
}
