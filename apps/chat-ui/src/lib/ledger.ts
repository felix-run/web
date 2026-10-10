import { threadSuffix } from '@felix/client';
import { tsToMs } from '@/components/inspector/primitives';
import { type EventOutcome, eventOutcome, isFailureOutcome } from '@/lib/audit-outcome';
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

/**
 * The visit this tab measures from, held for the life of the tab.
 *
 * Every leave stamps `LAST_VISIT_KEY`, so reading it on each mount meant a reload —
 * or a second tab, or a remount — turned "since your last visit" into "since a
 * minute ago" and the page opened on nothing. The first value a tab reads is
 * copied into `sessionStorage` and that is what the tab keeps measuring from;
 * only a new tab reads the stamp afresh.
 */
const SESSION_SINCE_KEY = 'felix.activity.sessionSince';

const toVisit = (raw: string | null): number | null => {
  const n = raw == null ? Number.NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function readLastVisit(): number | null {
  try {
    const held = sessionStorage.getItem(SESSION_SINCE_KEY);
    if (held !== null) return toVisit(held);
    const stamped = localStorage.getItem(LAST_VISIT_KEY);
    // Held even when empty (`''`), so a first visit stays a first visit on reload.
    sessionStorage.setItem(SESSION_SINCE_KEY, stamped ?? '');
    return toVisit(stamped);
  } catch {
    return null;
  }
}

/** How long the page must have been on screen before leaving it counts as a visit. */
export const VISIT_MIN_MS = 5_000;

export function writeLastVisit(at: number): void {
  try {
    localStorage.setItem(LAST_VISIT_KEY, String(at));
  } catch {
    // A private window or blocked storage: the next visit opens on a day instead.
  }
}

/**
 * `error` outranks `refused` outranks `denied` outranks `ok`: a broken call beats
 * one a control stopped, and both beat one an approval gate declined, which is
 * not something going wrong at all.
 */
export type Worst = 'ok' | 'denied' | 'refused' | 'error';

const RANK: Record<Worst, number> = { ok: 0, denied: 1, refused: 2, error: 3 };

function worstOf(outcomes: Iterable<EventOutcome>): Worst {
  let worst: Worst = 'ok';
  for (const o of outcomes) {
    // A reply after a denial is the denial's consequence, not an outcome of its own.
    const w: Worst = o === 'after-denial' ? 'ok' : o;
    if (RANK[w] > RANK[worst]) worst = w;
  }
  return worst;
}

/**
 * Each event's outcome, read in its turn (`eventOutcome`). Keyed by id so a view
 * can colour a row without re-cutting the thread.
 */
export type Outcomes = ReadonlyMap<string, EventOutcome>;

function outcomesOf(groups: AuditEvent[][]): Map<string, EventOutcome> {
  const out = new Map<string, EventOutcome>();
  for (const g of groups) for (const e of g) out.set(e.id, eventOutcome(e, g));
  return out;
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
  /** Broken calls and control refusals. Never a denial, never a reply after one. */
  failures: AuditEvent[];
  /** Calls an approval gate declined. */
  denials: AuditEvent[];
  /** Every event's outcome, read in this turn. */
  outcomes: Outcomes;
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
  /** Newest first. Broken calls and control refusals; see `LedgerTurn.failures`. */
  failures: AuditEvent[];
  /** Newest first. Calls an approval gate declined. */
  denials: AuditEvent[];
  /** Every event's outcome, read in its turn. */
  outcomes: Outcomes;
  tools: number;
  /** The newest thing in the window, from either record. */
  lastTs: number;
  /** The oldest, likewise — what decides whether its spend can have been metered. */
  firstTs: number;
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
  const outcomes = outcomesOf(groups);
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
        worst: worstOf(g.map((e) => outcomes.get(e.id) ?? 'ok')),
        failures: g.filter((e) => isFailureOutcome(outcomes.get(e.id) ?? 'ok')).reverse(),
        denials: g.filter((e) => outcomes.get(e.id) === 'denied').reverse(),
        outcomes,
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
    // Read in its turn where there are turns; the no-thread bucket has no turn to
    // read an event in, so each stands alone.
    const outcomes: Map<string, EventOutcome> = new Map(
      turns.length > 0
        ? turns.flatMap((t) => t.events.map((e) => [e.id, t.outcomes.get(e.id) ?? 'ok'] as const))
        : evs.map((e) => [e.id, eventOutcome(e)] as const),
    );
    const newestFirst = (a: AuditEvent, b: AuditEvent) => tsToMs(b.ts) - tsToMs(a.ts);
    const lastEvent = evs.reduce((m, e) => Math.max(m, tsToMs(e.ts)), 0);
    const firstEvent = evs.reduce((m, e) => Math.min(m, tsToMs(e.ts)), Number.POSITIVE_INFINITY);
    return {
      id,
      turns,
      loose,
      worst: worstOf(outcomes.values()),
      failures: evs.filter((e) => isFailureOutcome(outcomes.get(e.id) ?? 'ok')).sort(newestFirst),
      denials: evs.filter((e) => outcomes.get(e.id) === 'denied').sort(newestFirst),
      outcomes,
      tools: evs.filter(isTool).length,
      lastTs: Math.max(lastEvent, own ? tsToMs(own.last_ts) : 0),
      firstTs: Math.min(firstEvent, own ? tsToMs(own.first_ts) : Number.POSITIVE_INFINITY),
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
 * Where per-thread metering begins inside this window, if it does.
 *
 * Spend is stamped with its thread from harness 0.12.1 on (`felix-run/felix#542`);
 * every call before that sits in the `""` bucket. So a window reaching back past
 * the upgrade holds threads whose model calls really happened and can never show
 * a cost. That is read from the data, not a version — the page cannot see when the
 * harness was upgraded, but it can see that unattributed spend came *before* the
 * first attributed call:
 *
 * - `null` — no such boundary: everything here was metered (or nothing spent).
 *   Unattributed calls *after* metering began are real no-thread calls (memory
 *   consolidation, skill model calls) and are not a boundary.
 * - `Infinity` — unattributed spend and no attributed spend at all: the whole
 *   window predates metering.
 * - a time — the first attributed call, with unattributed spend before it.
 */
export function meteringStart(spend: UsageThreadItem[] | null): number | null {
  let threaded: number | null = null;
  let unthreaded: number | null = null;
  for (const s of spend ?? []) {
    if (s.calls === 0) continue;
    const ts = tsToMs(s.first_ts);
    if (s.thread_id) threaded = threaded === null ? ts : Math.min(threaded, ts);
    else unthreaded = unthreaded === null ? ts : Math.min(unthreaded, ts);
  }
  if (unthreaded === null) return null;
  if (threaded === null) return Number.POSITIVE_INFINITY;
  return unthreaded < threaded ? threaded : null;
}

/**
 * How far before the first attributed call a thread's activity can begin and
 * still count as metered: a turn's `user_input` lands seconds before its first
 * model call, and the thread that made the first attributed call is otherwise
 * read as having straddled the upgrade.
 */
const METERING_SLACK_MS = 5 * 60_000;

/**
 * What a thread's cost cell may honestly say.
 *
 * - `cost` — metered for the whole of its activity in the window.
 * - `floor` — it spent before metering began too, so the figure is a lower bound.
 * - `unrecorded` — all of its spend predates metering; its calls are in the
 *   no-thread bucket, not free.
 * - `none` — metered throughout and nothing was charged to it.
 */
export type SpendState = 'cost' | 'floor' | 'unrecorded' | 'none';

export function spendState(t: LedgerThread, cutover: number | null): SpendState {
  if (t.id === NO_THREAD) return t.spend ? 'cost' : 'none';
  const before = cutover !== null && t.firstTs < cutover - METERING_SLACK_MS;
  if (t.spend) return before ? 'floor' : 'cost';
  return cutover === Number.POSITIVE_INFINITY || before ? 'unrecorded' : 'none';
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
 * page's empty state says. An approval's denials are not failures, so
 * `failuresOnly` does not find them; `layer: 'approvals'` does.
 */
export function filterLedger(
  threads: LedgerThread[],
  opts: { failuresOnly: boolean; layer: string },
): LedgerThread[] {
  return threads.filter((t) => {
    if (opts.failuresOnly && t.failures.length === 0) return false;
    if (opts.layer === 'any') return true;
    return [...t.failures, ...t.denials].some(
      (e) => e.event_type === 'policy_deny' && e.payload?.control === opts.layer,
    );
  });
}

/**
 * What makes two failures the same failure: the kind of row, the tool, and why —
 * the layer that refused it or the error class. Seven `local_write blocked by an
 * approval` rows are one fact repeated, and drawn seven times they hid the
 * different failure behind "6 more".
 */
export function failureKey(e: AuditEvent): string {
  const tool = typeof e.payload?.tool === 'string' ? e.payload.tool : '';
  const why = e.payload?.control ?? e.payload?.error_code ?? '';
  return `${e.event_type}\u0000${tool}\u0000${String(why)}`;
}

/** Failures grouped by `failureKey`, each with its count, in first-seen order. */
export function groupFailures(events: AuditEvent[]): { event: AuditEvent; count: number }[] {
  const groups = new Map<string, { event: AuditEvent; count: number }>();
  for (const e of events) {
    const k = failureKey(e);
    const g = groups.get(k);
    if (g) g.count += 1;
    else groups.set(k, { event: e, count: 1 });
  }
  return [...groups.values()];
}

/**
 * A turn's rows as drawn: an event on its own, a run of routine events folded, or
 * a run of the same failure or denial folded to one counted line, which stays
 * red for a failure and muted for a denial.
 */
export type TurnSegment =
  | { kind: 'event'; event: AuditEvent }
  | { kind: 'fold'; id: string; events: AuditEvent[] }
  | { kind: 'repeat'; id: string; events: AuditEvent[] };

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
export function foldRoutine(
  events: AuditEvent[],
  outcomes: Outcomes = new Map(events.map((e) => [e.id, eventOutcome(e, events)])),
): TurnSegment[] {
  // Anything not `ok` stands alone: a failure, a denial, and a reply after one.
  const notable = (e: AuditEvent) => (outcomes.get(e.id) ?? 'ok') !== 'ok';
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
    if (!boundary && !notable(e)) {
      run.push(e);
      continue;
    }
    flush();
    // The same failure again, straight after itself, joins it: one line that says
    // how many, rather than a column of identical rows. Never hidden — a repeat
    // is still a failure (or a denial), it is only counted.
    const prev = out[out.length - 1];
    const prevEvent =
      prev?.kind === 'event' ? prev.event : prev?.kind === 'repeat' ? prev.events[0] : null;
    if (!boundary && prevEvent && notable(prevEvent) && failureKey(prevEvent) === failureKey(e)) {
      if (prev.kind === 'repeat') prev.events.push(e);
      else out[out.length - 1] = { kind: 'repeat', id: prevEvent.id, events: [prevEvent, e] };
      continue;
    }
    out.push({ kind: 'event', event: e });
  }
  flush();
  return out;
}

/** `run ×20 · edit_file ×5`, most-called first. */
export function toolTally(events: AuditEvent[], shown = 4): string {
  // Tools only: an event type in the same list read as a tool of that name
  // (`activate_skill ×4 · skill_activation ×4`). The rest are counted as such.
  const counts = new Map<string, number>();
  let other = 0;
  for (const e of events) {
    const t = typeof e.payload?.tool === 'string' && e.payload.tool ? e.payload.tool : null;
    if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
    else other += 1;
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const head = ranked
    .slice(0, shown)
    .map(([t, n]) => (n > 1 ? `${t} ×${n}` : t))
    .join(' · ');
  const parts = [
    head,
    ranked.length > shown ? `${ranked.length - shown} more tools` : '',
    other > 0 ? `${other} other ${other === 1 ? 'event' : 'events'}` : '',
  ].filter(Boolean);
  return parts.join(' · ');
}
