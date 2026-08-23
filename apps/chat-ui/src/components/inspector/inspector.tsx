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
import { toast } from 'sonner';
import {
  decideApproval,
  getToolMetrics,
  listApprovals,
  listAudit,
  listPlans,
  listUsage,
} from '@/api';
import { ErrorBoundary, PanelErrorFallback } from '@/components/error-boundary';
import { usePoll } from '@/hooks/usePoll';
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
 * Tones for the events worth interrupting a scan for. `tool_call` is deliberately
 * absent: it is the overwhelming majority of the feed, so badging it too would put
 * every row at the same volume and the exceptions would stop reading as exceptions.
 */
const EVENT_TONE: Record<string, string> = {
  judge_score: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  guardrail_block: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  approval_request: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  approval_decision: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  plan_step: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300',
  model_switch: 'bg-pink-500/15 text-pink-700 dark:text-pink-300',
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
  className,
}: {
  open: boolean;
  onClose: () => void;
  skills: SkillState | null;
  onSuggest: (text: string) => void;
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
        'flex h-full w-[22rem] shrink-0 flex-col border-l border-border/60 bg-card/40',
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
                ? 'rounded-full bg-amber-500/20 px-1.5 py-0.5 font-medium text-amber-800 dark:text-amber-300'
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
  empty,
  emptyText,
  status,
  onRetry,
  children,
}: {
  loading: boolean;
  error: string | null;
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
    // No sr-only status line here: `role="alert"` is already a live region, and
    // carrying the same text in both makes a screen reader read the failure twice.
    return (
      <>
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-xs text-destructive"
        >
          <div className="flex items-start gap-2">
            <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0 break-words">{error}</span>
          </div>
          {onRetry && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 self-start text-xs"
              onClick={onRetry}
            >
              Try again
            </Button>
          )}
        </div>
      </>
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
        ok && 'text-emerald-600 dark:text-emerald-400',
        bad && 'text-destructive',
        !ok && !bad && 'text-muted-foreground',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-1.5 rounded-full',
          ok && 'bg-emerald-500',
          bad && 'bg-destructive',
          !ok && !bad && 'bg-muted-foreground/50',
        )}
      />
      {status}
    </span>
  );
}

function toolOf(e: AuditEvent): string {
  const t = e.payload?.tool;
  return typeof t === 'string' ? t : e.manifest_id || 'event';
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

  // Approving a gated call is the one irreversible thing this panel does, so a second
  // decision must not get out while the first is in flight.
  //
  // The guard is a ref, not the state below. React batches state updates, so a burst
  // of clicks in one tick all read the same pre-update value and every one of them
  // gets through: measured at 10 POSTs from 10 clicks with a state-only guard. A ref
  // is written synchronously, so the second click sees the first. The state exists
  // only to disable the buttons and relabel them.
  const decidingRef = useRef<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);

  async function decide(id: string, status: 'approved' | 'denied', tool: string) {
    if (decidingRef.current) return;
    decidingRef.current = id;
    setDeciding(id);
    try {
      await decideApproval(id, { status });
      toast.success(`${status === 'approved' ? 'Approved' : 'Denied'} ${tool}`);
      refresh();
    } catch (err) {
      toast.error(`Could not ${status === 'approved' ? 'approve' : 'deny'} ${tool}`, {
        description: String((err as Error)?.message ?? err),
      });
    } finally {
      decidingRef.current = null;
      setDeciding(null);
    }
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
            <article
              key={a.id}
              className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 text-xs"
            >
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="py-0 font-mono text-xs">
                  {a.tool_name}
                </Badge>
                <span className="truncate text-muted-foreground">{a.manifest_id}</span>
              </div>
              <ApprovalArgs args={a.args} />
              <div className="mt-2.5 flex gap-2">
                <Button
                  size="sm"
                  className="h-8 flex-1"
                  disabled={deciding !== null}
                  onClick={() => void decide(a.id, 'approved', a.tool_name)}
                >
                  {deciding === a.id ? 'Deciding…' : `Approve ${a.tool_name}`}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={deciding !== null}
                  onClick={() => void decide(a.id, 'denied', a.tool_name)}
                >
                  Deny
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Deciding resumes the paused run, no need to re-send.
              </p>
            </article>
          ))}
        </div>
      </SectionBody>
    </Section>
  );
}

/** Lines shown before the payload folds. Chosen to clear a typical shell/file call whole. */
const ARGS_FOLD_LINES = 14;

/**
 * The arguments being approved.
 *
 * Rendered in full by default rather than inside a fixed-height scroll box: the
 * reason to read this at all is to catch the destructive part of the call, and a
 * scroll box puts exactly that below the fold on anything non-trivial. Long
 * payloads fold, but the fold says how much it is hiding and opens in place.
 */
function ApprovalArgs({ args }: { args: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const text = safeStringify(args);
  const lines = text.split('\n');
  const overlong = lines.length > ARGS_FOLD_LINES;
  const shown = expanded || !overlong ? text : lines.slice(0, ARGS_FOLD_LINES).join('\n');

  return (
    <div className="mt-2">
      <pre
        className={cn(
          'overflow-x-auto rounded-md border border-border/40 bg-background/60 p-2 font-mono text-sm whitespace-pre-wrap break-words text-foreground/80',
          expanded && 'max-h-64 overflow-y-auto',
        )}
      >
        {shown}
      </pre>
      {overlong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 rounded text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {expanded
            ? 'Show less'
            : `Show all ${lines.length} lines (${lines.length - ARGS_FOLD_LINES} hidden)`}
        </button>
      )}
    </div>
  );
}

/** Approval payloads come off the wire; a cycle or a BigInt should not break the panel. */
function safeStringify(value: unknown): string {
  try {
    return (
      JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? String(v) : v), 2) ?? String(value)
    );
  } catch {
    return String(value);
  }
}

// --- Plans ---

const STEP_TONE: Record<PlanStepStatus, string> = {
  pending: 'text-muted-foreground',
  in_progress: 'text-sky-600 dark:text-sky-400',
  completed: 'text-emerald-600 dark:text-emerald-400',
  skipped: 'text-muted-foreground line-through',
  failed: 'text-destructive',
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
                <span className={cn(t.errors > 0 && 'font-medium text-destructive')}>
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
}: {
  open: boolean;
  onToggle: () => void;
  skills: SkillState | null;
  onSuggest: (text: string) => void;
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
        <Button
          size="sm"
          variant="outline"
          className="h-8 w-full"
          onClick={() => onSuggest('List your skills — which are declared and which are active?')}
        >
          Ask agent to list skills
        </Button>
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
