import { threadSuffix } from '@felix/client';
import type { JobRecord, JobRun } from '@/types';

/**
 * What wrote a job that no operator wrote: an agent's `schedule_task`, or a person turning on a
 * heartbeat. The mark is `payload.scheduled_by`, read as the harness reads it
 * (`felix/jobs/store.py:scheduled_by`): it counts only while it names the manifest the job runs,
 * so one re-saved onto another agent is an ordinary job.
 */
export interface JobOrigin {
  kind: 'task' | 'heartbeat';
  title?: string;
  /** The conversation it reports to, as the address spells it. */
  threadSuffix?: string;
}

export function jobOrigin(j: JobRecord): JobOrigin | null {
  const by = j.payload?.scheduled_by;
  if (!by || typeof by !== 'object') return null;
  const { tool, manifest, thread_id: thread } = by as Record<string, unknown>;
  if (manifest !== j.manifest_id) return null;
  const kind = tool === 'schedule_task' ? 'task' : tool === 'heartbeat' ? 'heartbeat' : null;
  if (!kind) return null;
  const title = j.payload?.title;
  return {
    kind,
    ...(typeof title === 'string' && title.trim() ? { title: title.trim() } : {}),
    ...(typeof thread === 'string' && thread ? { threadSuffix: threadSuffix(thread) } : {}),
  };
}

/**
 * What a re-save does to a job someone else wrote, asked before Pause or Resume. `PUT /jobs/{name}`
 * is the only way to set `enabled`, and from anyone but the writer it is a takeover. This client
 * does not know who it is signed in as in the harness's spelling, so it says who keeps it intact.
 */
export function takeoverQuestion(j: JobRecord, origin: JobOrigin, verb: string): string {
  const noun = origin.kind === 'task' ? 'a scheduled task' : 'a heartbeat';
  const writer = j.created_by ?? 'whoever wrote it';
  return `${verb} ${j.name}? Unless you are ${writer}, this takes it over: it runs as you, its preferences and state are cleared, and it stops being ${noun}.`;
}

/** The tool sources a run could not reach, across the agent and any child it compiled. */
export function missingSources(run: JobRun): string[] {
  const by = run.result?.unavailable_sources;
  return by ? [...new Set(Object.values(by).flat())] : [];
}

/** A report that did not reach the conversation, in words; null when it did, or there was none. */
export function reportProblem(run: JobRun): string | null {
  switch (run.result?.report) {
    case 'queued':
      return 'report waiting for the run in its conversation';
    case 'screened':
      return 'report withheld by screening';
    case 'failed':
      return 'report could not be added';
    case 'missing':
      return 'its conversation no longer exists';
    default:
      return null;
  }
}
