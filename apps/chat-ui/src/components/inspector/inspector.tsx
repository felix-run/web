import { Button } from '@felix/ui/button';
import { ScrollArea } from '@felix/ui/scroll-area';
import { ClipboardListIcon, GaugeIcon, ListTodoIcon, XIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { decideApproval, deletePlan, getToolMetrics, listApprovals, listPlans } from '@/api';
import { ApprovalDecision } from '@/components/approval/approval-decision';
import { ConfirmButton } from '@/components/confirm-button';
import {
  PanelModeProvider,
  Section,
  SectionBody,
  SectionBoundary,
} from '@/components/inspector/primitives';
import { usePoll } from '@/hooks/usePoll';
import { cn } from '@/lib/utils';
import type { Plan } from '@/types';

type SectionId = 'approvals' | 'plans' | 'metrics';

/**
 * Right-hand inspector, scoped to **this run**: approvals, plans, tool metrics.
 *
 * It used to hold eight sections, which is what made it an accordion — six tab
 * destinations did not fit the rail's 22rem. The other five were tenant-durable
 * (activity, usage, memory, corpus, skills): they outlive any one run and answer
 * questions about the harness rather than about what is on screen, so they are
 * `/harness` now and this is the three that actually belong beside a transcript.
 *
 * Each section fetches only while it is expanded, so the panel costs one poll per
 * open section rather than three. Approvals is the exception and always polls while
 * the inspector is open: it is the channel a paused run is waiting on, so its count
 * has to be true before anyone thinks to look at it.
 */
/** The three sections, declared once so the strip and the panel cannot disagree. */
const SECTIONS = [
  { id: 'approvals', label: 'Approvals' },
  { id: 'plans', label: 'Plans' },
  { id: 'metrics', label: 'Tools' },
] as const satisfies readonly { id: SectionId; label: string }[];

export function Inspector({
  open,
  onClose,
  className,
}: {
  open: boolean;
  onClose: () => void;
  /** Set by the shell when this renders inside a drawer instead of as a column. */
  className?: string;
}) {
  const [active, setActive] = useState<SectionId>('approvals');

  return (
    <aside
      aria-labelledby="inspector-heading"
      className={cn(
        // The panel is the thing worth widening on a large display, not the
        // transcript. Floor is the old fixed 22rem.
        'flex h-full w-[clamp(22rem,24vw,30rem)] shrink-0 flex-col border-l border-border/60 bg-card/40',
        className,
      )}
    >
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3">
        <h2 id="inspector-heading" className="text-base font-semibold">
          This run
        </h2>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close inspector">
          <XIcon className="size-4" />
        </Button>
      </div>

      {/*
        Tabs, not a stacked accordion. Three sections fit a 22rem strip where the
        original eight did not, and one on screen is one poll rather than one per
        expanded section.

        The strip carries no counts. Showing them would mean every section
        fetching to populate a label nobody is reading, which is the cost tabs
        exist to avoid — and the count that actually matters is already in the
        attention line, always, tenant-wide.
      */}
      <div
        role="tablist"
        aria-label="Run instrument"
        className="flex shrink-0 gap-1 border-b border-border/60 px-2 py-1.5"
      >
        {SECTIONS.map(({ id, label }) => (
          <Button
            key={id}
            role="tab"
            aria-selected={active === id}
            variant={active === id ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 flex-1 px-2 text-xs"
            onClick={() => setActive(id)}
          >
            {label}
          </Button>
        ))}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-3">
          {/*
            `bare` chrome: the strip above is the heading, so the section draws
            none of its own. Each is mounted only while it is the active tab, so
            `enabled` is simply whether the rail is open.
          */}
          <PanelModeProvider chrome="bare">
            {active === 'approvals' && (
              <SectionBoundary title="Approvals">
                <ApprovalsSection enabled={open} open onToggle={() => {}} onPending={() => {}} />
              </SectionBoundary>
            )}
            {active === 'plans' && (
              <SectionBoundary title="Plans">
                <PlansSection enabled={open} open onToggle={() => {}} />
              </SectionBoundary>
            )}
            {active === 'metrics' && (
              <SectionBoundary title="Tools">
                <MetricsSection enabled={open} open onToggle={() => {}} />
              </SectionBoundary>
            )}
          </PanelModeProvider>
        </div>
      </ScrollArea>
    </aside>
  );
}

// --- section shell ---

// --- Activity ---

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

// --- Skills ---
