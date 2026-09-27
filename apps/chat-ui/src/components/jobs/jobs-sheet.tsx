import { relativeTime } from '@felix/client';
import { Badge } from '@felix/ui/badge';
import { Button } from '@felix/ui/button';
import { Input } from '@felix/ui/input';
import { Label } from '@felix/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@felix/ui/select';
import { ClockIcon, HistoryIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { deleteJob, listJobRuns, listJobs, upsertJob } from '@/api';
import { ConfirmButton } from '@/components/confirm-button';
import { ErrorNotice } from '@/components/error-notice';
import {
  CreateToggle,
  PageHeader,
  PageSection,
  Panel,
  PanelBody,
  plural,
} from '@/components/harness/panel';
import { StatusDot } from '@/components/inspector/primitives';
import { usePoll } from '@/hooks/usePoll';
import type { JobRun } from '@/types';

/**
 * Scheduled-jobs workbench — the `/jobs` registry as a `/harness` page. A job is a
 * persistent, tenant-scoped record the worker's `run_scheduled_jobs` cron
 * invokes on its `schedule`; an empty schedule means it is never swept.
 *
 * The sweep only fires when felix-scheduler runs alongside felix-worker. There
 * is no run-now route on the harness, so runs are observed rather than
 * triggered — expand a job to see its recent runs.
 */
export function JobsSheet({
  manifest,
  manifestOptions,
}: {
  manifest: string;
  manifestOptions: string[];
}) {
  // `usePoll` rather than a bare interval: this was the one poll in the app that
  // never moved onto it, so a backgrounded tab with the sheet open kept hitting the
  // harness every four seconds forever.
  const { data, error: listError, refresh } = usePoll(listJobs, { intervalMs: 4000 });
  // Kept apart from `data` so the header can tell "no jobs" from "not loaded yet".
  const jobs = data ?? [];

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
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  // `null` means "not loaded yet", which is not the same as "no runs". Rendering an
  // empty array during the fetch told the operator a job had never run while its
  // history was still in flight — the one moment the answer matters most.
  const [runs, setRuns] = useState<JobRun[] | null>(null);
  const [runsError, setRunsError] = useState<unknown>(null);

  async function create() {
    if (!name.trim()) return;
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
      });
      setName('');
      setPrompt('');
      setFreshThread(false);
      setCreating(false);
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
      setRuns(await listJobRuns(jobName));
    } catch (err) {
      setRunsError(err);
      setRuns([]);
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

  return (
    <Panel>
      {/* "Jobs", as the nav says. The page was "Scheduled jobs" under a nav entry
          reading "Jobs", which is one place answering to two names. */}
      <PageHeader
        icon={<ClockIcon />}
        title="Jobs"
        value={data ? plural(jobs.length, 'job') : undefined}
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
        {listError ? (
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
          <div id="job-create" className="pb-1">
            <PageSection title="New job">
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
                      id="job-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="nightly-digest"
                      className="mt-1 h-8 text-sm"
                      onKeyDown={(e) => e.key === 'Enter' && create()}
                    />
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
                    aria-describedby="job-schedule-help"
                    className="mt-1 h-8 max-w-xs font-mono text-sm"
                    onKeyDown={(e) => e.key === 'Enter' && create()}
                  />
                  <p id="job-schedule-help" className="mt-1 text-xs text-muted-foreground">
                    Five-field cron in UTC: minute hour day month weekday. Empty never runs on its
                    own.
                  </p>
                </div>
                <div>
                  <Label htmlFor="job-prompt">Prompt</Label>
                  <Input
                    id="job-prompt"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    aria-describedby="job-prompt-help"
                    className="mt-1 h-8 text-sm"
                    onKeyDown={(e) => e.key === 'Enter' && create()}
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
                    className="mt-1 ml-5.5 text-xs text-muted-foreground"
                  >
                    Off, every run shares one thread named after the job, so a digest remembers last
                    week. On, each run starts clean — for a job that works something different each
                    time.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="gap-1"
                    disabled={busy || !name.trim()}
                    onClick={create}
                  >
                    <PlusIcon className="size-3.5" /> Create
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            </PageSection>
          </div>
        )}

        {/* Rows divided by hairlines, as the Ledger's are. Each job was a bordered
            card, which made a list of one kind of thing look like a pile of
            separate things, and spent a border on every row saying so. */}
        <div>
          {/* The page's one explanation lives here now, where it is needed: the
                header lost its subline, and a page with jobs on it explains itself. */}
          {data && jobs.length === 0 && (
            <p className="max-w-prose text-sm text-muted-foreground">
              No jobs yet. A job is an agent run the worker starts on a cron schedule; once one
              exists, its recent runs are a click away on its row.
            </p>
          )}
          {jobs.map((j) => (
            <div
              key={j.name}
              className="border-b border-border/60 py-2 text-sm first-of-type:border-t"
            >
              {/* wraps so an armed delete confirmation gets its own line rather
                      than crushing the job name out of the row */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-medium">{j.name}</span>
                <Badge variant="secondary" className="py-0 font-mono text-xs">
                  {j.schedule || 'manual'}
                </Badge>
                {/* Mono: the harness named it (the Provenance Rule). */}
                <span className="font-mono text-xs text-muted-foreground">
                  {j.manifest_id || '—'}
                </span>
                <Button
                  size="xs"
                  variant="ghost"
                  className="ml-auto"
                  aria-expanded={expanded === j.name}
                  aria-controls={`job-runs-${j.name}`}
                  onClick={() => toggleRuns(j.name)}
                >
                  <HistoryIcon className="size-3" /> Runs
                </Button>
                <ConfirmButton
                  size="xs"
                  variant="ghost"
                  className="text-muted-foreground hover:text-state-failed"
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
                {j.enabled === false && <span>disabled</span>}
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
                {/* The status as the Ledger draws one — word and dot — rather
                    than plain muted text that read the same whether it passed. */}
                {j.last_status && (
                  <span className="inline-flex items-center gap-1">
                    last <StatusDot status={j.last_status} />
                  </span>
                )}
                {j.last_run_at && <span>ran {relativeTime(j.last_run_at)}</span>}
                {j.next_run_at && <span>next {relativeTime(j.next_run_at)}</span>}
                {j.last_error && <span className="text-state-failed">{j.last_error}</span>}
              </div>
              {expanded === j.name && (
                <div id={`job-runs-${j.name}`} className="mt-1.5 space-y-1 border-t pt-1.5">
                  {runsError != null ? (
                    <ErrorNotice error={runsError} doing="load this job's run history" />
                  ) : runs === null ? (
                    <p className="text-sm text-muted-foreground">Loading runs…</p>
                  ) : runs.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No runs recorded.</p>
                  ) : (
                    runs.map((r, i) => (
                      <div
                        key={r.run_id ?? `${j.name}-${i}`}
                        className="flex items-center gap-2 text-xs text-muted-foreground"
                      >
                        {r.status ? <StatusDot status={r.status} /> : <span>—</span>}
                        {r.started_at && <span>{relativeTime(r.started_at)}</span>}
                        {r.error && <span className="text-state-failed">{r.error}</span>}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </PanelBody>
    </Panel>
  );
}
