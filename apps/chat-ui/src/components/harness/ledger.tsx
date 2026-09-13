import { Badge } from '@felix/ui/badge';
import { Button } from '@felix/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@felix/ui/collapsible';
import { ActivityIcon, ChevronRightIcon, CoinsIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getUsageSummary, listAudit, listUsage } from '@/api';
import {
  Field,
  isFailure,
  relTime,
  Section,
  SectionBody,
  STATUS_LABEL,
  StatusDot,
  Truncated,
  tsToMs,
} from '@/components/inspector/primitives';
import { usePoll } from '@/hooks/usePoll';
import { cn } from '@/lib/utils';
import type { AuditEvent, UsageSummary } from '@/types';

/**
 * The Ledger: what the harness *did*, and what it cost.
 *
 * One `/harness` destination holding both halves, segmented rather than stacked.
 * An audit event and a usage row are different shapes and answer different
 * questions, so interleaving them into one feed would serve neither — and only
 * the visible half polls, which is the same economy the terminal's tab strip
 * buys. Two stacked panels would cost two polls for a surface where exactly one
 * is being read.
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
  // place. Which layer denied it is a Prometheus question, not an audit one.
  policy_deny:
    'Something refused this tool call before it ran: a policy, a limit, a guardrail, a judge, or an approval nobody has answered.',
  final_response: 'The turn ended; the agent produced its reply.',
};

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
  policy_deny: 'bg-state-blocked/15 text-state-blocked',
};

/** Rows rendered per section before the footer starts saying what was left out. */
const ACTIVITY_VISIBLE = 12;

/**
 * How many events the window covers. This is a request cap, not a total, and the
 * footer has to say so: `/audit` returns no count of what it did not send, so the
 * honest phrasing is "the last 60" rather than a number that looks like a census.
 * Upstream allows up to 500.
 */
const ACTIVITY_FETCH = 60;

export function ActivitySection({
  enabled,
  open,
  onToggle,
}: {
  enabled: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const [failuresOnly, setFailuresOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  // Polling stops while a row is open. The feed repaints every 3s and a new event
  // pushes every row below it down, which moves the pane out from under whoever is
  // reading it — and the reason to open a row is to read something that has already
  // finished, so there is nothing to miss by holding still. `usePoll` refetches on
  // the `enabled` false→true edge, so closing the row brings the list back current
  // with no extra wiring.
  const { data, error, loading, refresh } = usePoll(() => listAudit({ limit: ACTIVITY_FETCH }), {
    enabled: enabled && open && openId === null,
  });

  // Close the drill-down when the list it belongs to changes underneath it. Without
  // this, filtering or collapsing the section unmounts the open row while `openId`
  // stays set — nothing looks expanded and the poll never resumes.
  useEffect(() => setOpenId(null), [failuresOnly, open]);

  // Applied to the whole fetched window, before the render cap. Filtering the twelve
  // visible rows instead would drop exactly what the filter exists to find: a failure
  // thirty events back is one the cap was already hiding.
  //
  // Deliberately client-side even though `/audit` accepts `status`. A failure here is
  // `error` *or* `denied`, the server filter takes one value at a time, and a filter
  // that disagreed with the "N failed" count in the header would be worse than none.
  const failed = data?.filter((e) => isFailure(e.status)) ?? [];
  const visible = failuresOnly ? failed : (data ?? []);
  const rows = visible.slice(0, ACTIVITY_VISIBLE);

  return (
    <Section
      icon={<ActivityIcon className="size-3.5" />}
      title="Activity"
      // A census of the window is a constant once the harness has `ACTIVITY_FETCH`
      // rows — it read "60" forever and answered nothing. What is worth knowing from a
      // collapsed header is whether anything in the window went wrong.
      meta={failed.length > 0 ? `${failed.length} failed` : undefined}
      metaTone={failed.length > 0 ? 'failed' : 'default'}
      open={open}
      onToggle={onToggle}
    >
      <SectionBody
        onRetry={refresh}
        doing="load recent activity"
        loading={loading && !data}
        error={error}
        empty={visible.length === 0}
        emptyText={
          failuresOnly
            ? `Nothing failed or was denied in the last ${ACTIVITY_FETCH} events.`
            : 'Turns, tool calls, and policy denials from chat show up here as they happen.'
        }
        // Derived from the newest event rather than the count, which stops changing
        // once the window is full — and a live region that never changes never speaks.
        status={
          data && data.length > 0
            ? `${data.length} events. Latest: ${subjectOf(data[0])}, ${STATUS_LABEL[data[0].status] ?? data[0].status}.`
            : undefined
        }
      >
        <div className="mb-1.5 flex justify-end">
          {/* Outline rather than ghost: at this size a ghost toggle reads as a caption
              floating above the list, and a control nobody recognises as one is the
              same as no filter at all. */}
          <Button
            size="sm"
            variant={failuresOnly ? 'secondary' : 'outline'}
            className="h-6 px-2 text-xs"
            aria-pressed={failuresOnly}
            onClick={() => setFailuresOnly((v) => !v)}
          >
            Failures only
          </Button>
        </div>
        <ol className="divide-y divide-border/40">
          {rows.map((e) => (
            <ActivityRow
              key={e.id}
              event={e}
              open={openId === e.id}
              onToggle={() => setOpenId((prev) => (prev === e.id ? null : e.id))}
            />
          ))}
        </ol>
        {/* Counts the filtered set, not the fetch: with the filter on, "of the last 60"
            would describe a window the reader is no longer looking at. */}
        <Truncated
          shown={rows.length}
          total={visible.length}
          noun={failuresOnly ? `failed events in the last ${ACTIVITY_FETCH}` : 'recent events'}
          windowed={!failuresOnly}
        />
        {openId !== null && (
          // A list that has quietly stopped updating looks exactly like a harness that
          // has stopped working. Say which one it is.
          <p className="mt-1 text-xs text-muted-foreground">Paused while a row is open.</p>
        )}
      </SectionBody>
    </Section>
  );
}

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
function ActivityRow({
  event: e,
  open,
  onToggle,
}: {
  event: AuditEvent;
  open: boolean;
  onToggle: () => void;
}) {
  const tone = EVENT_TONE[e.event_type];
  const label = EVENT_LABEL[e.event_type] ?? e.event_type;
  const subject = subjectOf(e);
  const text = summary(e);

  return (
    <li>
      <Collapsible open={open} onOpenChange={onToggle}>
        {/* A visible ring, not just a background wash. `Section` indicates focus with
            `bg-accent/40` alone, which at this density is hard to locate and does not
            clear the 3:1 WCAG 1.4.11 asks of a focus indicator; `--ring` was measured
            for exactly this and is used on both now. */}
        <CollapsibleTrigger className="group flex w-full items-start gap-2 rounded-sm py-1.5 text-left text-sm transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronRightIcon
            aria-hidden
            className="mt-0.5 size-3 shrink-0 text-muted-foreground transition-transform duration-150 group-data-[state=open]:rotate-90"
          />
          <div className="min-w-0 flex-1">
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
                // `EVENT_LABEL` returns for a turn boundary.
                label !== subject && (
                  <span
                    title={EVENT_HELP[e.event_type]}
                    className="shrink-0 text-xs text-muted-foreground"
                  >
                    {label}
                  </span>
                )
              )}
              <span className="truncate font-medium">{subject}</span>
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
          <div className="flex shrink-0 flex-col items-end gap-0.5">
            <StatusDot status={e.status} />
            {e.ts != null && (
              // The rounded "3h" is for scanning; the exact stamp is for matching a
              // row against a harness log line.
              <span
                title={new Date(tsToMs(e.ts)).toISOString()}
                className="text-xs tabular-nums text-muted-foreground"
              >
                {relTime(e.ts)}
              </span>
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
  return (
    <div className="mt-1 mb-2 ml-5 rounded-md bg-background px-2.5 py-2 text-xs">
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
function subjectOf(e: AuditEvent): string {
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

const USAGE_VISIBLE = 8;
/** What `GET /usage/summary` answers for when asked for no window. */
const SUMMARY_DEFAULT_DAYS = 30;

export function UsageSection({
  enabled,
  open,
  onToggle,
}: {
  enabled: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  /**
   * Two requests, one tick.
   *
   * They answer different questions and neither can answer the other's. The
   * **summary** is what the tenant actually spent: the harness groups and totals
   * over a window — thirty days unless asked otherwise — which is a number this
   * panel could not produce before, because it was summing whatever page of rows
   * it happened to fetch and labelling the result as the total. The **rows** are
   * the recent detail the summary drops, above all `wire_model_id`, which is what
   * a turn was priced by and the one thing worth seeing when it disagrees with
   * the route the operator configured.
   *
   * One `usePoll` rather than two, so the section still costs one tick — the
   * economy the Ledger's tabs exist for.
   */
  const { data, error, loading, refresh } = usePoll(
    async () => {
      const [summary, page] = await Promise.all([
        getUsageSummary(),
        listUsage({ limit: USAGE_VISIBLE }),
      ]);
      return { summary, rows: page.items };
    },
    { enabled },
  );
  const summary = data?.summary ?? null;
  // Zeroed rather than nullable, so the readout below stays one shape. `SectionBody`
  // renders the loading skeleton ahead of the empty state, so a zero here is only
  // ever on screen once the window really is empty.
  const totals = summary
    ? summarizeWindow(summary)
    : { in: 0, out: 0, cost: 0, calls: 0, unpriced: 0 };
  const days = summary ? windowDays(summary) : SUMMARY_DEFAULT_DAYS;
  const rows = data?.rows ?? [];

  return (
    <Section
      icon={<CoinsIcon className="size-3.5" />}
      title="Usage"
      meta={
        totals && totals.in + totals.out > 0 ? `${compact(totals.in + totals.out)} tok` : undefined
      }
      open={open}
      onToggle={onToggle}
    >
      <SectionBody
        onRetry={refresh}
        doing="load token usage"
        loading={loading && !data}
        error={error}
        empty={totals.calls === 0}
        emptyText="Token meters appear here after model turns flush to the usage store."
        status={
          totals
            ? `${totals.calls} turns in the last ${days} days, ${totals.in.toLocaleString()} tokens in, ${totals.out.toLocaleString()} out`
            : undefined
        }
      >
        <p className="mb-1.5 text-xs text-muted-foreground">
          Last {days} days, across {totals.calls.toLocaleString()}{' '}
          {totals.calls === 1 ? 'turn' : 'turns'}
        </p>
        <dl className="mb-2.5 flex gap-6 border-b border-border/40 pb-2.5">
          <div>
            <dt className="text-xs text-muted-foreground">Input</dt>
            <dd className="mt-0.5 tabular-nums font-mono text-sm">{totals.in.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Output</dt>
            <dd className="mt-0.5 tabular-nums font-mono text-sm">{totals.out.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">
              {/*
                Not "Cost" when any row was unpriced: the number is a floor, and
                labelling a floor as the total is the misreading worth designing
                against here.
              */}
              {totals.unpriced > 0 ? 'Cost (floor)' : 'Cost'}
            </dt>
            <dd className="mt-0.5 tabular-nums font-mono text-sm">
              {totals.unpriced > 0 ? '≥ ' : ''}
              {usd(totals.cost)}
            </dd>
          </div>
        </dl>
        {totals.unpriced > 0 && (
          <p className="mb-2.5 text-xs text-state-failed">
            {totals.unpriced} {totals.unpriced === 1 ? 'turn is' : 'turns are'} metered but unpriced
            — the model has no entry in the pricing catalog, so its spend counts as zero and{' '}
            <code className="font-mono">limits.max_cost_usd</code> fails open for it.
          </p>
        )}
        <ol className="divide-y divide-border/40">
          {rows.map((e) => (
            <li key={e.id} className="flex items-start gap-2 py-1.5 text-xs">
              <div className="min-w-0 flex-1">
                <div className="truncate">
                  {e.manifest_id || '—'}
                  {e.model_id ? (
                    <span className="ml-1 font-mono text-xs text-muted-foreground">
                      {e.model_id}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 tabular-nums font-mono text-xs text-muted-foreground">
                  {(e.tokens_input ?? 0).toLocaleString()} in ·{' '}
                  {(e.tokens_output ?? 0).toLocaleString()} out
                  {(e.cache_read ?? 0) > 0 ? ` · ${e.cache_read.toLocaleString()} cache` : ''}
                  {e.cost_usd ? ` · ${usd(e.cost_usd)}` : ''}
                </p>
                {/*
                  Only when it disagrees with the reported id. `model_id` is the
                  logical route the operator configured; this is what the row was
                  actually priced by, and the two differing on a custom route is
                  the case worth being able to see.
                */}
                {e.wire_model_id && e.wire_model_id !== e.model_id ? (
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                    priced as {e.wire_model_id}
                  </p>
                ) : null}
              </div>
              {e.ts != null && (
                <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                  {relTime(e.ts)}
                </span>
              )}
            </li>
          ))}
        </ol>
        {/*
          The rows are a recent sample, not a page of the window. Saying "8 of 8"
          would be true and useless; what the reader needs is that the list and
          the totals above it are measuring different things.
        */}
        {rows.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            The {rows.length} most recent {rows.length === 1 ? 'turn' : 'turns'}; the totals above
            cover the window.
          </p>
        )}
      </SectionBody>
    </Section>
  );
}

/** The window the harness answered for, in whole days, for a label. */
export function windowDays(summary: UsageSummary): number {
  return Math.max(1, Math.round((summary.until_ms - summary.since_ms) / 86_400_000));
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
  cost: number;
  calls: number;
  unpriced: number;
} {
  let unpriced = 0;
  for (const item of summary.items) {
    if (item.cost_usd === 0 && item.tokens_input + item.tokens_output > 0) unpriced += item.calls;
  }
  return {
    in: summary.totals.tokens_input,
    out: summary.totals.tokens_output,
    cost: summary.totals.cost_usd,
    calls: summary.totals.calls,
    unpriced,
  };
}

export function usd(n: number): string {
  if (n === 0) return '$0';
  if (n < 0.01) return `$${n.toFixed(5)}`;
  if (n < 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

/** 12_400 → "12.4k". Header metas have to fit beside a title in a 22rem rail. */
function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}m`;
}
