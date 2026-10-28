import { Button } from '@felix/ui/button';
import { Input } from '@felix/ui/input';
import { Label } from '@felix/ui/label';
import { Select, SelectContent, SelectTrigger, SelectValue } from '@felix/ui/select';
import { Textarea } from '@felix/ui/textarea';
import { useEffect, useMemo, useRef, useState } from 'react';
import { listWorkflows, upsertJob } from '@/api';
import { AgentSelect, OPTION_LIST_BOUNDS, OptionItem } from '@/components/agent-select';
import { ErrorNotice } from '@/components/error-notice';
import { ViewSwitch } from '@/components/harness/panel';
import { WhyDisabled } from '@/components/why-disabled';
import { nextAfter, parseSchedule, ScheduleError, scheduleLabel } from '@/lib/job-schedule';
import { cn } from '@/lib/utils';
import type { JobRecord, WorkflowSummary } from '@/types';

/**
 * The form that writes a new job (`PUT /jobs/{name}`): the Jobs page's, behind New job,
 * and the transcript's "Repeat on a schedule", which opens it in a dialog with the
 * message's text as the prompt. One form for both, so what a schedule will do — the
 * next run, the cost of a short interval, a name that would replace a job — is said
 * the same way wherever a job is made.
 *
 * It is mounted only while open and owns its state, so closing it is forgetting it.
 */

/** A day, for saying what a short interval costs in turns. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** `payload.inputs` as typed: an object, or why not. Empty is `{}`. */
function parseInputs(text: string): { inputs: Record<string, unknown> } | { error: string } {
  if (!text.trim()) return { inputs: {} };
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { inputs: parsed as Record<string, unknown> };
    }
    return { error: 'Inputs must be a JSON object, like {"repo": "felix"}.' };
  } catch (err) {
    return { error: `Not valid JSON: ${String((err as Error)?.message ?? err)}` };
  }
}

/** Below this an interval is said as a cost: an every-minute job is ~1,440 agent turns a day. */
const COSTLY_INTERVAL_MS = 5 * 60 * 1000;

/** A time to the minute, local, with its UTC beside it: a schedule is written in UTC. */
function localAndUtc(ms: number): string {
  const d = new Date(ms);
  const local = d.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  const utc = d.toISOString().slice(11, 16);
  return `${local} (${utc} UTC)`;
}

export interface JobDraft {
  name?: string;
  manifest?: string;
  prompt?: string;
}

export function JobCreateForm({
  manifest,
  manifestOptions,
  jobs,
  initial,
  agentOnly = false,
  submitLabel = 'Create',
  onCreated,
  onCancel,
}: {
  /** The agent selected when the form opens, unless `initial` names one. */
  manifest: string;
  manifestOptions: string[];
  /** The jobs that exist, so a name that would replace one says so. */
  jobs: readonly JobRecord[];
  initial?: JobDraft;
  /** Only an agent prompt — no workflow switch. */
  agentOnly?: boolean;
  submitLabel?: string;
  onCreated: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [schedule, setSchedule] = useState('0 9 * * *');
  const [manifestId, setManifestId] = useState(initial?.manifest ?? manifest);
  // Both live in the job's free-form `payload`. `prompt` is the turn each firing
  // sends (the worker falls back to "ping" when there is none, which is a job that
  // runs and asks nothing). `fresh_thread` gives each firing its own thread: by
  // default every run of a job shares one, named after the job, so a digest
  // remembers last week — and a job that works a different ticket each time would
  // carry ticket N's transcript into ticket N+1's context.
  const [prompt, setPrompt] = useState(initial?.prompt ?? '');
  const [freshThread, setFreshThread] = useState(false);
  // What each firing runs: an agent turn, or a run of a workflow (`felix-run/felix#642`).
  const [target, setTarget] = useState<'agent' | 'workflow'>('agent');
  const [workflowId, setWorkflowId] = useState('');
  const [inputsText, setInputsText] = useState('');
  // Read when the form opens, not with the page: most visits only look at the list.
  const [workflows, setWorkflows] = useState<WorkflowSummary[] | null>(null);
  const [workflowsError, setWorkflowsError] = useState<unknown>(null);
  // A new job fires at the next sweep whatever its schedule; started paused, it waits until
  // someone resumes it — the one way to set a job up without it running first.
  const [startPaused, setStartPaused] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // The next-run preview reads the clock; a form left open must not measure from when it opened.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);
  // Opening the form lands in its first field.
  useEffect(() => {
    requestAnimationFrame(() => nameRef.current?.focus());
  }, []);

  // The job this name would replace. `PUT /jobs/{name}` is an upsert: Create on an existing
  // name replaced its schedule, agent and prompt, and turned a paused job back on, with
  // nothing on screen to say so.
  const existing = jobs.find((j) => j.name === name.trim());
  // The form's reading of its schedule, as the harness will read it.
  const parsedSchedule = useMemo(() => {
    try {
      return { schedule: parseSchedule(schedule), error: null };
    } catch (err) {
      return { schedule: null, error: err instanceof ScheduleError ? err.message : String(err) };
    }
  }, [schedule]);
  const parsedInputs = useMemo(() => parseInputs(inputsText), [inputsText]);
  // The schedule's own error is said under its field; this only points at it.
  const jobUnready = !name.trim()
    ? 'Name the job.'
    : parsedSchedule.error !== null
      ? 'Fix the schedule above.'
      : target === 'workflow' && !workflowId
        ? 'Choose a workflow.'
        : target === 'workflow' && 'error' in parsedInputs
          ? 'Fix the inputs above.'
          : null;

  useEffect(() => {
    if (agentOnly || workflows !== null) return;
    let live = true;
    listWorkflows().then(
      (items) => {
        if (!live) return;
        setWorkflows(items);
        setWorkflowsError(null);
      },
      (err: unknown) => live && setWorkflowsError(err),
    );
    return () => {
      live = false;
    };
  }, [agentOnly, workflows]);
  const costly =
    parsedSchedule.schedule?.kind === 'interval' && parsedSchedule.schedule.ms < COSTLY_INTERVAL_MS;

  async function create() {
    if (jobUnready) return;
    setSaving(true);
    setError(null);
    try {
      // Only the keys that were set: the scheduler reads `payload.get(...)`, so an
      // explicit `fresh_thread: false` is noise on every row nobody asked for.
      const payload: Record<string, unknown> = {};
      if (target === 'workflow') {
        if ('inputs' in parsedInputs && Object.keys(parsedInputs.inputs).length) {
          payload.inputs = parsedInputs.inputs;
        }
      } else {
        if (prompt.trim()) payload.prompt = prompt.trim();
        if (freshThread) payload.fresh_thread = true;
      }
      await upsertJob({
        name: name.trim(),
        schedule: schedule.trim(),
        ...(target === 'workflow'
          ? {
              workflow_id: workflowId,
              // The revision on screen when it was picked, so an edit saved meanwhile is
              // refused rather than becoming what the job runs.
              ...(workflows?.find((w) => w.id === workflowId)?.revision
                ? { workflow_revision: workflows.find((w) => w.id === workflowId)?.revision }
                : {}),
            }
          : { manifest_id: manifestId }),
        payload,
        // Replacing keeps the job's own state unless the form says to pause it.
        enabled: startPaused ? false : (existing?.enabled ?? true),
      });
      onCreated(name.trim());
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {!agentOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Each run</span>
          <ViewSwitch
            label="What each run of the job does"
            value={target}
            options={[
              ['agent', 'Sends a prompt'],
              ['workflow', 'Runs a workflow'],
            ]}
            onChange={setTarget}
          />
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <div>
          <Label htmlFor="job-name">Name</Label>
          <Input
            ref={nameRef}
            id="job-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-describedby={existing ? 'job-name-replaces' : undefined}
            className="mt-1"
            onKeyDown={(e) => e.key === 'Enter' && create()}
          />
          {existing && (
            // Amber: it waits on the operator's decision before it writes.
            <p id="job-name-replaces" className="mt-1 max-w-[56ch] text-xs text-state-blocked">
              <span className="font-mono">{existing.name}</span> exists. Replace changes its
              schedule and what it runs; its run history stays
              {existing.enabled === false ? ', and it stays paused' : ''}.
            </p>
          )}
        </div>
        {target === 'agent' ? (
          <div>
            <Label htmlFor="job-manifest">Agent</Label>
            <AgentSelect
              id="job-manifest"
              value={manifestId}
              options={manifestOptions.length ? manifestOptions : [manifest]}
              onValueChange={setManifestId}
              className="mt-1 w-full"
            />
          </div>
        ) : (
          <div>
            <Label htmlFor="job-workflow">Workflow</Label>
            <Select value={workflowId || undefined} onValueChange={(v) => v && setWorkflowId(v)}>
              <SelectTrigger
                id="job-workflow"
                className="mt-1 w-full font-mono"
                aria-describedby={
                  workflowsError != null || workflows?.length === 0
                    ? 'job-workflow-help'
                    : undefined
                }
              >
                <SelectValue placeholder={workflows === null ? 'Loading…' : 'Choose a workflow'} />
              </SelectTrigger>
              <SelectContent className={OPTION_LIST_BOUNDS}>
                {(workflows ?? []).map((w) => (
                  <OptionItem
                    key={w.id}
                    value={w.id}
                    label={w.name || w.id}
                    description={w.name && w.name !== w.id ? w.id : undefined}
                  />
                ))}
              </SelectContent>
            </Select>
            {(workflowsError != null || workflows?.length === 0) && (
              <p id="job-workflow-help" className="mt-1 text-xs text-muted-foreground">
                {workflowsError != null
                  ? 'Could not list workflows.'
                  : 'No workflows yet. Author one on the Workflows page.'}
              </p>
            )}
          </div>
        )}
      </div>
      <div>
        <Label htmlFor="job-schedule">Schedule</Label>
        <Input
          id="job-schedule"
          value={schedule}
          onChange={(e) => setSchedule(e.target.value)}
          aria-describedby="job-schedule-help job-schedule-next"
          aria-invalid={parsedSchedule.error ? true : undefined}
          className="mt-1 max-w-xs font-mono"
          onKeyDown={(e) => e.key === 'Enter' && create()}
        />
        <p id="job-schedule-help" className="mt-1 max-w-[56ch] text-xs text-muted-foreground">
          Five-field cron in UTC (minute hour day month weekday), <code>@daily</code>,{' '}
          <code>every:5m</code> or seconds.{' '}
          <strong className="font-medium">Empty runs only when you press Run now.</strong>
        </p>
        {/* What the harness will do with it, said before it is created: a new job
                      fires at the next sweep whatever its schedule, then follows it. */}
        {/* Not a live region: it is in the field's description, so it is read on
                      focus, and announcing it on every keystroke read "Not a schedule…"
                      four times while `0 9 * * *` was typed. */}
        <p
          id="job-schedule-next"
          className={cn(
            'mt-0.5 max-w-[56ch] text-xs',
            parsedSchedule.error
              ? 'text-state-failed'
              : costly
                ? 'font-medium text-state-blocked'
                : 'text-muted-foreground',
          )}
        >
          {parsedSchedule.error
            ? parsedSchedule.error
            : parsedSchedule.schedule
              ? parsedSchedule.schedule.kind === 'manual'
                ? 'Manual only: it runs when you press Run now, never on its own.'
                : `${
                    startPaused
                      ? 'Starts paused: it runs only when resumed or run by hand'
                      : 'First run at the next sweep, about a minute after creating it'
                  }; then ${
                    parsedSchedule.schedule.kind === 'interval'
                      ? `${scheduleLabel(schedule)}${
                          costly
                            ? ` — about ${Math.round(
                                DAY_MS / parsedSchedule.schedule.ms,
                              ).toLocaleString()} agent turns a day`
                            : ''
                        }`
                      : `next ${localAndUtc(nextAfter(parsedSchedule.schedule, now) ?? Number.NaN)}`
                  }.`
              : null}
        </p>
      </div>
      {target === 'agent' ? (
        <>
          <div>
            <Label htmlFor="job-prompt">Prompt</Label>
            {/* A textarea: the prompt is a whole instruction, and one line of
                      input showed a sliver of it while it was being written. */}
            <Textarea
              id="job-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              aria-describedby="job-prompt-help"
              rows={3}
              className="mt-1 resize-y"
            />
            <p id="job-prompt-help" className="mt-1 text-xs text-muted-foreground">
              Sent as the turn on each run. Empty sends “ping”.
            </p>
          </div>
          {/* A native checkbox: the shared primitives have no switch, and a `<button
              aria-pressed>` for a yes/no that is submitted with a form promises a
              toggle rather than a field. */}
          {/* The label is the choice; the reasoning is help under it. It was one
                    three-line 11px paragraph wrapped round the box, so the thing
                    being chosen was the first clause of a sentence. */}
          <div>
            <label htmlFor="job-fresh-thread" className="flex items-center gap-2 text-sm">
              <input
                id="job-fresh-thread"
                type="checkbox"
                checked={freshThread}
                onChange={(e) => setFreshThread(e.target.checked)}
                aria-describedby="job-fresh-thread-help"
                className="size-3.5 shrink-0 accent-primary"
              />
              Fresh thread each run
            </label>
            <p
              id="job-fresh-thread-help"
              className="mt-1 ml-5.5 max-w-[56ch] text-xs text-muted-foreground"
            >
              Off, every run shares one thread named after the job, so a digest remembers last week.
              On, each run starts clean — for a job that works something different each time.
            </p>
          </div>
        </>
      ) : (
        <div>
          <Label htmlFor="job-inputs">Inputs</Label>
          <Textarea
            id="job-inputs"
            value={inputsText}
            onChange={(e) => setInputsText(e.target.value)}
            aria-describedby="job-inputs-help"
            aria-invalid={'error' in parsedInputs ? true : undefined}
            rows={3}
            spellCheck={false}
            placeholder="{}"
            className="mt-1 resize-y font-mono"
          />
          <p
            id="job-inputs-help"
            className={cn(
              'mt-1 max-w-[56ch] text-xs',
              'error' in parsedInputs ? 'text-state-failed' : 'text-muted-foreground',
            )}
          >
            {'error' in parsedInputs
              ? parsedInputs.error
              : 'The workflow’s inputs for every run, as a JSON object. The harness checks them against the workflow when the job is saved.'}
          </p>
        </div>
      )}
      <div>
        <label htmlFor="job-start-paused" className="flex items-center gap-2 text-sm">
          <input
            id="job-start-paused"
            type="checkbox"
            checked={startPaused}
            onChange={(e) => setStartPaused(e.target.checked)}
            aria-describedby="job-start-paused-help"
            className="size-3.5 shrink-0 accent-primary"
          />
          Start paused
        </label>
        <p
          id="job-start-paused-help"
          className="mt-1 ml-5.5 max-w-[56ch] text-xs text-muted-foreground"
        >
          A new scheduled job runs at the next sweep. Paused, it waits until you resume it; Run now
          still works, to try it once first.
        </p>
      </div>
      {error != null && <ErrorNotice error={error} doing="schedule this job" />}
      <div className="flex gap-2">
        <Button
          size="sm"
          className="gap-1"
          disabled={saving || jobUnready !== null}
          aria-describedby={jobUnready ? 'job-unready' : undefined}
          onClick={create}
        >
          {existing ? 'Replace' : submitLabel}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <WhyDisabled id="job-unready" reason={saving ? null : jobUnready} />
      </div>
    </div>
  );
}
