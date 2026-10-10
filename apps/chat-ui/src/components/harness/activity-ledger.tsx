import { Button } from '@felix/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@felix/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@felix/ui/select';
import { ActivityIcon, ChevronRightIcon } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { getUsageSummary, listAuditWindow, listUsage, listUsageByThread } from '@/api';
import {
  ActivityRow,
  byModel,
  CONTROL_LABEL,
  CONTROL_LAYERS,
  clockTime,
  controlOf,
  ERROR_CODE_LABEL,
  errorCodeOf,
  OutcomeMark,
  subjectOf,
  summarizeWindow,
  TEXT_BUTTON,
  THREAD_CHARS,
  tokenLine,
} from '@/components/harness/activity';
import { keepAgent } from '@/components/harness/harness-agent';
import { PageEmpty, PageHeader, PanelBody, plural } from '@/components/harness/panel';
import { relTime, SectionBody, tsToMs } from '@/components/inspector/primitives';
import { usePoll } from '@/hooks/usePoll';
import { middleTruncate } from '@/lib/format';
import {
  buildLedger,
  filterLedger,
  foldRoutine,
  groupFailures,
  type LedgerThread,
  type LedgerTurn,
  type LedgerWindow,
  meteringStart,
  money,
  NO_THREAD,
  type Outcomes,
  parseWindow,
  readLastVisit,
  resolveWindow,
  type SpendState,
  spendState,
  toolTally,
  VISIT_MIN_MS,
  type Worst,
  writeLastVisit,
} from '@/lib/ledger';
import { threadLabel } from '@/lib/threads';
import { cn } from '@/lib/utils';
import { useShell } from '@/shell-context';
import type { AuditEvent, UsageEvent, UsageSummary } from '@/types';

/**
 * Activity, as a ledger: one entry per thread, saying what happened on it, what
 * failed and what it cost, over a window the reader names.
 *
 * It was two tabs split by route — Events (`/audit`) and Usage (`/usage`) — which
 * is how the harness files the record and not how anyone asks about it. An
 * operator coming back asks about a run, and answering that meant finding the
 * failure on one tab and then failing to find its cost on the other, because no
 * usage row said which thread it was. The harness records that now
 * (`felix-run/felix#542`), so both records fold into the thread they describe.
 *
 * The window opens on **since this browser last left the page**, which is the
 * question "what happened while I was away" asked literally; a fixed count of the
 * last 60 events was minutes on a busy tenant and weeks on a quiet one.
 */

/** Threads drawn before the list says how many more there are. */
const THREADS_VISIBLE = 30;
/** Turns an opened thread draws before offering the rest. */
const TURNS_VISIBLE = 5;
/** Events the no-thread bucket draws before offering the rest. */
const LOOSE_VISIBLE = 12;
/** Audit events read for one window before the page says it stopped. */
const MAX_EVENTS = 2000;
/** Threads the spend read returns; the totals still cover all of them. */
const SPEND_THREADS = 200;
/** Recent usage rows read only to find routes priced as another model. */
const PRICING_SAMPLE = 20;

const WINDOW_LABEL: Record<LedgerWindow, string> = {
  last: 'Since last visit',
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
};

export function ActivityLedger({ docs }: { docs?: string }) {
  const [params, setParams] = useSearchParams();
  const win = parseWindow(params.get('since'));
  const setWin = (next: LedgerWindow) =>
    setParams(keepAgent(params, next === 'last' ? {} : { since: next }), { replace: true });

  // Read once, and held for the life of the tab (`readLastVisit`): the visit this
  // page measures from is the *previous* one. Leaving stamps the next — on unmount
  // and on `pagehide`, since a closed tab never unmounts — but only once the page
  // has been on screen for `VISIT_MIN_MS`. A reload, a remount or a glance through
  // a tab is not a visit, and counting each as one made the window "since a minute
  // ago" every time the reader came back.
  const [lastVisit] = useState(readLastVisit);
  useEffect(() => {
    let shownFor = 0;
    let since = document.visibilityState === 'visible' ? Date.now() : null;
    const onVisibility = () => {
      if (document.visibilityState === 'visible') since = Date.now();
      else if (since !== null) {
        shownFor += Date.now() - since;
        since = null;
      }
    };
    const stamp = () => {
      const total = shownFor + (since !== null ? Date.now() - since : 0);
      if (total >= VISIT_MIN_MS) writeLastVisit(Date.now());
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', stamp);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', stamp);
      stamp();
    };
  }, []);

  const [openThread, setOpenThread] = useState<string | null>(null);
  const [failuresOnly, setFailuresOnly] = useState(params.get('failed') === '1');
  const [layer, setLayer] = useState<string>(params.get('layer') ?? 'any');
  const [showAll, setShowAll] = useState(false);

  // The filters are in the address too, so "what failed this week" is a link.
  const setFilters = (next: { failuresOnly?: boolean; layer?: string }) => {
    const f = next.failuresOnly ?? failuresOnly;
    const l = next.layer ?? layer;
    setFailuresOnly(f);
    setLayer(l);
    setOpenThread(null);
    const extra: Record<string, string> = {};
    if (win !== 'last') extra.since = win;
    if (f) extra.failed = '1';
    if (l !== 'any') extra.layer = l;
    setParams(keepAgent(params, extra), { replace: true });
  };

  // Polling stops while a thread is open: a new event re-sorts the list and moves
  // the row being read out from under the reader, and what they opened has already
  // happened. `usePoll` refetches on the false→true edge, so closing it catches up.
  const { data, error, loading, lastOkAt, refresh } = usePoll(
    async () => {
      const now = Date.now();
      const { since, fellBack } = resolveWindow(win, now, lastVisit);
      const [audit, spend, summary, recent] = await Promise.all([
        listAuditWindow({ since, maxEvents: MAX_EVENTS }),
        listUsageByThread({ since_ms: since, limit: SPEND_THREADS }),
        getUsageSummary({ since_ms: since }),
        listUsage({ limit: PRICING_SAMPLE }),
      ]);
      return { since, fellBack, audit, spend, summary, recent: recent.items };
    },
    { enabled: openThread === null, intervalMs: 10_000 },
  );
  // A changed window is a different question; ask it now rather than at the next
  // tick. Not on mount, where `usePoll` is already asking.
  const askedFor = useRef(win);
  useEffect(() => {
    if (askedFor.current === win) return;
    askedFor.current = win;
    setOpenThread(null);
    setShowAll(false);
    refresh();
  }, [win, refresh]);

  const { threads: threadMeta } = useShell();
  const titleOf = (id: string) => {
    const meta = threadMeta.find((t) => t.id === id);
    return meta ? threadLabel(meta) : { text: id, isId: true };
  };

  const ledger = data ? buildLedger(data.audit.events, data.spend?.items ?? null) : [];
  const shown = filterLedger(ledger, { failuresOnly, layer });
  const rows = showAll ? shown : shown.slice(0, THREADS_VISIBLE);
  const conversations = ledger.filter((t) => t.id !== NO_THREAD);
  const failing = conversations.filter((t) => t.failures.length > 0).length;
  // Counted apart from failures, and never in red: an approval saying no is the
  // gate working, and a thread whose only "failure" was one read *Failed*.
  const denying = conversations.filter((t) => t.denials.length > 0).length;
  // A summary with no `totals` is not one: say nothing about cost rather than
  // take the page down with it.
  const totals = data?.summary?.totals ? summarizeWindow(data.summary) : null;
  const cost = totals ? `${totals.unpriced > 0 ? '≥ ' : ''}${money(totals.cost)}` : null;
  const account = [cost, plural(conversations.length, 'thread')].filter(Boolean).join(' · ');
  const metered = data?.spend ? meteringStart(data.spend.items) : null;
  // The cost column is drawn only when a thread on screen has a figure for it. On
  // the day per-thread metering began, 51 of 52 rows read `—`: a column that is
  // nearly always empty is texture, and the reason is said once below instead.
  const costColumn =
    data?.spend != null && rows.some((t) => t.id !== NO_THREAD && t.spend !== null);
  const emptyLast = data !== undefined && ledger.length === 0 && win === 'last' && !data.fellBack;

  return (
    <>
      <PageHeader
        icon={<ActivityIcon />}
        title="Activity"
        docs={docs}
        valueLead={data && failing > 0 ? `${account} ·` : undefined}
        value={data ? (failing > 0 ? `${failing} with failures` : account) : undefined}
        valueTone={failing > 0 ? 'failed' : 'default'}
        controls={
          <Select value={win} onValueChange={(v) => setWin(v as LedgerWindow)}>
            <SelectTrigger size="sm" className="h-8 w-auto gap-1 px-2 text-xs" aria-label="Window">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(WINDOW_LABEL) as LedgerWindow[]).map((w) => (
                <SelectItem key={w} value={w} className="text-xs">
                  {WINDOW_LABEL[w]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <PanelBody>
        <SectionBody
          onRetry={refresh}
          lastOkAt={lastOkAt}
          doing="load activity"
          loading={loading && !data}
          error={error}
          empty={ledger.length === 0 && !emptyLast}
          emptyText="Nothing ran in this window. Turns, tool calls and their spend show up here, one entry per thread."
          status={
            data
              ? `${plural(conversations.length, 'thread')}, ${failing} with failures${
                  denying > 0 ? `, ${denying} with a call denied` : ''
                }${cost ? `, ${cost} spent` : ''}.`
              : undefined
          }
        >
          {data && emptyLast && (
            // Not a dead end: "nothing since a minute ago" is true and useless to
            // someone who came here from a count of failures, so it hands over
            // the window that count was taken in.
            <PageEmpty>
              <span className="max-w-[70ch]">
                Nothing ran since your last visit, {relTime(data.since)} ago.{' '}
                <button
                  type="button"
                  className={cn(TEXT_BUTTON, 'text-foreground')}
                  onClick={() => setWin('24h')}
                >
                  Show the last 24 hours
                </button>
              </span>
            </PageEmpty>
          )}
          {data && !emptyLast && (
            <>
              <Account
                win={win}
                since={data.since}
                fellBack={data.fellBack}
                denying={denying}
                paused={openThread !== null}
              />
              <Filters failuresOnly={failuresOnly} layer={layer} onChange={setFilters} />
              {shown.length === 0 ? (
                <p className="max-w-[70ch] py-2 text-sm text-muted-foreground">
                  {layer === 'approvals'
                    ? 'No thread in this window had a call denied at an approval.'
                    : layer !== 'any'
                      ? // "recorded": a harness older than the `control` stamp writes
                        // denials this filter can never find.
                        `No thread in this window has a call recorded as blocked by ${CONTROL_LABEL[layer] ?? layer}.`
                      : 'No thread in this window had a failure.'}
                </p>
              ) : (
                <LedgerList
                  threads={rows}
                  titleOf={titleOf}
                  openId={openThread}
                  onToggle={(id) => setOpenThread((prev) => (prev === id ? null : id))}
                  spendKnown={data.spend !== null}
                  metered={metered}
                  costColumn={costColumn}
                />
              )}
              {shown.length > rows.length && (
                <button
                  type="button"
                  className={cn(TEXT_BUTTON, 'mt-2 text-sm')}
                  onClick={() => setShowAll(true)}
                >
                  Show all {shown.length} threads
                </button>
              )}
              <Caveats
                eventsTruncated={data.audit.truncated}
                spendTruncated={data.spend?.truncated ?? false}
                spendKnown={data.spend !== null}
                metered={metered}
              />
              {data.summary?.totals && (totals?.calls ?? 0) > 0 && (
                <SpendByModel summary={data.summary} recent={data.recent} />
              )}
            </>
          )}
        </SectionBody>
      </PanelBody>
    </>
  );
}

/**
 * The window, and what the header cannot say about it.
 *
 * This was a 24px sentence (`4 threads ran, 3 with failures. $2.57 spent.`)
 * directly under a header reading `$2.57 · 4 threads · 3 with failures`: the
 * same three facts twice, eighty pixels apart. The header value is the page
 * grammar every `/harness` page shares, so it stays and the sentence went. What
 * is left is what the header does not hold: which window this is, and how many
 * threads had a call denied, which is not a failure and so has no place in a
 * header value drawn in the failure colour.
 */
function Account({
  win,
  since,
  fellBack,
  denying,
  paused,
}: {
  win: LedgerWindow;
  since: number;
  fellBack: boolean;
  denying: number;
  paused: boolean;
}) {
  const when =
    win === 'last' && !fellBack
      ? `Since your last visit, ${relTime(since)} ago (${new Date(since).toLocaleString(undefined, {
          weekday: 'short',
          hour: 'numeric',
          minute: '2-digit',
        })})`
      : win === 'last'
        ? 'Last 24 hours — no earlier visit from this browser to measure from'
        : WINDOW_LABEL[win];
  return (
    <div className="mb-3 max-w-[70ch]">
      <p className="text-sm text-muted-foreground">
        {when}.
        {denying > 0 && (
          <>
            {' '}
            {denying === 1
              ? '1 thread had a call denied at an approval.'
              : `${denying} threads had a call denied at an approval.`}
          </>
        )}
      </p>
      {/* Next to the window rather than under the list: the list is what stopped
          updating, and the reader is looking at the top of it. The line's height is
          held when empty — appearing, it pushed every row 16px down and out from
          under the pointer — and it is a polite live region, so a screen reader
          hears that the list has stopped. */}
      <p aria-live="polite" className="mt-0.5 min-h-4 text-xs text-muted-foreground">
        {paused ? 'Paused while a thread is open; closing it catches up.' : ''}
      </p>
    </div>
  );
}

function Filters({
  failuresOnly,
  layer,
  onChange,
}: {
  failuresOnly: boolean;
  layer: string;
  onChange: (next: { failuresOnly?: boolean; layer?: string }) => void;
}) {
  return (
    <div className="mb-1.5 flex flex-wrap items-center justify-end gap-1.5">
      <Select value={layer} onValueChange={(l) => onChange({ layer: l })}>
        <SelectTrigger
          size="sm"
          className="h-8 w-auto gap-1 px-2 text-xs"
          aria-label="Show threads"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {/* Named for what the list then shows. "Any denial or none" described the
              filter's logic, and no operator asks for threads that way. */}
          <SelectItem value="any" className="text-xs">
            All threads
          </SelectItem>
          {CONTROL_LAYERS.map((c) => (
            <SelectItem key={c} value={c} className="text-xs">
              {c === 'approvals' ? 'Denied at an approval' : `Blocked by ${CONTROL_LABEL[c]}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        variant={failuresOnly ? 'secondary' : 'outline'}
        className="h-8 px-2 text-xs"
        aria-pressed={failuresOnly}
        onClick={() => onChange({ failuresOnly: !failuresOnly })}
      >
        Failures only
      </Button>
    </div>
  );
}

/**
 * The threads, as **one** Tab stop.
 *
 * Every event row used to be its own stop — twelve, or sixty after "Show all" —
 * so reaching the filters below meant walking the whole feed. The list now roves
 * like the sidebar's: ↑/↓, Home/End between threads, → or Enter to open, ← or
 * Escape to close. Inside an opened thread the event rows are ordinary buttons,
 * because that is where the reader has chosen to be.
 */
function LedgerList({
  threads,
  titleOf,
  openId,
  onToggle,
  spendKnown,
  metered,
  costColumn,
}: {
  threads: LedgerThread[];
  titleOf: (id: string) => { text: string; isId: boolean };
  openId: string | null;
  onToggle: (id: string) => void;
  spendKnown: boolean;
  metered: number | null;
  costColumn: boolean;
}) {
  const ref = useRef<HTMLOListElement>(null);
  const [stop, setStop] = useState<string | null>(null);
  const tabStop = threads.some((t) => t.id === stop) ? stop : (threads[0]?.id ?? null);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, id: string) => {
    const rows = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[data-ledger-row]') ?? [])];
    const at = rows.indexOf(e.currentTarget);
    const move = (to: number) => {
      e.preventDefault();
      rows[Math.max(0, Math.min(rows.length - 1, to))]?.focus();
    };
    if (e.key === 'ArrowDown') move(at + 1);
    else if (e.key === 'ArrowUp') move(at - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(rows.length - 1);
    else if (e.key === 'ArrowRight' && openId !== id) {
      e.preventDefault();
      onToggle(id);
    } else if ((e.key === 'ArrowLeft' || e.key === 'Escape') && openId === id) {
      e.preventDefault();
      onToggle(id);
    }
  };

  return (
    <ol ref={ref} className="flex flex-col gap-1.5 rounded-2xl bg-ground p-1.5">
      {threads.map((t) => (
        <ThreadEntry
          key={t.id || 'none'}
          thread={t}
          title={t.id === NO_THREAD ? null : titleOf(t.id)}
          open={openId === t.id}
          tabIndex={t.id === tabStop ? 0 : -1}
          onFocus={() => setStop(t.id)}
          onToggle={() => onToggle(t.id)}
          onKeyDown={(e) => onKeyDown(e, t.id)}
          spendKnown={spendKnown}
          spend={spendKnown ? spendState(t, metered) : null}
          costColumn={costColumn}
        />
      ))}
    </ol>
  );
}

/**
 * A failure or a denial as a few words: the tool, then why — its error class, the
 * layer that said no, or that an approval did.
 */
function failureWords(e: AuditEvent): string {
  const subject = subjectOf(e);
  const control = e.event_type === 'policy_deny' ? controlOf(e) : undefined;
  if (control === 'approvals') return `${subject} denied`;
  if (control) return `${subject} blocked by ${CONTROL_LABEL[control] ?? control}`;
  const code = errorCodeOf(e);
  if (code) return `${subject} ${ERROR_CODE_LABEL[code] ?? code}`;
  if (e.event_type === 'policy_deny') return `${subject} blocked`;
  // Said as what happened. "Turn ended badly" named a mood, not an event; the
  // harness writes this when the run stopped on a call that broke.
  if (e.event_type === 'final_response') return 'run stopped on an error';
  return `${subject} failed`;
}

/** A list of failures or denials, the same one counted rather than repeated. */
function wordsFor(events: AuditEvent[]): string {
  const groups = groupFailures(events);
  return `${groups
    .slice(0, 2)
    .map((g) => `${failureWords(g.event)}${g.count > 1 ? ` ×${g.count}` : ''}`)
    .join(' · ')}${groups.length > 2 ? ` · ${groups.length - 2} more kinds` : ''}`;
}

/** The worst outcome as a word, for a row's accessible name. */
const WORST_WORD: Record<Worst, string> = {
  ok: 'OK',
  denied: 'Denied',
  refused: 'Refused',
  error: 'Failed',
};

/**
 * The title a thread is shown under, as long as the tile allows.
 *
 * A thread nobody named is titled with its first message cut at 48 characters,
 * so the ledger's tile ended at "…" with a third of its width empty. Where the
 * window holds that first message, its whole text is drawn and the tile's own
 * width truncates it.
 */
function fullTitle(name: string, t: LedgerThread): string {
  if (!name.endsWith('…')) return name;
  const first = t.turns[t.turns.length - 1];
  const prompt = first && !first.partial ? first.prompt : null;
  if (!prompt) return name;
  const whole = prompt.trim().replace(/\s+/g, ' ');
  return whole.startsWith(name.slice(0, -1).trimEnd()) ? whole : name;
}

/** Two strings saying the same thing, give or take a truncation. */
function sameText(a: string, b: string): boolean {
  const norm = (x: string) => x.trim().replace(/\s+/g, ' ').replace(/…$/, '').toLowerCase();
  const [x, y] = [norm(a), norm(b)];
  return x === y || x.startsWith(y) || y.startsWith(x);
}

/**
 * The cost cell: what is drawn and what is said. A thread whose activity all
 * predates metering draws nothing — its calls are in the no-thread bucket, and a
 * dash would claim it cost nothing — and one that straddles the start is a floor.
 */
function costCell(
  t: LedgerThread,
  state: SpendState | null,
): { shown: ReactNode; spoken: string | null } {
  if (state === null || state === 'unrecorded') {
    return { shown: null, spoken: state === 'unrecorded' ? 'cost not recorded' : null };
  }
  if (state === 'none')
    return { shown: <span className="text-muted-foreground">—</span>, spoken: 'no spend' };
  const s = t.spend;
  if (!s) return { shown: null, spoken: null };
  if (s.cost_usd === 0 && s.calls > 0) {
    return {
      shown: <span className="font-sans text-xs text-foreground">unpriced</span>,
      spoken: 'unpriced',
    };
  }
  const amount = money(s.cost_usd);
  return state === 'floor'
    ? { shown: `≥ ${amount}`, spoken: `at least ${amount}` }
    : { shown: amount, spoken: amount };
}

function ThreadEntry({
  thread: t,
  title,
  open,
  tabIndex,
  onFocus,
  onToggle,
  onKeyDown,
  spendKnown,
  spend,
  costColumn,
}: {
  thread: LedgerThread;
  title: { text: string; isId: boolean } | null;
  open: boolean;
  tabIndex: number;
  onFocus: () => void;
  onToggle: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
  spendKnown: boolean;
  /** `null` when the harness cannot attribute spend to threads at all. */
  spend: SpendState | null;
  costColumn: boolean;
}) {
  const failed = t.failures.length > 0;
  const denied = t.denials.length > 0;
  const latestPrompt = t.turns.find((turn) => turn.prompt)?.prompt ?? null;
  const name =
    title === null
      ? 'Outside a thread'
      : title.isId
        ? middleTruncate(title.text, 32)
        : fullTitle(title.text, t);
  // The call that broke before the turn it broke: the reply is the consequence,
  // and leading with it named nothing.
  const causes = [
    ...t.failures.filter((e) => e.event_type !== 'final_response'),
    ...t.failures.filter((e) => e.event_type === 'final_response'),
  ];
  // The same failure counted, not repeated: "local_write blocked by an approval ·
  // local_write blocked by an approval · 6 more" hid the one failure that differed.
  const failureLine = failed ? wordsFor(causes) : null;
  // Denials in their own words and their own tone, after any failure.
  const denialLine = denied ? wordsFor(t.denials) : null;
  const what =
    failed || denied
      ? null
      : t.id === NO_THREAD
        ? // Said by what it holds. Before per-thread metering this bucket carries
          // every model call there was, and calling that "screening and skills"
          // put a thread's whole cost under the wrong name.
          t.spend && t.spend.calls > 0
          ? 'Spend recorded before per-thread metering, or made outside any thread'
          : 'Sign-ins, screening and other events outside any conversation'
        : // The title is usually the first prompt; saying it twice is not a summary.
          latestPrompt && !sameText(latestPrompt, name)
          ? latestPrompt
          : null;
  const cell = costCell(t, spend);
  // The row's name, short: the whole row as its name read the title twice and
  // the dash aloud.
  const label = [
    name,
    WORST_WORD[t.worst],
    failed ? plural(t.failures.length, 'failure') : null,
    denied ? `${plural(t.denials.length, 'call')} denied` : null,
    cell.spoken,
    `${relTime(t.lastTs)} ago`,
  ]
    .filter(Boolean)
    .join(', ');
  const facts = [
    t.turns.length > 0 ? plural(t.turns.length, 'turn') : null,
    t.tools > 0 ? plural(t.tools, 'tool call') : null,
  ].filter(Boolean);

  return (
    <li className="rounded-xl bg-background shadow-sheet">
      <Collapsible open={open} onOpenChange={onToggle}>
        <CollapsibleTrigger
          data-ledger-row
          aria-label={label}
          tabIndex={tabIndex}
          onFocus={onFocus}
          onKeyDown={onKeyDown}
          className="group grid w-full grid-cols-[auto_1fr_auto] items-start gap-x-2 rounded-xl px-3 py-3 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
        >
          <ChevronRightIcon
            aria-hidden
            className={cn(
              'mt-1 size-3 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none',
              open && 'rotate-90',
            )}
          />
          <div className="min-w-0">
            <p
              className={cn(
                // Two lines on a phone, where the status column takes the width a
                // title needs; one line, truncated, where there is room.
                'line-clamp-2 break-words text-sm font-medium sm:line-clamp-1',
                title?.isId && 'font-mono text-xs font-normal leading-5',
              )}
              title={
                title?.isId === false ? (name !== title.text ? name : undefined) : t.id || undefined
              }
            >
              {name}
            </p>
            {(failureLine || denialLine) && (
              // The failure line names what broke; on a phone one line cut it to
              // "publish_commits blocked by…", the part that mattered. A denial
              // follows in the muted tone: nothing broke.
              <p className="mt-0.5 line-clamp-2 break-words text-xs sm:line-clamp-1">
                {failureLine && <span className="text-state-failed">{failureLine}</span>}
                {failureLine && denialLine && <span className="text-muted-foreground"> · </span>}
                {denialLine && <span className="text-muted-foreground">{denialLine}</span>}
              </p>
            )}
            {what && (
              <p className="mt-0.5 line-clamp-2 break-words text-xs text-muted-foreground sm:line-clamp-1">
                {what}
              </p>
            )}
            {facts.length > 0 && (
              <p className="mt-0.5 text-xs text-muted-foreground">{facts.join(' · ')}</p>
            )}
          </div>
          <div className="flex items-center gap-3 pl-2">
            {/* A thread whose only miss was a denial reads *Denied*, outlined and
                muted, never *Failed* in red. */}
            <OutcomeMark status={t.worst} outcome={t.worst} />
            {costColumn && (
              <span className="w-16 text-right font-mono text-sm tabular-nums">{cell.shown}</span>
            )}
            <span
              title={new Date(t.lastTs).toISOString()}
              className="w-8 text-right text-xs tabular-nums text-muted-foreground"
            >
              {relTime(t.lastTs)}
            </span>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent className="px-3 pb-3">
          <ThreadDetail thread={t} spendKnown={spendKnown} spend={spend} />
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

/** One thread opened: its spend, a way into it, and its turns newest first. */
function ThreadDetail({
  thread: t,
  spendKnown,
  spend,
}: {
  thread: LedgerThread;
  spendKnown: boolean;
  spend: SpendState | null;
}) {
  const [openEvent, setOpenEvent] = useState<string | null>(null);
  const [allTurns, setAllTurns] = useState(false);
  const [allLoose, setAllLoose] = useState(false);
  // In the order they happened, as the thread itself reads: the turns were newest
  // first while the events inside each ran oldest first, two directions in one
  // view. The newest are what is shown; the earlier ones are offered above them.
  const newest = allTurns ? t.turns : t.turns.slice(0, TURNS_VISIBLE);
  const turns = [...newest].reverse();
  const loose = allLoose ? t.loose : t.loose.slice(0, LOOSE_VISIBLE);
  const toggle = (id: string) => setOpenEvent((prev) => (prev === id ? null : id));

  return (
    <div className="mb-3 ml-5 border-l border-border/60 pl-3">
      <p className="max-w-[70ch] text-sm text-muted-foreground">
        {t.spend ? (
          <>
            <span className="font-mono tabular-nums text-foreground">
              {t.spend.cost_usd === 0 && t.spend.calls > 0
                ? 'unpriced'
                : `${spend === 'floor' ? '≥ ' : ''}${money(t.spend.cost_usd)}`}
            </span>{' '}
            across {plural(t.spend.calls, 'model call')}
            {spend === 'floor' ? ' since per-thread metering began' : ''} ·{' '}
            <span className="font-mono text-xs tabular-nums">{tokenLine(t.spend)}</span>
          </>
        ) : spend === 'unrecorded' ? (
          // True of every thread whose turns predate the upgrade: its calls were
          // made and charged, just not to a thread. "No model spend recorded"
          // said the opposite.
          'Its spend predates per-thread metering, so it is counted under Outside a thread.'
        ) : spendKnown ? (
          'No model spend recorded for this thread in the window.'
        ) : (
          // An older harness records spend with no thread on it; the total at the
          // foot of the page still counts it.
          'This harness does not record spend per thread; the window’s total is below.'
        )}
      </p>
      {t.id !== NO_THREAD && (
        <p className="mt-1 text-sm">
          <Link to={`/t/${t.id}`} className={cn(TEXT_BUTTON, 'text-foreground')}>
            Open thread{' '}
            <span className="font-mono text-xs">{middleTruncate(t.id, THREAD_CHARS)}</span>
          </Link>
        </p>
      )}
      {t.turns.length === 0 && t.loose.length === 0 && (
        <p className="mt-2 max-w-[70ch] text-sm text-muted-foreground">
          It spent in this window, but every audited event on it is older than the window.
        </p>
      )}
      {t.turns.length > turns.length && (
        <button
          type="button"
          className={cn(TEXT_BUTTON, 'mt-2 text-sm')}
          onClick={() => setAllTurns(true)}
        >
          Show {t.turns.length - turns.length} earlier turns
        </button>
      )}
      {turns.map((turn) => (
        <TurnBlock key={turn.id} turn={turn} openEvent={openEvent} onToggle={toggle} />
      ))}
      {loose.length > 0 && (
        // Folded as a turn's rows are: eleven alternating sign-in rows were the
        // longest thing on the page and the least looked-at.
        <ol className="mt-2 divide-y divide-border/40">
          <Segments events={loose} outcomes={t.outcomes} openEvent={openEvent} onToggle={toggle} />
        </ol>
      )}
      {t.loose.length > loose.length && (
        <button
          type="button"
          className={cn(TEXT_BUTTON, 'mt-1 text-sm')}
          onClick={() => setAllLoose(true)}
        >
          Show all {t.loose.length} events
        </button>
      )}
    </div>
  );
}

/**
 * A turn: what was asked, then what the agent did in the order it did it. A
 * failure reads inside the turn it broke rather than alone in a feed, which is
 * what a red `final_response` needed — the call that failed is the row above it.
 */
function TurnBlock({
  turn,
  openEvent,
  onToggle,
}: {
  turn: LedgerTurn;
  openEvent: string | null;
  onToggle: (id: string) => void;
}) {
  const heading = turn.prompt
    ? turn.prompt
    : turn.partial
      ? 'Continued from before the window'
      : 'Turn';
  // "Yet" promised something still coming on turns seven hours old. Past the run
  // deadline a turn with no reply did not get one.
  const replyState = turn.open
    ? Date.now() - turn.endTs > OPEN_TURN_MS
      ? 'ended without a reply'
      : 'no reply yet'
    : null;
  return (
    <section className="mt-3">
      <div className="flex items-baseline gap-2">
        {/* An h3 under the page's h2: the turns were h4 with no h3 above them. */}
        <h3
          className={cn(
            'min-w-0 flex-1 truncate text-sm',
            turn.prompt ? 'text-foreground' : 'text-muted-foreground',
          )}
          title={turn.prompt ?? undefined}
        >
          {heading}
        </h3>
        {replyState && <span className="shrink-0 text-xs text-muted-foreground">{replyState}</span>}
        <span
          title={new Date(turn.startTs).toISOString()}
          className="shrink-0 text-xs tabular-nums text-muted-foreground"
        >
          {clockTime(turn.startTs)}
        </span>
      </div>
      <ol className="divide-y divide-border/40">
        {/* The `user_input` is the heading; drawing it again as a row said it twice. */}
        <Segments
          events={turn.events.filter((e) => !(e.event_type === 'user_input' && turn.prompt))}
          outcomes={turn.outcomes}
          openEvent={openEvent}
          onToggle={onToggle}
        />
      </ol>
    </section>
  );
}

/** Past this, a turn with no `final_response` is over rather than still running. */
const OPEN_TURN_MS = 15 * 60_000;

/** A list of events as drawn: routine runs folded, repeated failures counted. */
function Segments({
  events,
  outcomes,
  openEvent,
  onToggle,
}: {
  events: AuditEvent[];
  /** Each event's outcome, read in its turn. */
  outcomes: Outcomes;
  openEvent: string | null;
  onToggle: (id: string) => void;
}) {
  return (
    <>
      {foldRoutine(events, outcomes).map((seg) =>
        seg.kind === 'event' ? (
          <ActivityRow
            key={seg.event.id}
            event={seg.event}
            outcome={outcomes.get(seg.event.id) ?? 'ok'}
            hideThread
            clock
            open={openEvent === seg.event.id}
            onToggle={() => onToggle(seg.event.id)}
          />
        ) : (
          <FoldedRun
            key={seg.id}
            kind={seg.kind}
            events={seg.events}
            outcomes={outcomes}
            openEvent={openEvent}
            onToggle={onToggle}
          />
        ),
      )}
    </>
  );
}

/**
 * A folded run, as one line until asked. Routine: how many, and which tools.
 * Repeated: the failure, once, in red, with how many times — counted, never
 * hidden. Opened, it is the rows it stood for, in order, and focus moves to the
 * first of them: the button that was focused is gone, and focus had fallen to
 * the page.
 */
function FoldedRun({
  kind,
  events,
  outcomes,
  openEvent,
  onToggle,
}: {
  kind: 'fold' | 'repeat';
  events: AuditEvent[];
  outcomes: Outcomes;
  openEvent: string | null;
  onToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const firstRow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) firstRow.current?.querySelector<HTMLElement>('button')?.focus();
  }, [open]);
  if (open) {
    return (
      <>
        {events.map((e, i) => (
          // `display: contents`, so the wrapper adds nothing to the list's layout
          // and exists only for focus to find the first row.
          <div key={e.id} ref={i === 0 ? firstRow : undefined} className="contents">
            <ActivityRow
              event={e}
              outcome={outcomes.get(e.id) ?? 'ok'}
              hideThread
              clock
              open={openEvent === e.id}
              onToggle={() => onToggle(e.id)}
            />
          </div>
        ))}
      </>
    );
  }
  const first = events[0];
  // A repeated denial is counted in the muted tone; only a repeated failure is red.
  const deniedRun = kind === 'repeat' && outcomes.get(first.id) === 'denied';
  return (
    <li>
      <button
        type="button"
        aria-expanded={false}
        onClick={() => setOpen(true)}
        className={cn(
          'group flex w-full items-start gap-2 rounded-sm py-1.5 text-left text-xs transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          kind === 'repeat' && !deniedRun ? 'text-state-failed' : 'text-muted-foreground',
        )}
      >
        <ChevronRightIcon aria-hidden className="mt-0.5 size-3 shrink-0" />
        {kind === 'repeat' ? (
          <span className="min-w-0">
            <span className="font-mono">{failureWords(first)}</span> ×{events.length}
            <span className="ml-2 whitespace-nowrap text-muted-foreground">
              {span(tsToMs(first.ts), tsToMs(events[events.length - 1].ts))}
            </span>
          </span>
        ) : (
          <span className="min-w-0">
            {plural(
              events.length,
              events.every((e) => e.event_type === 'tool_call') ? 'call' : 'event',
            )}
            , all OK: <span className="font-mono">{toolTally(events)}</span>
          </span>
        )}
      </button>
    </li>
  );
}

/** `8:43 PM`, or `8:43 PM–9:10 PM`: a range that starts and ends in one minute is one time. */
function span(from: number, to: number): string {
  const [a, b] = [clockTime(from), clockTime(to)];
  return a === b ? a : `${a}–${b}`;
}

/** What the page could not cover, said where the reader would assume it had. */
function Caveats({
  eventsTruncated,
  spendTruncated,
  spendKnown,
  metered,
}: {
  eventsTruncated: boolean;
  spendTruncated: boolean;
  spendKnown: boolean;
  metered: number | null;
}) {
  // Said once, rather than as a dash on every row it explains.
  const before =
    !spendKnown || metered === null
      ? null
      : metered === Number.POSITIVE_INFINITY
        ? 'No spend in this window is recorded against a thread yet: it predates per-thread metering, so its cost is under Outside a thread.'
        : `Spend is recorded per thread from ${clockTime(metered)}; before that it is counted under Outside a thread, and a thread that ran across that point shows at least what came after (≥).`;
  const lines = [
    before,
    eventsTruncated
      ? `This window holds more than ${MAX_EVENTS.toLocaleString()} events; the ledger covers the newest ${MAX_EVENTS.toLocaleString()}. A shorter window shows the rest.`
      : null,
    spendTruncated
      ? `Cost is shown per thread for the ${SPEND_THREADS} most recently active; the total below covers every thread.`
      : null,
    spendKnown
      ? null
      : 'This harness records spend without the thread it ran on, so no thread shows a cost. The total below is still the whole window.',
  ].filter(Boolean);
  if (lines.length === 0) return null;
  return (
    <div className="mt-3 max-w-[70ch] space-y-1 text-sm text-muted-foreground">
      {lines.map((l) => (
        <p key={l}>{l}</p>
      ))}
    </div>
  );
}

/**
 * Where the window's spend went, by agent and model — the half of the old Usage
 * tab no thread row can carry: the unpriced-model warning, which is about the
 * pricing catalog rather than any run, and a route priced as a different model.
 *
 * Cost leads, at a step above the token figures: "what did it cost" is the
 * question, and the old row of four equal figures put it fourth.
 */
function SpendByModel({ summary, recent }: { summary: UsageSummary; recent: UsageEvent[] }) {
  const totals = summarizeWindow(summary);
  const buckets = byModel(summary);
  const repriced = repricedRoutes(recent);
  return (
    <section aria-labelledby="spend-by-model" className="mt-8">
      <h3 id="spend-by-model" className="text-base font-semibold">
        Where the spend went
      </h3>
      <p className="mt-1 text-sm">
        <span className="text-2xl font-semibold tracking-tight tabular-nums">
          {totals.unpriced > 0 ? '≥ ' : ''}
          {money(totals.cost)}
        </span>{' '}
        <span className="text-muted-foreground">
          {totals.unpriced > 0 ? 'at least, ' : ''}across {plural(totals.calls, 'model call')}
        </span>
      </p>
      <p className="mt-0.5 font-mono text-xs tabular-nums text-muted-foreground">
        {tokenLine({
          tokens_input: summary.totals.tokens_input,
          tokens_output: summary.totals.tokens_output,
          cache_read: summary.totals.cache_read,
          cache_creation: summary.totals.cache_creation,
        })}
      </p>
      {totals.unpriced > 0 && (
        // Foreground, not red: an unpriced model is a gap in the pricing catalog,
        // not something that failed. Said in full because the consequence — a
        // spending cap that fails open — is one an operator acts on.
        <p className="mt-2 max-w-[70ch] text-sm text-foreground">
          {totals.unpriced} {totals.unpriced === 1 ? 'call is' : 'calls are'} metered but unpriced —
          the model has no entry in the pricing catalog, so its spend counts as zero and{' '}
          <code className="font-mono">limits.max_cost_usd</code> fails open for it.
        </p>
      )}
      {buckets.length > 0 && (
        // A stone tray, like the ledger above it: tone separates, not a rule per row.
        <div className="mt-3 overflow-x-auto rounded-2xl bg-ground px-3 py-1.5">
          <table className="w-full text-xs">
            <caption className="sr-only">Spend by agent and model, most first</caption>
            <thead className="text-muted-foreground">
              <tr>
                <th scope="col" className="py-1 pr-3 text-left font-medium">
                  Agent · model
                </th>
                <th scope="col" className="py-1 pl-3 text-right font-medium">
                  Calls
                </th>
                <th scope="col" className="py-1 pl-3 text-right font-medium">
                  Tokens in + out
                </th>
                <th scope="col" className="py-1 pl-3 text-right font-medium">
                  Cost
                </th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((b) => (
                <tr key={`${b.manifest_id}:${b.model_id}`} className="[&>td]:py-1.5">
                  <td className="py-1 pr-3 font-mono">
                    {b.manifest_id || '—'}{' '}
                    <span className="text-muted-foreground">{b.model_id}</span>
                  </td>
                  <td className="py-1 pl-3 text-right font-mono tabular-nums">
                    {b.calls.toLocaleString()}
                  </td>
                  <td className="py-1 pl-3 text-right font-mono tabular-nums">
                    {b.tokens.toLocaleString()}
                  </td>
                  <td className="py-1 pl-3 text-right font-mono tabular-nums">
                    {b.unpriced ? <span className="font-sans">unpriced</span> : money(b.cost)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {repriced.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-sm text-muted-foreground">
          {repriced.map((r) => (
            <li key={`${r.model}>${r.wire}`}>
              <span className="font-mono text-xs">{r.model}</span> is priced as{' '}
              <span className="font-mono text-xs">{r.wire}</span> on recent calls.
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Routes a recent call was priced as some other model. `model_id` is the route
 * the operator configured and `wire_model_id` what the pricing catalog keyed on;
 * on a custom route they differ, and that is the case worth seeing. Each pair once.
 */
export function repricedRoutes(rows: UsageEvent[]): { model: string; wire: string }[] {
  const seen = new Map<string, { model: string; wire: string }>();
  for (const r of rows) {
    if (!r.model_id || !r.wire_model_id || r.model_id === r.wire_model_id) continue;
    seen.set(`${r.model_id}\u0000${r.wire_model_id}`, { model: r.model_id, wire: r.wire_model_id });
  }
  return [...seen.values()];
}
