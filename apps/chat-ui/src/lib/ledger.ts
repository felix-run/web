import { threadSuffix } from '@felix/client';
import { isFailure, tsToMs } from '@/components/inspector/primitives';
import type { AuditEvent, UsageThreadItem } from '@/types';

/**
 * The Activity page as a ledger: one entry per thread, in the operator's unit.
 *
 * The page used to be two halves split by route — `/audit` on one tab, `/usage` on
 * the other — which is how the harness stores the record, not how anyone asks about
 * it. The question is per run: what happened on that thread, did anything fail,
 * and what did it cost. Events and spend are folded here into one row per thread,
 * and a thread's events into its turns, so the page answers that without the
 * reader joining two lists by eye.
 *
 * Pure, so the grouping can be tested without a DOM, and so the rules about what
 * counts as a turn or a failure live in one place.
 */

/** The key the bucket of events and spend with no thread is filed under. */
export const NO_THREAD = '';

/** The windows the page offers. `last` is "since this tab last left the page". */
export const LEDGER_WINDOWS = ['last', '24h', '7d', '30d'] as const;
export type LedgerWindow = (typeof LEDGER_WINDOWS)[number];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const SPAN_MS: Record<Exclude<LedgerWindow, 'last'>, number> = {
  '24h': DAY,
  '7d': 7 * DAY,
  '30d': 30 * DAY,
};

/** Past this, "since your last visit" is a month of history and stops meaning anything. */
const LAST_VISIT_MAX_MS = 30 * DAY;

export function parseWindow(raw: string | null): LedgerWindow {
  return (LEDGER_WINDOWS as readonly string[]).includes(raw ?? '') ? (raw as LedgerWindow) : 'last';
}

/**
 * Where the window starts, and what to call it.
 *
 * `last` falls back to a day when there is no visit to measure from, or when the
 * last one is too old to be a useful floor. `fellBack` lets the page say so, rather
 * than labelling a day as "since your last visit".
 */
export function resolveWindow(
  w: LedgerWindow,
  now: number,
  lastVisit: number | null,
): { since: number; fellBack: boolean } {
  if (w === 'last') {
    if (lastVisit != null && lastVisit < now && now - lastVisit <= LAST_VISIT_MAX_MS) {
      return { since: lastVisit, fellBack: false };
    }
    return { since: now - DAY, fellBack: true };
  }
  return { since: now - SPAN_MS[w], fellBack: false };
}

/**
 * When this tab last left the Activity page.
 *
 * `localStorage`, so it is per browser rather than per account: it records what
 * *this* reader has seen, which a harness-side "read" mark could not — two
 * operators on one tenant have not seen the same things. A convenience, so every
 * access is guarded and a blocked store just means the day-long fallback.
 */
const LAST_VISIT_KEY = 'felix.activity.lastVisit';

export function readLastVisit(): number | null {
  try {
    const raw = localStorage.getItem(LAST_VISIT_KEY);
    const n = raw == null ? Number.NaN : Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function writeLastVisit(at: number): void {
  try {
    localStorage.setItem(LAST_VISIT_KEY, String(at));
  } catch {
    // A private window or blocked storage: the next visit opens on a day instead.
  }
}

/** `error` outranks `denied` outranks `ok`: a broken call beats a refused one. */
export type Worst = 'ok' | 'denied' | 'error';

function worstOf(events: AuditEvent[]): Worst {
  let worst: Worst = 'ok';
  for (const e of events) {
    if (e.status === 'error' || e.status === 'failed') return 'error';
    if (e.status === 'denied') worst = 'denied';
  }
  return worst;
}

/** A turn: a `user_input`, what the agent did about it, and its `final_response`. */
export interface LedgerTurn {
  /** The first event's id, which is stable for as long as the turn is in the window. */
  id: string;
  /** Oldest first, the order they happened in. */
  events: AuditEvent[];
  /** What the operator sent, when the turn's `user_input` is in the window. */
  prompt: string | null;
  /** The turn began before the window did, so its opening is not here. */
  partial: boolean;
  /** No `final_response` yet: still running, or it ended without writing one. */
  open: boolean;
  worst: Worst;
  failures: AuditEvent[];
  /** Calls that reached a tool, refused ones included. */
  tools: number;
  startTs: number;
  endTs: number;
}

export interface LedgerThread {
  /** The suffix every client holds, or `NO_THREAD`. */
  id: string;
  /** Newest first. Empty for a thread that spent in the window with no audited event. */
  turns: LedgerTurn[];
  /** Events with no thread are not cut into turns: there is no conversation to cut. */
  loose: AuditEvent[];
  worst: Worst;
  /** Newest first. */
  failures: AuditEvent[];
  tools: number;
  /** The newest thing in the window, from either record. */
  lastTs: number;
  /** `null` when the harness reported no spend for it, or cannot report per thread. */
  spend: UsageThreadItem | null;
}

/** The thread an event belongs to, as a suffix, or `NO_THREAD`. */
export function threadOfEvent(e: AuditEvent): string {
  const raw = e.payload?.thread_id;
  return typeof raw === 'string' && raw ? threadSuffix(raw) : NO_THREAD;
}

function isTool(e: AuditEvent): boolean {
  return e.event_type === 'tool_call' || e.event_type === 'policy_deny';
}

/**
 * One thread's events, cut into turns at each `user_input`.
 *
 * Events before the first `user_input` belong to a turn that started before the
 * window did — kept, and marked `partial`, rather than dropped: a failure in the
 * tail of last night's run is exactly what someone opening this in the morning
 * came for.
 */
export function cutTurns(events: AuditEvent[]): LedgerTurn[] {
  const asc = [...events].sort((a, b) => tsToMs(a.ts) - tsToMs(b.ts) || a.id.localeCompare(b.id));
  const groups: AuditEvent[][] = [];
  for (const e of asc) {
    if (e.event_type === 'user_input' || groups.length === 0) groups.push([e]);
    else groups[groups.length - 1].push(e);
  }
  return groups
    .map((g): LedgerTurn => {
      const first = g[0];
      const prompt =
        first.event_type === 'user_input' && typeof first.payload?.user_input === 'string'
          ? first.payload.user_input
          : null;
      return {
        id: first.id,
        events: g,
        prompt,
        partial: first.event_type !== 'user_input',
        open: !g.some((e) => e.event_type === 'final_response'),
        worst: worstOf(g),
        failures: g.filter((e) => isFailure(e.status)).reverse(),
        tools: g.filter(isTool).length,
        startTs: tsToMs(first.ts),
        endTs: tsToMs(g[g.length - 1].ts),
      };
    })
    .reverse();
}

/**
 * The window's events and spend, one entry per thread, newest activity first.
 *
 * Spend is matched by suffix: the usage store records the harness's own spelling,
 * and every client holds the suffix. A thread that spent in the window with no
 * audited event in it still gets an entry — its cost is real even if the turn that
 * incurred it started before the window. The no-thread bucket always sorts last:
 * it is not a conversation, and putting it among them would rank screening events
 * as if they were one.
 */
export function buildLedger(events: AuditEvent[], spend: UsageThreadItem[] | null): LedgerThread[] {
  const byThread = new Map<string, AuditEvent[]>();
  for (const e of events) {
    const id = threadOfEvent(e);
    const list = byThread.get(id);
    if (list) list.push(e);
    else byThread.set(id, [e]);
  }
  const spendBy = new Map<string, UsageThreadItem>();
  for (const s of spend ?? []) {
    const id = s.thread_id ? threadSuffix(s.thread_id) : NO_THREAD;
    const prior = spendBy.get(id);
    // Two spellings of one thread (a full id and a bare suffix) fold together.
    spendBy.set(id, prior ? mergeSpend(prior, s) : s);
  }
  const ids = new Set([...byThread.keys(), ...spendBy.keys()]);
  const threads = [...ids].map((id): LedgerThread => {
    const evs = byThread.get(id) ?? [];
    const own = spendBy.get(id) ?? null;
    const turns = id === NO_THREAD ? [] : cutTurns(evs);
    const loose = id === NO_THREAD ? [...evs].sort((a, b) => tsToMs(b.ts) - tsToMs(a.ts)) : [];
    const lastEvent = evs.reduce((m, e) => Math.max(m, tsToMs(e.ts)), 0);
    return {
      id,
      turns,
      loose,
      worst: worstOf(evs),
      failures: evs.filter((e) => isFailure(e.status)).sort((a, b) => tsToMs(b.ts) - tsToMs(a.ts)),
      tools: evs.filter(isTool).length,
      lastTs: Math.max(lastEvent, own ? tsToMs(own.last_ts) : 0),
      spend: own,
    };
  });
  return threads.sort(
    (a, b) =>
      Number(a.id === NO_THREAD) - Number(b.id === NO_THREAD) ||
      b.lastTs - a.lastTs ||
      a.id.localeCompare(b.id),
  );
}

function mergeSpend(a: UsageThreadItem, b: UsageThreadItem): UsageThreadItem {
  return {
    thread_id: a.thread_id,
    calls: a.calls + b.calls,
    tokens_input: a.tokens_input + b.tokens_input,
    tokens_output: a.tokens_output + b.tokens_output,
    cache_creation: a.cache_creation + b.cache_creation,
    cache_read: a.cache_read + b.cache_read,
    cost_usd: a.cost_usd + b.cost_usd,
    first_ts: Math.min(a.first_ts, b.first_ts),
    last_ts: Math.max(a.last_ts, b.last_ts),
  };
}

/**
 * A money amount in a column. Fixed at cents so a column of them lines up by
 * magnitude: `$60.77`, `$0.0781` and `$0.00252` right-aligned put the decimal
 * point in three places, and the eye compares lengths. Under a cent says so
 * rather than rounding a real cost to `$0.00`.
 */
export function money(n: number): string {
  if (n === 0) return '$0.00';
  if (n < 0.01) return '< $0.01';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * The ledger's filters, which choose **threads**, not events.
 *
 * Filtering events — what the feed did — cut a failure out of its turn: the red
 * row arrived with nothing around it to say what the agent was doing. Here a
 * thread either qualifies or does not, and an opened one shows all of its turns.
 * `layer` keeps threads holding a denial stamped with that governance layer
 * (`payload.control`); a harness older than the stamp writes none, which the
 * page's empty state says.
 */
export function filterLedger(
  threads: LedgerThread[],
  opts: { failuresOnly: boolean; layer: string },
): LedgerThread[] {
  return threads.filter((t) => {
    if (opts.failuresOnly && t.failures.length === 0) return false;
    if (opts.layer === 'any') return true;
    return t.failures.some(
      (e) => e.event_type === 'policy_deny' && e.payload?.control === opts.layer,
    );
  });
}

/** A turn's rows as drawn: an event on its own, or a run of routine calls folded. */
export type TurnSegment =
  | { kind: 'event'; event: AuditEvent }
  | { kind: 'fold'; id: string; events: AuditEvent[] };

/** Below this, a run of successful calls is drawn as rows; folding two hides nothing. */
const FOLD_MIN = 3;

/**
 * Fold each run of routine events — successful calls and the like — into one line.
 *
 * A long turn is mostly routine — sixty-seven calls, two of them the reason
 * anyone opened it — and drawn row by row the two were a scroll below the fold,
 * under a column of `OK`. The page's own rule is rank before you render: a
 * failure, a denial and a turn boundary always stand alone, and what went fine is
 * counted until someone asks to see it.
 */
export function foldRoutine(events: AuditEvent[]): TurnSegment[] {
  const out: TurnSegment[] = [];
  let run: AuditEvent[] = [];
  const flush = () => {
    if (run.length >= FOLD_MIN) out.push({ kind: 'fold', id: run[0].id, events: run });
    else for (const e of run) out.push({ kind: 'event', event: e });
    run = [];
  };
  for (const e of events) {
    // Anything that went fine and is not a turn boundary is routine: a call, and
    // the `skill_activation` rows the harness writes between them, which broke
    // every run into fragments when only calls folded.
    const boundary = e.event_type === 'user_input' || e.event_type === 'final_response';
    if (!boundary && !isFailure(e.status)) run.push(e);
    else {
      flush();
      out.push({ kind: 'event', event: e });
    }
  }
  flush();
  return out;
}

/** `run ×20 · edit_file ×5`, most-called first. */
export function toolTally(events: AuditEvent[], shown = 4): string {
  const counts = new Map<string, number>();
  for (const e of events) {
    const t = typeof e.payload?.tool === 'string' && e.payload.tool ? e.payload.tool : e.event_type;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const head = ranked
    .slice(0, shown)
    .map(([t, n]) => (n > 1 ? `${t} ×${n}` : t))
    .join(' · ');
  return ranked.length > shown ? `${head} · ${ranked.length - shown} more` : head;
}
