/**
 * Editing a workflow definition: every change the editor makes, as a pure function from one
 * definition to the next. The canvas and the inspector call these and nothing else, so what an
 * edit does to the steps, the wires and the saved positions is decided once, here, and tested
 * without a canvas.
 *
 * The harness owns what a definition *means*: its ports, and the problems that stop it running,
 * come back from `POST /workflows/-/check` for every draft. What lives here is only what the shape
 * of the JSON requires — an id the schema accepts, an edge that names real nodes, no edge listed
 * twice — so a draft never fails to parse on its way to the check.
 */
import {
  COL_WIDTH,
  DEFAULT_NODE_HEIGHT,
  nodeIdsOf,
  ORIGIN,
  positionsOf,
  ROW_GAP,
  stepsOf,
  TRIGGER,
  wiresOf,
} from '@/lib/workflow-layout';
import type { WorkflowDefinition, WorkflowStepDef } from '@/types';

type Point = { x: number; y: number };
type Edge = NonNullable<WorkflowDefinition['edges']>[number];

/** A step id or a port name, as `felix/workflows/ports.py` holds them. */
export const NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
/** A workflow id, as `felix/workflows/schema.py` holds it: a URL path segment. */
export const WORKFLOW_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** Every step's implicit control input: an edge into it gates the step. */
export const WHEN = 'when';

/** The input types the editor offers for a workflow input: JSON Schema's, and anything. */
export const INPUT_TYPES = ['string', 'integer', 'number', 'boolean', 'object', 'array', 'any'];

function edgesOf(def: WorkflowDefinition): Edge[] {
  return Array.isArray(def.edges) ? def.edges : [];
}

function sameEdge(a: Edge, b: Edge): boolean {
  return (
    a.source.step === b.source.step &&
    a.source.port === b.source.port &&
    a.target.step === b.target.step &&
    a.target.port === b.target.port
  );
}

/** The id a wire has on the canvas (`wiresOf`), for an edge. */
export function edgeId(e: Edge): string {
  return `${e.source.step}.${e.source.port}->${e.target.step}.${e.target.port}`;
}

/** Why `name` cannot be a step id here, or null when it can. */
export function stepIdProblem(def: WorkflowDefinition, name: string, self?: string): string | null {
  if (!NAME_PATTERN.test(name)) {
    return 'Starts with a letter; lowercase letters, digits and _ only, at most 64.';
  }
  if (name === TRIGGER) return `“${TRIGGER}” is the workflow’s inputs.`;
  if (name !== self && stepsOf(def).some((s) => s.id === name)) return 'Another step has this id.';
  return null;
}

/** Why `name` cannot be a workflow input here, or null when it can. */
export function inputNameProblem(
  def: WorkflowDefinition,
  name: string,
  self?: string,
): string | null {
  if (!NAME_PATTERN.test(name)) {
    return 'Starts with a letter; lowercase letters, digits and _ only, at most 64.';
  }
  if (name === WHEN) return `“${WHEN}” is every step’s control input.`;
  if (name !== self && name in (def.inputs ?? {})) return 'Another input has this name.';
  return null;
}

const ID_STEM: Record<string, string> = {
  agent_turn: 'agent',
  tool_call: 'tool',
  approval: 'approve',
  branch: 'branch',
};

/** A fresh step id for a kind: its stem, then `_2`, `_3` … until no step has it. */
export function newStepId(def: WorkflowDefinition, kind: string): string {
  const cleaned = kind
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^[^a-z]+/, '');
  const stem = (ID_STEM[kind] ?? cleaned.slice(0, 58)) || 'step';
  const taken = new Set(stepsOf(def).map((s) => s.id));
  if (!taken.has(stem) && stem !== TRIGGER) return stem;
  for (let n = 2; ; n++) {
    const id = `${stem}_${n}`;
    if (!taken.has(id)) return id;
  }
}

/**
 * The definition with every node placed where it is drawn now. The editor starts every draft from
 * this: a node the layout placed would otherwise move whenever a wire changed the layout, and the
 * author has only ever seen it where it is.
 */
export function withPositions(
  def: WorkflowDefinition,
  heightOf?: (id: string) => number,
  fresh = false,
): WorkflowDefinition {
  const at = positionsOf(def, { fresh, ...(heightOf ? { heightOf } : {}) });
  return {
    ...def,
    trigger_position: at.get(TRIGGER) ?? ORIGIN,
    steps: stepsOf(def).map((s) => ({ ...s, position: at.get(s.id) ?? ORIGIN })),
  };
}

/** Tidy: lay every node out again, saved positions included. */
export function tidy(
  def: WorkflowDefinition,
  heightOf?: (id: string) => number,
): WorkflowDefinition {
  return withPositions(def, heightOf, true);
}

function positionOf(def: WorkflowDefinition, id: string): Point | null {
  if (id === TRIGGER) return def.trigger_position ?? null;
  return stepsOf(def).find((s) => s.id === id)?.position ?? null;
}

/**
 * Where a new step goes: one column right of `after` (the selected node), else right of the
 * rightmost node; moved down a row at a time until nothing already sits there.
 */
export function placeFor(def: WorkflowDefinition, after?: string | null): Point {
  const placed = nodeIdsOf(def)
    .map((id) => positionOf(def, id))
    .filter((p): p is Point => p !== null);
  const anchor = after ? positionOf(def, after) : null;
  const x = anchor
    ? anchor.x + COL_WIDTH
    : placed.length
      ? Math.max(...placed.map((p) => p.x)) + COL_WIDTH
      : ORIGIN.x;
  let y = anchor?.y ?? ORIGIN.y;
  const step = DEFAULT_NODE_HEIGHT + ROW_GAP;
  while (placed.some((p) => Math.abs(p.x - x) < COL_WIDTH / 2 && Math.abs(p.y - y) < step)) {
    y += step;
  }
  return { x, y };
}

/** Add a step of `kind` at `position`; the new step's id comes back beside the definition. */
export function addStep(
  def: WorkflowDefinition,
  kind: string,
  position: Point,
): { def: WorkflowDefinition; id: string } {
  const id = newStepId(def, kind);
  const step: WorkflowStepDef = { id, kind, name: '', config: {}, position };
  return { def: { ...def, steps: [...stepsOf(def), step] }, id };
}

/** Remove a step and every wire into or out of it. */
export function removeStep(def: WorkflowDefinition, id: string): WorkflowDefinition {
  return {
    ...def,
    steps: stepsOf(def).filter((s) => s.id !== id),
    edges: edgesOf(def).filter((e) => e.source.step !== id && e.target.step !== id),
  };
}

/** Change a step's id, and every wire that names it. The caller checks `stepIdProblem` first. */
export function renameStep(def: WorkflowDefinition, from: string, to: string): WorkflowDefinition {
  if (from === to) return def;
  const swap = (step: string) => (step === from ? to : step);
  return {
    ...def,
    steps: stepsOf(def).map((s) => (s.id === from ? { ...s, id: to } : s)),
    edges: edgesOf(def).map((e) => ({
      source: { ...e.source, step: swap(e.source.step) },
      target: { ...e.target, step: swap(e.target.step) },
    })),
  };
}

/** Merge `patch` into one step. */
export function updateStep(
  def: WorkflowDefinition,
  id: string,
  patch: Partial<Omit<WorkflowStepDef, 'id'>>,
): WorkflowDefinition {
  return { ...def, steps: stepsOf(def).map((s) => (s.id === id ? { ...s, ...patch } : s)) };
}

/** Put a node — a step, or the workflow's inputs — at `position`. */
export function moveNode(def: WorkflowDefinition, id: string, position: Point): WorkflowDefinition {
  const at = { x: Math.round(position.x), y: Math.round(position.y) };
  if (id === TRIGGER) return { ...def, trigger_position: at };
  return updateStep(def, id, { position: at });
}

/** Whether a wire from `source` into `target` would close a loop: `target` already reaches it. */
export function wouldCycle(def: WorkflowDefinition, source: string, target: string): boolean {
  if (source === target) return true;
  const next = new Map<string, string[]>();
  for (const w of wiresOf(def)) next.set(w.source, [...(next.get(w.source) ?? []), w.target]);
  const seen = new Set<string>();
  const stack = [target];
  while (stack.length) {
    const id = stack.pop() as string;
    if (id === source) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(next.get(id) ?? []));
  }
  return false;
}

/**
 * Wire an output into an input. A data input takes one wire, so a new one replaces what fed it;
 * `when` takes any number, since the step runs when any of them fires. The same wire twice is
 * one wire.
 */
export function connect(def: WorkflowDefinition, edge: Edge): WorkflowDefinition {
  const edges = edgesOf(def);
  if (edges.some((e) => sameEdge(e, edge))) return def;
  const kept =
    edge.target.port === WHEN
      ? edges
      : edges.filter(
          (e) => !(e.target.step === edge.target.step && e.target.port === edge.target.port),
        );
  return { ...def, edges: [...kept, edge] };
}

/** Remove the wires whose canvas ids are `ids`. */
export function disconnect(def: WorkflowDefinition, ids: Iterable<string>): WorkflowDefinition {
  const gone = new Set(ids);
  return { ...def, edges: edgesOf(def).filter((e) => !gone.has(edgeId(e))) };
}

/** The wires into one input port of a step. */
export function edgesInto(def: WorkflowDefinition, step: string, port: string): Edge[] {
  return edgesOf(def).filter((e) => e.target.step === step && e.target.port === port);
}

/** An input type as the editor names it, from its schema. */
export function inputTypeOf(schema: Record<string, unknown> | undefined): string {
  const t = schema?.type;
  return typeof t === 'string' && INPUT_TYPES.includes(t) ? t : 'any';
}

/** Set a workflow input's schema to a type the editor offers (`any` is the empty schema). */
export function setInputType(
  def: WorkflowDefinition,
  name: string,
  type: string,
): WorkflowDefinition {
  const { type: _old, ...rest } = def.inputs?.[name] ?? {};
  return {
    ...def,
    inputs: { ...def.inputs, [name]: type === 'any' ? rest : { ...rest, type } },
  };
}

/** Add a workflow input, typed `string`. The caller checks `inputNameProblem` first. */
export function addInput(def: WorkflowDefinition, name: string): WorkflowDefinition {
  return { ...def, inputs: { ...def.inputs, [name]: { type: 'string' } } };
}

/** Rename a workflow input, keeping its place in the list and the wires out of it. */
export function renameInput(def: WorkflowDefinition, from: string, to: string): WorkflowDefinition {
  if (from === to) return def;
  const inputs = Object.fromEntries(
    Object.entries(def.inputs ?? {}).map(([k, v]) => [k === from ? to : k, v]),
  );
  return {
    ...def,
    inputs,
    edges: edgesOf(def).map((e) =>
      e.source.step === TRIGGER && e.source.port === from
        ? { ...e, source: { step: TRIGGER, port: to } }
        : e,
    ),
  };
}

/** Remove a workflow input and the wires out of it. */
export function removeInput(def: WorkflowDefinition, name: string): WorkflowDefinition {
  const { [name]: _gone, ...inputs } = def.inputs ?? {};
  return {
    ...def,
    inputs,
    edges: edgesOf(def).filter((e) => !(e.source.step === TRIGGER && e.source.port === name)),
  };
}

/** A value with every object's keys sorted, so two that differ only in key order compare equal. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

/**
 * What two definitions disagree on, a line each: the editor shows it when a save loses to one
 * made since, so *keep mine* and *take theirs* are chosen knowing what each throws away.
 * Positions are left out: where a node sits is not what anyone is choosing between.
 */
export function describeDifferences(
  mine: WorkflowDefinition,
  theirs: WorkflowDefinition,
): string[] {
  const lines: string[] = [];
  if (mine.name !== theirs.name) lines.push(`Name: yours “${mine.name}”, theirs “${theirs.name}”.`);
  if ((mine.description ?? '') !== (theirs.description ?? '')) lines.push('Description differs.');
  // Key order is not content: a stored object comes back in Postgres's order, and an edit that
  // removes a key and adds it again moves it.
  const json = (v: unknown) => JSON.stringify(canonical(v ?? null));
  if (json(mine.inputs ?? {}) !== json(theirs.inputs ?? {})) lines.push('Inputs differ.');
  const byId = (def: WorkflowDefinition) => new Map(stepsOf(def).map((s) => [s.id, s]));
  const a = byId(mine);
  const b = byId(theirs);
  for (const [id, s] of a) {
    const t = b.get(id);
    if (!t) lines.push(`Step ${id}: only in yours.`);
    else if (
      s.kind !== t.kind ||
      (s.name ?? '') !== (t.name ?? '') ||
      json(s.config) !== json(t.config)
    ) {
      lines.push(`Step ${id}: differs.`);
    }
  }
  for (const id of b.keys()) if (!a.has(id)) lines.push(`Step ${id}: only in theirs.`);
  const ids = (def: WorkflowDefinition) => new Set(edgesOf(def).map(edgeId));
  const ea = ids(mine);
  const eb = ids(theirs);
  const onlyMine = [...ea].filter((e) => !eb.has(e)).length;
  const onlyTheirs = [...eb].filter((e) => !ea.has(e)).length;
  if (onlyMine) lines.push(`${onlyMine === 1 ? '1 wire' : `${onlyMine} wires`} only in yours.`);
  if (onlyTheirs)
    lines.push(`${onlyTheirs === 1 ? '1 wire' : `${onlyTheirs} wires`} only in theirs.`);
  return lines;
}
