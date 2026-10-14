import { Button } from '@felix/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@felix/ui/select';
import { ArrowLeftIcon, PlayIcon, WorkflowIcon, XIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  getWorkflow,
  getWorkflowRun,
  listWorkflowRuns,
  listWorkflows,
  WorkflowRouteError,
} from '@/api';
import { ErrorNotice } from '@/components/error-notice';
import { keepAgent } from '@/components/harness/harness-agent';
import {
  PageEmpty,
  PageHeader,
  PageSection,
  Panel,
  PanelBody,
  plural,
  ViewSwitch,
} from '@/components/harness/panel';
import { ReadFailure, relTime, withAge } from '@/components/inspector/primitives';
import { RunNowForm } from '@/components/workflows/run-now-form';
import { WorkflowCanvas } from '@/components/workflows/workflow-canvas';
import {
  DefinitionInspector,
  RUN_LIVE,
  RunInspector,
  runWord,
} from '@/components/workflows/workflow-inspector';
import { usePoll } from '@/hooks/usePoll';
import { cn } from '@/lib/utils';
import { STEP_STATE_WORD, stepsOf } from '@/lib/workflow-layout';
import type { WorkflowRecord, WorkflowRun, WorkflowRunSummary } from '@/types';

/**
 * Authored workflows as a `/harness` page (`felix/workflows/`): the list, then one workflow's graph
 * on a canvas with two views of it — the **definition** (its steps, ports, wires and the problems
 * that stop it running) and a **run** (each step's state on the same nodes, the path the run took
 * drawn solid). The view, the workflow and the run are in the address (`?workflow=&view=&run=`) so
 * a run can be linked. A run is polled while it is live; nothing here streams.
 */

type View = 'definition' | 'run';

const LIST_POLL_MS = 15_000;
const WORKFLOW_POLL_MS = 30_000;
const RUNS_POLL_MS = 5_000;
const RUN_POLL_MS = 2_000;

function WorkflowList() {
  const [params] = useSearchParams();
  const { data, error, lastOkAt, refresh } = usePoll(listWorkflows, { intervalMs: LIST_POLL_MS });
  const items = data ?? [];
  return (
    <Panel>
      <PageHeader
        icon={<WorkflowIcon />}
        title="Workflows"
        value={withAge(
          data ? plural(items.length, 'workflow') : undefined,
          error ? lastOkAt : undefined,
        )}
      />
      <PanelBody>
        {error ? (
          <ReadFailure error={error} doing="list workflows" lastOkAt={lastOkAt} onRetry={refresh} />
        ) : null}
        {!data && !error ? (
          <p className="text-sm text-muted-foreground">Loading workflows…</p>
        ) : null}
        {data && items.length === 0 ? (
          <PageEmpty>
            No workflows yet. A workflow is saved with{' '}
            <span className="font-mono">PUT /workflows/&lt;id&gt;</span>.
          </PageEmpty>
        ) : null}
        <ul>
          {items.map((w) => (
            <li key={w.id} className="border-b border-border/60 first-of-type:border-t">
              <Link
                to={`?${keepAgent(params, { workflow: w.id })}`}
                className="block rounded-lg px-2 py-2.5 hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
              >
                <div className="flex items-baseline gap-2">
                  <h3 className="truncate text-sm font-semibold">{w.name}</h3>
                  <span className="truncate font-mono text-xs text-muted-foreground">{w.id}</span>
                </div>
                {w.description ? (
                  <p className="mt-0.5 truncate text-sm text-muted-foreground">{w.description}</p>
                ) : null}
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {plural(w.step_count, 'step')} · saved {relTime(w.updated_at)}
                  {w.updated_by ? <span className="font-mono"> · {w.updated_by}</span> : null}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </PanelBody>
    </Panel>
  );
}

function runLabel(r: WorkflowRunSummary): string {
  return `${runWord(r.status)} · ${relTime(r.created_at)} · ${r.trigger}`;
}

/** Where the run's own status sits in the announcer's memory: no step id can be empty. */
const RUN_KEY = '';

/** Step-state changes, said once each to a screen reader: the canvas itself is not a live region. */
function useStateAnnouncements(
  run: WorkflowRun | null | undefined,
  nameOf: (stepId: string) => string,
): string {
  const last = useRef<Record<string, string>>({});
  const runId = useRef<string | null>(null);
  const [said, setSaid] = useState('');
  useEffect(() => {
    if (!run) return;
    if (runId.current !== run.id) {
      runId.current = run.id;
      last.current = {
        ...Object.fromEntries(Object.entries(run.steps).map(([id, s]) => [id, s.status])),
        [RUN_KEY]: run.status,
      };
      return;
    }
    const changed = Object.entries(run.steps).filter(([id, s]) => last.current[id] !== s.status);
    const runChanged = last.current[RUN_KEY] !== undefined && last.current[RUN_KEY] !== run.status;
    const parts = changed.map(([id, s]) => `${nameOf(id)}: ${STEP_STATE_WORD[s.status]}`);
    if (runChanged) parts.push(`Run: ${runWord(run.status)}`);
    if (parts.length) setSaid(parts.join('. '));
    last.current = {
      ...Object.fromEntries(Object.entries(run.steps).map(([id, s]) => [id, s.status])),
      [RUN_KEY]: run.status,
    };
  }, [run, nameOf]);
  return said;
}

function WorkflowDetail({ id }: { id: string }) {
  const [params, setParams] = useSearchParams();
  const view: View = params.get('view') === 'run' ? 'run' : 'definition';
  const runParam = params.get('run');
  const [selected, setSelected] = useState<string | null>(null);
  const [runningNow, setRunningNow] = useState(false);

  const fetchWorkflow = useCallback(() => getWorkflow(id), [id]);
  const workflow = usePoll(fetchWorkflow, { intervalMs: WORKFLOW_POLL_MS });
  const fetchRuns = useCallback(() => listWorkflowRuns(id), [id]);
  const runs = usePoll(fetchRuns, { enabled: view === 'run', intervalMs: RUNS_POLL_MS });
  // With no run in the address, the newest one — pinned once seen, so a run a job or a trigger starts
  // meanwhile does not move the canvas off the run being read.
  const [pinned, setPinned] = useState<string | null>(null);
  useEffect(() => {
    if (!pinned && runs.data?.[0]) setPinned(runs.data[0].id);
  }, [pinned, runs.data]);
  const runId = runParam ?? pinned ?? null;
  const fetchRun = useCallback(
    () => (runId ? getWorkflowRun(id, runId) : Promise.resolve(null)),
    [id, runId],
  );
  const [runDone, setRunDone] = useState(false);
  const [runGone, setRunGone] = useState(false);
  const run = usePoll(fetchRun, {
    enabled: view === 'run' && Boolean(runId) && !runDone && !runGone,
    intervalMs: RUN_POLL_MS,
  });
  // A run that is not there (swept, mistyped in a link) will not appear by asking again.
  useEffect(() => {
    setRunGone(run.error instanceof WorkflowRouteError && run.error.status === 404);
  }, [run.error]);
  // The poll keeps its last answer across a change of run; drop it so one run's states never sit on another's.
  const current = run.data && run.data.id === runId ? run.data : null;
  useEffect(() => {
    setRunDone(Boolean(current && !RUN_LIVE.has(current.status)));
  }, [current]);
  useEffect(() => {
    setRunDone(false);
    setRunGone(false);
    run.refresh();
  }, [runId, run.refresh]);
  const nameOf = useCallback(
    (stepId: string) =>
      stepsOf(workflow.data?.definition ?? { name: '' }).find((s) => s.id === stepId)?.name ||
      stepId,
    [workflow.data],
  );
  const said = useStateAnnouncements(current, nameOf);

  const set = useCallback(
    (next: Record<string, string | null>) => {
      const p = new URLSearchParams(params);
      for (const [k, v] of Object.entries(next)) {
        if (v == null) p.delete(k);
        else p.set(k, v);
      }
      setParams(p);
    },
    [params, setParams],
  );

  const wf: WorkflowRecord | undefined = workflow.data;
  // The run on screen is always in the picker, even one older than the newest page of runs.
  const runOptions = useMemo((): WorkflowRunSummary[] => {
    const listed = runs.data ?? [];
    if (!current || listed.some((r) => r.id === current.id)) return listed;
    const steps = Object.fromEntries(Object.entries(current.steps).map(([k, v]) => [k, v.status]));
    return [{ ...current, step_statuses: steps }, ...listed];
  }, [runs.data, current]);
  if (!wf) {
    return (
      <Panel>
        <PageHeader icon={<WorkflowIcon />} title="Workflows" />
        <PanelBody>
          {workflow.error ? (
            <ErrorNotice error={workflow.error} doing={`load workflow ${id}`} />
          ) : (
            <p className="text-sm text-muted-foreground">Loading the workflow…</p>
          )}
        </PanelBody>
      </Panel>
    );
  }
  const problems = wf.problems.length;
  const blockedId = `run-blocked-${id}`;
  return (
    <Panel fullBleed>
      <PageHeader
        icon={<WorkflowIcon />}
        title="Workflows"
        // The name and size stay neutral; only the problems, in words, take the failed chip.
        valueLead={
          problems
            ? `${wf.definition.name} · ${plural(stepsOf(wf.definition).length, 'step')}`
            : undefined
        }
        value={
          problems
            ? plural(problems, 'problem')
            : `${wf.definition.name} · ${plural(stepsOf(wf.definition).length, 'step')}`
        }
        valueTone={problems ? 'failed' : 'default'}
        controls={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link to={`?${keepAgent(params, {})}`}>
                <ArrowLeftIcon />
                All workflows
              </Link>
            </Button>
            <ViewSwitch
              label="View"
              value={view}
              options={[
                ['definition', 'Definition'],
                ['run', 'Runs'],
              ]}
              onChange={(v) => set({ view: v === 'run' ? 'run' : null })}
            />
            {view === 'run' && runOptions.length ? (
              <Select value={runId ?? undefined} onValueChange={(v) => set({ run: v })}>
                <SelectTrigger size="sm" className="w-64" aria-label="Run">
                  <SelectValue placeholder="Choose a run" />
                </SelectTrigger>
                <SelectContent>
                  {runOptions.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {runLabel(r)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              aria-expanded={runningNow}
              // Not `disabled`: a disabled button cannot be reached, and its reason with it. Pressed
              // while blocked, it shows the problems instead of a form that would be refused.
              aria-disabled={problems > 0 && !runningNow}
              aria-describedby={problems ? blockedId : undefined}
              className={cn(problems > 0 && !runningNow && 'opacity-50')}
              onClick={() => {
                if (problems > 0 && !runningNow) {
                  setSelected(null);
                  set({ view: null });
                  return;
                }
                setRunningNow((v) => !v);
              }}
            >
              {runningNow ? <XIcon /> : <PlayIcon />}
              Run now
            </Button>
            {problems ? (
              <span id={blockedId} className="sr-only">
                Fix {plural(problems, 'problem')} first; they are listed under Problems.
              </span>
            ) : null}
          </div>
        }
      />
      {workflow.error ? (
        <div className="px-4">
          <ReadFailure
            error={workflow.error}
            doing="reload the workflow"
            lastOkAt={workflow.lastOkAt}
            onRetry={workflow.refresh}
          />
        </div>
      ) : null}
      <span className="sr-only" aria-live="polite">
        {said}
      </span>
      <div className="flex min-h-0 flex-1 max-lg:flex-col">
        <div className="relative min-h-[24rem] flex-1 max-lg:h-[60svh] max-lg:flex-none">
          <WorkflowCanvas
            workflow={wf}
            run={view === 'run' ? current : null}
            selected={selected}
            onSelect={setSelected}
          />
          {view === 'run' && runs.error ? (
            <div className="absolute inset-x-4 top-4">
              <ReadFailure
                error={runs.error}
                doing="list this workflow's runs"
                lastOkAt={runs.lastOkAt}
                onRetry={runs.refresh}
              />
            </div>
          ) : null}
          {view === 'run' && runs.data && runOptions.length === 0 ? (
            <p className="pointer-events-none absolute inset-x-0 top-4 text-center text-sm text-muted-foreground">
              No runs yet.
            </p>
          ) : null}
        </div>
        <aside
          aria-label="Inspector"
          className="min-h-0 overflow-y-auto border-border/60 p-4 lg:w-[clamp(24rem,32vw,34rem)] lg:border-l max-lg:border-t"
        >
          {runningNow ? (
            <PageSection title="Run now">
              <RunNowForm
                workflow={wf}
                onStarted={(started) => {
                  setRunningNow(false);
                  set({ view: 'run', run: started.id });
                  runs.refresh();
                }}
              />
            </PageSection>
          ) : null}
          {view === 'run' && current && run.error ? (
            <div className="mb-4">
              <ReadFailure
                error={run.error}
                doing="refresh the run"
                lastOkAt={run.lastOkAt}
                onRetry={run.refresh}
              />
            </div>
          ) : null}
          {view === 'run' && current ? (
            <RunInspector workflow={wf} run={current} selected={selected} onChanged={run.refresh} />
          ) : view === 'run' && run.error ? (
            <ErrorNotice error={run.error} doing="load the run" />
          ) : view === 'run' && runId ? (
            <p className="text-sm text-muted-foreground">Loading the run…</p>
          ) : view === 'definition' ? (
            <DefinitionInspector workflow={wf} selected={selected} onSelect={setSelected} />
          ) : null}
          {view === 'run' && current && !selected ? (
            <p className="mt-4 text-xs text-muted-foreground">
              Select a step for what it received and produced.
            </p>
          ) : null}
        </aside>
      </div>
    </Panel>
  );
}

export function WorkflowsPage() {
  const [params] = useSearchParams();
  const id = params.get('workflow');
  // Keyed on the workflow, so moving between two never shows one's graph, selection or run on the other.
  return id ? <WorkflowDetail key={id} id={id} /> : <WorkflowList />;
}
