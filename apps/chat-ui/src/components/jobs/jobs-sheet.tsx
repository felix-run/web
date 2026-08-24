import { Badge } from '@felix/ui/badge';
import { Button } from '@felix/ui/button';
import { Input } from '@felix/ui/input';
import { Label } from '@felix/ui/label';
import { ScrollArea } from '@felix/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@felix/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@felix/ui/sheet';
import { ClockIcon, HistoryIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { deleteJob, listJobRuns, listJobs, upsertJob } from '@/api';
import { ConfirmButton } from '@/components/confirm-button';
import { ErrorNotice } from '@/components/error-notice';
import { usePoll } from '@/hooks/usePoll';
import { relativeTime } from '@/lib/time';
import type { JobRun } from '@/types';

/**
 * Scheduled-jobs workbench — the `/jobs` registry as a slide-over. A job is a
 * persistent, tenant-scoped record the worker's `run_scheduled_jobs` cron
 * invokes on its `schedule`; an empty schedule means it is never swept.
 *
 * The sweep only fires when felix-scheduler runs alongside felix-worker. There
 * is no run-now route on the harness, so runs are observed rather than
 * triggered — expand a job to see its recent runs.
 */
export function JobsSheet({
  open,
  onOpenChange,
  manifest,
  manifestOptions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  manifest: string;
  manifestOptions: string[];
}) {
  // `usePoll` rather than a bare interval: this was the one poll in the app that
  // never moved onto it, so a backgrounded tab with the sheet open kept hitting the
  // harness every four seconds forever.
  const {
    data: jobs = [],
    error: listError,
    refresh,
  } = usePoll(listJobs, { enabled: open, intervalMs: 4000 });

  const [actionError, setActionError] = useState<unknown>(null);
  const [name, setName] = useState('');
  const [schedule, setSchedule] = useState('0 9 * * *');
  const [manifestId, setManifestId] = useState(manifest);
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
      await upsertJob({ name: name.trim(), schedule: schedule.trim(), manifest_id: manifestId });
      setName('');
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* Two widths across the four sheets, by role: the read-only Agent spec is a
          reading column at `max-w-md`, and every sheet you *work* in is `max-w-xl`.
          It was three widths for four sheets with no rule behind them. */}
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2">
            <ClockIcon className="size-4" /> Scheduled jobs
          </SheetTitle>
          <SheetDescription>
            Persistent cron-scheduled agent runs, swept by the worker. Expand a job for its recent
            run history.
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
          {listError && (
            <ErrorNotice
              error={listError}
              doing="list scheduled jobs"
              action={
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 self-start text-xs"
                  onClick={refresh}
                >
                  Try again
                </Button>
              }
            />
          )}
          {actionError != null && <ErrorNotice error={actionError} doing="update this job" />}

          {/* Create form */}
          <div className="space-y-1.5 rounded-md border border-dashed p-2.5">
            <div className="text-xs font-medium text-muted-foreground">New job</div>
            <Label htmlFor="job-name" className="sr-only">
              Job name
            </Label>
            <Input
              id="job-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="job name, e.g. nightly-digest"
              className="h-8 font-mono text-sm"
              onKeyDown={(e) => e.key === 'Enter' && create()}
            />
            <div className="flex gap-2">
              <Label htmlFor="job-schedule" className="sr-only">
                Schedule, as 5-field cron in UTC. Leave empty to never run automatically.
              </Label>
              <Input
                id="job-schedule"
                value={schedule}
                onChange={(e) => setSchedule(e.target.value)}
                placeholder="cron (m h dom mon dow); leave empty to never run"
                className="h-8 font-mono text-sm"
                onKeyDown={(e) => e.key === 'Enter' && create()}
              />
              {/* The shared primitive, not a bare `<select>`: a native one draws its
                  option list with the OS, which ignores the app's theme entirely. */}
              <Select value={manifestId} onValueChange={setManifestId}>
                <SelectTrigger
                  size="sm"
                  className="h-8 w-40 font-mono text-sm"
                  aria-label="Manifest for this job"
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
            <Button
              size="sm"
              className="h-7 gap-1"
              disabled={busy || !name.trim()}
              onClick={create}
            >
              <PlusIcon className="size-3.5" /> Create
            </Button>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-1.5 pr-3">
              {jobs.length === 0 && (
                <p className="text-sm text-muted-foreground">No jobs yet. Create one above.</p>
              )}
              {jobs.map((j) => (
                <div key={j.name} className="rounded-md border bg-background px-2.5 py-1.5 text-sm">
                  {/* wraps so an armed delete confirmation gets its own line rather
                      than crushing the job name out of the row */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-medium">{j.name}</span>
                    <Badge variant="secondary" className="py-0 font-mono text-xs">
                      {j.schedule || 'manual'}
                    </Badge>
                    <span className="text-muted-foreground">{j.manifest_id || '—'}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto h-6 gap-1 px-2 text-xs"
                      aria-expanded={expanded === j.name}
                      aria-controls={`job-runs-${j.name}`}
                      onClick={() => toggleRuns(j.name)}
                    >
                      <HistoryIcon className="size-3" /> Runs
                    </Button>
                    <ConfirmButton
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs text-muted-foreground hover:text-state-failed"
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
                  <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                    {j.enabled === false && <span>disabled</span>}
                    {j.last_status && <span>last: {j.last_status}</span>}
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
                            <span className="font-mono">{r.status ?? '—'}</span>
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
          </ScrollArea>
        </div>
      </SheetContent>
    </Sheet>
  );
}
