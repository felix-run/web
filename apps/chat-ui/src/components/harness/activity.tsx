import { threadSuffix } from '@felix/client';
import { promptTokens } from '@felix/protocol';
import { Badge } from '@felix/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@felix/ui/collapsible';
import { ChevronRightIcon } from 'lucide-react';
import { Link } from 'react-router';
import { Field, isFailure, relTime, StatusDot, tsToMs } from '@/components/inspector/primitives';
import { middleTruncate } from '@/lib/format';
import {
  ACTIVITY_FETCH,
  ACTIVITY_GLANCE_SPAN,
  AUDIT_POLL_KEY,
  recentFailures,
} from '@/lib/harness-glances';
import { cn } from '@/lib/utils';
import type { AuditEvent, UsageSummary } from '@/types';

// The window, its keys and the glance's count live where the rail can import
// them without loading this page; re-exported so the page's readers are unchanged.
export { ACTIVITY_FETCH, ACTIVITY_GLANCE_SPAN, AUDIT_POLL_KEY, recentFailures };

/**
 * The Activity page's vocabulary: how one audit event reads as a row, and how a
 * usage record's tokens and cost are counted.
 *
 * The page itself is `activity-ledger.tsx`, which folds these rows into one entry
 * per thread. What is here is what a row *says*, and it is shared with anything
 * else that shows an audit event or a dollar figure (`eval-sheet.tsx` reads
 * `usd` and `compact`).
 */

/**
 * The subject line for each event type: what the row is *about*, in the reader's
 * words rather than the harness's.
 *
 * These are the four types `emit_agent_audit` writes. The previous set modelled seven
 * — `judge_score`, `guardrail_block`, `approval_request`, `approval_decision`,
 * `plan_step`, `model_switch` — and six of them are not audit events at all: approvals
 * live on `/approvals`, and the rest were never emitted by any harness build. Only
 * `tool_call` overlapped. Meanwhile the three types the feed is actually made of were
 * absent, so every branch keyed on this table missed on every row.
 */
const EVENT_LABEL: Record<string, string> = {
  user_input: 'User message',
  tool_call: 'Tool call',
  policy_deny: 'Blocked',
  final_response: 'Assistant reply',
};

/**
 * What each event type means, for the reader who has not memorised the harness
 * vocabulary. Rendered on every row rather than only the badged ones: the previous
 * version hung this off the badge's `title`, and the badge rendered for three types,
 * so four of these strings could never appear on screen.
 */
const EVENT_HELP: Record<string, string> = {
  user_input: 'The turn started; this is what the operator sent.',
  tool_call: 'The agent called a tool.',
  // Deliberately broader than "a policy said no". The harness folds every governance
  // denial into this one name — screening, limits, guardrails, judges, and a pending
  // approval — so naming only one of them would send the reader looking in the wrong
  // place. Which layer denied it is on the row when the harness recorded it; see
  // `CONTROL_LABEL`.
  policy_deny:
    'Something refused this tool call before it ran. The row says which layer when the harness recorded it: a policy rule, a limit, a guardrail, an approval nobody answered, a command rule, or screening.',
  final_response: 'The turn ended; the agent produced its reply.',
};

/**
 * What each `ToolErrorCode` means, for a failed call's row and its detail.
 *
 * The harness records the code on a failed `tool_call` row as `payload.error_code`
 * (felix-run/felix#348) — the class of failure, never the message, which is the
 * tool's own text and stays on its card in the thread. An older harness records
 * none, and a code this table does not know is shown as the harness spelled it.
 */
export const ERROR_CODE_LABEL: Record<string, string> = {
  invalid_arguments: 'bad arguments',
  transport_unavailable: 'unreachable',
  provider_error: 'provider error',
  timeout: 'timed out',
  user_aborted: 'aborted',
  rate_limited: 'rate-limited',
  permission_denied: 'permission denied',
  internal: 'internal error',
};

const ERROR_CODE_HELP: Record<string, string> = {
  invalid_arguments: 'The tool rejected the arguments the model sent.',
  transport_unavailable: "The tool's server or transport could not be reached.",
  provider_error: 'The service behind the tool returned an error.',
  timeout: 'The call ran past its deadline.',
  user_aborted: 'The run was stopped while the call was in flight.',
  rate_limited: 'The service behind the tool refused the call as over its rate limit.',
  permission_denied:
    'The call was refused for lack of permission — by the filesystem or by the service behind the tool.',
  internal: 'The tool failed in an unexpected way.',
};

/** The harness's error class for a failed call, when it recorded one. */
export function errorCodeOf(e: Pick<AuditEvent, 'payload'>): string | undefined {
  const code = e.payload?.error_code;
  return typeof code === 'string' && code !== '' ? code : undefined;
}

/**
 * The help line for one event, which for a failed call has to say something the
 * type's line cannot.
 *
 * A red row invites a click, and it used to answer "The agent called a tool." —
 * the same words as a call that worked, at the one moment the operator leaned in.
 * With the harness's error class it says which kind of failure this was; without
 * one (a harness older than felix-run/felix#348) it says where the reason lives
 * rather than guessing at it. Either way the message itself is on the tool card.
 */
export function eventHelp(
  e: Pick<AuditEvent, 'event_type' | 'status' | 'payload'>,
): string | undefined {
  if (e.event_type === 'tool_call' && e.status === 'error') {
    const code = errorCodeOf(e);
    const known = code ? ERROR_CODE_HELP[code] : undefined;
    if (known) return `${known} The full message is on the call's card in the thread.`;
    if (code)
      return `The tool failed with \`${code}\`. The full message is on the call's card in the thread.`;
    return "The tool returned an error. The audit record keeps which call failed, not why; the tool's result is on its card in the thread.";
  }
  // The harness writes `final_response` as `error` when any call in the turn
  // failed fatally *or was refused*, and the agent usually replied anyway — so a
  // red reply row is a turn that ended badly, not a reply that failed to send. It
  // fell through to "the agent produced its reply" under a red Failed, the one
  // row type that explained itself as a success. The row does not record which of
  // the two it was; the turn's other rows do.
  if (e.event_type === 'final_response' && isFailure(e.status)) {
    const replied = typeof e.payload?.chars === 'number' && e.payload.chars > 0;
    return `The turn ended, but not cleanly: a call in it failed or was refused${
      replied ? ', and the agent replied after it' : ', and the agent produced no reply'
    }. Which call is on this turn's earlier rows; the reply is in the thread.`;
  }
  return EVENT_HELP[e.event_type];
}

/**
 * Tone for the one event worth interrupting a scan for.
 *
 * Colour here means run state, not event category. An earlier version gave each of six
 * event types its own hue, which spent the whole colour budget on telling violet from
 * indigo: neither carries urgency, and six hues in a 22rem panel is noise. That was cut
 * back to two states, which was right — but every key in the table (`guardrail_block`,
 * `approval_request`, `approval_decision`) named an event the harness does not emit, so
 * the reduction shipped as no badge at all. `policy_deny` is what a refusal is really
 * called, and it is the exception the panel exists to surface.
 *
 * `tool_call` stays deliberately absent, and now so do `user_input` and `final_response`:
 * between them they are nearly the whole feed, and badging the majority would put every
 * row at the same volume and stop the exception reading as one. A failed `final_response`
 * still stands out — through its status, which is the channel for that.
 */
const EVENT_TONE: Record<string, string> = {
  // An outline, not amber. Amber is "a person is being asked to act", and a
  // denial in the feed is history — the run already moved on. The row's status
  // dot says "Denied" in red, so the badge only has to say *what kind* of row
  // this is; colouring it too put two state colours on one row.
  policy_deny: 'border border-border bg-transparent text-foreground',
};

/**
 * The governance layer that refused a call, as `payload.control` names it.
 *
 * Every wrapper deny lands in the feed as one `policy_deny`, and until the harness
 * stamped the source on the row, which layer said no was a Prometheus question:
 * `felix_policy_deny` carried the rule, the audit row carried only the fact. The row
 * carries the layer now (`felix-run/felix@6853057`), so "what has approvals blocked
 * this week" is a filter on this feed rather than a join across two systems. The
 * row is still the coarser record — the counter knows *which* policy or judge, the
 * row knows which *kind* — which is why the layer is a filter here and not a chart.
 *
 * An older harness sends no `control`; those rows keep reading as plain `Blocked`,
 * and the filter cannot find them, which the empty state says.
 */
export const CONTROL_LAYERS = [
  'policy',
  'limits',
  'guardrails',
  'approvals',
  'command',
  'screening',
] as const;

export const CONTROL_LABEL: Record<string, string> = {
  policy: 'a policy rule',
  limits: 'a limit',
  guardrails: 'a guardrail',
  approvals: 'an approval',
  command: 'a command rule',
  screening: 'screening',
};

export function controlOf(e: AuditEvent): string | undefined {
  const c = e.payload?.control;
  return typeof c === 'string' && c ? c : undefined;
}

/**
 * How many characters of a thread id the Activity row shows.
 *
 * It was `max-w-[10ch]` with CSS truncation, which kept a uuid's first group and
 * nothing of a named thread: `self-triage-changelog-union` and `self-triage-other`
 * both read `self-tri…`, so the column could not tell two threads apart — the one
 * thing it is there for. Twenty characters holds a whole short name, and for a
 * longer one `middleTruncate` keeps both ends, which is where ids differ: a shared
 * prefix names the kind of work and the tail names the instance.
 */
export const THREAD_CHARS = 20;

/** The thread an event belongs to, as the suffix every client holds, or `null`. */
function threadOf(e: AuditEvent): string | null {
  const raw = e.payload?.thread_id;
  return typeof raw === 'string' && raw ? threadSuffix(raw) : null;
}

/**
 * A text-weight button or link: underlined, and with the system's focus ring — the
 * Activity page's "Show all" and "Show the 3 failed" had none of their own.
 */
export const TEXT_BUTTON =
  'rounded-sm text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none';

/**
 * One event, as a disclosure.
 *
 * The row is a real `<button>` rather than a styled `<li>`, which is what makes the
 * feed keyboard-reachable: before this, tabbing through the inspector skipped every
 * event and landed on the next section header, so the whole list was mouse-only. It
 * carries the same chevron-and-rotate grammar as `Section` one level down, because a
 * second disclosure idiom inside the same panel would be a second thing to learn.
 *
 * Expanding is the only way to see a payload. The collapsed row shows a clamped
 * two-line summary and nothing else, so a long prompt or a denial's context used to
 * end at the clamp with nowhere to go.
 */
export function ActivityRow({
  event: e,
  hideThread = false,
  open,
  onToggle,
}: {
  event: AuditEvent;
  /** The list already said which thread every row is from. */
  hideThread?: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const tone = EVENT_TONE[e.event_type];
  const label = EVENT_LABEL[e.event_type] ?? e.event_type;
  const subject = subjectOf(e);
  const tool = typeof e.payload?.tool === 'string' && e.payload.tool !== '';
  const thread = hideThread ? null : threadOf(e);
  const failedRow = isFailure(e.status);
  const text = summary(e);
  const control = e.event_type === 'policy_deny' ? controlOf(e) : undefined;
  const errorCode = e.event_type === 'tool_call' && failedRow ? errorCodeOf(e) : undefined;

  return (
    <li>
      <Collapsible open={open} onOpenChange={onToggle}>
        {/* A visible ring, not just a background wash. `Section` indicates focus with
            `bg-accent/40` alone, which at this density is hard to locate and does not
            clear the 3:1 WCAG 1.4.11 asks of a focus indicator; `--ring` was measured
            for exactly this and is used on both now. */}
        {/* Escape closes the row it is on, and only that row: stopped here so the
            thread the row sits in does not close with it. */}
        <CollapsibleTrigger
          onKeyDown={(ev) => {
            if (ev.key !== 'Escape' || !open) return;
            ev.preventDefault();
            ev.stopPropagation();
            onToggle();
          }}
          className="group flex w-full items-start gap-2 rounded-sm py-1.5 text-left text-sm transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRightIcon
            aria-hidden
            className="mt-0.5 size-3 shrink-0 text-muted-foreground transition-transform duration-150 group-data-[state=open]:rotate-90"
          />
          <div className="min-w-0 flex-1">
            {/* One line in reading order — what, on which thread, how it went, when —
                so the status is read with the name rather than found at the far
                edge. There is no target: a `tool_call` row records the tool's name,
                call id and thread, never its arguments, so a target here would be
                invented. */}
            <div className="flex items-center gap-1.5">
              {/* Every row carries its type. The exception gets the tonal badge; the
                  routine majority gets a quiet label, which is what keeps the
                  exception reading as one. */}
              {tone ? (
                <Badge
                  variant="secondary"
                  title={EVENT_HELP[e.event_type]}
                  className={cn('shrink-0 px-1 py-0 font-sans text-xs font-medium', tone)}
                >
                  {label}
                </Badge>
              ) : (
                // Suppressed where it would only repeat the subject, which is what
                // `EVENT_LABEL` returns for a turn boundary — and on a tool call,
                // whose mono tool name already says what it is: "Tool call" on
                // every row of a turn was texture.
                label !== subject &&
                !(e.event_type === 'tool_call' && tool) && (
                  <span
                    title={EVENT_HELP[e.event_type]}
                    className="shrink-0 text-xs text-muted-foreground"
                  >
                    {label}
                  </span>
                )
              )}
              {/* A tool name is a quotation of the harness, so it is mono (the
                  Provenance Rule); a turn boundary is our own label and is not.

                  Ranked by what the row is. Turn boundaries — "Assistant reply",
                  "User message" — are the routine frame of every run, so they
                  recede: regular weight, muted. Tool calls are the mechanism this
                  page exists to show, so they carry the row at body size. They
                  were the other way round — turns at 13px medium, tools at 11px
                  mono — which made the frame the loudest thing in the feed and
                  the one failed call the smallest text on its own line. */}
              {/* A failed row's subject takes the failed colour, so the rows the
                  header counts are found by eye rather than by a filter click. The
                  status word beside it still says why. */}
              <span
                className={cn(
                  'truncate',
                  tool ? 'font-mono font-medium' : 'text-muted-foreground',
                  failedRow && 'text-state-failed',
                )}
              >
                {subject}
              </span>
              {control && (
                // Which layer said no, next to what it said no to. A row from a
                // harness that did not stamp it shows nothing here rather than a
                // guess.
                <span className="shrink-0 text-xs text-muted-foreground">
                  by {CONTROL_LABEL[control] ?? control}
                </span>
              )}
              {errorCode && (
                // Why it failed, next to what failed — the same place a denial says
                // which layer refused. The class only; the message is on the card.
                <span className="shrink-0 text-xs text-muted-foreground">
                  {ERROR_CODE_LABEL[errorCode] ?? errorCode}
                </span>
              )}
              {thread && (
                // The suffix, as every other thread id a client holds, cut from the
                // middle rather than the end: see `middleTruncate`. Whole in `title`
                // for matching against a log line, and whole to a screen reader,
                // which has no ellipsis to decode.
                // Not below `sm`: at a phone's width it kept its 20 characters
                // while the tool name beside it — the part that differs between
                // rows — was cut to `github__g…`. The thread is still in the row's
                // detail, whole, as the payload's `thread_id`.
                <span
                  title={`Thread ${thread}`}
                  className="hidden shrink-0 font-mono text-xs text-muted-foreground sm:inline"
                >
                  <span aria-hidden>{middleTruncate(thread, THREAD_CHARS)}</span>
                  <span className="sr-only">Thread {thread}</span>
                </span>
              )}
              <span className="ml-auto flex shrink-0 items-center gap-2 pl-2">
                <StatusDot status={e.status} />
                {e.ts != null && (
                  // The rounded "3h" is for scanning; the exact stamp is for matching a
                  // row against a harness log line.
                  <span
                    title={new Date(tsToMs(e.ts)).toISOString()}
                    className="w-8 text-right text-xs tabular-nums text-muted-foreground"
                  >
                    {relTime(e.ts)}
                  </span>
                )}
              </span>
            </div>
            {text && (
              // The clamp is a scanning aid, so it lifts once this row is the one
              // being read rather than one of twelve being skimmed.
              <p
                className={cn(
                  'mt-0.5 text-xs text-muted-foreground',
                  open ? 'whitespace-pre-wrap break-words' : 'line-clamp-2',
                )}
              >
                {text}
              </p>
            )}
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ActivityDetail event={e} />
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

/**
 * Everything the harness recorded about one event.
 *
 * `bg-background` rather than `--code-surface`: this pane sits inside the inspector's
 * own `bg-card/40`, and the house rule is that a pane takes whichever level its
 * container does not.
 *
 * The payload is rendered key by key rather than as pretty-printed JSON. Every value
 * the agent loop writes is a scalar — `tool`, `tool_call_id`, `thread_id`,
 * `user_input`, `chars` — so JSON would be punctuation around the same six words.
 * Anything nested still renders, as compact JSON in the value column.
 */
function ActivityDetail({ event: e }: { event: AuditEvent }) {
  const payload = Object.entries(e.payload ?? {});
  const thread = threadOf(e);
  return (
    <div className="mt-1 mb-2 ml-5 rounded-md bg-background px-2.5 py-2 text-xs">
      {/* What the event type means, on screen. It lived only in a `title`, which
          a keyboard or a touch screen never shows. */}
      {eventHelp(e) && <p className="mb-1.5 text-sm text-muted-foreground">{eventHelp(e)}</p>}
      {thread && (
        <p className="mb-1.5 text-sm">
          <Link to={`/t/${thread}`} className={cn(TEXT_BUTTON, 'text-foreground')}>
            Open thread{' '}
            <span className="font-mono text-xs">{middleTruncate(thread, THREAD_CHARS)}</span>
          </Link>
        </p>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <Field label="Event" value={e.event_type} mono />
        <Field label="Status" value={e.status} mono />
        {e.ts != null && <Field label="When" value={new Date(tsToMs(e.ts)).toLocaleString()} />}
        {e.manifest_id && <Field label="Manifest" value={e.manifest_id} mono />}
        {e.principal_subj && <Field label="Principal" value={e.principal_subj} mono />}
        <Field label="Event id" value={e.id} mono />
      </dl>
      {payload.length > 0 && (
        <>
          <p className="mt-2 mb-1 font-medium">Payload</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {payload.map(([k, v]) => (
              <Field
                key={k}
                label={k}
                value={typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}
                mono
              />
            ))}
          </dl>
        </>
      )}
      {payload.length === 0 && (
        // Distinguishes "the harness recorded no payload" from "the client dropped it",
        // which is the exact confusion the `payload_json` rename came out of.
        <p className="mt-2 text-muted-foreground">No payload recorded for this event.</p>
      )}
    </div>
  );
}

/**
 * The row's subject line: the tool for a call or a refusal, the turn boundary
 * otherwise.
 *
 * The manifest id used to be the fallback here, and because `payload` was undefined on
 * every row it was also the *result* — the whole feed read as the manifest's name
 * ("quick") repeated down the panel. It is now the last resort it was meant to be,
 * behind the event's own label.
 */
export function subjectOf(e: AuditEvent): string {
  const t = e.payload?.tool;
  if (typeof t === 'string' && t) return t;
  if (EVENT_LABEL[e.event_type]) return EVENT_LABEL[e.event_type];
  if (e.manifest_id) return e.manifest_id;
  return e.event_type;
}

/**
 * The second line, where the harness recorded something the subject does not already
 * say. Most rows have none, and that is the honest answer rather than a gap: the agent
 * loop records a tool call's *name*, not its arguments or its result.
 *
 * The previous arms read `output_preview`, `judge`, `score` and `approval_id`, none of
 * which any harness build writes, off a `payload` that was itself always undefined.
 */
function summary(e: AuditEvent): string {
  const p = e.payload ?? {};
  if (e.event_type === 'user_input' && typeof p.user_input === 'string') {
    return p.user_input;
  }
  if (e.event_type === 'final_response' && typeof p.chars === 'number') {
    return `${p.chars.toLocaleString()} characters`;
  }
  return '';
}

/**
 * The window's buckets folded to one row per agent and model, most expensive
 * first. The harness groups by day as well; across a window the day is noise
 * for the question this answers.
 */
export function byModel(summary: UsageSummary): Array<{
  manifest_id: string;
  model_id: string;
  calls: number;
  tokens: number;
  cost: number;
  /** Metered with tokens but priced at 0: an unpriced model, not a free one. */
  unpriced: boolean;
}> {
  const rows = new Map<
    string,
    { manifest_id: string; model_id: string; calls: number; tokens: number; cost: number }
  >();
  for (const item of summary.items) {
    const key = `${item.manifest_id}\u0000${item.model_id}`;
    const row = rows.get(key) ?? {
      manifest_id: item.manifest_id,
      model_id: item.model_id,
      calls: 0,
      tokens: 0,
      cost: 0,
    };
    row.calls += item.calls;
    // The whole prompt plus the output, as `tokenSplit` counts a row — the
    // uncached input alone left every cached token out of the column.
    const t = tokenSplit(item);
    row.tokens += t.prompt + t.out;
    row.cost += item.cost_usd;
    rows.set(key, row);
  }
  return [...rows.values()]
    .map((r) => ({ ...r, unpriced: r.cost === 0 && r.tokens > 0 }))
    .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens);
}

/**
 * Tokens and spend over the **window**, from the harness's own grouping.
 *
 * `unpriced` is still the load-bearing part, and the summary can count it
 * properly where the old client-side sum could not. A bucket priced at `0` with
 * tokens in it is a model with no entry in the pricing catalog: metered, counted
 * against the token caps, and recorded as costing nothing, which is what makes
 * `limits.max_cost_usd` fail open for it. `calls` says how many turns that
 * covers, so the count is over everything in the window rather than over
 * whichever rows happened to be on screen.
 */
export function summarizeWindow(summary: UsageSummary): {
  in: number;
  out: number;
  cache: number;
  cacheWrite: number;
  cost: number;
  calls: number;
  unpriced: number;
} {
  let unpriced = 0;
  for (const item of summary.items) {
    if (item.cost_usd === 0 && item.tokens_input + item.tokens_output > 0) unpriced += item.calls;
  }
  const t = tokenSplit(summary.totals);
  return {
    in: t.prompt,
    out: t.out,
    cache: t.cacheRead,
    cacheWrite: t.cacheWrite,
    cost: summary.totals.cost_usd,
    calls: summary.totals.calls,
    unpriced,
  };
}

/**
 * A usage row's tokens, split the way its cost was.
 *
 * `tokens_input` is the **uncached** part of the prompt only. The row used to print
 * it as "in" and leave `cache_creation` out entirely, so `3 in · 68 out · $0.0131`
 * sat above `5 in · 82 out · 3,228 cache · $0.00252` and the row that looked
 * cheaper cost five times more: its 3,228 cache *writes* — priced above plain input
 * — were never on screen. "in" is the whole prompt now, as `promptTokens` counts it
 * everywhere else, with the cached parts said in words beside it.
 */
export function tokenSplit(r: {
  tokens_input?: number | null;
  tokens_output?: number | null;
  cache_read?: number | null;
  cache_creation?: number | null;
}): { prompt: number; out: number; cacheRead: number; cacheWrite: number } {
  const cacheRead = r.cache_read ?? 0;
  const cacheWrite = r.cache_creation ?? 0;
  return {
    prompt: promptTokens({ input: r.tokens_input ?? 0, output: 0, cacheRead, cacheWrite }),
    out: r.tokens_output ?? 0,
    cacheRead,
    cacheWrite,
  };
}

/** `3,233 in (3,228 written to cache) · 82 out`. */
export function tokenLine(r: Parameters<typeof tokenSplit>[0]): string {
  const t = tokenSplit(r);
  const cached = [
    t.cacheRead > 0 ? `${t.cacheRead.toLocaleString()} from cache` : '',
    t.cacheWrite > 0 ? `${t.cacheWrite.toLocaleString()} written to cache` : '',
  ].filter(Boolean);
  const split = cached.length > 0 ? ` (${cached.join(', ')})` : '';
  return `${t.prompt.toLocaleString()} in${split} · ${t.out.toLocaleString()} out`;
}

export function usd(n: number): string {
  if (n === 0) return '$0';
  if (n < 0.01) return `$${n.toFixed(5)}`;
  if (n < 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

/** 12_400 → "12.4k". Header metas have to fit beside a title in a 22rem rail. */
export function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  // `M`, not `m`: lowercase is the SI prefix for milli, and "24.7m tokens"
  // read as a fraction of one on the one page that has to be exact about size.
  return `${(n / 1_000_000).toFixed(1)}M`;
}
