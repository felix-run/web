import {
  type Connection,
  type Edge,
  MarkerType,
  type NodeChange,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  nodeHeight,
  StepNode,
  type StepNodeData,
  type StepNodeType,
} from '@/components/workflows/step-node';
import { WHEN, wouldCycle } from '@/lib/workflow-draft';
import {
  type Direction,
  neighbourOf,
  ORIGIN,
  positionsOf,
  stepsOf,
  TRIGGER,
  type Wire,
  wireState,
  wiresOf,
} from '@/lib/workflow-layout';
import type { WorkflowPortRef, WorkflowRecord, WorkflowRun } from '@/types';

const NODE_TYPES = { step: StepNode };
const ARROWS: Record<string, Direction | undefined> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};
/** The least zoom a fit may choose: below it a port's 12px name renders under the type floor. */
const MIN_FIT_ZOOM = 0.8;

/** One step's line in the summary a screen reader hears on focus: React Flow makes each node a group. */
function ariaLabel(d: StepNodeData): string {
  const parts = [d.label, d.kind === 'trigger' ? 'workflow inputs' : d.kind.replaceAll('_', ' ')];
  if (d.status) parts.push(`status ${d.status}`);
  if (d.problems) parts.push(d.problems === 1 ? '1 problem' : `${d.problems} problems`);
  return parts.join(', ');
}

function detailOf(config: Record<string, unknown> | undefined): string | undefined {
  if (!config) return undefined;
  const manifest = typeof config.manifest === 'string' ? config.manifest : undefined;
  const tool = typeof config.tool === 'string' ? config.tool : undefined;
  if (tool && manifest) return `${manifest} · ${tool}`;
  return manifest ?? tool;
}

/** How tall each node draws, from its ports: what the layout stacks a column by. */
export function heightsOf(workflow: WorkflowRecord, editable = false): (id: string) => number {
  const wires = wiresOf(workflow.definition);
  const shownInputs = (id: string) =>
    (workflow.ports[id]?.inputs ?? []).filter(
      (p) =>
        p.name !== WHEN || editable || wires.some((w) => w.target === id && w.targetPort === WHEN),
    ).length;
  return (id) => nodeHeight(shownInputs(id), workflow.ports[id]?.outputs.length ?? 0);
}

/** The nodes for a workflow, in run mode with each step's state on it. */
export function buildNodes(
  workflow: WorkflowRecord,
  run?: WorkflowRun | null,
  editable = false,
): StepNodeType[] {
  const def = workflow.definition;
  const wires = wiresOf(def);
  const positions = positionsOf(def, { heightOf: heightsOf(workflow, editable) });
  const wiredInto = (id: string) =>
    new Set(wires.filter((w) => w.target === id).map((w) => w.targetPort));
  const problemsAt = (id: string) => workflow.problems.filter((p) => p.step === id).length;
  const trigger: StepNodeType = {
    id: TRIGGER,
    type: 'step',
    position: positions.get(TRIGGER) ?? { x: 0, y: 0 },
    data: {
      kind: 'trigger',
      label: def.name,
      stepId: TRIGGER,
      inputs: [],
      outputs: workflow.ports[TRIGGER]?.outputs ?? [],
      wiredInputs: new Set(),
      editable,
    },
    // The workflow's inputs are not a step: there is nothing to delete.
    deletable: false,
  };
  const steps = stepsOf(def).map((s): StepNodeType => {
    const ports = workflow.ports[s.id];
    const state = run?.steps[s.id];
    return {
      id: s.id,
      type: 'step',
      position: positions.get(s.id) ?? { x: 0, y: 0 },
      data: {
        kind: s.kind,
        label: s.name || s.id,
        stepId: s.id,
        detail: detailOf(s.config),
        inputs: ports?.inputs ?? [],
        outputs: ports?.outputs ?? [],
        wiredInputs: wiredInto(s.id),
        unknown: ports == null,
        problems: run ? undefined : problemsAt(s.id),
        status: state?.status,
        error: state?.error,
        editable,
      },
    };
  });
  return [trigger, ...steps].map((n) => ({ ...n, ariaLabel: ariaLabel(n.data) }));
}

/** Before a run, and a wire the run has not reached: plain. */
const PLAIN = { stroke: 'var(--color-muted-foreground)', strokeWidth: 1.5 };
/** A wire the run carried a value down: the ink a reader follows. */
const TAKEN = { stroke: 'var(--color-foreground)', strokeWidth: 2 };
/** A wire the run went by: a hairline. */
const PASSED = { stroke: 'var(--color-border)', strokeWidth: 1 };

/**
 * The wires, drawn by what the run did with them (`wireState`). Before a run every wire is plain.
 * In a run, a wire it took is drawn in ink, one it went by fades to a hairline (dashed where it
 * leads into a skipped or cancelled step), and one it has not reached stays plain — so the path the
 * run followed reads at a glance, and nothing claims to have been passed that is still ahead. No
 * animated wires: live state is the nodes' to show.
 */
export function buildEdges(
  workflow: WorkflowRecord,
  run?: WorkflowRun | null,
  editable = false,
): Edge[] {
  const controlOut = (w: Wire) =>
    Boolean(workflow.ports[w.source]?.outputs.find((p) => p.name === w.sourcePort)?.control);
  return wiresOf(workflow.definition).map((w) => {
    const state = run ? wireState(w, run, controlOut(w)) : null;
    const target = run?.steps[w.target]?.status;
    const style = state === 'taken' ? TAKEN : state === 'passed' ? PASSED : PLAIN;
    const dashed = state === 'passed' && (target === 'skipped' || target === 'cancelled');
    return {
      id: w.id,
      source: w.source,
      sourceHandle: w.sourcePort,
      target: w.target,
      targetHandle: w.targetPort,
      type: 'smoothstep',
      style: dashed ? { ...style, strokeDasharray: '4 4' } : style,
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: style.stroke },
      // While editing a wire is a thing to select and delete; otherwise the nodes carry focus.
      focusable: editable,
      selectable: editable,
      ariaLabel: `${w.source}.${w.sourcePort} to ${w.target}.${w.targetPort}${state ? `, ${state === 'ahead' ? 'not reached' : state}` : ''}`,
    };
  });
}

/** What the editor does with the canvas: every change goes back through the page's draft. */
export interface CanvasEditing {
  /** Nodes the author dragged, where they were dropped. */
  onMove: (moves: { id: string; position: { x: number; y: number } }[]) => void;
  onConnect: (edge: { source: WorkflowPortRef; target: WorkflowPortRef }) => void;
  /** Steps and wires (by canvas id) the author deleted with the keyboard. */
  onDelete: (removed: { steps: string[]; edges: string[] }) => void;
}

function Canvas({
  workflow,
  run,
  selected,
  onSelect,
  editing,
}: {
  workflow: WorkflowRecord;
  run?: WorkflowRun | null;
  selected: string | null;
  onSelect: (stepId: string | null) => void;
  editing?: CanvasEditing | undefined;
}) {
  const editable = Boolean(editing);
  const built = useMemo(
    () => buildNodes(workflow, run, editable).map((n) => ({ ...n, selected: n.id === selected })),
    [workflow, run, selected, editable],
  );
  // Held in the flow's own state, not passed fresh: every poll rebuilds the nodes, and a node handed
  // over without the size React Flow measured is hidden until measured again — which, its DOM size
  // unchanged, it never is. So each rebuild keeps what was measured.
  const [nodes, setNodes, onNodesChange] = useNodesState<StepNodeType>(built);
  useEffect(() => {
    setNodes((prev) => {
      const measured = new Map(prev.map((n) => [n.id, n.measured]));
      return built.map((n) => ({ ...n, measured: measured.get(n.id) }));
    });
  }, [built, setNodes]);
  const builtEdges = useMemo(() => buildEdges(workflow, run, editable), [workflow, run, editable]);
  // Held like the nodes, so a wire selected for deleting stays selected across a rebuild.
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(builtEdges);
  useEffect(() => {
    setEdges((prev) => {
      const picked = new Set(prev.filter((e) => e.selected).map((e) => e.id));
      return builtEdges.map((e) => ({ ...e, selected: picked.has(e.id) }));
    });
  }, [builtEdges, setEdges]);

  // A drop the harness would refuse anyway is refused here, before it is drawn: into itself, a
  // loop, or a control port wired to a data port. A type mismatch is the check's to judge.
  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      const source = c.source;
      const target = c.target;
      const sourcePort = c.sourceHandle;
      const targetPort = c.targetHandle;
      if (!source || !target || !sourcePort || !targetPort) return false;
      if (target === TRIGGER || wouldCycle(workflow.definition, source, target)) return false;
      const out = workflow.ports[source]?.outputs.find((p) => p.name === sourcePort);
      const into = workflow.ports[target]?.inputs.find((p) => p.name === targetPort);
      return !out || !into || out.control === into.control;
    },
    [workflow],
  );
  const { fitView, getViewport, setViewport } = useReactFlow();
  // Fit once per workflow: a status change, a poll or a selection never moves the view.
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (fitted.current === workflow.id) return;
    fitted.current = workflow.id;
    requestAnimationFrame(() => {
      // Never below MIN_FIT_ZOOM: past it the ports drop under the 12px floor. A graph that does not
      // fit at that zoom starts from its left edge, where the workflow begins, and pans from there.
      void fitView({ padding: 0.12, minZoom: MIN_FIT_ZOOM, maxZoom: 1 }).then(() => {
        const { y, zoom } = getViewport();
        if (zoom <= MIN_FIT_ZOOM) void setViewport({ x: 24 - ORIGIN.x * zoom, y, zoom });
      });
    });
  }, [workflow.id, fitView, getViewport, setViewport]);
  // Selection from the canvas — a click, Enter on a focused node, a click on the empty canvas —
  // versus from elsewhere (a Problems row, a step just added), which also brings the node into view
  // and focus, since the canvas fits once and the node may be off it.
  //
  // Read from the `select` changes React Flow emits, which are only ever a person's doing, and not
  // from `onSelectionChange`, which also reports the selection the page hands in — late. Answering
  // those reports re-selected a step the person had just deselected, and a step added from the
  // palette flipped between selected and not until React gave up.
  const fromCanvas = useRef(false);
  const [focused, setFocused] = useState(false);
  const onNodesChangeAndSelect = useCallback(
    (changes: NodeChange<StepNodeType>[]) => {
      onNodesChange(changes);
      const picks = changes.filter((c) => c.type === 'select');
      if (!picks.length) return;
      const on = picks.find((c) => c.selected);
      const next = on && on.id !== TRIGGER ? on.id : null;
      if (next === selected) return;
      fromCanvas.current = true;
      onSelect(next);
    },
    [onNodesChange, onSelect, selected],
  );
  useEffect(() => {
    if (fromCanvas.current) {
      fromCanvas.current = false;
      return;
    }
    if (!selected) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    void fitView({
      nodes: [{ id: selected }],
      minZoom: MIN_FIT_ZOOM,
      maxZoom: 1,
      duration: still ? 0 : 200,
    });
    // On the next frame: a step just added from the palette has no element until React Flow has
    // drawn it, and focus left on the palette button would leave Delete meaning nothing.
    const id = selected;
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`)
        ?.focus(),
    );
  }, [selected, fitView]);

  return (
    <ReactFlow
      nodes={nodes}
      onNodesChange={onNodesChangeAndSelect}
      edges={edges}
      onEdgesChange={onEdgesChange}
      nodeTypes={NODE_TYPES}
      nodesDraggable={editable}
      nodesConnectable={editable}
      isValidConnection={isValidConnection}
      onConnect={(c) => {
        if (!editing || !isValidConnection(c)) return;
        editing.onConnect({
          source: { step: c.source, port: c.sourceHandle as string },
          target: { step: c.target, port: c.targetHandle as string },
        });
      }}
      // Arrow keys on a focused node move along the graph (`neighbourOf`) — and, caught here before
      // React Flow's own handler, never nudge a draggable node a few pixels instead.
      onKeyDownCapture={(e) => {
        const direction = ARROWS[e.key];
        const from = direction
          ? (e.target as HTMLElement).closest('.react-flow__node')?.getAttribute('data-id')
          : null;
        if (!direction || !from || e.altKey || e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        e.stopPropagation();
        const positions = new Map(nodes.map((n) => [n.id, n.position]));
        const next = neighbourOf(positions, wiresOf(workflow.definition), from, direction);
        if (!next) return;
        if (next !== TRIGGER) {
          onSelect(next);
          return;
        }
        // The inputs are not a step to select, so they take focus alone.
        onSelect(null);
        document.querySelector<HTMLElement>(`.react-flow__node[data-id="${TRIGGER}"]`)?.focus();
      }}
      onNodeDragStop={(_event, _node, dragged) =>
        editing?.onMove(dragged.map((n) => ({ id: n.id, position: n.position })))
      }
      onDelete={({ nodes: gone, edges: cut }) =>
        editing?.onDelete({
          steps: gone.map((n) => n.id).filter((id) => id !== TRIGGER),
          edges: cut.map((e) => e.id),
        })
      }
      elementsSelectable
      // Only while focus is on the canvas: React Flow listens on the whole document, so Backspace
      // on a palette button or an inspector control would otherwise delete the selected step.
      deleteKeyCode={editable && focused ? ['Backspace', 'Delete'] : null}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
      panOnScroll
      minZoom={0.3}
      maxZoom={1.5}
      proOptions={{ hideAttribution: true }}
      // A focused node shows an outline offset from its card, apart from the selected ring; React
      // Flow's own sheet removes the outline, unlayered, so these win with `!`.
      className="bg-ground [&_.react-flow__node:focus-visible]:rounded-xl [&_.react-flow__node:focus-visible]:outline-[3px]! [&_.react-flow__node:focus-visible]:outline-offset-4! [&_.react-flow__node:focus-visible]:outline-ring!"
      aria-label={`${workflow.definition.name}: ${stepsOf(workflow.definition).length} steps`}
    />
  );
}

/** The workflow's graph: one canvas for the definition, edited or not, and for a run of it. */
export function WorkflowCanvas(props: {
  workflow: WorkflowRecord;
  run?: WorkflowRun | null;
  selected: string | null;
  onSelect: (stepId: string | null) => void;
  editing?: CanvasEditing | undefined;
}) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
