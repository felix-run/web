import { describeError } from '@felix/client';
import { Badge } from '@felix/ui/badge';
import { Button } from '@felix/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@felix/ui/collapsible';
import { ScrollArea } from '@felix/ui/scroll-area';
import { Skeleton } from '@felix/ui/skeleton';
import {
  ActivityIcon,
  BrainIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleAlertIcon,
  ClipboardListIcon,
  CoinsIcon,
  GaugeIcon,
  ListTodoIcon,
  SparklesIcon,
  XIcon,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addMemory,
  decideApproval,
  deletePlan,
  forgetMemory,
  getToolMetrics,
  listApprovals,
  listAudit,
  listMemories,
  listPlans,
  listUsage,
  memoriesAsOf,
  searchMemories,
} from '@/api';
import { ApprovalDecision } from '@/components/approval/approval-decision';
import { ConfirmButton } from '@/components/confirm-button';
import { ErrorBoundary, PanelErrorFallback } from '@/components/error-boundary';
import { usePoll } from '@/hooks/usePoll';
import { cn } from '@/lib/utils';
import type { AuditEvent, MemoryHit, MemoryRecord, Plan, UsageEvent } from '@/types';

export interface SkillState {
  declared: string[];
  active: string[];
}

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

/**
 * Harness status → the word the panel shows. The harness writes exactly these three
 * from `emit_agent_audit`; anything else is passed through untouched rather than
 * guessed at.
 *
 * There is deliberately no running or pending state here. An audit row is written
 * after the thing it describes has finished, so an in-flight call has no row at all —
 * which is why the feed is not where "is it working right now" gets answered.
 */
const STATUS_LABEL: Record<string, string> = {
  ok: 'OK',
  error: 'Failed',
  denied: 'Denied',
};

/** Rows rendered per section before the footer starts saying what was left out. */
const ACTIVITY_VISIBLE = 12;
const USAGE_VISIBLE = 8;

/**
 * How many events the window covers. This is a request cap, not a total, and the
 * footer has to say so: `/audit` returns no count of what it did not send, so the
 * honest phrasing is "the last 60" rather than a number that looks like a census.
 * Upstream allows up to 500.
 */
const ACTIVITY_FETCH = 60;

/** The statuses that mean the harness did not do the thing. */
function isFailure(status: string): boolean {
  return status === 'error' || status === 'failed' || status === 'denied';
}

type SectionId = 'activity' | 'approvals' | 'plans' | 'metrics' | 'usage' | 'memory' | 'skills';

/**
 * Right-hand harness inspector: activity, approvals, plans, tool metrics, usage,
 * memory, skills.
 *
 * Stacked disclosure rather than tabs. Six tab destinations did not fit the rail's
 * 22rem, so two of them were reachable only by discovering a horizontal scrollbar;
 * stacking also means a pending approval can interrupt whatever else is being read
 * instead of waiting behind a tab.
 *
 * Each section fetches only while it is expanded, so the panel costs one poll per
 * open section rather than six. Approvals is the exception and always polls while
 * the inspector is open: it is the channel a paused run is waiting on, so its count
 * has to be true before anyone thinks to look at it.
 */
export function Inspector({
  open,
  onClose,
  skills,
  onSuggest,
  busy,
  className,
}: {
  open: boolean;
  onClose: () => void;
  skills: SkillState | null;
  onSuggest: (text: string) => void;
  /** A run is in flight. Anything that posts to the thread has to stand down. */
  busy?: boolean;
  /** Set by the shell when this renders inside a drawer instead of as a column. */
  className?: string;
}) {
  const [expanded, setExpanded] = useState<Record<SectionId, boolean>>({
    activity: true,
    approvals: true,
    plans: false,
    metrics: false,
    usage: false,
    memory: false,
    skills: false,
  });

  const toggle = (id: SectionId) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  // Stable identity: ApprovalsSection depends on this in an effect, and a new function
  // every render would re-run it every render and re-open a section the user collapsed.
  const expandApprovals = useCallback(
    () => setExpanded((prev) => (prev.approvals ? prev : { ...prev, approvals: true })),
    [],
  );

  return (
    <aside
      aria-labelledby="inspector-heading"
      className={cn(
        // Same reasoning as the history rail: the panel is the thing worth widening on a
        // large display, not the transcript. Floor is the old fixed 22rem.
        'flex h-full w-[clamp(22rem,24vw,30rem)] shrink-0 flex-col border-l border-border/60 bg-card/40',
        className,
      )}
    >
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3">
        <h2 id="inspector-heading" className="text-base font-semibold">
          Inspector
        </h2>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close inspector">
          <XIcon className="size-4" />
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="divide-y divide-border/60">
          <SectionBoundary title="Activity">
            <ActivitySection
              enabled={open}
              open={expanded.activity}
              onToggle={() => toggle('activity')}
            />
          </SectionBoundary>
          <SectionBoundary title="Approvals">
            <ApprovalsSection
              enabled={open}
              open={expanded.approvals}
              onToggle={() => toggle('approvals')}
              onPending={expandApprovals}
            />
          </SectionBoundary>
          <SectionBoundary title="Plans">
            <PlansSection
              enabled={open && expanded.plans}
              open={expanded.plans}
              onToggle={() => toggle('plans')}
            />
          </SectionBoundary>
          <SectionBoundary title="Tools">
            <MetricsSection
              enabled={open && expanded.metrics}
              open={expanded.metrics}
              onToggle={() => toggle('metrics')}
            />
          </SectionBoundary>
          <SectionBoundary title="Usage">
            <UsageSection
              enabled={open && expanded.usage}
              open={expanded.usage}
              onToggle={() => toggle('usage')}
            />
          </SectionBoundary>
          <SectionBoundary title="Memory">
            <MemorySection
              enabled={open && expanded.memory}
              open={expanded.memory}
              onToggle={() => toggle('memory')}
            />
          </SectionBoundary>
          <SectionBoundary title="Skills">
            <SkillsSection
              open={expanded.skills}
              onToggle={() => toggle('skills')}
              skills={skills}
              onSuggest={onSuggest}
              busy={busy}
            />
          </SectionBoundary>
        </div>
      </ScrollArea>
    </aside>
  );
}

// --- section shell ---

/**
 * Wraps a whole section component, not its children.
 *
 * A section derives its view from the polled payload during its own render, so a
 * shape that does not match throws before any element it returns exists. A boundary
 * placed inside the section would never see it, and the error would keep climbing
 * until something caught it: the first version of this took the entire app down,
 * which is the failure it was added to prevent.
 */
function SectionBoundary({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <ErrorBoundary
      label={`inspector:${title}`}
      fallback={(error, reset) => (
        <div className="px-3 py-2.5">
          <PanelErrorFallback error={error} reset={reset} what={title} />
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}

/**
 * One disclosure row plus its body. `meta` is the at-a-glance value in the header,
 * the thing that should make expanding unnecessary most of the time.
 */
function Section({
  icon,
  title,
  meta,
  metaTone,
  open,
  onToggle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  meta?: string;
  /**
   * `attention` is amber: something is waiting on a person. `failed` is red:
   * something already went wrong and nobody is being asked to act. Collapsing the
   * two would put the panel's two most different states in one colour, which is the
   * whole thing the state palette exists to keep apart.
   */
  metaTone?: 'default' | 'attention' | 'failed';
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <Collapsible open={open} onOpenChange={onToggle}>
      <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <ChevronRightIcon
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 group-data-[state=open]:rotate-90"
        />
        <span className="shrink-0 text-muted-foreground">{icon}</span>
        <span className="flex-1 truncate text-sm font-semibold">{title}</span>
        {meta ? (
          <span
            className={cn(
              'shrink-0 text-xs tabular-nums',
              metaTone === 'attention' &&
                'rounded-full bg-state-blocked/15 px-1.5 py-0.5 font-medium text-state-blocked',
              metaTone === 'failed' &&
                'rounded-full bg-state-failed/15 px-1.5 py-0.5 font-medium text-state-failed',
              (!metaTone || metaTone === 'default') && 'text-muted-foreground',
            )}
          >
            {meta}
          </span>
        ) : null}
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Loading / error / empty handling inside an expanded section.
 *
 * `status` is the only live region: these bodies repaint on every poll, so marking the
 * lists themselves live would re-read every row every few seconds. A screen reader
 * announces a live region only when its text changes, so an unchanged count is silent.
 */
function SectionBody({
  loading,
  error,
  doing,
  empty,
  emptyText,
  status,
  onRetry,
  children,
}: {
  loading: boolean;
  /** Whatever was caught, unstringified — see `usePoll` and `ErrorNotice`. */
  error: unknown;
  /** Verb phrase completing "Could not …", used to write the failure message. */
  doing: string;
  empty?: boolean;
  emptyText: string;
  status?: string;
  /** Re-runs this section's fetch. Without it a failed poll is a dead end. */
  onRetry?: () => void;
  children: React.ReactNode;
}) {
  // A failed fetch leaves no data, which also reads as "empty". Showing both at once
  // says the harness is idle *and* unreachable; the error is the true one.
  if (error) {
    const described = describeError(error, doing);
    // No sr-only status line here: `role="alert"` is already a live region, and
    // carrying the same text in both makes a screen reader read the failure twice.
    return (
      <div
        role="alert"
        className="flex flex-col gap-2 rounded-lg border border-state-failed/30 bg-state-failed/10 px-2.5 py-2 text-xs text-state-failed"
      >
        <div className="flex items-start gap-2">
          <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
          <div className="min-w-0">
            <p className="break-words">{described.message}</p>
            {/* The mono face separates the raw status from the sentence; dimming it
                further would put it under the contrast floor. */}
            <p className="mt-0.5 font-mono break-words">{described.detail}</p>
          </div>
        </div>
        {onRetry && (
          <Button size="sm" variant="outline" className="h-7 self-start text-xs" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    );
  }

  return (
    <>
      <p className="sr-only" role="status" aria-live="polite">
        {loading && !status ? 'Loading' : status}
      </p>
      {loading && (
        <div className="space-y-1.5">
          <Skeleton className="h-8 w-full rounded-md" />
          <Skeleton className="h-8 w-full rounded-md" />
        </div>
      )}
      {!loading && empty && <p className="text-sm text-muted-foreground">{emptyText}</p>}
      {!loading && !empty && children}
    </>
  );
}

/** Footer that names what a render cap left out, so the list never lies by omission. */
function Truncated({
  shown,
  total,
  noun,
  /**
   * Set when `total` is the size of a fetch window rather than everything there is.
   * Without it the footer reads "12 of 60" and presents a request parameter as a
   * census of the harness — the exact lie this footer was added to prevent.
   */
  windowed,
}: {
  shown: number;
  total: number;
  noun: string;
  windowed?: boolean;
}) {
  if (total <= shown) return null;
  return (
    <p className="mt-2 text-xs text-muted-foreground">
      Showing {shown} of {windowed ? `the last ${total}` : total} {noun}
    </p>
  );
}

// --- Activity ---

function ActivitySection({
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

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('min-w-0 break-words', mono && 'font-mono')}>{value}</dd>
    </>
  );
}

/**
 * Status as a word plus a dot. The dot is decorative — the word carries the state, so
 * this never encodes anything in colour alone.
 *
 * The raw harness string stays in `title` for anyone matching a row against a log line;
 * what shows is `STATUS_LABEL`. Previously the raw value was rendered directly under a
 * `capitalize` class, which turned `ok` into the non-word "Ok" and let two rows meaning
 * the same thing read differently if the harness ever varied its spelling.
 */
function StatusDot({ status }: { status: string }) {
  const ok = status === 'ok' || status === 'success' || status === 'completed';
  const bad = status === 'error' || status === 'failed' || status === 'denied';
  return (
    <span
      title={status}
      className={cn(
        'inline-flex items-center gap-1 text-xs',
        ok && 'text-state-done',
        bad && 'text-state-failed',
        !ok && !bad && 'text-muted-foreground',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-1.5 rounded-full',
          ok && 'bg-state-done',
          // `--state-failed` is the text-weight red; `--destructive` is tuned to carry
          // white on a solid fill and was measurably the wrong one for a 6px dot.
          bad && 'bg-state-failed',
          !ok && !bad && 'bg-muted-foreground/50',
        )}
      />
      {STATUS_LABEL[status] ?? status}
    </span>
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

/** Audit rows have arrived in both units; normalise before doing arithmetic on one. */
function tsToMs(ts: number): number {
  return ts < 1e12 ? ts * 1000 : ts;
}

function relTime(ts: number): string {
  const ms = tsToMs(ts);
  const diff = Date.now() - ms;
  // A burst of tool calls lands inside one minute, and "now" on every row of it
  // erases the sequence. Seconds keep the rows distinguishable at the only moment
  // anyone is watching them arrive.
  if (diff < 5_000) return 'now';
  if (diff < 60_000) return `${Math.round(diff / 1_000)}s`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h`;
  return `${Math.round(diff / 86_400_000)}d`;
}

// --- Approvals ---

function ApprovalsSection({
  enabled,
  open,
  onToggle,
  onPending,
}: {
  enabled: boolean;
  open: boolean;
  onToggle: () => void;
  onPending: () => void;
}) {
  const { data, error, loading, refresh } = usePoll(() => listApprovals('pending'), { enabled });
  const count = data?.length ?? 0;

  // A gated run is stalled until someone answers, so the section opens itself rather
  // than waiting to be found. Only on the transition into a pending state: re-opening
  // while a count merely stays non-zero would fight anyone who deliberately collapsed it.
  const hadPending = useRef(false);
  useEffect(() => {
    if (count > 0 && !hadPending.current) onPending();
    hadPending.current = count > 0;
  }, [count, onPending]);

  // The in-flight guard, the toasts and the payload treatment all live in
  // `ApprovalDecision` now, shared with the transcript banner.
  async function decide(id: string, status: 'approved' | 'denied') {
    await decideApproval(id, { status });
    refresh();
  }

  return (
    <Section
      icon={<ClipboardListIcon className="size-3.5" />}
      title="Approvals"
      meta={count > 0 ? `${count} waiting` : data ? 'none' : undefined}
      metaTone={count > 0 ? 'attention' : 'default'}
      open={open}
      onToggle={onToggle}
    >
      <SectionBody
        onRetry={refresh}
        doing="load pending approvals"
        loading={loading && !data}
        error={error}
        empty={count === 0}
        emptyText="Gated tool calls wait here until you approve or deny them."
        status={
          count > 0
            ? `${count} pending ${count === 1 ? 'approval' : 'approvals'}`
            : 'No pending approvals'
        }
      >
        {/* The only carded surface in the panel. Everything else here is a readout;
            this is the one thing that stops a run until a person acts on it. */}
        <div className="space-y-2.5">
          {data?.map((a) => (
            <ApprovalDecision
              key={a.id}
              toolName={a.tool_name}
              args={(a.args ?? {}) as Record<string, unknown>}
              context={a.manifest_id}
              onDecide={(status) => decide(a.id, status)}
            />
          ))}
        </div>
      </SectionBody>
    </Section>
  );
}

// --- Plans ---

/**
 * Keyed loosely, and read through a fallback, because the harness stores whatever
 * status string the model passed. Only `pending` and `done` are written by the
 * plan tools themselves; the rest are the vocabulary a model reaches for, styled
 * where it happens to match and left neutral where it does not.
 */
const STEP_TONE: Record<string, string> = {
  pending: 'text-muted-foreground',
  in_progress: 'text-state-running',
  running: 'text-state-running',
  done: 'text-state-done',
  completed: 'text-state-done',
  skipped: 'text-muted-foreground line-through',
  failed: 'text-state-failed',
};

const STEP_MARK: Record<string, string> = {
  pending: '○',
  in_progress: '●',
  running: '●',
  done: '✓',
  completed: '✓',
  skipped: '–',
  failed: '!',
};

const DONE_STATUSES = new Set(['done', 'completed', 'skipped']);

function PlansSection({
  enabled,
  open,
  onToggle,
}: {
  enabled: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const { data, error, loading, refresh } = usePoll(() => listPlans(), { enabled });

  return (
    <Section
      icon={<ListTodoIcon className="size-3.5" />}
      title="Plans"
      meta={data ? String(data.length) : undefined}
      open={open}
      onToggle={onToggle}
    >
      <SectionBody
        onRetry={refresh}
        doing="load plans"
        loading={loading && !data}
        error={error}
        empty={data?.length === 0}
        emptyText="Switch to the deep agent and ask a multi-step question."
        status={data ? `${data.length} ${data.length === 1 ? 'plan' : 'plans'}` : undefined}
      >
        <div className="space-y-3">
          {data?.map((p: Plan) => {
            const done = p.steps.filter((s) => DONE_STATUSES.has(s.status)).length;
            const pct = p.steps.length ? (done / p.steps.length) * 100 : 0;
            return (
              <article key={p.id} className="text-xs">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-medium leading-snug">{p.title}</h3>
                  <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                    {done}/{p.steps.length}
                  </span>
                </div>
                <div className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-foreground/60 transition-[width] duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <ol className="mt-2 space-y-1">
                  {p.steps.map((s) => (
                    <li key={s.id} className={cn('flex gap-2 text-xs', STEP_TONE[s.status] ?? '')}>
                      <span className="w-3 shrink-0 font-mono" aria-hidden>
                        {STEP_MARK[s.status] ?? '·'}
                      </span>
                      <span className="flex-1 leading-snug">
                        {s.title}
                        {s.note && (
                          <span className="mt-0.5 block text-muted-foreground">{s.note}</span>
                        )}
                      </span>
                      <span className="sr-only">{s.status}</span>
                    </li>
                  ))}
                </ol>
                {/*
                  The plans equivalent of forgetting a memory: a way to clear a
                  stale plan without a database console. Editing one is not
                  offered — the body `PUT` takes is the agent-authored document,
                  and a hand-written one is a plan the agent did not write while
                  still claiming it did.
                */}
                <div className="mt-1.5">
                  <ConfirmButton
                    size="sm"
                    variant="ghost"
                    destructive
                    question={`"${p.title}" and its ${p.steps.length} step(s) will be deleted.`}
                    confirmLabel="Delete it"
                    onConfirm={async () => {
                      await deletePlan(p.id);
                      refresh();
                    }}
                  >
                    Delete
                  </ConfirmButton>
                </div>
              </article>
            );
          })}
        </div>
      </SectionBody>
    </Section>
  );
}

// --- Tool metrics ---

const HOUR_MS = 60 * 60 * 1000;

function MetricsSection({
  enabled,
  open,
  onToggle,
}: {
  enabled: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const { data, error, loading, refresh } = usePoll(() => getToolMetrics({ sinceMs: HOUR_MS }), {
    enabled,
  });
  // Already aggregated per tool and sorted by calls descending, harness-side.
  const tools = data?.tools ?? [];
  const maxCalls = Math.max(1, ...tools.map((t) => t.calls));

  return (
    <Section
      icon={<GaugeIcon className="size-3.5" />}
      title="Tools"
      meta={data ? String(tools.length) : undefined}
      open={open}
      onToggle={onToggle}
    >
      <SectionBody
        onRetry={refresh}
        doing="load tool metrics"
        loading={loading && !data}
        error={error}
        empty={tools.length === 0}
        emptyText="Ask the agent to use a tool. Rollups cover the last hour."
        status={data ? `${tools.length} tools called in the last hour` : undefined}
      >
        <p className="mb-2 text-xs text-muted-foreground">Last 60 minutes</p>
        <ol className="space-y-2">
          {tools.map((t) => (
            <li key={t.tool} className="text-xs">
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{t.tool}</span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                  {t.calls}×
                </span>
              </div>
              <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-foreground/60 transition-[width] duration-300"
                  style={{ width: `${Math.max(4, (t.calls / maxCalls) * 100)}%` }}
                />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2.5 text-xs text-muted-foreground">
                <span className={cn(t.errors > 0 && 'font-medium text-state-failed')}>
                  {t.errors > 0 ? `${t.errors} error${t.errors === 1 ? '' : 's'}` : 'healthy'}
                </span>
                {t.avg_latency_ms > 0 && <span>avg {Math.round(t.avg_latency_ms)}ms</span>}
              </div>
            </li>
          ))}
        </ol>
      </SectionBody>
    </Section>
  );
}

// --- Usage ---

/**
 * What the agent has stored across sessions, and how to get rid of it.
 *
 * The store is otherwise invisible: when a run starts answering from a fact that
 * is stale, wrong, or was extracted from a hostile tool result, this is the only
 * place to find that fact without a database console.
 *
 * Three views over the same store, because they answer different questions.
 * Listing says what is held. Search reproduces the agent's own hybrid ranking —
 * and reports which retriever produced each hit, since "why did it recall
 * *that*" is usually answered by the channel rather than the text. "As of"
 * replays what was believed at a past turn, superseded facts included.
 *
 * Forgetting is soft on the harness side: the row moves to `forgotten` and drops
 * out of recall rather than being erased. The UI says "forget" rather than
 * "delete" so it does not promise more than that.
 */
function MemorySection({
  enabled,
  open,
  onToggle,
}: {
  enabled: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const [mode, setMode] = useState<'recent' | 'search' | 'asOf' | 'add'>('recent');
  const [query, setQuery] = useState('');
  const [asOfSeq, setAsOfSeq] = useState('');
  /** Debounced so a poll is not issued per keystroke. */
  const [committedQuery, setCommittedQuery] = useState('');

  useEffect(() => {
    const t = window.setTimeout(() => setCommittedQuery(query.trim()), 300);
    return () => window.clearTimeout(t);
  }, [query]);

  const seq = Number.parseInt(asOfSeq, 10);
  const asOfReady = mode === 'asOf' && Number.isFinite(seq) && seq >= 0;
  const searchReady = mode === 'search' && committedQuery.length > 0;

  const recent = usePoll(() => listMemories({ limit: 50 }), {
    enabled: enabled && mode === 'recent',
  });
  const found = usePoll(() => searchMemories(committedQuery, { limit: 12 }), {
    enabled: enabled && searchReady,
  });
  const past = usePoll(() => memoriesAsOf(seq, { limit: 100 }), {
    enabled: enabled && asOfReady,
  });

  const active = mode === 'search' ? found : mode === 'asOf' ? past : recent;
  const rows: Array<MemoryRecord | MemoryHit> =
    mode === 'search' ? (found.data ?? []) : ((active.data as MemoryRecord[] | undefined) ?? []);

  const forget = async (id: string) => {
    await forgetMemory(id);
    active.refresh();
  };

  return (
    <Section
      icon={<BrainIcon className="size-3.5" />}
      title="Memory"
      meta={mode === 'recent' && recent.data ? String(recent.data.length) : undefined}
      open={open}
      onToggle={onToggle}
    >
      <div className="mb-2 flex gap-1" role="tablist" aria-label="Memory view">
        {(
          [
            ['recent', 'Recent'],
            ['search', 'Search'],
            ['asOf', 'As of'],
            ['add', 'Add'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            onClick={() => setMode(id)}
            className={cn(
              'rounded px-2 py-1 text-xs transition-colors',
              mode === id
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:bg-accent/50',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'add' && (
        <AddMemoryForm
          onAdded={() => {
            setMode('recent');
            recent.refresh();
          }}
        />
      )}

      {mode === 'search' && (
        <input
          type="search"
          aria-label="Search memory"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="What would it recall?"
          className="mb-2 h-8 w-full rounded-md border border-border/60 bg-background px-2 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
        />
      )}
      {mode === 'asOf' && (
        <input
          type="number"
          min={0}
          aria-label="Turn sequence"
          value={asOfSeq}
          onChange={(e) => setAsOfSeq(e.target.value)}
          // The numbers to type are the `origin_seq` values shown on the rows
          // themselves, which is what makes this usable without a separate lookup.
          placeholder="Turn sequence, e.g. 12"
          className="mb-2 h-8 w-full rounded-md border border-border/60 bg-background px-2 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
        />
      )}

      {mode === 'add' ? null : (
        <SectionBody
          onRetry={active.refresh}
          doing="read stored memory"
          loading={active.loading && !active.data}
          error={active.error}
          empty={
            (mode === 'search' && !searchReady) || (mode === 'asOf' && !asOfReady)
              ? true
              : rows.length === 0
          }
          emptyText={
            mode === 'search'
              ? searchReady
                ? 'Nothing recalled for that.'
                : 'Type to reproduce what the agent would recall.'
              : mode === 'asOf'
                ? asOfReady
                  ? 'Nothing was held at that turn.'
                  : 'Enter a turn sequence to see what was believed then.'
                : 'Nothing stored yet. Memory accumulates as the agent works.'
          }
          status={
            rows.length ? `${rows.length} ${rows.length === 1 ? 'memory' : 'memories'}` : undefined
          }
        >
          <ul className="space-y-2">
            {rows.map((m) => {
              const hit = mode === 'search' ? (m as MemoryHit) : null;
              const record = mode === 'search' ? null : (m as MemoryRecord);
              return (
                <li key={m.id} className="rounded-lg border border-border/60 px-2.5 py-2 text-xs">
                  <p className="leading-snug break-words">{m.content}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-muted-foreground">
                    <span>{m.kind}</span>
                    {m.topic_key && <span>· {m.topic_key}</span>}
                    {typeof m.importance === 'number' && (
                      <span>· imp {m.importance.toFixed(2)}</span>
                    )}
                    {hit && <span>· score {hit.score.toFixed(3)}</span>}
                    {/* Which retriever fired. The usual answer to "why this result". */}
                    {hit?.channels?.length ? <span>· via {hit.channels.join('+')}</span> : null}
                    {typeof record?.origin_seq === 'number' && (
                      <span>· seq {record.origin_seq}</span>
                    )}
                    {record?.status && record.status !== 'active' && (
                      <span className="text-state-failed">· {record.status}</span>
                    )}
                    {record?.superseded_by && <span>· superseded</span>}
                  </div>
                  {/* Forgetting a superseded row changes nothing the agent can recall. */}
                  {record?.status !== 'forgotten' && (
                    <div className="mt-1.5">
                      <ConfirmButton
                        size="sm"
                        variant="ghost"
                        destructive
                        question={`"${m.content.slice(0, 80)}" will stop being recalled.`}
                        confirmLabel="Forget it"
                        onConfirm={() => forget(m.id)}
                      >
                        Forget
                      </ConfirmButton>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </SectionBody>
      )}
    </Section>
  );
}

/** The harness's own bounds, restated so a length error is caught before a 422. */
const MEMORY_CONTENT_MAX = 4000;
const MEMORY_TOPIC_MAX = 200;

/**
 * Write a fact straight into what the agent recalls.
 *
 * The harness names this an injection ingress in its own docstring, and the
 * warning is not boilerplate: everything stored here is text the model will read
 * back later, in a session nobody is watching. That is also exactly why it is
 * worth having — a correction the agent keeps needing, a standing instruction —
 * so the panel says what it is rather than dressing it as a notes field.
 */
function AddMemoryForm({ onAdded }: { onAdded: () => void }) {
  const [content, setContent] = useState('');
  const [topicKey, setTopicKey] = useState('');
  const [importance, setImportance] = useState('0.5');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = content.trim();
  const weight = Number(importance);
  const ready =
    value.length > 0 &&
    value.length <= MEMORY_CONTENT_MAX &&
    topicKey.length <= MEMORY_TOPIC_MAX &&
    Number.isFinite(weight) &&
    weight >= 0 &&
    weight <= 1;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await addMemory({ content: value, topicKey: topicKey.trim(), importance: weight });
      setContent('');
      setTopicKey('');
      onAdded();
    } catch (err) {
      setError(describeError(err, 'store this memory').message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 text-xs">
      <p className="text-muted-foreground">
        Stored as a fact the agent can recall. It becomes model input in later sessions, so write it
        the way you would write an instruction.
      </p>
      <textarea
        aria-label="What to remember"
        value={content}
        maxLength={MEMORY_CONTENT_MAX}
        rows={3}
        onChange={(e) => setContent(e.target.value)}
        placeholder="The staging harness runs on :8081, not :8080."
        className="w-full resize-y rounded-md border border-border/60 bg-background px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
      />
      <div className="flex gap-2">
        <input
          aria-label="Topic key"
          value={topicKey}
          maxLength={MEMORY_TOPIC_MAX}
          onChange={(e) => setTopicKey(e.target.value)}
          placeholder="Topic (optional)"
          className="h-8 min-w-0 flex-1 rounded-md border border-border/60 bg-background px-2 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
        />
        <input
          aria-label="Importance"
          type="number"
          min={0}
          max={1}
          step={0.1}
          value={importance}
          onChange={(e) => setImportance(e.target.value)}
          className="h-8 w-20 rounded-md border border-border/60 bg-background px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={!ready || busy} onClick={() => void submit()}>
          {busy ? 'Storing…' : 'Remember it'}
        </Button>
        <span className="text-muted-foreground tabular-nums">
          {value.length}/{MEMORY_CONTENT_MAX}
        </span>
      </div>
      {error ? <p className="text-destructive">{error}</p> : null}
    </div>
  );
}

function UsageSection({
  enabled,
  open,
  onToggle,
}: {
  enabled: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const { data, error, loading, refresh } = usePoll(
    async () => {
      const page = await listUsage({ limit: 40 });
      return page.items;
    },
    { enabled },
  );
  const totals = summarizeUsage(data ?? []);
  const rows = data?.slice(0, USAGE_VISIBLE) ?? [];

  return (
    <Section
      icon={<CoinsIcon className="size-3.5" />}
      title="Usage"
      meta={data && data.length > 0 ? `${compact(totals.in + totals.out)} tok` : undefined}
      open={open}
      onToggle={onToggle}
    >
      <SectionBody
        onRetry={refresh}
        doing="load token usage"
        loading={loading && !data}
        error={error}
        empty={data?.length === 0}
        emptyText="Token meters appear here after model turns flush to the usage store."
        status={
          data
            ? `${data.length} usage records, ${totals.in.toLocaleString()} tokens in, ${totals.out.toLocaleString()} out`
            : undefined
        }
      >
        <dl className="mb-2.5 flex gap-6 border-b border-border/40 pb-2.5">
          <div>
            <dt className="text-xs text-muted-foreground">Input</dt>
            <dd className="mt-0.5 tabular-nums font-mono text-sm">{totals.in.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Output</dt>
            <dd className="mt-0.5 tabular-nums font-mono text-sm">{totals.out.toLocaleString()}</dd>
          </div>
        </dl>
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
                </p>
              </div>
              {e.ts != null && (
                <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                  {relTime(e.ts)}
                </span>
              )}
            </li>
          ))}
        </ol>
        <Truncated shown={rows.length} total={data?.length ?? 0} noun="records" />
      </SectionBody>
    </Section>
  );
}

function summarizeUsage(items: UsageEvent[]): { in: number; out: number } {
  let inn = 0;
  let out = 0;
  for (const e of items) {
    inn += e.tokens_input ?? 0;
    out += e.tokens_output ?? 0;
  }
  return { in: inn, out };
}

/** 12_400 → "12.4k". Header metas have to fit beside a title in a 22rem rail. */
function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}m`;
}

// --- Skills ---

function SkillsSection({
  open,
  onToggle,
  skills,
  onSuggest,
  busy,
}: {
  open: boolean;
  onToggle: () => void;
  skills: SkillState | null;
  onSuggest: (text: string) => void;
  busy?: boolean;
}) {
  return (
    <Section
      icon={<SparklesIcon className="size-3.5" />}
      title="Skills"
      meta={skills ? `${skills.active.length}/${skills.declared.length}` : undefined}
      open={open}
      onToggle={onToggle}
    >
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Skills activate through the <code className="font-mono">list_skills</code> and{' '}
          <code className="font-mono">activate_skill</code> tools during chat. This reads whatever
          the agent last reported.
        </p>
        {skills ? (
          <div className="space-y-2.5">
            <SkillList label="Active" names={skills.active} kind="active" />
            <SkillList
              label="Declared"
              names={skills.declared}
              kind="declared"
              active={skills.active}
            />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No <code className="rounded bg-muted px-1 py-0.5 font-mono">list_skills</code> result in
            this session yet.
          </p>
        )}
        {/* This is the only control outside the composer that posts to the thread, so
            it says so, and it stands down mid-run: `send` steers an in-flight run
            rather than starting a turn, so firing this during a stream would inject
            an unrelated instruction into whatever the agent is currently doing. */}
        <Button
          size="sm"
          variant="outline"
          className="h-8 w-full"
          disabled={busy}
          onClick={() => onSuggest('List your skills: which are declared, and which are active?')}
        >
          Send "list your skills" to this chat
        </Button>
        {busy && (
          <p className="text-xs text-muted-foreground">Available once the current run finishes.</p>
        )}
      </div>
    </Section>
  );
}

function SkillList({
  label,
  names,
  kind,
  active = [],
}: {
  label: string;
  names: string[];
  kind: 'active' | 'declared';
  active?: string[];
}) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div>
      {names.length === 0 ? (
        <p className="text-xs text-muted-foreground">None</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {names.map((n) => {
            const isActive = kind === 'active' || active.includes(n);
            return (
              <Badge
                key={n}
                variant={isActive && kind === 'active' ? 'default' : 'secondary'}
                className="gap-1 font-mono text-xs"
              >
                {kind === 'active' && <CheckCircle2Icon className="size-3" />}
                {n}
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}
