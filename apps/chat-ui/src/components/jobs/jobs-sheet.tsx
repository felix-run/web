import { Badge } from '@felix/ui/badge';
import { Button } from '@felix/ui/button';
import { Input } from '@felix/ui/input';
import { ScrollArea } from '@felix/ui/scroll-area';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@felix/ui/sheet';
import { ClockIcon, HistoryIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { deleteJob, listJobRuns, listJobs, upsertJob } from '@/api';
import { ConfirmButton } from '@/components/confirm-button';
import type { JobRecord, JobRun } from '@/types';

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
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [schedule, setSchedule] = useState('0 9 * * *');
  const [manifestId, setManifestId] = useState(manifest);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [runs, setRuns] = useState<JobRun[]>([]);

  const refresh = useCallback(async () => {
    try {
      setJobs(await listJobs());
      setError(null);
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void refresh();
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [open, refresh]);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await upsertJob({ name: name.trim(), schedule: schedule.trim(), manifest_id: manifestId });
      setName('');
      await refresh();
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
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
    setRuns([]);
    try {
      setRuns(await listJobRuns(jobName));
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    }
  }

  async function remove(jobName: string) {
    setBusy(true);
    try {
      await deleteJob(jobName);
      if (expanded === jobName) setExpanded(null);
      await refresh();
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-lg">
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
          {error && <p className="text-xs text-state-failed">⚠ {error}</p>}

          {/* Create form */}
          <div className="space-y-1.5 rounded-md border border-dashed p-2.5">
            <div className="text-xs font-medium text-muted-foreground">New job</div>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="job name, e.g. nightly-digest"
              className="h-8 font-mono text-sm"
            />
            <div className="flex gap-2">
              <Input
                value={schedule}
                onChange={(e) => setSchedule(e.target.value)}
                placeholder="cron (m h dom mon dow); leave empty to never run"
                className="h-8 font-mono text-sm"
                title="Standard 5-field cron, UTC. Empty disables automatic scheduling."
              />
              <select
                value={manifestId}
                onChange={(e) => setManifestId(e.target.value)}
                className="h-8 rounded-md border bg-transparent px-1.5 font-mono text-sm outline-none"
              >
                {(manifestOptions.length ? manifestOptions : [manifest]).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
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
                <p className="text-xs text-muted-foreground">No jobs yet. Create one above.</p>
              )}
              {jobs.map((j) => (
                <div key={j.name} className="rounded-md border bg-background px-2.5 py-1.5 text-xs">
                  {/* wraps so an armed delete confirmation gets its own line rather
                      than crushing the job name out of the row */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-medium">{j.name}</span>
                    <Badge variant="secondary" className="py-0 font-mono text-xs">
                      {j.schedule || 'manual'}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{j.manifest_id || '—'}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto h-6 gap-1 px-2 text-xs"
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
                    {j.last_run_at && <span>ran {rel(j.last_run_at)}</span>}
                    {j.next_run_at && <span>next {rel(j.next_run_at)}</span>}
                    {j.last_error && <span className="text-state-failed">{j.last_error}</span>}
                  </div>
                  {expanded === j.name && (
                    <div className="mt-1.5 space-y-1 border-t pt-1.5">
                      {runs.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No runs recorded.</p>
                      ) : (
                        runs.map((r, i) => (
                          <div
                            key={r.run_id ?? `${j.name}-${i}`}
                            className="flex items-center gap-2 text-xs text-muted-foreground"
                          >
                            <span className="font-mono">{r.status ?? '—'}</span>
                            {r.started_at && <span>{rel(r.started_at)}</span>}
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

/** Relative time like "in 3h" / "2m ago" from a ms timestamp. */
function rel(ts: number): string {
  const diff = ts - Date.now();
  const abs = Math.abs(diff);
  const m = Math.round(abs / 60000);
  const h = Math.round(abs / 3600000);
  const d = Math.round(abs / 86400000);
  const unit = abs < 3600000 ? `${m}m` : abs < 86400000 ? `${h}h` : `${d}d`;
  return diff >= 0 ? `in ${unit}` : `${unit} ago`;
}
