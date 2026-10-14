import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import {
  BotIcon,
  type LucideIcon,
  ShieldCheckIcon,
  SplitIcon,
  WorkflowIcon,
  WrenchIcon,
} from 'lucide-react';
import { memo } from 'react';
import { cn } from '@/lib/utils';
import { STEP_STATE_WORD, type StateTone, stepTone } from '@/lib/workflow-layout';
import type { WorkflowPort, WorkflowStepStatus } from '@/types';

/** What a node draws. Built per render from the definition and, in run mode, the run. */
export type StepNodeData = {
  /** `trigger` for the workflow's inputs, else the step's kind (`agent_turn`, a plugin's own). */
  kind: string;
  label: string;
  stepId: string;
  /** The one thing the step is about, in the harness's words: its manifest, its tool. */
  detail?: string;
  inputs: WorkflowPort[];
  outputs: WorkflowPort[];
  /** Input ports with a wire into them: `when` is drawn only then. */
  wiredInputs: ReadonlySet<string>;
  /** Set in run mode only. */
  status?: WorkflowStepStatus;
  error?: string | null;
  /** The step's kind is not one this harness knows, or its config does not parse: ports unknown. */
  unknown?: boolean;
  /** A problem names this step: drawn in the definition view. */
  problems?: number;
};

export type StepNodeType = Node<StepNodeData, 'step'>;

/** A step kind's identity is an icon and a word, never a colour. */
const KIND: Record<string, { icon: LucideIcon; word: string }> = {
  trigger: { icon: WorkflowIcon, word: 'Inputs' },
  agent_turn: { icon: BotIcon, word: 'Agent turn' },
  tool_call: { icon: WrenchIcon, word: 'Tool call' },
  approval: { icon: ShieldCheckIcon, word: 'Approval gate' },
  branch: { icon: SplitIcon, word: 'Branch' },
};

/** Beyond this many ports on a side, the rest fold to one `+N more` row. */
const MAX_PORTS = 12;
/** A port row's height, and a node's without ports: `nodeHeight` lays out the column from them. */
const PORT_ROW = 24;
const NODE_CHROME = 64;

/** The height a node draws at, from its ports: the layout stacks a column by it. */
export function nodeHeight(inputs: number, outputs: number): number {
  const rows = Math.min(inputs, MAX_PORTS + 1) + Math.min(outputs, MAX_PORTS + 1);
  return NODE_CHROME + rows * PORT_ROW + (rows ? 12 : 0);
}

const TONE_TEXT: Record<StateTone, string> = {
  idle: 'text-muted-foreground',
  running: 'text-state-running',
  blocked: 'text-state-blocked',
  done: 'text-state-done',
  failed: 'text-state-failed',
};
const TONE_CHIP: Record<StateTone, string> = {
  idle: 'bg-ground',
  running: 'bg-solid-state-running/10',
  blocked: 'bg-solid-state-blocked/10',
  done: 'bg-solid-state-done/10',
  failed: 'bg-solid-state-failed/10',
};
const TONE_DOT: Record<StateTone, string> = {
  idle: 'bg-muted-foreground/50',
  // `animate-pulse` slows rather than stops under reduced motion (`index.css`): it still means working.
  running: 'bg-state-running animate-pulse',
  blocked: 'bg-state-blocked',
  done: 'bg-state-done',
  failed: 'bg-state-failed',
};

/** A step's state as a chip: the word and a dot, never the dot alone. */
export function StepStateChip({
  status,
  className,
}: {
  status: WorkflowStepStatus;
  className?: string;
}) {
  const tone = stepTone(status);
  return (
    <span
      className={cn(
        'inline-flex h-5.5 shrink-0 items-center gap-1.5 rounded-full px-2 text-xs font-medium',
        TONE_TEXT[tone],
        TONE_CHIP[tone],
        className,
      )}
    >
      <span aria-hidden className={cn('size-1.5 rounded-full', TONE_DOT[tone])} />
      {STEP_STATE_WORD[status]}
    </span>
  );
}

export function kindWord(kind: string): string {
  return KIND[kind]?.word ?? kind;
}

function PortRow({ port, side }: { port: WorkflowPort; side: 'in' | 'out' }) {
  return (
    <div
      className={cn(
        'relative flex h-6 items-center gap-1.5 px-3 text-xs',
        side === 'out' && 'flex-row-reverse text-right',
      )}
    >
      <Handle
        type={side === 'in' ? 'target' : 'source'}
        position={side === 'in' ? Position.Left : Position.Right}
        id={port.name}
        isConnectable={false}
        className={cn(
          '!size-2.5 !border-2 !border-background',
          port.control
            ? '!rotate-45 !rounded-[2px] !bg-muted-foreground'
            : '!rounded-full !bg-foreground/70',
        )}
      />
      <span className="min-w-0 truncate font-mono text-foreground">
        {port.name}
        {port.required && side === 'in' ? (
          <span className="text-muted-foreground" title="required">
            *
          </span>
        ) : null}
      </span>
      <span className="max-w-[50%] shrink-0 truncate font-mono text-muted-foreground">
        {port.control ? 'control' : port.type}
      </span>
    </div>
  );
}

function PortList({ ports, side }: { ports: WorkflowPort[]; side: 'in' | 'out' }) {
  const shown = ports.slice(0, MAX_PORTS);
  const folded = ports.slice(MAX_PORTS);
  return (
    <div>
      {shown.map((p) => (
        <PortRow key={p.name} port={p} side={side} />
      ))}
      {folded.length ? (
        <div
          className={cn(
            'relative h-6 px-3 text-xs leading-6 text-muted-foreground',
            side === 'out' && 'text-right',
          )}
        >
          {/* The folded ports keep their handles, stacked on this row, so a wire into one still draws. */}
          {folded.map((p) => (
            <Handle
              key={p.name}
              type={side === 'in' ? 'target' : 'source'}
              position={side === 'in' ? Position.Left : Position.Right}
              id={p.name}
              isConnectable={false}
              className="!size-2.5 !rounded-full !border-2 !border-background !bg-foreground/70"
            />
          ))}
          +{folded.length} more
        </div>
      ) : null}
    </div>
  );
}

function StepNodeView({ data, selected }: NodeProps<StepNodeType>) {
  const kind = KIND[data.kind];
  const Icon = kind?.icon ?? WorkflowIcon;
  const inputs = data.inputs.filter((p) => p.name !== 'when' || data.wiredInputs.has('when'));
  const quiet = data.status === 'skipped' || data.status === 'cancelled';
  return (
    <div
      className={cn(
        'w-72 rounded-xl border bg-card text-card-foreground shadow-sheet transition-shadow',
        // Quiet by tone, not opacity: a faded node took its 12px words under AA with it.
        quiet ? 'border-dashed border-muted-foreground/40' : 'border-border/60',
        // The one node the eye should find: a heavier amber edge and a tinted header, no new lift.
        data.status === 'waiting' && 'border-2 border-state-blocked/50',
        selected && 'ring-[3px] ring-ring',
      )}
    >
      <div
        className={cn(
          'flex items-start gap-2 rounded-t-xl px-3 pt-2.5 pb-2',
          data.status === 'waiting' && 'bg-solid-state-blocked/5',
        )}
      >
        <Icon
          aria-hidden
          className={cn(
            'mt-0.5 size-4 shrink-0',
            quiet ? 'text-muted-foreground' : 'text-foreground/70',
          )}
        />
        <div className="min-w-0 flex-1">
          <div
            className={cn('truncate text-sm font-semibold', quiet && 'text-muted-foreground')}
            title={data.label}
          >
            {data.label}
          </div>
          {data.kind === 'trigger' ? (
            <div className="truncate text-xs text-muted-foreground">{kind?.word}</div>
          ) : (
            <div
              className="truncate font-mono text-xs text-muted-foreground"
              title={data.detail ?? data.stepId}
            >
              {data.detail ?? data.stepId}
            </div>
          )}
        </div>
        {data.status ? <StepStateChip status={data.status} /> : null}
        {!data.status && data.problems ? (
          <span className="shrink-0 rounded-full bg-solid-state-failed/10 px-2 text-xs font-medium leading-5.5 text-state-failed">
            {data.problems === 1 ? '1 problem' : `${data.problems} problems`}
          </span>
        ) : null}
      </div>
      {data.unknown ? (
        <p className="border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
          {kindWord(data.kind)} · ports unknown
        </p>
      ) : inputs.length || data.outputs.length ? (
        <div className="border-t border-border/60 py-1.5">
          <PortList ports={inputs} side="in" />
          <PortList ports={data.outputs} side="out" />
        </div>
      ) : null}
      {data.status === 'failed' && data.error ? (
        <p
          className="line-clamp-2 border-t border-border/60 px-3 py-2 text-xs text-state-failed"
          title={data.error}
        >
          {data.error}
        </p>
      ) : null}
    </div>
  );
}

export const StepNode = memo(StepNodeView);
