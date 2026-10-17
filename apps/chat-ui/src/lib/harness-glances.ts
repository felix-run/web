import { threadSuffix } from '@felix/client';
import { isFailure, tsToMs } from '@/components/inspector/primitives';
import { eventOutcome, isFailureOutcome, type OutcomeEvent } from '@/lib/audit-outcome';

/**
 * What the sidebar's glances read, apart from the pages that also read it.
 *
 * The Jobs and Activity pages share their polls with the rail's glance under
 * these keys, and the rail is in the entry chunk while the pages load with
 * `/harness`. Kept in their own module so the glance does not pull either page
 * in with it — importing `failing` from `jobs-sheet.tsx` was enough to put the
 * whole workbench in every first load.
 */

/** The key the Jobs page and the rail's glance share their `listJobs` read under. */
export const JOBS_POLL_KEY = 'jobs';

/** A job whose last run did not succeed. */
export function failing(j: { last_status?: string | null; last_error?: string | null }): boolean {
  return Boolean(j.last_error) || (j.last_status != null && isFailure(j.last_status));
}

/**
 * How many events the window covers. This is a request cap, not a total, and the
 * footer has to say so: `/audit` returns no count of what it did not send, so the
 * honest phrasing is "the last 60" rather than a number that looks like a census.
 * Upstream allows up to 500.
 */
export const ACTIVITY_FETCH = 60;

/**
 * The rail's Activity glance counts failures in this window, where the page counts
 * them over its last `ACTIVITY_FETCH` events — on a quiet tenant those span weeks,
 * and one old failure kept the rail red for all of them.
 *
 * A week, since 2026-10-16. It was a day, and a job that failed four days earlier
 * — 943 turns and nearly all of a week's spend — left the glance blank while the
 * Activity page led with it. "Go look" has to survive a weekend away; a week still
 * ages a failure out.
 */
export const ACTIVITY_GLANCE_MS = 7 * 24 * 60 * 60 * 1000;
export const ACTIVITY_GLANCE_SPAN = '7d';

/** `45m`, `20h`, `3d`: how far back a read reached, in the glance's own short form. */
function shortSpan(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/**
 * The window the glance can actually vouch for, which ends at `now`.
 *
 * The read is the newest `ACTIVITY_FETCH` events, not a week of them: on a busy
 * tenant sixty events are an hour. A full read whose oldest event is younger than
 * the week covers only back to that event, and the glance says so — `· 3h`, not
 * `· 7d` — rather than offering a week it did not look at. A short read is the
 * whole record, so it covers the week.
 */
export function glanceWindow(
  events: readonly { ts: number }[],
  now: number,
): { since: number; span: string } {
  const week = now - ACTIVITY_GLANCE_MS;
  if (events.length < ACTIVITY_FETCH) return { since: week, span: ACTIVITY_GLANCE_SPAN };
  const oldest = events.reduce((m, e) => Math.min(m, tsToMs(e.ts)), Number.POSITIVE_INFINITY);
  if (!Number.isFinite(oldest) || oldest <= week)
    return { since: week, span: ACTIVITY_GLANCE_SPAN };
  return { since: oldest, span: shortSpan(now - oldest) };
}

function byThreadOf<E extends OutcomeEvent>(events: readonly E[]): Map<unknown, E[]> {
  const byThread = new Map<unknown, E[]>();
  for (const e of events) {
    const k = e.payload?.thread_id ?? null;
    byThread.set(k, [...(byThread.get(k) ?? []), e]);
  }
  return byThread;
}

/**
 * The key the glance's second read — the newest `ACTIVITY_FETCH` events whose
 * status is `error` — is shared under.
 *
 * Sixty events of everything were not a week. Measured on the reference harness
 * on 2026-10-16, a job firing every few minutes put sixty events at 106 hours and
 * even 500 (`/audit`'s ceiling, 262 KB) at 112, so a failure five days old was in
 * neither and the glance said nothing. Failures are rare: the newest sixty of them
 * reached back 576 hours in 16 KB. The everything-read stays, for the turns
 * around a failure and for a control's refusal, which is `denied` not `error`.
 */
export const AUDIT_ERRORS_POLL_KEY = `audit:error:${ACTIVITY_FETCH}`;

/** Two reads of `/audit` as one list, each event once. */
export function mergeReads<E extends { id?: string }>(...reads: (readonly E[] | undefined)[]): E[] {
  const seen = new Set<string>();
  const out: E[] = [];
  for (const read of reads) {
    for (const e of read ?? []) {
      if (e.id !== undefined) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
      }
      out.push(e);
    }
  }
  return out;
}

/**
 * Failures since `since`, by thread suffix (`''` for an event with no thread).
 *
 * Read as the page reads them (`eventOutcome`): an approval's denial is not a
 * failure, and nor is the reply the harness marks `error` after one. Counting both
 * put `Activity · 2 failed` in red beside a thread where someone had declined one
 * write. A reply is read among its thread's events, the nearest the glance has to
 * its turn.
 */
export function failuresByThread(
  events: (OutcomeEvent & { ts: number })[],
  since: number,
): Map<string, number> {
  const byThread = byThreadOf(events);
  const out = new Map<string, number>();
  for (const e of events) {
    if (e.ts == null || tsToMs(e.ts) < since) continue;
    const raw = e.payload?.thread_id ?? null;
    if (!isFailureOutcome(eventOutcome(e, byThread.get(raw)))) continue;
    const id = typeof raw === 'string' && raw ? threadSuffix(raw) : '';
    out.set(id, (out.get(id) ?? 0) + 1);
  }
  return out;
}

/** Failures since `since` (by default the window `events` can vouch for, `glanceWindow`). */
export function recentFailures(
  events: (OutcomeEvent & { ts: number })[],
  now: number,
  since = glanceWindow(events, now).since,
): number {
  let n = 0;
  for (const count of failuresByThread(events, since).values()) n += count;
  return n;
}

/** How a thread's newest turn in the glance's read went. */
export interface ThreadOutcome {
  failed: boolean;
  /** When the turn began (its `user_input`), or its oldest event when that is not in the read. */
  startTs: number;
  endTs: number;
}

/**
 * Each thread's newest turn, by suffix, from the same read the glance counts —
 * so a thread row's *Failed* mark and the Jobs page's outcome cost no request of
 * their own, and cannot disagree with the glance about what failed.
 *
 * Only the **newest** turn counts: a thread that failed and then ran cleanly is
 * not marked, because the mark answers "did its last run go wrong", not "has it
 * ever". A turn starts at the thread's newest `user_input`; with none in the read
 * the turn is whatever of it the read holds. Outside the glance's window a thread
 * has no outcome here, which is *unknown*, never *OK*.
 */
export function threadOutcomes(
  events: (OutcomeEvent & { ts: number })[],
  now: number,
): Map<string, ThreadOutcome> {
  const { since } = glanceWindow(events, now);
  const out = new Map<string, ThreadOutcome>();
  for (const [raw, evs] of byThreadOf(events)) {
    if (typeof raw !== 'string' || !raw) continue;
    const inWindow = evs.filter((e) => e.ts != null && tsToMs(e.ts) >= since);
    if (inWindow.length === 0) continue;
    const opened = inWindow
      .filter((e) => e.event_type === 'user_input')
      .reduce((m, e) => Math.max(m, tsToMs(e.ts)), Number.NEGATIVE_INFINITY);
    const turn = Number.isFinite(opened)
      ? inWindow.filter((e) => tsToMs(e.ts) >= opened)
      : inWindow;
    const times = turn.map((e) => tsToMs(e.ts));
    out.set(threadSuffix(raw), {
      failed: turn.some((e) => isFailureOutcome(eventOutcome(e, turn))),
      startTs: Math.min(...times),
      endTs: Math.max(...times),
    });
  }
  return out;
}

/**
 * How a job's last run went on its thread, when the audit read can say.
 *
 * The scheduler's `last_status` records whether the firing *returned*, so a job
 * whose turn ran 943 times and ended on a broken call still read `last ● OK`. Its
 * thread's newest turn says what the run did. Only for a job that keeps one thread
 * (`job:<name>`, whose suffix is the name): a fresh-thread job's runs each have an
 * id this page cannot name. And only a turn that began with the last run, or
 * after it — an older turn is a previous firing's, and says nothing about this one.
 * `null` is "not known", and the row keeps the scheduler's word.
 */
export function jobThreadOutcome(
  job: { name: string; last_run_at?: number | null; payload?: Record<string, unknown> | null },
  outcomes: ReadonlyMap<string, ThreadOutcome>,
): 'failed' | 'ok' | null {
  if (job.payload?.fresh_thread === true || job.last_run_at == null) return null;
  const o = outcomes.get(threadSuffix(`job:${job.name}`));
  // A minute's slack: the firing is stamped before its turn's first event lands.
  if (!o || o.startTs < job.last_run_at - 60_000) return null;
  return o.failed ? 'failed' : 'ok';
}

/** The threads whose newest turn failed, by suffix. */
export function failedThreads(outcomes: ReadonlyMap<string, ThreadOutcome>): Set<string> {
  return new Set([...outcomes].filter(([, o]) => o.failed).map(([id]) => id));
}

/**
 * The rail's Skills glance: drafts waiting for review, read on their own slow
 * poll. The Skills page reads the same queue through its Query cache, which
 * lives in the lazy library chunk — sharing a key would pull that chunk into
 * the entry, which is the mistake this module exists to prevent.
 */
export const SKILL_QUEUE_POLL_KEY = 'skill-review-queue';

/** How many drafts the glance reads; a fuller queue says `100+`. */
export const SKILL_QUEUE_GLANCE_LIMIT = 100;

/** The key Activity and the rail's glance share their audit read under. */
export const AUDIT_POLL_KEY = `audit:${ACTIVITY_FETCH}`;
