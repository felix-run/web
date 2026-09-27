import { threadSuffix } from '@felix/client';
import { Badge } from '@felix/ui/badge';
import { Button } from '@felix/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@felix/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@felix/ui/select';
import { ActivityIcon, ChevronRightIcon, CoinsIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { getUsageSummary, listAudit, listUsage } from '@/api';
import {
  Field,
  isFailure,
  relTime,
  Section,
  SectionBody,
  STATUS_LABEL,
  StatusDot,
  tsToMs,
} from '@/components/inspector/primitives';
import { usePoll } from '@/hooks/usePoll';
import { middleTruncate } from '@/lib/format';
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
  // place. Which layer denied it is on the row when the harness recorded it; see
  // `CONTROL_LABEL`.
  policy_deny:
    'Something refused this tool call before it ran. The row says which layer when the harness recorded it: a policy rule, a limit, a guardrail, an approval nobody answered, a command rule, or screening.',
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

const CONTROL_LABEL: Record<string, string> = {
  policy: 'a policy rule',
  limits: 'a limit',
  guardrails: 'a guardrail',
  approvals: 'an approval',
  command: 'a command rule',
  screening: 'screening',
};

function controlOf(e: AuditEvent): string | undefined {
  const c = e.payload?.control;
  return typeof c === 'string' && c ? c : undefined;
}

/**
 * The feed's two filters, applied to the whole fetched window before the render cap.
 * Pure and exported so the test can drive it without opening a Radix select in a
 * DOM that lays nothing out. `layer` narrows to `policy_deny` rows that name it;
 * `'any'` is no filter.
 */
export function filterActivity(
  rows: AuditEvent[],
  opts: { failuresOnly: boolean; layer: string },
): AuditEvent[] {
  const base = opts.failuresOnly ? rows.filter((e) => isFailure(e.status)) : rows;
  if (opts.layer === 'any') return base;
  return base.filter((e) => e.event_type === 'policy_deny' && controlOf(e) === opts.layer);
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
const THREAD_CHARS = 20;

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
  const [layer, setLayer] = useState<string>('any');
  const [openId, setOpenId] = useState<string | null>(null);
  /** Draw the whole filtered window rather than its newest `ACTIVITY_VISIBLE`. */
  const [showAll, setShowAll] = useState(false);

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
  useEffect(() => setOpenId(null), [failuresOnly, layer, open]);

  // Applied to the whole fetched window, before the render cap. Filtering the twelve
  // visible rows instead would drop exactly what the filter exists to find: a failure
  // thirty events back is one the cap was already hiding.
  //
  // Deliberately client-side even though `/audit` accepts `status`. A failure here is
  // `error` *or* `denied`, the server filter takes one value at a time, and a filter
  // that disagreed with the "N failed" count in the header would be worse than none.
  // The layer filter is client-side for a plainer reason: `control` lives inside the
  // payload, and `/audit` filters on columns.
  const failed = data?.filter((e) => isFailure(e.status)) ?? [];
  const visible = filterActivity(data ?? [], { failuresOnly, layer });
  const rows = showAll ? visible : visible.slice(0, ACTIVITY_VISIBLE);
  const firstThread = rows[0] ? threadOf(rows[0]) : null;
  const sharedThread =
    firstThread && rows.length > 1 && rows.every((r) => threadOf(r) === firstThread)
      ? firstThread
      : null;
  /**
   * Failures in the window that the drawn rows do not include. The header said
   * "3 failed" over twelve rows holding one, with no way to see the other two
   * short of guessing that the filter above was the way — so the footer offers it
   * by name.
   */
  const shownIds = new Set(rows.map((e) => e.id));
  const failedHidden = failuresOnly ? 0 : failed.filter((e) => !shownIds.has(e.id)).length;
  const layerLabel = layer === 'any' ? null : (CONTROL_LABEL[layer] ?? layer);

  return (
    <Section
      icon={<ActivityIcon className="size-3.5" />}
      title="Activity"
      // A bare count of the window is a constant once the harness has
      // `ACTIVITY_FETCH` rows — it read "60" forever and answered nothing. What is
      // worth knowing at a glance is whether anything in the window went wrong, and
      // the window is there as that number's denominator, labelled as a window.
      // Two parts, so only the part that is a state takes its colour: the
      // window is the denominator, and red on it read as the window failing.
      metaLead={
        data
          ? `${data.length >= ACTIVITY_FETCH ? `last ${ACTIVITY_FETCH}` : data.length} ${
              data.length === 1 ? 'event' : 'events'
            } ·`
          : undefined
      }
      meta={data ? `${failed.length} failed` : undefined}
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
          layerLabel
            ? // Says "recorded" on purpose: a harness older than the `control` stamp
              // writes denials this filter can never find, and "nothing was blocked"
              // would be the wrong reading of that.
              `No denial recorded as blocked by ${layerLabel} in the last ${ACTIVITY_FETCH} events.`
            : failuresOnly
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
        {/*
          Held to the reading measure by `Section` on `/harness`. Across a
          full-width page the tool name sat at the left edge and its status ~1300px
          away at the right, so reading one row meant carrying a word across the
          screen; the filters sit on the same edge the statuses do.
        */}
        <div>
          <div className="mb-1.5 flex items-center justify-end gap-1.5">
            {/* The layer filter answers one question — "what has approvals blocked this
              week" — so it reads as that question rather than as a column picker. */}
            <Select value={layer} onValueChange={setLayer}>
              <SelectTrigger
                size="sm"
                className="h-8 w-auto gap-1 px-2 text-xs"
                aria-label="Blocked by which layer"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any" className="text-xs">
                  Any layer
                </SelectItem>
                {CONTROL_LAYERS.map((c) => (
                  <SelectItem key={c} value={c} className="text-xs">
                    Blocked by {CONTROL_LABEL[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Outline rather than ghost: at this size a ghost toggle reads as a caption
              floating above the list, and a control nobody recognises as one is the
              same as no filter at all. */}
            <Button
              size="sm"
              variant={failuresOnly ? 'secondary' : 'outline'}
              // The select's height: two heights in one toolbar read as uneven.
              className="h-8 px-2 text-xs"
              aria-pressed={failuresOnly}
              onClick={() => setFailuresOnly((v) => !v)}
            >
              Failures only
            </Button>
          </div>
          {/* Said once when every drawn row shares it — nine copies of one id were
              texture, not information — and as a link, which a row cannot hold
              (it is itself a button). */}
          {sharedThread && (
            <p className="mb-1 text-sm text-muted-foreground">
              {rows.length === 1 ? 'From' : `All ${rows.length} from`} thread{' '}
              <Link
                to={`/t/${sharedThread}`}
                title={`Thread ${sharedThread}`}
                className={cn(TEXT_BUTTON, 'font-mono text-xs')}
              >
                {middleTruncate(sharedThread, THREAD_CHARS)}
              </Link>
              .
            </p>
          )}
          <ol className="divide-y divide-border/40">
            {rows.map((e) => (
              <ActivityRow
                key={e.id}
                event={e}
                hideThread={sharedThread !== null}
                open={openId === e.id}
                onToggle={() => setOpenId((prev) => (prev === e.id ? null : e.id))}
              />
            ))}
          </ol>
          {/* Counts the filtered set, not the fetch: with the filter on, "of the last 60"
            would describe a window the reader is no longer looking at. And it says
            where the rest are, because the filters run over the whole window while
            only the newest rows are drawn — "Showing 12 of the last 60 recent
            events" said "recent" twice and not how to reach the other 48. */}
          {visible.length > rows.length && data && (
            // Body size: it is an instruction (how to reach the rest), and DESIGN.md
            // sets instructional copy at 13px; 11px is for counts and labels.
            <p className="mt-2 text-sm text-muted-foreground">
              {layerLabel
                ? `Newest ${rows.length} of ${visible.length} denials by ${layerLabel} in the last ${data.length} events.`
                : failuresOnly
                  ? `Newest ${rows.length} of ${visible.length} failed events in the last ${data.length}.`
                  : `Newest ${rows.length} of the last ${data.length} events. The filters search all ${data.length}.`}
            </p>
          )}
          {(visible.length > ACTIVITY_VISIBLE || failedHidden > 0) && (
            <div className="mt-1 flex flex-wrap gap-x-3 text-sm">
              {visible.length > ACTIVITY_VISIBLE && (
                <button type="button" className={TEXT_BUTTON} onClick={() => setShowAll((v) => !v)}>
                  {showAll ? `Show newest ${ACTIVITY_VISIBLE}` : `Show all ${visible.length}`}
                </button>
              )}
              {failedHidden > 0 && (
                <button type="button" className={TEXT_BUTTON} onClick={() => setFailuresOnly(true)}>
                  {`Show the ${failed.length} failed`}
                </button>
              )}
            </div>
          )}
          {openId !== null && (
            // A list that has quietly stopped updating looks exactly like a harness that
            // has stopped working. Say which one it is.
            <p className="mt-1 text-xs text-muted-foreground">Paused while a row is open.</p>
          )}
        </div>
      </SectionBody>
    </Section>
  );
}

/** The thread an event belongs to, as the suffix every client holds, or `null`. */
function threadOf(e: AuditEvent): string | null {
  const raw = e.payload?.thread_id;
  return typeof raw === 'string' && raw ? threadSuffix(raw) : null;
}

/**
 * A text-weight button or link: underlined, and with the system's focus ring — the
 * Ledger's "Show all" and "Show the 3 failed" had none of their own.
 */
const TEXT_BUTTON =
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
function ActivityRow({
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
              {/* A tool name is a quotation of the harness, so it is mono (the
                  Provenance Rule); a turn boundary is our own label and is not. */}
              {/* A failed row's subject takes the failed colour, so the three rows the
                  header counts are found by eye rather than by a filter click. The
                  status word beside it still says why. */}
              <span
                className={cn(
                  'truncate font-medium',
                  tool && 'font-mono text-xs',
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
      {EVENT_HELP[e.event_type] && (
        <p className="mb-1.5 text-sm text-muted-foreground">{EVENT_HELP[e.event_type]}</p>
      )}
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
  const pricedAs = sharedPricing(rows);
  const buckets = summary ? byModel(summary) : [];

  return (
    <Section
      icon={<CoinsIcon className="size-3.5" />}
      title="Usage"
      // The window rides with the total: "12.4k tokens" alone does not say over
      // what, and the header is read without the body under it.
      meta={summary ? `${compact(totals.in + totals.out)} tokens · last ${days} days` : undefined}
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
        <div>
          <p className="mb-1.5 text-xs text-muted-foreground">
            Last {days} days, across {totals.calls.toLocaleString()}{' '}
            {totals.calls === 1 ? 'turn' : 'turns'}
          </p>
          <dl className="mb-2.5 flex gap-6 border-b border-border/40 pb-2.5">
            <div>
              <dt className="text-xs text-muted-foreground">Input</dt>
              <dd className="mt-0.5 tabular-nums font-mono text-sm">
                {totals.in.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Output</dt>
              <dd className="mt-0.5 tabular-nums font-mono text-sm">
                {totals.out.toLocaleString()}
              </dd>
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
              {totals.unpriced} {totals.unpriced === 1 ? 'turn is' : 'turns are'} metered but
              unpriced — the model has no entry in the pricing catalog, so its spend counts as zero
              and <code className="font-mono">limits.max_cost_usd</code> fails open for it.
            </p>
          )}
          {/* Where the window's spend went. The summary was fetched grouped by
              agent and model and used only to count unpriced turns, so the page
              had a total and eight recent rows and no answer to "what cost that".
              Sorted by cost, so the answer is the first row. */}
          {buckets.length > 1 && (
            <table className="mb-3 w-full text-xs">
              <caption className="sr-only">Spend by agent and model, most first</caption>
              <thead className="text-muted-foreground">
                <tr className="border-b border-border/60">
                  <th scope="col" className="py-1 text-left font-medium">
                    Agent · model
                  </th>
                  <th scope="col" className="py-1 text-right font-medium">
                    Turns
                  </th>
                  <th scope="col" className="py-1 text-right font-medium">
                    Tokens
                  </th>
                  <th scope="col" className="py-1 text-right font-medium">
                    Cost
                  </th>
                </tr>
              </thead>
              <tbody>
                {buckets.map((b) => (
                  <tr key={`${b.manifest_id}:${b.model_id}`} className="border-b border-border/40">
                    <td className="py-1 font-mono">
                      {b.manifest_id || '—'}{' '}
                      <span className="text-muted-foreground">{b.model_id}</span>
                    </td>
                    <td className="py-1 text-right font-mono tabular-nums">
                      {b.calls.toLocaleString()}
                    </td>
                    <td className="py-1 text-right font-mono tabular-nums">{compact(b.tokens)}</td>
                    <td className="py-1 text-right font-mono tabular-nums">
                      {b.unpriced ? (
                        <span className="text-state-failed">unpriced</span>
                      ) : (
                        usd(b.cost)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {/* One line for a mapping every row shares, rather than the same line
              under each of them: repeated eight times it is texture, and the
              row that *differs* — the thing this exists to show — is lost in it. */}
          {pricedAs && (
            <p className="mb-1 text-xs text-muted-foreground">
              {rows.length === 1 ? 'The turn' : `All ${rows.length} turns`} below routed{' '}
              <span className="font-mono">{pricedAs.model}</span>, priced as{' '}
              <span className="font-mono">{pricedAs.wire}</span>.
            </p>
          )}
          <ol className="divide-y divide-border/40">
            {rows.map((e) => (
              <li key={e.id} className="flex items-start gap-2 py-1.5 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="truncate">
                    <span className="font-mono">{e.manifest_id || '—'}</span>
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
                  {!pricedAs && e.wire_model_id && e.wire_model_id !== e.model_id ? (
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
        </div>
      </SectionBody>
    </Section>
  );
}

/**
 * The route → price mapping, when every row shares one that differs.
 *
 * `null` when any row was priced as its own id, or rows disagree: then the
 * per-row line is the honest form, because the rows are not all the same.
 */
export function sharedPricing(
  rows: { model_id?: string | null; wire_model_id?: string | null }[],
): { model: string; wire: string } | null {
  const first = rows[0];
  if (!first?.wire_model_id || !first.model_id || first.wire_model_id === first.model_id) {
    return null;
  }
  const same = rows.every(
    (r) => r.model_id === first.model_id && r.wire_model_id === first.wire_model_id,
  );
  return same ? { model: first.model_id, wire: first.wire_model_id } : null;
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
    row.tokens += item.tokens_input + item.tokens_output;
    row.cost += item.cost_usd;
    rows.set(key, row);
  }
  return [...rows.values()]
    .map((r) => ({ ...r, unpriced: r.cost === 0 && r.tokens > 0 }))
    .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens);
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
