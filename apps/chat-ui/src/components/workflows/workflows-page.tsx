import { Button } from '@felix/ui/button';
import { Input } from '@felix/ui/input';
import { Label } from '@felix/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@felix/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@felix/ui/sheet';
import {
  ArrowLeftIcon,
  LoaderIcon,
  Maximize2Icon,
  Minimize2Icon,
  PanelRightIcon,
  PlayIcon,
  PlusIcon,
  Redo2Icon,
  SaveIcon,
  Undo2Icon,
  WandSparklesIcon,
  WorkflowIcon,
  XIcon,
} from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import {
  deleteWorkflow,
  getWorkflow,
  listWorkflowKinds,
  listWorkflowRuns,
  listWorkflows,
  saveWorkflow,
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
import { DRAWER_MOTION } from '@/components/pane/pane-zone';
import { RunNowForm } from '@/components/workflows/run-now-form';
import { useWorkflowDraft } from '@/components/workflows/use-workflow-draft';
import { useWorkflowRun } from '@/components/workflows/use-workflow-run';
import { heightsOf, WorkflowCanvas } from '@/components/workflows/workflow-canvas';
import {
  ConflictNotice,
  StepEditor,
  StepPalette,
  WorkflowSettings,
} from '@/components/workflows/workflow-editor';
import {
  DefinitionInspector,
  RunInspector,
  runWord,
} from '@/components/workflows/workflow-inspector';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { usePoll } from '@/hooks/usePoll';
import { cn } from '@/lib/utils';
import {
  addStep,
  disconnect,
  moveNode,
  newStepId,
  placeFor,
  removeStep,
  tidy,
  WORKFLOW_ID_PATTERN,
} from '@/lib/workflow-draft';
import { STEP_STATE_WORD, stepsOf } from '@/lib/workflow-layout';
import { useOptionalShell } from '@/shell-context';
import type { WorkflowKind, WorkflowRecord, WorkflowRun, WorkflowRunSummary } from '@/types';

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

/** Why a create was refused, in the harness's terms, or null for an error to show as one. */
function createRefusal(err: unknown): string | null {
  if (!(err instanceof WorkflowRouteError)) return null;
  if (err.code === 'workflow_changed') return 'A workflow with this id exists.';
  if (err.code === 'workflow_limit') {
    const limit = (err.detail as { limit?: number } | undefined)?.limit;
    return `This tenant already keeps ${limit ?? 'its most'} workflows.`;
  }
  return null;
}

/** New workflow: an id and a name, saved at once (only where no workflow has the id), then opened. */
function NewWorkflowForm({ onCancel }: { onCancel: () => void }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const formId = useId();
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const idTouched = useRef(false);
  const idProblem =
    id && !WORKFLOW_ID_PATTERN.test(id)
      ? 'Lowercase letters, digits, - and _; starts with a letter or digit; at most 64.'
      : null;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!id || idProblem || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await saveWorkflow(
        id,
        { name: name.trim(), inputs: {}, steps: [], edges: [] },
        { create: true },
      );
      navigate(`?${keepAgent(params, { workflow: id })}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }
  const refused = error ? createRefusal(error) : null;
  return (
    <form
      onSubmit={submit}
      className="mb-4 space-y-3 rounded-2xl bg-ground p-3.5"
      aria-label="New workflow"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${formId}-name`}>Name</Label>
          <Input
            id={`${formId}-name`}
            value={name}
            maxLength={200}
            autoFocus
            onChange={(e) => {
              setName(e.target.value);
              // The id follows the name until it is typed itself.
              if (!idTouched.current) {
                setId(
                  e.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9_-]+/g, '-')
                    .replace(/^[^a-z0-9]+/, '')
                    .replace(/-+$/, '')
                    .slice(0, 64),
                );
              }
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${formId}-id`}>Id</Label>
          <Input
            id={`${formId}-id`}
            value={id}
            className="font-mono"
            onChange={(e) => {
              idTouched.current = true;
              setId(e.target.value);
            }}
            aria-invalid={Boolean(idProblem)}
            aria-describedby={`${formId}-id-note`}
          />
          <p
            id={`${formId}-id-note`}
            className={idProblem ? 'text-xs text-state-failed' : 'text-xs text-muted-foreground'}
          >
            {idProblem ?? 'In its address and in every job and trigger that starts it.'}
          </p>
        </div>
      </div>
      {error ? (
        refused ? (
          <p className="text-sm text-state-failed">{refused}</p>
        ) : (
          <ErrorNotice error={error} doing="create the workflow" />
        )
      ) : null}
      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={busy || !id || Boolean(idProblem) || !name.trim()}
        >
          {busy ? <LoaderIcon className="animate-spin" /> : <PlusIcon />}
          Create
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function WorkflowList() {
  const [params] = useSearchParams();
  const { data, error, lastOkAt, refresh } = usePoll(listWorkflows, { intervalMs: LIST_POLL_MS });
  const [creating, setCreating] = useState(false);
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
        controls={
          creating ? null : (
            <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
              <PlusIcon />
              New workflow
            </Button>
          )
        }
      />
      <PanelBody>
        {creating ? <NewWorkflowForm onCancel={() => setCreating(false)} /> : null}
        {error ? (
          <ReadFailure error={error} doing="list workflows" lastOkAt={lastOkAt} onRetry={refresh} />
        ) : null}
        {!data && !error ? (
          <p className="text-sm text-muted-foreground">Loading workflows…</p>
        ) : null}
        {data && items.length === 0 && !creating ? (
          <PageEmpty>No workflows yet. New workflow starts one.</PageEmpty>
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
  const draft = useWorkflowDraft(id, workflow.data);
  // A phone reads the graph and its runs; editing one wants a pointer and room.
  const phone = useMediaQuery('(max-width: 639px)');
  const editing = view === 'definition' && !phone;
  const manifestOptions = useOptionalShell()?.manifestOptions ?? [];
  const [kinds, setKinds] = useState<WorkflowKind[] | undefined>();
  const [kindsError, setKindsError] = useState<unknown>(null);
  useEffect(() => {
    if (!editing || kinds) return;
    let live = true;
    listWorkflowKinds().then(
      (items) => live && setKinds(items),
      (err: unknown) => live && setKindsError(err),
    );
    return () => {
      live = false;
    };
  }, [editing, kinds]);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const fetchRuns = useCallback(() => listWorkflowRuns(id), [id]);
  const runs = usePoll(fetchRuns, { enabled: view === 'run', intervalMs: RUNS_POLL_MS });
  // With no run in the address, the newest one — pinned once seen, so a run a job or a trigger starts
  // meanwhile does not move the canvas off the run being read.
  const [pinned, setPinned] = useState<string | null>(null);
  useEffect(() => {
    if (!pinned && runs.data?.[0]) setPinned(runs.data[0].id);
  }, [pinned, runs.data]);
  const runId = runParam ?? pinned ?? null;
  // Watched over the run's stream while the run view shows it: a step moving lands as it is saved.
  const run = useWorkflowRun(id, runId, view === 'run');
  // The hook keeps its last answer across a change of run; drop it so one run's states never sit on another's.
  const current = run.data && run.data.id === runId ? run.data : null;
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

  // The saved workflow is what runs; the draft, while there is one, is what the definition view edits.
  const wf: WorkflowRecord | undefined = draft.saved;
  const shown: WorkflowRecord | undefined = view === 'definition' ? draft.record : wf;
  const { dirty, save, undo, redo } = draft;

  // ⌘S / Ctrl+S saves the draft, wherever focus is on the page. ⌘Z / ⇧⌘Z (Ctrl+Z / Ctrl+Y)
  // step the draft back and forward — except in a text field, where they are the field's own.
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        // A field that writes on leaving it (an id, JSON) writes first, then the save reads it.
        (document.activeElement as HTMLElement | null)?.blur();
        setTimeout(save, 0);
        return;
      }
      if (key !== 'z' && key !== 'y') return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      e.preventDefault();
      if (key === 'y' || e.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, save, undo, redo]);
  // F: the canvas alone, filling the window, for a graph wider than the sheet; F or Escape again
  // brings the palette and inspector back. A key typed into a field is the field's.
  const [expanded, setExpanded] = useState(false);
  // Below 1024 the palette and the inspector are sheets over the canvas, opened from its corner.
  // A step selected, Run now, or a save that lost opens the inspector: each is something to read.
  const wide = !useMediaQuery('(max-width: 1023px)');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const lostSave = Boolean(draft.conflict);
  useEffect(() => {
    if (selected || runningNow || lostSave) setInspectorOpen(true);
  }, [selected, runningNow, lostSave]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="combobox"]'))
        return;
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        setExpanded((v) => !v);
      } else if (e.key === 'Escape') {
        setExpanded(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Closing the tab on unsaved edits asks first; moving within the app keeps the draft.
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [dirty]);
  // The run on screen is always in the picker, even one older than the newest page of runs.
  const runOptions = useMemo((): WorkflowRunSummary[] => {
    const listed = runs.data ?? [];
    if (!current || listed.some((r) => r.id === current.id)) return listed;
    const steps = Object.fromEntries(Object.entries(current.steps).map(([k, v]) => [k, v.status]));
    return [{ ...current, step_statuses: steps }, ...listed];
  }, [runs.data, current]);
  if (!wf || !shown) {
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
  const problems = shown.problems.length;
  // A draft the harness could not check (it refused to parse it) has problems nobody counted: the
  // last check's count would claim otherwise.
  const unchecked = view === 'definition' && draft.dirty && Boolean(draft.checkError);
  // A run starts the saved revision: its problems, and unsaved edits, are what stop one here.
  const runBlocked = wf.problems.length > 0 || dirty;
  const blockedId = `run-blocked-${id}`;
  const selectedStep = selected
    ? stepsOf(shown.definition).find((s) => s.id === selected)
    : undefined;

  const addKind = (kind: string) => {
    const stepId = newStepId(shown.definition, kind);
    draft.edit((d) => addStep(d, kind, placeFor(d, selected)).def);
    setSelected(stepId);
  };
  // The inspector's content, beside the canvas from 1024 and a sheet over it below.
  const inspector = (
    <>
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
      ) : view === 'run' && run.gone ? (
        <p className="text-sm text-muted-foreground">
          This run is not there: finished runs are swept after their retention, and a link may name
          one that never existed.
        </p>
      ) : view === 'run' && run.error ? (
        <ErrorNotice error={run.error} doing="load the run" />
      ) : view === 'run' && runId ? (
        <p className="text-sm text-muted-foreground">Loading the run…</p>
      ) : view === 'definition' && editing && !runningNow ? (
        <>
          {draft.conflict ? (
            <ConflictNotice
              mine={shown.definition}
              conflict={draft.conflict}
              onKeepMine={draft.keepMine}
              onTakeTheirs={draft.takeTheirs}
              onLeave={() => set({ workflow: null, view: null, run: null })}
            />
          ) : null}
          {draft.saveError ? (
            <div className="mb-4">
              <ErrorNotice error={draft.saveError} doing="save the workflow" />
            </div>
          ) : null}
          {draft.checkError ? (
            <div className="mb-4">
              <ErrorNotice error={draft.checkError} doing="check the draft" />
            </div>
          ) : null}
          {deleteError ? (
            <div className="mb-4">
              <ErrorNotice error={deleteError} doing="delete the workflow" />
            </div>
          ) : null}
          {selectedStep ? (
            <StepEditor
              key={selectedStep.id}
              record={shown}
              step={selectedStep}
              edit={draft.edit}
              wire={(edge) => void draft.wire(edge)}
              manifestOptions={manifestOptions}
              onSelect={setSelected}
            />
          ) : (
            <WorkflowSettings
              record={shown}
              edit={draft.edit}
              onSelect={setSelected}
              onDelete={async () => {
                setDeleteError(null);
                try {
                  await deleteWorkflow(id, wf.revision);
                  set({ workflow: null, view: null, run: null });
                } catch (err) {
                  setDeleteError(err);
                }
              }}
            />
          )}
        </>
      ) : view === 'definition' && !runningNow ? (
        <>
          {phone ? (
            <p className="mb-4 text-sm text-muted-foreground">
              Editing a workflow needs a wider window; its graph and runs read here.
            </p>
          ) : null}
          <DefinitionInspector workflow={wf} selected={selected} onSelect={setSelected} />
        </>
      ) : null}
      {view === 'run' && current && !selected ? (
        <p className="mt-4 text-xs text-muted-foreground">
          Select a step for what it received and produced.
        </p>
      ) : null}
    </>
  );
  return (
    <Panel fullBleed>
      <PageHeader
        icon={<WorkflowIcon />}
        title="Workflows"
        // The name and size stay neutral; only the problems, in words, take the failed chip.
        valueLead={
          problems || unchecked
            ? `${shown.definition.name} · ${plural(stepsOf(shown.definition).length, 'step')}`
            : undefined
        }
        value={
          unchecked
            ? 'Not checked'
            : problems
              ? plural(problems, 'problem')
              : `${shown.definition.name} · ${plural(stepsOf(shown.definition).length, 'step')}`
        }
        valueTone={problems || unchecked ? 'failed' : 'default'}
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
            {editing ? (
              <>
                {dirty ? (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span aria-hidden className="size-1.5 rounded-full bg-state-blocked" />
                    Unsaved
                  </span>
                ) : null}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Undo"
                  aria-keyshortcuts="Meta+Z Control+Z"
                  disabled={!draft.canUndo}
                  onClick={undo}
                >
                  <Undo2Icon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Redo"
                  aria-keyshortcuts="Meta+Shift+Z Control+Y"
                  disabled={!draft.canRedo}
                  onClick={redo}
                >
                  <Redo2Icon />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => draft.edit((d) => tidy(d, heightsOf(shown, true)))}
                >
                  <WandSparklesIcon />
                  Tidy
                </Button>
                {dirty ? (
                  <Button variant="ghost" size="sm" onClick={draft.discard}>
                    Discard
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant={dirty ? 'default' : 'outline'}
                  disabled={!dirty || draft.saving}
                  aria-keyshortcuts="Meta+S Control+S"
                  onClick={draft.save}
                >
                  {draft.saving ? <LoaderIcon className="animate-spin" /> : <SaveIcon />}
                  Save
                </Button>
              </>
            ) : null}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Full screen"
              aria-keyshortcuts="F"
              onClick={() => setExpanded(true)}
            >
              <Maximize2Icon />
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-expanded={runningNow}
              // Not `disabled`: a disabled button cannot be reached, and its reason with it. Pressed
              // while blocked by problems, it shows them instead of a form that would be refused.
              aria-disabled={runBlocked && !runningNow}
              aria-describedby={runBlocked ? blockedId : undefined}
              className={cn(runBlocked && !runningNow && 'opacity-50')}
              onClick={() => {
                if (runBlocked && !runningNow) {
                  if (!dirty) {
                    setSelected(null);
                    set({ view: null });
                  }
                  return;
                }
                setRunningNow((v) => !v);
              }}
            >
              {runningNow ? <XIcon /> : <PlayIcon />}
              Run now
            </Button>
            {runBlocked ? (
              <span id={blockedId} className="sr-only">
                {dirty
                  ? 'Save first: a run starts the saved revision.'
                  : `Fix ${plural(wf.problems.length, 'problem')} first; they are listed under Problems.`}
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
        {editing && wide ? (
          <StepPalette
            kinds={kinds}
            error={kindsError}
            onAdd={addKind}
            className="w-44 shrink-0 border-r border-border/60 p-3"
          />
        ) : null}
        {editing && !wide ? (
          <Sheet open={paletteOpen} onOpenChange={setPaletteOpen}>
            <SheetContent side="left" className={cn('w-64 gap-0', DRAWER_MOTION)}>
              <SheetTitle className="sr-only">Add a step</SheetTitle>
              <SheetDescription className="sr-only">
                Each kind adds a step beside the selected one.
              </SheetDescription>
              <StepPalette
                kinds={kinds}
                error={kindsError}
                className="p-4 pt-12"
                onAdd={(kind) => {
                  setPaletteOpen(false);
                  addKind(kind);
                }}
              />
            </SheetContent>
          </Sheet>
        ) : null}
        <div
          data-expanded={expanded || undefined}
          className={cn(
            'relative min-h-[24rem] flex-1 max-lg:min-h-[70svh]',
            expanded && 'fixed! inset-0 z-50 h-auto! bg-ground',
          )}
        >
          {expanded ? (
            <Button
              variant="outline"
              size="sm"
              className="absolute top-4 right-4 z-10"
              aria-keyshortcuts="F Escape"
              onClick={() => setExpanded(false)}
            >
              <Minimize2Icon />
              Exit full screen
            </Button>
          ) : null}
          <WorkflowCanvas
            workflow={shown}
            run={view === 'run' ? current : null}
            selected={selected}
            onSelect={setSelected}
            editing={
              editing
                ? {
                    onMove: (moves) =>
                      draft.edit((d) =>
                        moves.reduce((acc, m) => moveNode(acc, m.id, m.position), d),
                      ),
                    onConnect: (edge) => void draft.wire(edge),
                    onDelete: ({ steps, edges }) => {
                      draft.edit((d) => disconnect(steps.reduce(removeStep, d), edges));
                      if (selected && steps.includes(selected)) setSelected(null);
                    },
                  }
                : undefined
            }
          />
          {!wide && !expanded ? (
            // Below 1024 the canvas has the sheet to itself; these bring the palette and inspector.
            <div className="absolute right-3 bottom-3 z-10 flex gap-2">
              {editing ? (
                <Button variant="outline" size="sm" onClick={() => setPaletteOpen(true)}>
                  <PlusIcon />
                  Add step
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                aria-expanded={inspectorOpen}
                onClick={() => setInspectorOpen(true)}
              >
                <PanelRightIcon />
                Inspector
              </Button>
            </div>
          ) : null}
          {editing && draft.refusal ? (
            <div
              role="status"
              className="absolute inset-x-4 bottom-4 max-lg:bottom-16 flex items-start gap-2 rounded-xl border border-border/60 bg-card px-3 py-2 text-sm shadow-sheet"
            >
              <p className="flex-1 text-state-failed">{draft.refusal}</p>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Dismiss"
                onClick={draft.clearRefusal}
              >
                <XIcon />
              </Button>
            </div>
          ) : null}
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
        {wide ? (
          <aside
            aria-label="Inspector"
            className="min-h-0 w-[clamp(24rem,32vw,34rem)] overflow-y-auto border-l border-border/60 p-4"
          >
            {inspector}
          </aside>
        ) : (
          <Sheet open={inspectorOpen} onOpenChange={setInspectorOpen}>
            <SheetContent
              side="right"
              className={cn('w-full gap-0 overflow-y-auto sm:max-w-md', DRAWER_MOTION)}
            >
              <SheetTitle className="sr-only">Inspector</SheetTitle>
              <SheetDescription className="sr-only">
                The selected step, the run, or the workflow.
              </SheetDescription>
              {/* Padded inside: the sheet's own safe-area padding wins over a class on it, and the
                  top clears the close button. */}
              <div className="p-4 pt-12">{inspector}</div>
            </SheetContent>
          </Sheet>
        )}
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
