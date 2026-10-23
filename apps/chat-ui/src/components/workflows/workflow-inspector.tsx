import { isClosedApproval } from '@felix/client';
import { cancelWorkflowRun, decideApproval } from '@/api';
import { ApprovalDecision, CodePane } from '@/components/approval/approval-decision';
import { ConfirmButton } from '@/components/confirm-button';
import { CutId } from '@/components/cut-id';
import { ErrorNotice } from '@/components/error-notice';
import { Fact, Facts, PageSection } from '@/components/harness/panel';
import { relTime } from '@/components/inspector/primitives';
import { AuthorshipFact } from '@/components/workflows/authorship';
import { kindWord, StepStateChip } from '@/components/workflows/step-node';
import { StepTranscript } from '@/components/workflows/step-transcript';
import { cn } from '@/lib/utils';
import { useOptionalShell } from '@/shell-context';
import type {
  WorkflowProblem,
  WorkflowRecord,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowStepDef,
} from '@/types';

export const RUN_LIVE: ReadonlySet<WorkflowRunStatus> = new Set([
  'pending',
  'running',
  'waiting',
  'cancelling',
]);

const RUN_WORD: Record<WorkflowRunStatus, string> = {
  pending: 'Starting',
  running: 'Running',
  waiting: 'Waiting on you',
  cancelling: 'Cancelling',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

const RUN_TONE: Record<WorkflowRunStatus, string> = {
  pending: 'text-state-running',
  running: 'text-state-running',
  waiting: 'text-state-blocked',
  cancelling: 'text-muted-foreground',
  completed: 'text-state-done',
  failed: 'text-state-failed',
  cancelled: 'text-muted-foreground',
  expired: 'text-state-failed',
};

const RUN_DOT: Record<WorkflowRunStatus, string> = {
  pending: 'bg-state-running animate-pulse',
  running: 'bg-state-running animate-pulse',
  waiting: 'bg-state-blocked',
  cancelling: 'bg-muted-foreground/50',
  completed: 'bg-state-done',
  failed: 'bg-state-failed',
  cancelled: 'bg-muted-foreground/50',
  expired: 'bg-state-failed',
};

/** A run's state, as the run readout says one: a dot and the word, the word a Statement. */
export function RunState({ status, className }: { status: WorkflowRunStatus; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', RUN_TONE[status], className)}>
      <span aria-hidden className={cn('size-2 rounded-full', RUN_DOT[status])} />
      {RUN_WORD[status]}
    </span>
  );
}

export function runWord(status: WorkflowRunStatus): string {
  return RUN_WORD[status];
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** A step's config as the author wrote it, label by label; anything else falls to JSON. */
function ConfigFacts({ step }: { step: WorkflowStepDef }) {
  const config = step.config ?? {};
  const { manifest, tool, prompt, args, output_schema, input_schema, cases, ttl_seconds, ...rest } =
    config;
  return (
    <>
      <Facts>
        <Fact label="Kind">{kindWord(step.kind)}</Fact>
        <Fact label="Step" mono>
          {step.id}
        </Fact>
        {typeof manifest === 'string' ? (
          <Fact label="Manifest" mono>
            {manifest}
          </Fact>
        ) : null}
        {typeof tool === 'string' ? (
          <Fact label="Tool" mono>
            {tool}
          </Fact>
        ) : null}
        {Array.isArray(cases) ? (
          <Fact label="Cases" mono={cases.length > 0}>
            {cases.length ? cases.join(', ') : 'true / false'}
          </Fact>
        ) : null}
        {typeof ttl_seconds === 'number' ? <Fact label="Expires after">{ttl_seconds}s</Fact> : null}
      </Facts>
      {typeof prompt === 'string' && prompt ? (
        <div className="mt-3">
          <CodePane label="Prompt">{prompt}</CodePane>
        </div>
      ) : null}
      {args && typeof args === 'object' && Object.keys(args).length ? (
        <div className="mt-3">
          <CodePane label="Fixed arguments">{json(args)}</CodePane>
        </div>
      ) : null}
      {output_schema ? (
        <div className="mt-3">
          <CodePane label="Output schema">{json(output_schema)}</CodePane>
        </div>
      ) : null}
      {input_schema && typeof input_schema === 'object' && Object.keys(input_schema).length ? (
        <div className="mt-3">
          <CodePane label="Input schema, as wired">{json(input_schema)}</CodePane>
        </div>
      ) : null}
      {Object.keys(rest).length ? (
        <div className="mt-3">
          <CodePane label="Config">{json(rest)}</CodePane>
        </div>
      ) : null}
    </>
  );
}

function ProblemText({ problem: p }: { problem: WorkflowProblem }) {
  return (
    <>
      <span className="text-state-failed">{p.message}</span>
      <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
        {p.code}
        {p.step ? ` · ${p.step}${p.port ? `.${p.port}` : ''}` : ''}
      </span>
    </>
  );
}

export function Problems({
  problems,
  onSelect,
}: {
  problems: WorkflowProblem[];
  onSelect: (stepId: string | null) => void;
}) {
  if (!problems.length) {
    return <p className="text-sm text-muted-foreground">None: the workflow can run.</p>;
  }
  return (
    <ul className="space-y-1">
      {problems.map((p, i) => (
        <li key={`${p.code}-${p.step ?? ''}-${p.port ?? ''}-${i}`}>
          {/* A problem naming a step selects it; one about the whole workflow is only read, so it
              is text rather than a button announced as dimmed. */}
          {p.step ? (
            <button
              type="button"
              onClick={() => p.step && onSelect(p.step)}
              className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
            >
              <ProblemText problem={p} />
            </button>
          ) : (
            <div className="px-2 py-1.5 text-sm">
              <ProblemText problem={p} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Beside the canvas in the definition view: the selected step's config, else the workflow's facts. */
export function DefinitionInspector({
  workflow,
  selected,
  onSelect,
}: {
  workflow: WorkflowRecord;
  selected: string | null;
  onSelect: (stepId: string | null) => void;
}) {
  const step = selected
    ? (workflow.definition.steps ?? []).find((s) => s.id === selected)
    : undefined;
  const stepProblems = step ? workflow.problems.filter((p) => p.step === step.id) : [];
  if (step) {
    return (
      <>
        <PageSection title={step.name || step.id}>
          <ConfigFacts step={step} />
        </PageSection>
        {stepProblems.length ? (
          <PageSection title="Problems">
            <Problems problems={stepProblems} onSelect={onSelect} />
          </PageSection>
        ) : null}
      </>
    );
  }
  const inputs = Object.keys(workflow.definition.inputs ?? {});
  return (
    <>
      <PageSection title="Workflow">
        {workflow.definition.description ? (
          <p className="mb-3 text-sm text-muted-foreground">{workflow.definition.description}</p>
        ) : null}
        <Facts>
          <Fact label="Id" mono>
            {workflow.id}
          </Fact>
          <Fact label="Revision" mono>
            {workflow.revision}
          </Fact>
          <Fact label="Inputs" mono absent="none">
            {inputs.length ? inputs.join(', ') : undefined}
          </Fact>
          <Fact label="Saved">
            {relTime(workflow.updated_at)}
            {workflow.updated_by ? (
              <span className="font-mono"> · {workflow.updated_by}</span>
            ) : null}
          </Fact>
          <AuthorshipFact workflow={workflow} />
        </Facts>
      </PageSection>
      <PageSection
        title="Problems"
        meta={workflow.problems.length ? String(workflow.problems.length) : undefined}
      >
        <Problems problems={workflow.problems} onSelect={onSelect} />
      </PageSection>
    </>
  );
}

function WaitingApproval({ approvalId }: { approvalId: string }) {
  const shell = useOptionalShell();
  const row = shell?.tenantApprovals.pending.find((a) => a.id === approvalId);
  if (!row && (!shell || shell.tenantApprovals.forbidden)) {
    return (
      <p className="text-sm text-muted-foreground">
        Waiting on approval <CutId id={approvalId} max={14} />. This credential cannot read
        approvals, so it cannot be decided here.
      </p>
    );
  }
  if (!row) {
    // The `/approvals` poll lists it within its interval; until then the step says what it waits on.
    return (
      <p className="text-sm text-muted-foreground">
        Waiting on approval <CutId id={approvalId} max={14} />.
      </p>
    );
  }
  const args = (row.args ?? {}) as Record<string, unknown>;
  return (
    <ApprovalDecision
      toolName={row.tool_name}
      args={args}
      context={row.manifest_id || undefined}
      reason={row.reason || undefined}
      expiresAt={row.expires_at ?? undefined}
      onDecide={async (status) => {
        try {
          await decideApproval(row.id, { status });
        } catch (err) {
          // Decided elsewhere or timed out: re-read so the card goes; the toast says why.
          if (isClosedApproval(err)) shell?.tenantApprovals.refresh();
          throw err;
        }
        shell?.tenantApprovals.markDecided(row.id);
        shell?.tenantApprovals.refresh();
      }}
    />
  );
}

/** Beside the canvas in the run view: the run's state, then the selected step's inputs and outputs. */
export function RunInspector({
  workflow,
  run,
  selected,
  onChanged,
}: {
  workflow: WorkflowRecord;
  run: WorkflowRun;
  selected: string | null;
  onChanged: () => void;
}) {
  const step = selected
    ? (workflow.definition.steps ?? []).find((s) => s.id === selected)
    : undefined;
  const state = step ? run.steps[step.id] : undefined;
  const waiting = Object.entries(run.steps).filter(
    ([, s]) => s.status === 'waiting' && s.approval_id,
  );
  return (
    <>
      <PageSection
        title="This run"
        actions={
          RUN_LIVE.has(run.status) && run.status !== 'cancelling' ? (
            <ConfirmButton
              question="Cancel this run? What is in flight is stopped."
              confirmLabel="Cancel run"
              destructive
              size="sm"
              variant="outline"
              onConfirm={async () => {
                await cancelWorkflowRun(workflow.id, run.id);
                onChanged();
              }}
            >
              Cancel
            </ConfirmButton>
          ) : null
        }
      >
        <div className="rounded-2xl bg-ground px-3.5 py-3">
          <div className="text-lg font-semibold tracking-tight">
            <RunState status={run.status} />
          </div>
          {run.error ? <p className="mt-1 text-sm text-state-failed">{run.error}</p> : null}
          <Facts>
            <Fact label="Run" mono>
              <CutId id={run.id} max={18} />
            </Fact>
            <Fact label="Started by" mono>
              {run.trigger === 'manual' ? run.started_by : `${run.trigger} · ${run.started_by}`}
            </Fact>
            <Fact label="Started">{relTime(run.created_at)}</Fact>
            {run.finished_at ? <Fact label="Finished">{relTime(run.finished_at)}</Fact> : null}
            {run.untrusted_inputs.length ? (
              <Fact label="Third-party" mono>
                {run.untrusted_inputs.join(', ')}
              </Fact>
            ) : null}
          </Facts>
        </div>
        {run.revision !== workflow.revision ? (
          <p className="mt-3 text-xs text-muted-foreground">
            This run started on revision <span className="font-mono">{run.revision}</span>; the
            graph shows the workflow as it is now, so a step added or renamed since has no state
            here.
          </p>
        ) : null}
      </PageSection>
      {waiting.filter(([id]) => id !== step?.id).length ? (
        <PageSection title="Waiting on you">
          {waiting
            .filter(([id]) => id !== step?.id)
            .map(([id, s]) => (
              <div key={id} className="mb-3">
                <WaitingApproval approvalId={s.approval_id as string} />
              </div>
            ))}
        </PageSection>
      ) : null}
      {step ? (
        <PageSection
          title={step.name || step.id}
          meta={state ? <StepStateChip status={state.status} /> : undefined}
        >
          {!state ? (
            <p className="text-sm text-muted-foreground">Not part of this run.</p>
          ) : (
            <div className="space-y-3">
              {state.status === 'waiting' && state.approval_id ? (
                <WaitingApproval approvalId={state.approval_id} />
              ) : null}
              {state.error ? <p className="text-sm text-state-failed">{state.error}</p> : null}
              <Facts>
                {state.started_at ? <Fact label="Started">{relTime(state.started_at)}</Fact> : null}
                {state.finished_at ? (
                  <Fact label="Finished">{relTime(state.finished_at)}</Fact>
                ) : null}
                {state.fired?.length ? (
                  <Fact label="Took" mono>
                    {state.fired.join(', ')}
                  </Fact>
                ) : null}
                {state.decided_by ? (
                  <Fact label="Decided by" mono>
                    {state.decided_by}
                  </Fact>
                ) : null}
              </Facts>
              {state.inputs && Object.keys(state.inputs).length ? (
                <CodePane label="Received">{json(state.inputs)}</CodePane>
              ) : null}
              {state.outputs && Object.keys(state.outputs).length ? (
                <CodePane label="Produced">{json(state.outputs)}</CodePane>
              ) : null}
              {state.thread_id ? (
                // The child run's own thread, read under the run: no chat route can open it.
                <StepTranscript
                  workflowId={workflow.id}
                  runId={run.id}
                  stepId={step.id}
                  version={run.version}
                />
              ) : null}
            </div>
          )}
        </PageSection>
      ) : null}
    </>
  );
}

export function StartRefusal({ error }: { error: unknown }) {
  return <ErrorNotice error={error} doing="start the run" />;
}
