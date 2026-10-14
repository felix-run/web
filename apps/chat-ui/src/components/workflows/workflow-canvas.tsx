import {
  type Edge,
  MarkerType,
  type OnSelectionChangeParams,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  nodeHeight,
  StepNode,
  type StepNodeData,
  type StepNodeType,
} from '@/components/workflows/step-node';
import {
  ORIGIN,
  positionsOf,
  stepsOf,
  TRIGGER,
  type Wire,
  wireState,
  wiresOf,
} from '@/lib/workflow-layout';
import type { WorkflowRecord, WorkflowRun } from '@/types';

const NODE_TYPES = { step: StepNode };
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

/** The nodes for a workflow, in run mode with each step's state on it. */
export function buildNodes(workflow: WorkflowRecord, run?: WorkflowRun | null): StepNodeType[] {
  const def = workflow.definition;
  const wires = wiresOf(def);
  const shownInputs = (id: string) =>
    (workflow.ports[id]?.inputs ?? []).filter(
      (p) => p.name !== 'when' || wires.some((w) => w.target === id && w.targetPort === 'when'),
    ).length;
  const positions = positionsOf(def, {
    heightOf: (id) => nodeHeight(shownInputs(id), workflow.ports[id]?.outputs.length ?? 0),
  });
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
    },
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
export function buildEdges(workflow: WorkflowRecord, run?: WorkflowRun | null): Edge[] {
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
      focusable: false,
      ariaLabel: `${w.source}.${w.sourcePort} to ${w.target}.${w.targetPort}${state ? `, ${state === 'ahead' ? 'not reached' : state}` : ''}`,
    };
  });
}

function Canvas({
  workflow,
  run,
  selected,
  onSelect,
}: {
  workflow: WorkflowRecord;
  run?: WorkflowRun | null;
  selected: string | null;
  onSelect: (stepId: string | null) => void;
}) {
  const built = useMemo(
    () => buildNodes(workflow, run).map((n) => ({ ...n, selected: n.id === selected })),
    [workflow, run, selected],
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
  const edges = useMemo(() => buildEdges(workflow, run), [workflow, run]);
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
  // Selection from the canvas — a click, or Enter on a focused node, which React Flow reports here
  // and never as a click — versus from elsewhere (a Problems row), which also brings the node into
  // view and focus, since the canvas fits once and the node may be off it.
  const fromCanvas = useRef(false);
  const onSelectionChange = useCallback(
    ({ nodes: picked }: OnSelectionChangeParams) => {
      const id = picked[0]?.id ?? null;
      const next = id === TRIGGER ? null : id;
      if (next === selected) return;
      fromCanvas.current = true;
      onSelect(next);
    },
    [onSelect, selected],
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
    document
      .querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(selected)}"]`)
      ?.focus();
  }, [selected, fitView]);

  return (
    <ReactFlow
      nodes={nodes}
      onNodesChange={onNodesChange}
      edges={edges}
      nodeTypes={NODE_TYPES}
      onSelectionChange={onSelectionChange}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      deleteKeyCode={null}
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

/** The workflow's graph: one canvas for the definition and for a run of it. */
export function WorkflowCanvas(props: {
  workflow: WorkflowRecord;
  run?: WorkflowRun | null;
  selected: string | null;
  onSelect: (stepId: string | null) => void;
}) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
