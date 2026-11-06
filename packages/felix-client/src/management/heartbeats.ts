/**
 * A person's own heartbeats (`/heartbeats`): a periodic check an operator defines on an agent
 * (`spec.heartbeat`) and each person switches on for themselves.
 *
 * Every route answers for the caller and nobody else, so each needs a named person: a shared key
 * or an anonymous request is refused `403 shared_subject` or `no_caller`, which no broader scope
 * cures. `GET /heartbeats` lists only what the caller has turned on. What an agent *offers* is on
 * its `/v1/models` row, as `ManifestEntry.heartbeat`.
 */

import type { FelixHttp } from '../http';

/** One row, as `felix/jobs/heartbeat.py:public` builds it. */
export interface Heartbeat {
  manifest: string;
  /** The job behind it, which the Jobs page lists: its runs and preferences are there. */
  name: string;
  enabled: boolean;
  schedule: string;
  /** The IANA zone a cron schedule is read in; `null` is UTC. */
  timezone?: string | null;
  /** The person's heartbeat conversation, where each notice is left. */
  thread_id?: string | null;
  next_run_at?: number | null;
  last_run_at?: number | null;
  last_status?: string | null;
  /** When it stops for good (ISO 8601), for a credential no firing can re-check. */
  expires_at?: string | null;
}

/** What `POST /heartbeats/{manifest}/run` returns: the job's run, read here for its outcome. */
export interface HeartbeatRun {
  status?: string;
  error?: string | null;
  result?: {
    /** It sent no notice. Not an all-clear: `answer` says whether it found nothing. */
    quiet?: boolean;
    /** What the firing replied, cut to 500 characters. `HEARTBEAT_OK` is a clean check. */
    answer?: string;
    /** Why it did not run: `daily_cap`, `preferences_missing`, … A code, not a sentence. */
    reason?: string;
    /** The cap a `daily_cap` skip reached. */
    max_firings_per_day?: number;
    /** Tool sources the run could not reach, by the manifest that named each. */
    unavailable_sources?: Record<string, string[]>;
  };
}

export function createHeartbeatsClient(http: FelixHttp) {
  const { chatFetch, detailOf } = http;

  /** GET /heartbeats → the caller's own, on every agent. */
  async function listHeartbeats(): Promise<Heartbeat[]> {
    const res = await chatFetch('/heartbeats');
    if (!res.ok) throw new Error(`heartbeats: ${res.status} ${await detailOf(res)}`);
    return ((await res.json()) as { items?: Heartbeat[] }).items ?? [];
  }

  /**
   * PUT /heartbeats/{manifest} → on, or off. Off keeps the heartbeat and its conversation, and on
   * goes back to the same conversation, waiting for the next scheduled slot. Off always works on
   * one the caller has; on is refused where the agent no longer offers one, or no longer lets them.
   */
  async function setHeartbeat(manifest: string, enabled: boolean): Promise<Heartbeat> {
    const res = await chatFetch(`/heartbeats/${encodeURIComponent(manifest)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    // Only an agent that is gone: a PUT never answers 404 for the heartbeat itself.
    if (res.status === 404) throw new Error('heartbeats/set: 404 heartbeat_agent_gone');
    if (!res.ok) throw new Error(`heartbeats/set: ${res.status} ${await detailOf(res)}`);
    return (await res.json()) as Heartbeat;
  }

  /** DELETE /heartbeats/{manifest} → its job and run history go; its conversation stays. */
  async function deleteHeartbeat(manifest: string): Promise<void> {
    const res = await chatFetch(`/heartbeats/${encodeURIComponent(manifest)}`, {
      method: 'DELETE',
    });
    if (res.status === 404) throw new Error('heartbeats/delete: 404 heartbeat_gone');
    if (!res.ok) throw new Error(`heartbeats/delete: ${res.status} ${await detailOf(res)}`);
  }

  /** POST /heartbeats/{manifest}/run → fires it now and answers once the run has finished. */
  async function runHeartbeat(manifest: string): Promise<HeartbeatRun> {
    const res = await chatFetch(`/heartbeats/${encodeURIComponent(manifest)}/run`, {
      method: 'POST',
    });
    if (res.status === 404) throw new Error('heartbeats/run: 404 heartbeat_gone');
    if (!res.ok) throw new Error(`heartbeats/run: ${res.status} ${await detailOf(res)}`);
    return (await res.json()) as HeartbeatRun;
  }

  return { listHeartbeats, setHeartbeat, deleteHeartbeat, runHeartbeat };
}
