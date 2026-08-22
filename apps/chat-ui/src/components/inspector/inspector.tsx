import { Badge } from '@felix/ui/badge';
import { Button } from '@felix/ui/button';
import { ScrollArea } from '@felix/ui/scroll-area';
import { Skeleton } from '@felix/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@felix/ui/tabs';
import {
  ActivityIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  ClipboardListIcon,
  CoinsIcon,
  GaugeIcon,
  ListTodoIcon,
  SparklesIcon,
  XIcon,
} from 'lucide-react';
import {
  decideApproval,
  getToolMetrics,
  listApprovals,
  listAudit,
  listPlans,
  listUsage,
} from '@/api';
import { usePoll } from '@/hooks/usePoll';
import { cn } from '@/lib/utils';
import type { AuditEvent, Plan, PlanStepStatus, ToolMetricsRow, UsageEvent } from '@/types';

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

const EVENT_TONE: Record<string, string> = {
  tool_call: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  judge_score: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  guardrail_block: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  approval_request: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  approval_decision: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  plan_step: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300',
  model_switch: 'bg-pink-500/15 text-pink-700 dark:text-pink-300',
};

/**
 * Right-hand harness inspector: activity, tool metrics, approvals, plans, skills.
 * Polls only while open.
 */
export function Inspector({
  open,
  onClose,
  skills,
  onSuggest,
}: {
  open: boolean;
  onClose: () => void;
  skills: SkillState | null;
  onSuggest: (text: string) => void;
}) {
  return (
    <aside className="flex h-full w-[22rem] shrink-0 flex-col border-l border-border/60 bg-card/40">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium tracking-tight">Inspector</div>
          <div className="truncate text-[11px] text-muted-foreground">Live harness activity</div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7 shrink-0"
          onClick={onClose}
          aria-label="Close inspector"
        >
          <XIcon className="size-4" />
        </Button>
      </div>

      <Tabs defaultValue="activity" className="flex min-h-0 flex-1 flex-col gap-0">
        <TabsList
          variant="line"
          className="h-auto w-full shrink-0 justify-start gap-0 overflow-x-auto border-b border-border/60 px-1"
        >
          <InspectorTab value="activity" icon={<ActivityIcon className="size-3" />}>
            Activity
          </InspectorTab>
          <InspectorTab value="metrics" icon={<GaugeIcon className="size-3" />}>
            Tools
          </InspectorTab>
          <InspectorTab value="usage" icon={<CoinsIcon className="size-3" />}>
            Usage
          </InspectorTab>
          <InspectorTab value="approvals" icon={<ClipboardListIcon className="size-3" />}>
            Approvals
          </InspectorTab>
          <InspectorTab value="plans" icon={<ListTodoIcon className="size-3" />}>
            Plans
          </InspectorTab>
          <InspectorTab value="skills" icon={<SparklesIcon className="size-3" />}>
            Skills
          </InspectorTab>
        </TabsList>

        <TabsContent value="activity" className="mt-0 min-h-0 flex-1 outline-none">
          <ActivityTab enabled={open} />
        </TabsContent>
        <TabsContent value="metrics" className="mt-0 min-h-0 flex-1 outline-none">
          <MetricsTab enabled={open} />
        </TabsContent>
        <TabsContent value="usage" className="mt-0 min-h-0 flex-1 outline-none">
          <UsageTab enabled={open} />
        </TabsContent>
        <TabsContent value="approvals" className="mt-0 min-h-0 flex-1 outline-none">
          <ApprovalsTab enabled={open} />
        </TabsContent>
        <TabsContent value="plans" className="mt-0 min-h-0 flex-1 outline-none">
          <PlansTab enabled={open} />
        </TabsContent>
        <TabsContent value="skills" className="mt-0 min-h-0 flex-1 outline-none">
          <SkillsTab skills={skills} onSuggest={onSuggest} />
        </TabsContent>
      </Tabs>
    </aside>
  );
}

function InspectorTab({
  value,
  children,
  icon,
}: {
  value: string;
  children: React.ReactNode;
  icon: React.ReactNode;
}) {
  return (
    <TabsTrigger
      value={value}
      className="flex-none gap-1 px-2.5 py-2.5 text-[11px] data-[state=active]:text-foreground"
    >
      <span className="opacity-70">{icon}</span>
      {children}
    </TabsTrigger>
  );
}

// --- Activity ---

function ActivityTab({ enabled }: { enabled: boolean }) {
  const { data, error, loading } = usePoll(() => listAudit({ limit: 60 }), { enabled });
  return (
    <PanelBody
      loading={loading && !data}
      error={error}
      empty={data?.length === 0}
      emptyIcon={<ActivityIcon className="size-5" />}
      emptyTitle="No activity yet"
      emptyText="Tool calls, approvals, and plan steps from chat will show up here."
    >
      <div className="space-y-1.5">
        {data?.map((e) => (
          <article
            key={e.id}
            className="rounded-xl border border-border/50 bg-background/80 px-2.5 py-2 text-xs"
          >
            <div className="flex items-start gap-2">
              <Badge
                variant="secondary"
                className={cn(
                  'shrink-0 py-0 font-sans text-[10px] font-medium',
                  EVENT_TONE[e.event_type],
                )}
              >
                {EVENT_LABEL[e.event_type] ?? e.event_type}
              </Badge>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-foreground">{toolOf(e)}</div>
                {summary(e) && (
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                    {summary(e)}
                  </p>
                )}
              </div>
              <div className="shrink-0 text-right">
                <StatusDot status={e.status} />
                {e.ts != null && (
                  <div className="mt-0.5 text-[10px] text-muted-foreground">{relTime(e.ts)}</div>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
    </PanelBody>
  );
}

function StatusDot({ status }: { status: string }) {
  const ok = status === 'ok' || status === 'success' || status === 'completed';
  const bad = status === 'error' || status === 'failed' || status === 'denied';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[10px] capitalize',
        ok && 'text-emerald-600 dark:text-emerald-400',
        bad && 'text-destructive',
        !ok && !bad && 'text-muted-foreground',
      )}
    >
      <span
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

// --- Metrics ---

const HOUR_MS = 60 * 60 * 1000;

function MetricsTab({ enabled }: { enabled: boolean }) {
  const { data, error, loading } = usePoll(() => getToolMetrics({ sinceMs: HOUR_MS }), { enabled });
  const tools = data ? foldByTool(data.rows) : [];
  const maxCount = Math.max(1, ...tools.map((t) => t.count));

  return (
    <PanelBody
      loading={loading && !data}
      error={error}
      empty={tools.length === 0}
      emptyIcon={<GaugeIcon className="size-5" />}
      emptyTitle="No tool calls yet"
      emptyText="Ask the agent to use a tool. Rollups cover the last hour."
    >
      <div className="mb-3 text-[11px] text-muted-foreground">Last 60 minutes</div>
      <div className="space-y-2">
        {tools.map((t) => (
          <article
            key={t.tool}
            className="rounded-xl border border-border/50 bg-background/80 px-2.5 py-2 text-xs"
          >
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-medium">
                {t.tool}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                {t.count}×
              </span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-foreground/70 transition-[width] duration-300"
                style={{ width: `${Math.max(8, (t.count / maxCount) * 100)}%` }}
              />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
              <span className="capitalize">{t.transport}</span>
              <span className={cn(t.errors > 0 && 'text-destructive')}>
                {t.errors > 0 ? `${t.errors} error${t.errors === 1 ? '' : 's'}` : 'healthy'}
              </span>
              {t.avgMs != null && <span>~{Math.round(t.avgMs)}ms</span>}
            </div>
          </article>
        ))}
      </div>
    </PanelBody>
  );
}

interface ToolSummary {
  tool: string;
  transport: string;
  count: number;
  errors: number;
  avgMs: number | null;
}

function foldByTool(rows: ToolMetricsRow[]): ToolSummary[] {
  const by = new Map<string, ToolSummary>();
  for (const r of rows) {
    const cur =
      by.get(r.tool) ??
      ({ tool: r.tool, transport: r.transport, count: 0, errors: 0, avgMs: null } as ToolSummary);
    cur.count += r.count;
    if (r.status === 'error') cur.errors += r.count;
    if (r.avg_duration_ms != null) cur.avgMs = Math.max(cur.avgMs ?? 0, r.avg_duration_ms);
    by.set(r.tool, cur);
  }
  return [...by.values()].sort((a, b) => b.count - a.count);
}

// --- Usage ---

function UsageTab({ enabled }: { enabled: boolean }) {
  const { data, error, loading } = usePoll(
    async () => {
      const page = await listUsage({ limit: 40 });
      return page.items;
    },
    { enabled },
  );
  const totals = summarizeUsage(data ?? []);

  return (
    <PanelBody
      loading={loading && !data}
      error={error}
      empty={data?.length === 0}
      emptyIcon={<CoinsIcon className="size-5" />}
      emptyTitle="No usage yet"
      emptyText="Token meters appear here after model turns flush to the usage store."
    >
      <div className="mb-3 grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-lg border border-border/50 bg-background/80 px-2.5 py-2">
          <div className="text-muted-foreground">Input</div>
          <div className="mt-0.5 font-mono text-sm font-medium">{totals.in.toLocaleString()}</div>
        </div>
        <div className="rounded-lg border border-border/50 bg-background/80 px-2.5 py-2">
          <div className="text-muted-foreground">Output</div>
          <div className="mt-0.5 font-mono text-sm font-medium">{totals.out.toLocaleString()}</div>
        </div>
      </div>
      <div className="space-y-1.5">
        {data?.map((e) => (
          <article
            key={e.id}
            className="rounded-xl border border-border/50 bg-background/80 px-2.5 py-2 text-xs"
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">
                  {e.manifest_id || '—'}
                  {e.model_id ? (
                    <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                      {e.model_id}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                  {(e.tokens_input ?? 0).toLocaleString()} in ·{' '}
                  {(e.tokens_output ?? 0).toLocaleString()} out
                  {(e.cache_read ?? 0) > 0 ? ` · ${e.cache_read.toLocaleString()} cache` : ''}
                </p>
              </div>
              {e.ts != null && (
                <div className="shrink-0 text-[10px] text-muted-foreground">{relTime(e.ts)}</div>
              )}
            </div>
          </article>
        ))}
      </div>
    </PanelBody>
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

// --- Approvals ---

function ApprovalsTab({ enabled }: { enabled: boolean }) {
  const { data, error, loading, refresh } = usePoll(() => listApprovals('pending'), { enabled });

  async function decide(id: string, status: 'approved' | 'denied') {
    await decideApproval(id, { status });
    refresh();
  }

  return (
    <PanelBody
      loading={loading && !data}
      error={error}
      empty={data?.length === 0}
      emptyIcon={<ClipboardListIcon className="size-5" />}
      emptyTitle="No pending approvals"
      emptyText="Gated tool calls wait here until you approve or deny them."
    >
      <div className="space-y-2.5">
        {data?.map((a) => (
          <article
            key={a.id}
            className="rounded-xl border border-border/50 bg-background/80 p-3 text-xs"
          >
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="py-0 font-mono text-[10px]">
                {a.tool_name}
              </Badge>
              <span className="truncate text-muted-foreground">{a.manifest_id}</span>
            </div>
            <pre className="mt-2 max-h-32 overflow-auto rounded-lg border border-border/40 bg-muted/40 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
              {JSON.stringify(a.args, null, 2)}
            </pre>
            <div className="mt-2.5 flex gap-2">
              <Button size="sm" className="h-8 flex-1" onClick={() => decide(a.id, 'approved')}>
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 flex-1"
                onClick={() => decide(a.id, 'denied')}
              >
                Deny
              </Button>
            </div>
            <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
              Deciding resumes the paused run — no need to re-send.
            </p>
          </article>
        ))}
      </div>
    </PanelBody>
  );
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

function PlansTab({ enabled }: { enabled: boolean }) {
  const { data, error, loading } = usePoll(() => listPlans(), { enabled });
  return (
    <PanelBody
      loading={loading && !data}
      error={error}
      empty={data?.length === 0}
      emptyIcon={<ListTodoIcon className="size-5" />}
      emptyTitle="No plans yet"
      emptyText="Switch to the deep agent and ask a multi-step question."
    >
      <div className="space-y-3">
        {data?.map((p: Plan) => {
          const done = p.steps.filter((s) => s.status === 'completed').length;
          return (
            <article
              key={p.id}
              className="rounded-xl border border-border/50 bg-background/80 p-3 text-xs"
            >
              <div className="mb-1 flex items-start justify-between gap-2">
                <div className="font-medium leading-snug">{p.title}</div>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {done}/{p.steps.length}
                </span>
              </div>
              <ol className="mt-2 space-y-1.5">
                {p.steps.map((s) => (
                  <li key={s.id} className={cn('flex gap-2 text-[11px]', STEP_TONE[s.status])}>
                    <span className="w-3 shrink-0 font-mono" aria-hidden>
                      {STEP_MARK[s.status]}
                    </span>
                    <span className="flex-1 leading-snug">{s.description}</span>
                  </li>
                ))}
              </ol>
            </article>
          );
        })}
      </div>
    </PanelBody>
  );
}

// --- Skills ---

function SkillsTab({
  skills,
  onSuggest,
}: {
  skills: SkillState | null;
  onSuggest: (text: string) => void;
}) {
  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-3 text-xs">
        <EmptyState
          icon={<SparklesIcon className="size-5" />}
          title="Session skills"
          text="Skills activate through list_skills / activate_skill tools during chat. Capture updates as the agent runs them."
          compact
        />
        <Button
          size="sm"
          variant="outline"
          className="h-8 w-full"
          onClick={() => onSuggest('List your skills — which are declared and which are active?')}
        >
          Ask agent to list skills
        </Button>
        {skills ? (
          <div className="space-y-3">
            <SkillList label="Active" names={skills.active} kind="active" />
            <SkillList
              label="Declared"
              names={skills.declared}
              kind="declared"
              active={skills.active}
            />
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            No <code className="rounded bg-muted px-1 py-0.5">list_skills</code> result in this
            session yet.
          </p>
        )}
      </div>
    </ScrollArea>
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
  if (!names.length) {
    return (
      <div>
        <div className="mb-1.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </div>
        <p className="text-[11px] text-muted-foreground">None</p>
      </div>
    );
  }
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {names.map((n) => {
          const isActive = kind === 'active' || active.includes(n);
          return (
            <Badge
              key={n}
              variant={isActive && kind === 'active' ? 'default' : 'secondary'}
              className="gap-1 font-mono text-[10px]"
            >
              {kind === 'active' && <CheckCircle2Icon className="size-3" />}
              {n}
            </Badge>
          );
        })}
      </div>
    </div>
  );
}

// --- shared ---

function EmptyState({
  icon,
  title,
  text,
  compact,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center text-center',
        compact ? 'gap-1.5' : 'gap-2 px-2 py-10',
      )}
    >
      <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="max-w-[16rem] text-[11px] leading-relaxed text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}

function PanelBody({
  loading,
  error,
  empty,
  emptyIcon,
  emptyTitle,
  emptyText,
  children,
}: {
  loading: boolean;
  error: string | null;
  empty?: boolean;
  emptyIcon: React.ReactNode;
  emptyTitle: string;
  emptyText: string;
  children: React.ReactNode;
}) {
  return (
    <ScrollArea className="h-full">
      <div className="p-3">
        {error && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
            <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {loading && (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-full rounded-xl" />
          </div>
        )}
        {!loading && empty && <EmptyState icon={emptyIcon} title={emptyTitle} text={emptyText} />}
        {!loading && !empty && children}
      </div>
    </ScrollArea>
  );
}
