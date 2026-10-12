import { relativeTime, threadSuffix } from '@felix/client';
import { Badge } from '@felix/ui/badge';
import { Button } from '@felix/ui/button';
import { Input } from '@felix/ui/input';
import { Label } from '@felix/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@felix/ui/select';
import { Textarea } from '@felix/ui/textarea';
import {
  ClockIcon,
  HistoryIcon,
  LoaderIcon,
  PauseIcon,
  PlayIcon,
  StepForwardIcon,
  Trash2Icon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { deleteJob, listJobRuns, listJobs, listUsageByThread, runJobNow, upsertJob } from '@/api';
import { ConfirmButton } from '@/components/confirm-button';
import { ErrorNotice } from '@/components/error-notice';
import {
  CREATE_FORM,
  CreateToggle,
  PageEmpty,
  PageHeader,
  PageSection,
  Panel,
  PanelBody,
  plural,
} from '@/components/harness/panel';
import { StaleNotice, StatusDot, withAge } from '@/components/inspector/primitives';
import { useSharedPoll } from '@/hooks/useSharedPoll';
import { failing, JOBS_POLL_KEY } from '@/lib/harness-glances';
import { nextAfter, parseSchedule, ScheduleError, scheduleLabel } from '@/lib/job-schedule';
import { cn } from '@/lib/utils';
import { useOptionalShell } from '@/shell-context';
import type { JobRecord, JobRun } from '@/types';

/**
 * Scheduled-jobs workbench — the `/jobs` registry as a `/harness` page. A job is a
 * persistent, tenant-scoped record the scheduler fires on its `schedule`, in the grammar
 * `lib/job-schedule.ts` mirrors from the harness. **An empty schedule runs every 60
 * seconds**: this page called it "manual" and said it never ran on its own, while a job so
 * labelled fired about 1,440 times a day. A job with no `next_run_at` yet — a new one — fires
 * at the next sweep, whatever its schedule says, and then follows it.
 *
 * The sweep only fires when felix-scheduler runs alongside felix-worker. Run now
 * (`POST /jobs/{name}/run`) fires a job by hand and answers when the run has finished.
 */

/** As many runs as the history asks for; a list this long says it was cut. */
const RUNS_SHOWN = 20;

/** `1.4s`, `2m 05s`: how long a run took, from its own timestamps. */
function duration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const m = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return `${m}m ${String(sec).padStart(2, '0')}s`;
}

/** `0:42`: a running clock, for a Run now that takes a whole agent turn. */
function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** The window a row's spend covers: the Activity page's own `24h`. */
const SPEND_WINDOW_MS = 24 * 60 * 60 * 1000;
const SPEND_POLL_KEY = 'jobs-spend';

/**
 * A job runs on `{tenant}:job:<name>`, or `{tenant}:job:<name>:<id>` with a fresh thread each
 * run (`felix/jobs/scheduler.py`). `/usage/threads` names threads in that full spelling.
 */
function isJobThread(threadId: string, jobName: string): boolean {
  const suffix = threadId.slice(threadId.indexOf(':') + 1);
  return suffix === `job:${jobName}` || suffix.startsWith(`job:${jobName}:`);
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

// Re-exported from where the rail's glance can import them without this page.
export { failing, JOBS_POLL_KEY };

export function JobsSheet({
  manifest,
  manifestOptions,
}: {
  manifest: string;
  manifestOptions: string[];
}) {
  // A managed poll rather than a bare interval: this was the one poll in the app
  // that never moved onto one, so a backgrounded tab with the sheet open kept
  // hitting the harness every four seconds forever. Shared with the rail's `Jobs · N failing` glance: one request, and the two
  // can never disagree about the count.
  const {
    data,
    error: listError,
    lastOkAt,
    refresh,
  } = useSharedPoll(JOBS_POLL_KEY, listJobs, { intervalMs: 4000 });
  // Kept apart from `data` so the header can tell "no jobs" from "not loaded yet".
  // Failing first: someone coming back wants the exception before the list.
  // Stable otherwise, so the harness's own order holds among the healthy ones.
  const jobs = [...(data ?? [])].sort((a, b) => Number(failing(b)) - Number(failing(a)));
  const failingCount = jobs.filter(failing).length;

  const [actionError, setActionError] = useState<unknown>(null);
  // The form sits behind a button. It led the page, so what an operator comes
  // here to read — which jobs exist, and how their last run went — started below
  // five inputs and a paragraph about thread reuse, for a page visited far more
  // often to look than to create.
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [schedule, setSchedule] = useState('0 9 * * *');
  const [manifestId, setManifestId] = useState(manifest);
  // Both live in the job's free-form `payload`. `prompt` is the turn each firing
  // sends (the worker falls back to "ping" when there is none, which is a job that
  // runs and asks nothing). `fresh_thread` gives each firing its own thread: by
  // default every run of a job shares one, named after the job, so a digest
  // remembers last week — and a job that works a different ticket each time would
  // carry ticket N's transcript into ticket N+1's context.
  const [prompt, setPrompt] = useState('');
  const [freshThread, setFreshThread] = useState(false);
  // A new job fires at the next sweep whatever its schedule; started paused, it waits until
  // someone resumes it — the one way to set a job up without it running first.
  const [startPaused, setStartPaused] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  // `null` means "not loaded yet", which is not the same as "no runs". Rendering an
  // empty array during the fetch told the operator a job had never run while its
  // history was still in flight — the one moment the answer matters most.
  const [runs, setRuns] = useState<JobRun[] | null>(null);
  const [runsError, setRunsError] = useState<unknown>(null);
  // The job a Run now is waiting on. The route answers when the run has finished, which is
  // a whole agent turn, so the row says it is going rather than looking idle.
  // Per job, with when it started: a Run now locks its own row, not every row, and says how
  // long it has been going — the route answers only when the whole agent turn is over.
  const [running, setRunning] = useState<Record<string, number>>({});
  const [now, setNow] = useState(() => Date.now());
  const anyRunning = Object.keys(running).length > 0;
  // Every second while a Run now counts; every 15s otherwise. It ticked only during a run, so
  // a page left open measured "due now" and the form's preview against when it was opened.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), anyRunning ? 1000 : 15_000);
    return () => clearInterval(id);
  }, [anyRunning]);
  // Spend per job over the last day, from the same per-thread meter the Activity page reads.
  // 200 is the route's ceiling (a larger limit is a 422, and the page said nothing at all).
  // `null` is a harness without the route: say nothing rather than draw every job as free.
  const spend = useSharedPoll(
    SPEND_POLL_KEY,
    () => listUsageByThread({ since_ms: Date.now() - SPEND_WINDOW_MS, limit: 200 }),
    { intervalMs: 60_000 },
  ).data;
  const spendOf = (jobName: string) => {
    if (!spend) return null;
    const rows = spend.items.filter((t) => isJobThread(t.thread_id, jobName));
    if (rows.length === 0) return spend.truncated ? null : { calls: 0, cost: 0 };
    return {
      calls: rows.reduce((n, t) => n + t.calls, 0),
      cost: rows.reduce((n, t) => n + t.cost_usd, 0),
    };
  };
  // What the last Run now came to, for a screen reader: the spinner turning back into a
  // button announced nothing.
  const [announce, setAnnounce] = useState('');
  // A run blocked on an approval waits on a person, and the row only said "Running…". The
  // tenant-wide `/approvals` poll names each row's thread; a job runs on `job:<name>` (or
  // `job:<name>:<id>` with a fresh thread each run).
  const approvals = useOptionalShell()?.tenantApprovals.pending ?? [];
  // Any run of the job, scheduled or by hand: a scheduled firing blocked on an approval
  // waits on a person just the same. The rows carry the client's suffix (`threadSuffix`, the
  // part after the *last* colon), so the shared thread `{tenant}:job:<name>` arrives as
  // `<name>`; a fresh-thread run's arrives as its own id and cannot be told apart.
  const waitingOn = (jobName: string) =>
    approvals.some((a) => a.thread_id === threadSuffix(`job:${jobName}`));
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
  const costly =
    parsedSchedule.schedule?.kind === 'interval' && parsedSchedule.schedule.ms < COSTLY_INTERVAL_MS;

  async function create() {
    if (!name.trim() || parsedSchedule.error) return;
    setBusy(true);
    setActionError(null);
    try {
      // Only the keys that were set: the scheduler reads `payload.get(...)`, so an
      // explicit `fresh_thread: false` is noise on every row nobody asked for.
      const payload: Record<string, unknown> = {};
      if (prompt.trim()) payload.prompt = prompt.trim();
      if (freshThread) payload.fresh_thread = true;
      await upsertJob({
        name: name.trim(),
        schedule: schedule.trim(),
        manifest_id: manifestId,
        payload,
        // Replacing keeps the job's own state unless the form says to pause it.
        enabled: startPaused ? false : (existing?.enabled ?? true),
      });
      setName('');
      setPrompt('');
      setFreshThread(false);
      setStartPaused(false);
      closeForm();
      refresh();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  async function toggleRuns(jobName: string) {
    if (expanded === jobName) {
      setExpanded(null);
      return;
    }
    setExpanded(jobName);
    setRuns(null);
    setRunsError(null);
    try {
      setRuns(await listJobRuns(jobName, RUNS_SHOWN));
    } catch (err) {
      setRunsError(err);
      setRuns([]);
    }
  }

  // An open history follows the job. It was read once, so a row reading `last running` sat
  // over a list whose newest run said OK, and a job firing every minute showed the same
  // twenty runs for as long as the list was open. Re-read when the job's own last run moves,
  // which the page's poll already reports — not on every tick.
  const openJob = jobs.find((j) => j.name === expanded);
  const openMark = openJob ? `${openJob.last_run_at ?? ''}|${openJob.last_status ?? ''}` : '';
  useEffect(() => {
    if (!expanded || !openMark) return;
    let live = true;
    listJobRuns(expanded, RUNS_SHOWN).then(
      (next) => {
        if (live) {
          setRuns(next);
          setRunsError(null);
        }
      },
      () => {
        // Keep what is on screen; the next movement tries again.
      },
    );
    return () => {
      live = false;
    };
  }, [expanded, openMark]);

  /** Close the form and hand focus back to the toggle that opened it, not to the page. */
  function closeForm() {
    setCreating(false);
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>('[aria-controls="job-create"]')?.focus(),
    );
  }
  // Opening the form lands in its first field.
  useEffect(() => {
    if (creating) requestAnimationFrame(() => nameRef.current?.focus());
  }, [creating]);

  /**
   * Pause or resume: the same record with `enabled` flipped. The docs' way to stop a job was
   * `enabled: false`, and the page had no control for it, so stopping one meant deleting it
   * and its history.
   */
  async function setEnabled(j: JobRecord, enabled: boolean) {
    setBusy(true);
    setActionError(null);
    try {
      await upsertJob({
        name: j.name,
        schedule: j.schedule ?? '',
        manifest_id: j.manifest_id ?? '',
        payload: j.payload ?? {},
        enabled,
      });
      setAnnounce(`${j.name} ${enabled ? 'resumed' : 'paused'}.`);
      refresh();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove(jobName: string) {
    setBusy(true);
    setActionError(null);
    try {
      await deleteJob(jobName);
      if (expanded === jobName) setExpanded(null);
      refresh();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Fire a job now and show what it did. The response is the finished run, so its history
   * opens with that run on top; the list refreshes for the row's `last` and `ran`.
   */
  async function runNow(jobName: string) {
    setRunning((r) => ({ ...r, [jobName]: Date.now() }));
    setNow(Date.now());
    setActionError(null);
    setAnnounce('');
    try {
      const run = await runJobNow(jobName);
      setAnnounce(
        run.status === 'error' || run.error
          ? `${jobName} ran and failed.`
          : run.result?.reason
            ? `${jobName} was skipped: ${run.result.reason}.`
            : `${jobName} ran: ${run.status ?? 'done'}.`,
      );
      setExpanded(jobName);
      setRunsError(null);
      setRuns(await listJobRuns(jobName, RUNS_SHOWN).catch(() => [run]));
      refresh();
    } catch (err) {
      setAnnounce(`${jobName} could not be run.`);
      setActionError(err);
    } finally {
      setRunning(({ [jobName]: _, ...rest }) => rest);
    }
  }

  return (
    <Panel>
      {/* "Jobs", as the nav says. The page was "Scheduled jobs" under a nav entry
          reading "Jobs", which is one place answering to two names. */}
      <PageHeader
        icon={<ClockIcon />}
        title="Jobs"
        // The count, then how many are failing in the failed chip — the one
        // number here an operator acts on, which the header never said.
        valueLead={data && failingCount > 0 ? `${plural(jobs.length, 'job')} ·` : undefined}
        // Aged when the latest read failed: the list below is the last good
        // one, and the count above it should not claim to be current.
        value={withAge(
          data
            ? failingCount > 0
              ? `${failingCount} failing`
              : plural(jobs.length, 'job')
            : undefined,
          listError ? lastOkAt : undefined,
        )}
        valueTone={failingCount > 0 ? 'failed' : 'default'}
        controls={
          <CreateToggle
            open={creating}
            onToggle={() => setCreating((v) => !v)}
            controls="job-create"
          >
            New job
          </CreateToggle>
        }
      />

      <PanelBody className="space-y-4">
        <p role="status" className="sr-only">
          {announce}
        </p>
        {/* A failed read after a good one keeps the rows under one line, as every
            polled page does; the box is only for a failure with nothing earlier
            to show. Jobs polls every few seconds, so it meets a 429 first. */}
        {listError && data && lastOkAt != null ? (
          <StaleNotice
            error={listError}
            doing="list scheduled jobs"
            lastOkAt={lastOkAt}
            onRetry={refresh}
          />
        ) : listError ? (
          <ErrorNotice
            error={listError}
            doing="list scheduled jobs"
            action={
              <Button size="sm" variant="outline" className="self-start text-xs" onClick={refresh}>
                Try again
              </Button>
            }
          />
        ) : null}
        {actionError != null && <ErrorNotice error={actionError} doing="update this job" />}

        {creating && (
          // A section with a heading, not a dashed box: the form is a part of
          // the page while it is open, and a heading is what names a part.
          <div
            id="job-create"
            role="group"
            aria-label="New job"
            className={CREATE_FORM}
            onKeyDown={(e) => {
              // As every other dismissable surface here: Escape puts it away.
              if (e.key === 'Escape' && !e.defaultPrevented) closeForm();
            }}
          >
            <PageSection title="Job to schedule">
              {/* Visible labels, with the format under the field it describes. The
                  labels were `sr-only` and the cron grammar lived in a placeholder,
                  so the one hint the schedule field needs vanished on the first
                  keystroke — and a half-typed `0 9 * *` has nothing to check it
                  against. */}
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
                  <div>
                    <Label htmlFor="job-name">Name</Label>
                    <Input
                      ref={nameRef}
                      id="job-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      aria-describedby={existing ? 'job-name-replaces' : undefined}
                      className="mt-1 h-8 text-sm"
                      onKeyDown={(e) => e.key === 'Enter' && create()}
                    />
                    {existing && (
                      // Amber: it waits on the operator's decision before it writes.
                      <p
                        id="job-name-replaces"
                        className="mt-1 max-w-[56ch] text-xs text-state-blocked"
                      >
                        <span className="font-mono">{existing.name}</span> exists. Replace changes
                        its schedule, agent and prompt; its run history stays
                        {existing.enabled === false ? ', and it stays paused' : ''}.
                      </p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="job-manifest">Agent</Label>
                    {/* The shared primitive, not a bare `<select>`: a native one draws
                        its option list with the OS, which ignores the app's theme. */}
                    <Select value={manifestId} onValueChange={setManifestId}>
                      <SelectTrigger
                        id="job-manifest"
                        size="sm"
                        className="mt-1 h-8 w-full font-mono text-sm"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(manifestOptions.length ? manifestOptions : [manifest]).map((m) => (
                          <SelectItem key={m} value={m} className="font-mono text-sm">
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label htmlFor="job-schedule">Schedule</Label>
                  <Input
                    id="job-schedule"
                    value={schedule}
                    onChange={(e) => setSchedule(e.target.value)}
                    aria-describedby="job-schedule-help job-schedule-next"
                    aria-invalid={parsedSchedule.error ? true : undefined}
                    className="mt-1 h-8 max-w-xs font-mono text-sm"
                    onKeyDown={(e) => e.key === 'Enter' && create()}
                  />
                  <p
                    id="job-schedule-help"
                    className="mt-1 max-w-[56ch] text-xs text-muted-foreground"
                  >
                    Five-field cron in UTC (minute hour day month weekday), <code>@daily</code>,{' '}
                    <code>every:5m</code> or seconds.{' '}
                    <strong className="font-medium">Empty runs every minute.</strong>
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
                        ? `${
                            startPaused
                              ? 'Starts paused: it runs only when resumed or run by hand'
                              : 'First run at the next sweep, about a minute after creating it'
                          }; then ${
                            parsedSchedule.schedule.kind === 'interval'
                              ? `${scheduleLabel(schedule)}${
                                  costly
                                    ? ` — about ${Math.round(
                                        SPEND_WINDOW_MS / parsedSchedule.schedule.ms,
                                      ).toLocaleString()} agent turns a day`
                                    : ''
                                }`
                              : `next ${localAndUtc(nextAfter(parsedSchedule.schedule, now))}`
                          }.`
                        : null}
                  </p>
                </div>
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
                    className="mt-1 resize-y text-sm"
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
                    Off, every run shares one thread named after the job, so a digest remembers last
                    week. On, each run starts clean — for a job that works something different each
                    time.
                  </p>
                </div>
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
                    A new job runs at the next sweep. Paused, it waits until you resume it; Run now
                    still works, to try it once first.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="gap-1"
                    disabled={busy || !name.trim() || parsedSchedule.error !== null}
                    onClick={create}
                  >
                    {existing ? 'Replace' : 'Create'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={closeForm}>
                    Cancel
                  </Button>
                </div>
              </div>
            </PageSection>
          </div>
        )}

        {/* Rows divided by hairlines, as the Activity page's are. Each job was a bordered
            card, which made a list of one kind of thing look like a pile of
            separate things, and spent a border on every row saying so. */}
        <div>
          {/* The page's one explanation lives here now, where it is needed: the
                header lost its subline, and a page with jobs on it explains itself. */}
          {data && jobs.length === 0 && (
            <PageEmpty>
              No jobs yet. A job is an agent run the scheduler starts on its schedule. One with no
              schedule runs every minute.
            </PageEmpty>
          )}
          {jobs.map((j) => {
            let invalid = false;
            try {
              parseSchedule(j.schedule ?? '');
            } catch {
              invalid = true;
            }
            const jobSpend = spendOf(j.name);
            return (
              <div
                key={j.name}
                className="border-b border-border/60 py-2 text-sm first-of-type:border-t"
              >
                {/* wraps so an armed delete confirmation gets its own line rather
                      than crushing the job name out of the row */}
                <div className="flex flex-wrap items-center gap-2">
                  {/* A heading, so a screen reader can move job to job. */}
                  <h3 className="font-mono text-sm font-medium">{j.name}</h3>
                  {/* On the name line, where the job's state is read: as a word on the meta
                    line it sat among muted facts and was missed. */}
                  {j.enabled === false && (
                    <span className="text-xs font-medium text-muted-foreground">paused</span>
                  )}
                  <Badge
                    variant="secondary"
                    className="py-0 font-mono text-xs"
                    // The badge is what the harness will do; the stored text is in the title
                    // when the two differ (an empty schedule).
                    title={
                      j.schedule ? `Schedule: ${j.schedule}` : 'No schedule: runs every minute'
                    }
                  >
                    {scheduleLabel(j.schedule ?? '')}
                  </Badge>
                  {/* Mono: the harness named it (the Provenance Rule). */}
                  {j.manifest_id ? (
                    <span className="font-mono text-xs text-muted-foreground">{j.manifest_id}</span>
                  ) : (
                    // The harness skips a run with no agent (`no_manifest`); said in words.
                    <span className="text-xs text-muted-foreground">
                      no agent — runs are skipped
                    </span>
                  )}
                  {invalid && (
                    // It never fires — the scheduler refuses it — though its next time stays.
                    <span className="text-xs font-medium text-state-failed">invalid schedule</span>
                  )}
                  {waitingOn(j.name) && (
                    <span className="text-xs font-medium text-state-blocked">
                      Waiting on an approval — see the attention line
                    </span>
                  )}
                  <Button
                    size="xs"
                    variant="ghost"
                    className="ml-auto coarse:h-9 coarse:px-3"
                    disabled={running[j.name] !== undefined}
                    aria-label={running[j.name] !== undefined ? undefined : `Run ${j.name} now`}
                    title={
                      j.enabled === false
                        ? 'Run once now. The job stays disabled for its schedule.'
                        : 'Run once now, without waiting for the schedule. A whole agent turn.'
                    }
                    onClick={() => runNow(j.name)}
                  >
                    {running[j.name] !== undefined ? (
                      <>
                        <LoaderIcon className="size-3 motion-safe:animate-spin" />
                        <span className="shimmer shimmer-color-foreground">
                          Running ·{' '}
                          <span className="tabular-nums">{clock(now - running[j.name])}</span>
                        </span>
                      </>
                    ) : (
                      <>
                        <PlayIcon className="size-3" /> Run now
                      </>
                    )}
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    className="coarse:h-9 coarse:px-3"
                    disabled={busy}
                    aria-label={`${j.enabled === false ? 'Resume' : 'Pause'} ${j.name}`}
                    onClick={() => setEnabled(j, j.enabled === false)}
                  >
                    {j.enabled === false ? (
                      <>
                        <StepForwardIcon className="size-3" /> Resume
                      </>
                    ) : (
                      <>
                        <PauseIcon className="size-3" /> Pause
                      </>
                    )}
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    className="coarse:h-9 coarse:px-3"
                    aria-expanded={expanded === j.name}
                    aria-controls={`job-runs-${j.name}`}
                    aria-label={`Runs of ${j.name}`}
                    onClick={() => toggleRuns(j.name)}
                  >
                    <HistoryIcon className="size-3" /> Runs
                  </Button>
                  <ConfirmButton
                    size="xs"
                    variant="ghost"
                    className="text-muted-foreground hover:text-state-failed coarse:h-9 coarse:px-3"
                    disabled={busy}
                    destructive
                    question={`Delete ${j.name}? Its run history goes with it.`}
                    confirmLabel="Delete job"
                    onConfirm={() => remove(j.name)}
                  >
                    <Trash2Icon className="size-3" />
                    <span className="sr-only">Delete {j.name}</span>
                  </ConfirmButton>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  {/* State first, then timing, then what it costs, then what it says: the
                    quoted prompt led the line, so its first words were content, not state. */}
                  {/* The status as the Activity page draws one — word and dot — rather
                    than plain muted text that read the same whether it passed. */}
                  {/* A run in progress is said as one: "last running" read as a finished run
                    whose result was "running". */}
                  {j.last_status === 'running' ? (
                    <span className="inline-flex items-center gap-1">
                      <StatusDot status="running" />
                    </span>
                  ) : j.last_status ? (
                    <span className="inline-flex items-center gap-1">
                      last <StatusDot status={j.last_status} />
                    </span>
                  ) : null}
                  {j.last_run_at && (
                    <span title={new Date(j.last_run_at).toLocaleString()}>
                      ran {relativeTime(j.last_run_at)}
                    </span>
                  )}
                  {/* Null is a job the scheduler has not claimed yet — it fires at the next
                    sweep; a time already past is due, not "next just now". */}
                  {j.enabled !== false &&
                    !invalid &&
                    (j.next_run_at == null ? (
                      <span>first run at the next sweep</span>
                    ) : j.next_run_at <= now + 1000 ? (
                      <span title={new Date(j.next_run_at).toLocaleString()}>due now</span>
                    ) : (
                      <span title={new Date(j.next_run_at).toLocaleString()}>
                        next {relativeTime(j.next_run_at)}
                      </span>
                    ))}
                  {jobSpend && (
                    <Link
                      to={{
                        pathname: '/harness/activity',
                        // One thread to open unless each run has its own.
                        search:
                          j.payload?.fresh_thread === true
                            ? '?since=24h'
                            : // The ledger files threads under `threadSuffix`, as every client does.
                              `?since=24h&thread=${encodeURIComponent(threadSuffix(`job:${j.name}`))}`,
                      }}
                      className="underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
                      title="This job's spend and turns on the Activity page"
                    >
                      {jobSpend.calls === 0
                        ? 'no model calls · 24h'
                        : jobSpend.cost > 0
                          ? `$${jobSpend.cost.toFixed(jobSpend.cost < 1 ? 3 : 2)} · ${jobSpend.calls} calls · 24h`
                          : // Metered but unpriced: `0` does not mean free.
                            `${jobSpend.calls} calls, unpriced · 24h`}
                    </Link>
                  )}
                  {/* Said only when set: the default is one thread kept between runs, and
                      restating a default on every row is what makes the exception vanish. */}
                  {j.payload?.fresh_thread === true && (
                    <span title="Each run gets a thread of its own; nothing carries over between runs.">
                      fresh thread each run
                    </span>
                  )}
                  {typeof j.payload?.prompt === 'string' && j.payload.prompt && (
                    <span className="min-w-0 truncate" title={j.payload.prompt}>
                      “{j.payload.prompt}”
                    </span>
                  )}
                  {j.last_error && <span className="text-state-failed">{j.last_error}</span>}
                </div>
                {expanded === j.name && (
                  <div id={`job-runs-${j.name}`} className="mt-1.5 border-t pt-1.5">
                    {runsError != null ? (
                      <ErrorNotice error={runsError} doing="load this job's run history" />
                    ) : runs === null ? (
                      <p className="text-sm text-muted-foreground">Loading runs…</p>
                    ) : runs.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No runs recorded.</p>
                    ) : (
                      // A list, in columns: status, when, how long, how it started, what it said.
                      // It was a row of loose spans, so nothing lined up from one run to the next.
                      <ol className="space-y-0.5">
                        {runs.map((r, i) => (
                          <li
                            key={r.run_id ?? `${j.name}-${i}`}
                            className="grid grid-cols-[3.5rem_4.5rem_3rem_minmax(0,1fr)] items-center gap-2 text-xs text-muted-foreground"
                          >
                            <span>{r.status ? <StatusDot status={r.status} /> : '—'}</span>
                            <span
                              title={
                                r.started_at ? new Date(r.started_at).toLocaleString() : undefined
                              }
                            >
                              {r.started_at ? relativeTime(r.started_at) : '—'}
                            </span>
                            <span className="text-right tabular-nums">
                              {r.started_at && r.finished_at && r.finished_at >= r.started_at
                                ? duration(r.finished_at - r.started_at)
                                : ''}
                            </span>
                            <span className="flex min-w-0 gap-2">
                              {/* Said only when it was not the schedule: the default is cron. */}
                              {r.result?.trigger === 'manual' && <span>run by hand</span>}
                              {r.error ? (
                                <span className="text-state-failed">{r.error}</span>
                              ) : r.result?.reason ? (
                                <span>skipped: {r.result.reason}</span>
                              ) : r.result?.answer ? (
                                // One line of what the agent said; the whole of it on hover.
                                <span
                                  className="min-w-0 truncate text-foreground/80"
                                  title={r.result.answer}
                                >
                                  {r.result.answer}
                                </span>
                              ) : null}
                            </span>
                          </li>
                        ))}
                      </ol>
                    )}
                    {/* The route returns the newest few; a list that long was cut, and
                      said nothing about it. */}
                    {runs !== null && runs.length >= RUNS_SHOWN && (
                      <p className="pt-1 text-xs text-muted-foreground">
                        The latest {RUNS_SHOWN} runs.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </PanelBody>
    </Panel>
  );
}
