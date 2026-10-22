import {
  Background,
  BackgroundVariant,
  type Connection,
  ControlButton,
  type Edge,
  MarkerType,
  MiniMap,
  type NodeChange,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { CrosshairIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Controls } from '@/components/ai-elements/controls';
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
  type StateTone,
  stepsOf,
  stepTone,
  TRIGGER,
  type Wire,
  wireState,
  wiresOf,
} from '@/lib/workflow-layout';
import type { WorkflowPortRef, WorkflowRecord, WorkflowRun, WorkflowStepStatus } from '@/types';

const NODE_TYPES = { step: StepNode };
const ARROWS: Record<string, Direction | undefined> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};
/** The least zoom a fit may choose: below it a port's 12px name renders under the type floor. */
const MIN_FIT_ZOOM = 0.8;
/** Past this many steps an overview earns its corner, when the canvas is wide enough to spare it. */
const MINIMAP_STEPS = 10;
const MINIMAP_MIN_WIDTH = 480;
/** The steps a run view frames: the ones working or waiting, and else the one that failed. */
const LIVE: readonly WorkflowStepStatus[] = ['running', 'waiting'];
const TONE_FILL: Record<StateTone, string> = {
  idle: 'var(--color-muted-foreground)',
  running: 'var(--color-state-running)',
  blocked: 'var(--color-state-blocked)',
  done: 'var(--color-state-done)',
  failed: 'var(--color-state-failed)',
};

const stillMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

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

/**
 * How tall each node draws, from its ports: what the layout stacks a column by. A run view keeps
 * room under every step for the error a failure prints, so a step failing mid-run never moves its
 * neighbours.
 */
export function heightsOf(
  workflow: WorkflowRecord,
  editable = false,
  runView = false,
): (id: string) => number {
  const wires = wiresOf(workflow.definition);
  const shownInputs = (id: string) =>
    (workflow.ports[id]?.inputs ?? []).filter(
      (p) =>
        p.name !== WHEN || editable || wires.some((w) => w.target === id && w.targetPort === WHEN),
    ).length;
  return (id) =>
    nodeHeight(shownInputs(id), workflow.ports[id]?.outputs.length ?? 0, {
      unknown: id !== TRIGGER && workflow.ports[id] == null,
      error: runView && id !== TRIGGER,
    });
}

/** The nodes for a workflow, in run mode with each step's state on it. */
export function buildNodes(
  workflow: WorkflowRecord,
  run?: WorkflowRun | null,
  editable = false,
): StepNodeType[] {
  const def = workflow.definition;
  const wires = wiresOf(def);
  const positions = positionsOf(def, { heightOf: heightsOf(workflow, editable, Boolean(run)) });
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

/**
 * A wire's stroke per state, drawn by class (`.wf-wire-*` in `index.css`) and never inline: React
 * Flow marks a selected or focused wire with a stylesheet rule, which an inline stroke outranks —
 * and then a wire picked for deleting looks like every other. The marker cannot take a class, so
 * it carries the same colour here.
 */
const WIRE_INK = {
  /** Before a run, and a wire the run has not reached. */
  plain: 'var(--color-muted-foreground)',
  /** A wire the run carried a value down: the ink a reader follows. */
  taken: 'var(--color-foreground)',
  /** A wire the run went by: a hairline. */
  passed: 'var(--color-border)',
} as const;
const SELECTED_INK = 'var(--color-ring)';

const marker = (color: string) => ({
  type: MarkerType.ArrowClosed,
  width: 14,
  height: 14,
  color,
});

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
    const ink = state === 'taken' ? 'taken' : state === 'passed' ? 'passed' : 'plain';
    const dashed = state === 'passed' && (target === 'skipped' || target === 'cancelled');
    return {
      id: w.id,
      source: w.source,
      sourceHandle: w.sourcePort,
      target: w.target,
      targetHandle: w.targetPort,
      type: 'smoothstep',
      className: `wf-wire wf-wire-${ink}${dashed ? ' wf-wire-dashed' : ''}`,
      markerEnd: marker(WIRE_INK[ink]),
      // While editing a wire is a thing to select and delete; otherwise the nodes carry focus.
      focusable: editable,
      selectable: editable,
      ariaLabel: `${w.source}.${w.sourcePort} to ${w.target}.${w.targetPort}${state ? `, ${state === 'ahead' ? 'not reached' : state}` : ''}`,
    };
  });
}

/**
 * Whether a wire from `out` into `into` is one the canvas lets be drawn. A drop the harness would
 * refuse anyway is refused before it is drawn: into itself, a loop, the workflow's inputs, or a
 * control port wired to a data port. A type mismatch is the harness's check to judge.
 */
export function wireFits(
  workflow: WorkflowRecord,
  out: { node: string; port: string },
  into: { node: string; port: string },
): boolean {
  if (into.node === TRIGGER || wouldCycle(workflow.definition, out.node, into.node)) return false;
  const from = workflow.ports[out.node]?.outputs.find((p) => p.name === out.port);
  const to = workflow.ports[into.node]?.inputs.find((p) => p.name === into.port);
  return !from || !to || from.control === to.control;
}

const sameSet = (a: ReadonlySet<string> | undefined, b: ReadonlySet<string> | undefined) =>
  a === b || (a != null && b != null && a.size === b.size && [...a].every((v) => b.has(v)));
const samePorts = (a: StepNodeData['inputs'], b: StepNodeData['inputs']) =>
  a === b || JSON.stringify(a) === JSON.stringify(b);
const SCALARS = [
  'kind',
  'label',
  'stepId',
  'detail',
  'status',
  'error',
  'unknown',
  'problems',
  'editable',
] as const satisfies readonly (keyof StepNodeData)[];

/** Whether a rebuilt node draws exactly what the one on the canvas already draws. */
function sameNode(a: StepNodeType, b: StepNodeType): boolean {
  return (
    a.selected === b.selected &&
    a.ariaLabel === b.ariaLabel &&
    a.deletable === b.deletable &&
    a.position.x === b.position.x &&
    a.position.y === b.position.y &&
    SCALARS.every((k) => a.data[k] === b.data[k]) &&
    samePorts(a.data.inputs, b.data.inputs) &&
    samePorts(a.data.outputs, b.data.outputs) &&
    sameSet(a.data.wiredInputs, b.data.wiredInputs) &&
    sameSet(a.data.unreachable, b.data.unreachable)
  );
}

/**
 * The canvas's nodes after a rebuild. Every poll rebuilds them as fresh objects, which defeats the
 * memoised node and redraws every step every two seconds, so a node that draws the same is kept as
 * the very object on the canvas. A changed one keeps the size React Flow measured: a node handed
 * over without it is hidden until measured again — which, its DOM size unchanged, it never is.
 */
export function keepNodes(prev: StepNodeType[], built: StepNodeType[]): StepNodeType[] {
  const old = new Map(prev.map((n) => [n.id, n]));
  const next = built.map((n) => {
    const o = old.get(n.id);
    if (!o) return n;
    return sameNode(o, n) ? o : { ...n, measured: o.measured };
  });
  return next.length === prev.length && next.every((n, i) => n === prev[i]) ? prev : next;
}

/** The wires after a rebuild: kept when they draw the same, and a selected wire stays selected. */
export function keepEdges(prev: Edge[], built: Edge[]): Edge[] {
  const old = new Map(prev.map((e) => [e.id, e]));
  const next = built.map((e) => {
    const o = old.get(e.id);
    if (!o) return e;
    const same =
      o.className === e.className &&
      o.ariaLabel === e.ariaLabel &&
      o.focusable === e.focusable &&
      o.selectable === e.selectable &&
      JSON.stringify(o.markerEnd) === JSON.stringify(e.markerEnd);
    return same ? o : { ...e, selected: Boolean(o.selected) };
  });
  return next.length === prev.length && next.every((e, i) => e === prev[i]) ? prev : next;
}

/** What the editor does with the canvas: every change goes back through the page's draft. */
export interface CanvasEditing {
  /** Nodes the author dragged, where they were dropped. */
  onMove: (moves: { id: string; position: { x: number; y: number } }[]) => void;
  onConnect: (edge: { source: WorkflowPortRef; target: WorkflowPortRef }) => void;
  /** Steps and wires (by canvas id) the author deleted with the keyboard. */
  onDelete: (removed: { steps: string[]; edges: string[] }) => void;
}

interface CanvasProps {
  workflow: WorkflowRecord;
  run?: WorkflowRun | null;
  selected: string | null;
  onSelect: (stepId: string | null) => void;
  editing?: CanvasEditing | undefined;
  /** The page's full-screen state: entering or leaving it reframes the graph for the new size. */
  fullScreen?: boolean;
}

function Canvas({ workflow, run, selected, onSelect, editing, fullScreen = false }: CanvasProps) {
  const editable = Boolean(editing);
  const rootRef = useRef<HTMLDivElement>(null);
  // A node's element in this canvas, never the document's: a second canvas would hold the same ids.
  const nodeEl = useCallback(
    (id: string) =>
      rootRef.current?.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`),
    [],
  );
  // The output a wire is being dragged from, while one is: every input it may not land on is drawn
  // quiet, so the ones it may stand out before the drop rather than after it.
  const [dragging, setDragging] = useState<{ node: string; port: string } | null>(null);
  const built = useMemo(
    () =>
      buildNodes(workflow, run, editable).map((n) => ({
        ...n,
        selected: n.id === selected,
        ...(dragging
          ? {
              data: {
                ...n.data,
                unreachable: new Set(
                  n.data.inputs
                    .filter(
                      (into) => !wireFits(workflow, dragging, { node: n.id, port: into.name }),
                    )
                    .map((into) => into.name),
                ),
              },
            }
          : {}),
      })),
    [workflow, run, selected, editable, dragging],
  );
  // Held in the flow's own state, not passed fresh, and merged by `keepNodes`: it keeps what React
  // Flow measured and leaves a step that draws the same alone.
  const [nodes, setNodes, onNodesChange] = useNodesState<StepNodeType>(built);
  useEffect(() => setNodes((prev) => keepNodes(prev, built)), [built, setNodes]);
  const builtEdges = useMemo(() => buildEdges(workflow, run, editable), [workflow, run, editable]);
  // Held like the nodes, so a wire selected for deleting stays selected across a rebuild.
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(builtEdges);
  useEffect(() => setEdges((prev) => keepEdges(prev, builtEdges)), [builtEdges, setEdges]);
  // A selected wire's stroke turns to the ring by class; its arrowhead has to be told.
  const drawnEdges = useMemo(
    () => edges.map((e) => (e.selected ? { ...e, markerEnd: marker(SELECTED_INK) } : e)),
    [edges],
  );

  const isValidConnection = useCallback(
    (c: Connection | Edge) =>
      Boolean(c.source && c.target && c.sourceHandle && c.targetHandle) &&
      wireFits(
        workflow,
        { node: c.source, port: c.sourceHandle as string },
        { node: c.target, port: c.targetHandle as string },
      ),
    [workflow],
  );
  const { fitView, getViewport, setViewport } = useReactFlow();

  // The steps a run view frames: the ones working or waiting, else the ones that failed.
  const statusOf = (status: WorkflowStepStatus) =>
    run
      ? stepsOf(workflow.definition)
          .filter((s) => run.steps[s.id]?.status === status)
          .map((s) => s.id)
      : [];
  const live = LIVE.flatMap(statusOf);
  const liveKey = live.join(',');
  const followKey = run ? `${liveKey}|${statusOf('failed').join(',')}` : '';
  const focusRef = useRef<string[]>([]);
  focusRef.current = live.length ? live : statusOf('failed');
  const wiresRef = useRef(wiresOf(workflow.definition));
  wiresRef.current = wiresOf(workflow.definition);

  // Whether a person has moved the view — panned, zoomed, walked the graph with the keys. Until
  // then the canvas frames itself, again on every resize and as the run moves; after, it leaves
  // the view where they put it until they ask (Go to live step) or open something else.
  const taken = useRef(false);
  const frame = useCallback(
    (animate = false) => {
      if (taken.current) return;
      const duration = animate && !stillMotion() ? 200 : 0;
      const focus = focusRef.current;
      if (focus.length) {
        // A framed step keeps what leads into and out of it, so it is read in place.
        const ids = new Set(focus);
        for (const w of wiresRef.current) {
          if (focus.includes(w.target)) ids.add(w.source);
          if (focus.includes(w.source)) ids.add(w.target);
        }
        void fitView({
          nodes: [...ids].map((id) => ({ id })),
          padding: 0.15,
          minZoom: MIN_FIT_ZOOM,
          maxZoom: 1,
          duration,
        });
        return;
      }
      // Never below MIN_FIT_ZOOM: past it the ports drop under the 12px floor. A graph that does not
      // fit at that zoom starts from its left edge, where the workflow begins, and pans from there.
      void fitView({ padding: 0.12, minZoom: MIN_FIT_ZOOM, maxZoom: 1, duration }).then(() => {
        const { y, zoom } = getViewport();
        if (zoom <= MIN_FIT_ZOOM) void setViewport({ x: 24 - ORIGIN.x * zoom, y, zoom });
      });
    },
    [fitView, getViewport, setViewport],
  );
  // A new workflow, a different run, the other view or full screen: the view is the canvas's again.
  const runId = run?.id ?? null;
  useEffect(() => {
    // Read so the effect re-runs on each; the frame itself reads the canvas as it is then.
    void [workflow.id, runId, fullScreen];
    taken.current = false;
    const t = window.setTimeout(() => frame(), 30);
    return () => window.clearTimeout(t);
  }, [workflow.id, runId, fullScreen, frame]);
  // The sheet settles its size after the first frame (the pane, the sidebar, a phone stacking the
  // layout), and a fit made at the old size leaves the graph in a corner.
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let t: number | undefined;
    const ro = new ResizeObserver(() => {
      setNarrow(el.clientWidth < MINIMAP_MIN_WIDTH);
      window.clearTimeout(t);
      t = window.setTimeout(() => frame(), 60);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      window.clearTimeout(t);
    };
  }, [frame]);
  // Follow the run: when another step starts, waits or fails, bring it into view.
  const followed = useRef(followKey);
  useEffect(() => {
    if (followed.current === followKey) return;
    followed.current = followKey;
    if (!followKey || editable) return;
    const t = window.setTimeout(() => frame(true), 60);
    return () => window.clearTimeout(t);
  }, [followKey, editable, frame]);
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
    // A step chosen by name is where the person is looking now; the run no longer moves the view.
    taken.current = true;
    void fitView({
      nodes: [{ id: selected }],
      minZoom: MIN_FIT_ZOOM,
      maxZoom: 1,
      duration: stillMotion() ? 0 : 200,
    });
    // On the next frame: a step just added from the palette has no element until React Flow has
    // drawn it, and focus left on the palette button would leave Delete meaning nothing.
    const id = selected;
    requestAnimationFrame(() => nodeEl(id)?.focus());
  }, [selected, fitView, nodeEl]);

  return (
    <ReactFlow
      ref={rootRef}
      nodes={nodes}
      onNodesChange={onNodesChangeAndSelect}
      edges={drawnEdges}
      onEdgesChange={onEdgesChange}
      nodeTypes={NODE_TYPES}
      nodesDraggable={editable}
      nodesConnectable={editable}
      isValidConnection={isValidConnection}
      onConnectStart={(_e, { nodeId, handleId, handleType }) => {
        if (editable && nodeId && handleId && handleType === 'source') {
          setDragging({ node: nodeId, port: handleId });
        }
      }}
      onConnectEnd={() => setDragging(null)}
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
        taken.current = true;
        onSelect(null);
        nodeEl(TRIGGER)?.focus();
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
      // Only a person's pan or zoom carries an event; the canvas framing itself does not.
      onMoveStart={(event) => {
        if (event) taken.current = true;
      }}
      panOnScroll
      minZoom={0.3}
      maxZoom={1.5}
      proOptions={{ hideAttribution: true }}
      // A focused node shows an outline offset from its card, apart from the selected ring; React
      // Flow's own sheet removes the outline, unlayered, so these win with `!`.
      className="bg-ground [&_.react-flow__node:focus-visible]:rounded-xl [&_.react-flow__node:focus-visible]:outline-[3px]! [&_.react-flow__node:focus-visible]:outline-offset-4! [&_.react-flow__node:focus-visible]:outline-ring!"
      aria-label={`${workflow.definition.name}: ${stepsOf(workflow.definition).length} steps`}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--color-border)" />
      {/* Zooming is a pinch or ⌘/Ctrl+scroll under `panOnScroll`, which nothing else says. */}
      <Controls
        showInteractive={false}
        position="bottom-left"
        fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
        onFitView={() => {
          // The whole graph, at whatever zoom it takes: the person asked for the overview.
          taken.current = true;
        }}
      >
        {live.length && !editable ? (
          <ControlButton
            aria-label="Go to live step"
            title="Go to live step"
            onClick={() => {
              taken.current = false;
              frame(true);
            }}
          >
            <CrosshairIcon />
          </ControlButton>
        ) : null}
      </Controls>
      {/* On a narrow canvas the map would cover the steps it summarises. */}
      {stepsOf(workflow.definition).length > MINIMAP_STEPS && !narrow ? (
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          ariaLabel="Overview of the workflow"
          style={{ width: 150, height: 100 }}
          nodeColor={(n) => {
            const status = (n.data as StepNodeData).status;
            return status ? TONE_FILL[stepTone(status)] : TONE_FILL.idle;
          }}
        />
      ) : null}
    </ReactFlow>
  );
}

/** The workflow's graph: one canvas for the definition, edited or not, and for a run of it. */
export function WorkflowCanvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
