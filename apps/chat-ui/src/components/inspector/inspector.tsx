import { Badge } from '@felix/ui/badge';
import { Button } from '@felix/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@felix/ui/collapsible';
import { ScrollArea } from '@felix/ui/scroll-area';
import { Skeleton } from '@felix/ui/skeleton';
import {
  ActivityIcon,
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
  decideApproval,
  getToolMetrics,
  listApprovals,
  listAudit,
  listPlans,
  listUsage,
} from '@/api';
import { ApprovalDecision } from '@/components/approval/approval-decision';
import { ErrorBoundary, PanelErrorFallback } from '@/components/error-boundary';
import { usePoll } from '@/hooks/usePoll';
import { describeError } from '@/lib/errors';
import { cn } from '@/lib/utils';
import type { AuditEvent, Plan, PlanStepStatus, UsageEvent } from '@/types';

export interface SkillState {
  declared: string[];
  active: string[];
}

const EVENT_LABEL: Record<string, string> = {
  tool_call: 'Tool',
  judge_score: 'Judge',
  guardrail_block: 'Guardrail',
  approval_request: 'Approval',
  approval_decision: 'Decision',
  plan_step: 'Plan',
  model_switch: 'Model',
};

/**
 * What each event type actually means, for the reader who has not memorised the
 * harness vocabulary. Surfaced as the badge's `title`, so it costs nothing to
 * anyone who already knows and answers the question for anyone who does not.
 */
const EVENT_HELP: Record<string, string> = {
  tool_call: 'The agent called a tool.',
  judge_score: 'An automated judge scored the response.',
  guardrail_block: 'A policy rule stopped a tool call before it ran.',
  approval_request: 'A gated tool call paused, waiting for a person to decide.',
  approval_decision: 'Someone approved or denied a gated tool call.',
  plan_step: 'A step in a multi-step plan changed state.',
  model_switch: 'The run moved to a different model.',
};

/**
 * Tones for the events worth interrupting a scan for.
 *
 * Colour here means run state, not event category. The previous version gave each of
 * six event types its own hue, which spent the whole colour budget on telling violet
 * from indigo: neither carries urgency, neither is worth an operator's attention, and
 * six hues in a 22rem panel is noise. What the reader needs is which events are
 * waiting on a person and which resolved. The type is already written on the badge.
 *
 * `tool_call` is deliberately absent: it is the overwhelming majority of the feed, so
 * badging it too would put every row at the same volume and the exceptions would stop
 * reading as exceptions. `judge_score`, `plan_step` and `model_switch` are absent for
 * the same reason: they are routine, and their labels say what they are.
 */
const EVENT_TONE: Record<string, string> = {
  guardrail_block: 'bg-state-blocked/15 text-state-blocked',
  approval_request: 'bg-state-blocked/15 text-state-blocked',
  approval_decision: 'bg-state-done/15 text-state-done',
};

/** Rows rendered per section before the footer starts saying what was left out. */
const ACTIVITY_VISIBLE = 12;
const USAGE_VISIBLE = 8;

type SectionId = 'activity' | 'approvals' | 'plans' | 'metrics' | 'usage' | 'skills';

/**
 * Right-hand harness inspector: activity, approvals, plans, tool metrics, usage, skills.
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
  metaTone?: 'default' | 'attention';
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <Collapsible open={open} onOpenChange={onToggle}>
      <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none">
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
              metaTone === 'attention'
                ? 'rounded-full bg-state-blocked/15 px-1.5 py-0.5 font-medium text-state-blocked'
                : 'text-muted-foreground',
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
  error: string | null;
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
function Truncated({ shown, total, noun }: { shown: number; total: number; noun: string }) {
  if (total <= shown) return null;
  return (
    <p className="mt-2 text-xs text-muted-foreground">
      Showing {shown} of {total} {noun}
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
  const { data, error, loading, refresh } = usePoll(() => listAudit({ limit: 60 }), {
    enabled: enabled && open,
  });
  const rows = data?.slice(0, ACTIVITY_VISIBLE) ?? [];

  return (
    <Section
      icon={<ActivityIcon className="size-3.5" />}
      title="Activity"
      meta={data ? String(data.length) : undefined}
      open={open}
      onToggle={onToggle}
    >
      <SectionBody
        onRetry={refresh}
        doing="load recent activity"
        loading={loading && !data}
        error={error}
        empty={data?.length === 0}
        emptyText="Tool calls, approvals, and plan steps from chat show up here as they happen."
        status={data ? `${data.length} recent harness events` : undefined}
      >
        <ol className="divide-y divide-border/40">
          {rows.map((e) => {
            const tone = EVENT_TONE[e.event_type];
            return (
              <li key={e.id} className="flex items-start gap-2 py-1.5 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {tone && (
                      <Badge
                        variant="secondary"
                        title={EVENT_HELP[e.event_type]}
                        className={cn('shrink-0 px-1 py-0 font-sans text-xs font-medium', tone)}
                      >
                        {EVENT_LABEL[e.event_type] ?? e.event_type}
                      </Badge>
                    )}
                    <span className="truncate font-medium">{toolOf(e)}</span>
                  </div>
                  {summary(e) && (
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {summary(e)}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  <StatusDot status={e.status} />
                  {e.ts != null && (
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {relTime(e.ts)}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        <Truncated shown={rows.length} total={data?.length ?? 0} noun="recent events" />
      </SectionBody>
    </Section>
  );
}

function StatusDot({ status }: { status: string }) {
  const ok = status === 'ok' || status === 'success' || status === 'completed';
  const bad = status === 'error' || status === 'failed' || status === 'denied';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs capitalize',
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
          bad && 'bg-destructive',
          !ok && !bad && 'bg-muted-foreground/50',
        )}
      />
      {status}
    </span>
  );
}

/**
 * The row's subject line. Most audit events are tool calls and carry the tool name;
 * the rest fall back to whatever identifies them. The old last resort was the literal
 * word "event", which told the reader nothing they could not already see, so an event
 * with no tool and no manifest now says what kind of event it is instead.
 */
function toolOf(e: AuditEvent): string {
  const t = e.payload?.tool;
  if (typeof t === 'string') return t;
  if (e.manifest_id) return e.manifest_id;
  return (EVENT_LABEL[e.event_type] ?? e.event_type).toLowerCase();
}

function summary(e: AuditEvent): string {
  const p = e.payload ?? {};
  if (e.event_type === 'judge_score') {
    return `${p.judge}: score ${p.score}${p.reasoning ? ` — ${String(p.reasoning)}` : ''}`;
  }
  if (e.event_type === 'approval_request' || e.event_type === 'approval_decision') {
    return `approval ${String(p.approval_id ?? '').slice(0, 8)}`;
  }
  if (typeof p.output_preview === 'string') return p.output_preview;
  return '';
}

function relTime(ts: number): string {
  // Accept seconds or ms.
  const ms = ts < 1e12 ? ts * 1000 : ts;
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'now';
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

const STEP_TONE: Record<PlanStepStatus, string> = {
  pending: 'text-muted-foreground',
  in_progress: 'text-state-running',
  completed: 'text-state-done',
  skipped: 'text-muted-foreground line-through',
  failed: 'text-state-failed',
};

const STEP_MARK: Record<PlanStepStatus, string> = {
  pending: '○',
  in_progress: '●',
  completed: '✓',
  skipped: '–',
  failed: '!',
};

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
            const done = p.steps.filter((s) => s.status === 'completed').length;
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
                    <li key={s.id} className={cn('flex gap-2 text-xs', STEP_TONE[s.status])}>
                      <span className="w-3 shrink-0 font-mono" aria-hidden>
                        {STEP_MARK[s.status]}
                      </span>
                      <span className="flex-1 leading-snug">{s.description}</span>
                      <span className="sr-only">{s.status}</span>
                    </li>
                  ))}
                </ol>
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
