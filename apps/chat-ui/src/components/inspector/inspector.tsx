import { describeGate, formatElapsed, relativeTime } from '@felix/client';
import { promptTokens } from '@felix/protocol';
import { Button } from '@felix/ui/button';
import { ScrollArea } from '@felix/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@felix/ui/tabs';
import { GaugeIcon, ListTodoIcon, XIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { deletePlan, getToolMetrics, listPlans } from '@/api';
import { ConfirmButton } from '@/components/confirm-button';
import {
  PanelModeProvider,
  Section,
  SectionBody,
  SectionBoundary,
} from '@/components/inspector/primitives';
import { usePoll } from '@/hooks/usePoll';
import { callTarget } from '@/lib/call-target';
import { cn } from '@/lib/utils';
import { type ShellValue, useShell } from '@/shell-context';
import type { Plan, Turn } from '@/types';

type SectionId = 'plans' | 'metrics';

/**
 * Right-hand inspector: a readout of **this run**, then the harness's plans and
 * tool metrics.
 *
 * Two scopes, and each has its own heading. The readout is run-scoped: it is
 * derived from the engine the shell already holds, so it costs no request, and
 * "This run" heads it. The tabs are not: `/plans` and `/audit/metrics` take no
 * thread filter, so each lists the whole tenant, under a sub-heading of their
 * own, "Harness · all threads", and the per-tab line is left saying only what
 * the heading does not: the window a tab covers.
 *
 * **There is no Approvals tab.** There was one, and it drew a second live
 * decision card for every approval the attention line was already offering —
 * two Approve buttons and two countdowns, a second apart, for one call. The
 * attention line is the tenant-wide approvals surface: always on screen, polled
 * whether or not anyone is looking, on both addresses. A rail that is closed
 * half the time cannot be that, and a copy of it is a second thing to decide
 * from. The run's own approval is in the readout's state and in the banner.
 *
 * It used to hold eight sections, which is what made it an accordion — six tab
 * destinations did not fit the rail's 22rem. The other five were tenant-durable
 * (activity, usage, memory, corpus, skills): they outlive any one run and answer
 * questions about the harness rather than about what is on screen, so they are
 * `/harness` now. Approvals went to the attention line (above), which leaves the
 * two that belong beside a transcript.
 *
 * Only the visible tab fetches. The count that must be true before anyone looks
 * is the attention line's, which polls on its own.
 */
/**
 * The sections, declared once so the strip and the panel cannot disagree.
 * `window` is what the tab covers beyond "every thread" — the heading already
 * says that — and is absent where the list is simply everything pending.
 */
const SECTIONS = [
  { id: 'plans', label: 'Plans', window: 'Newest 25' },
  { id: 'metrics', label: 'Tools', window: 'Last 60 minutes' },
] as const satisfies readonly { id: SectionId; label: string; window?: string }[];

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
  const [active, setActive] = useState<SectionId>('plans');

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

      <RunReadout />

      {/*
        The tabs' own heading. They are tenant-wide — no route here takes a thread
        filter — so they must not sit under "This run" as though they were its
        detail. Title size, not headline: this is a section of the rail, and the
        rail's one headline is the run above it.
      */}
      <section aria-labelledby="inspector-harness-heading" className="flex min-h-0 flex-1 flex-col">
        <h3
          id="inspector-harness-heading"
          className="flex shrink-0 items-baseline gap-1.5 px-3 pt-2.5 text-sm font-semibold"
        >
          Harness
          <span className="text-xs font-normal text-muted-foreground">· all threads</span>
        </h3>
        {/*
        Tabs, not a stacked accordion. Two sections fit a 22rem strip where the
        original eight did not, and one on screen is one poll rather than one per
        expanded section.

        The strip carries no counts. Showing them would mean every section
        fetching to populate a label nobody is reading, which is the cost tabs
        exist to avoid — and the count that actually matters is already in the
        attention line, always, tenant-wide.

        `@felix/ui/tabs` rather than hand-rolled roles. A `role="tablist"` with
        `aria-selected` and no `tabpanel`, no `aria-controls` and no arrow-key
        roving focus announces a widget and then does not behave like one, which
        is worse than plain buttons. The primitive owns that contract.
      */}
        <Tabs
          value={active}
          onValueChange={(v) => setActive(v as SectionId)}
          className="min-h-0 flex-1 gap-0"
        >
          <TabsList className="mx-2 mt-1.5 w-auto shrink-0">
            {SECTIONS.map(({ id, label }) => (
              <TabsTrigger key={id} value={id} className="text-xs">
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
          {SECTIONS.map((section) => (
            <TabsContent key={section.id} value={section.id} className="min-h-0">
              <ScrollArea className="h-full">
                <div className="p-3">
                  {/* The heading above says "all threads"; this says the window,
                    where there is one. */}
                  {'window' in section && (
                    <p className="mb-2 text-xs text-muted-foreground">{section.window}</p>
                  )}
                  {/*
                  `bare` chrome: the tab is the heading, so the section draws none
                  of its own.

                  `enabled` is simply whether the rail is open, because an
                  inactive `TabsContent` renders its element for the ARIA
                  association but **not its children** — measured: inactive panels
                  hold zero child nodes, and nine seconds on Plans issued three
                  `/plans` requests and none to the tool metrics. That is the
                  one-section-one-poll economy tabs were chosen for, and
                  `forceMount` would silently undo it by mounting both.
                */}
                  <PanelModeProvider chrome="bare">
                    <SectionBoundary title={section.label}>
                      {section.id === 'plans' && (
                        <PlansSection enabled={open} open onToggle={() => {}} />
                      )}
                      {section.id === 'metrics' && (
                        <MetricsSection enabled={open} open onToggle={() => {}} />
                      )}
                    </SectionBoundary>
                  </PanelModeProvider>
                </div>
              </ScrollArea>
            </TabsContent>
          ))}
        </Tabs>
      </section>
    </aside>
  );
}

// --- Run readout ---

type RunState = 'blocked' | 'running' | 'rejoining' | 'failed' | 'idle';

/**
 * The ramp colour and the word for each state. The word always renders — a dot
 * is the fast channel, never the only one.
 *
 * `rejoining` is blue but says something different from `running`: the stream
 * dropped and the run was torn down on purpose, so what arrives now is what
 * landed, not a reply still being written. `idle` spends no colour: resting is not
 * a state the ramp has a hue for, and green would claim the last run succeeded,
 * which an abort does not.
 */
const RUN_STATE: Record<RunState, { word: string; dot: string; text: string }> = {
  blocked: { word: 'Waiting on you', dot: 'bg-state-blocked', text: 'text-state-blocked' },
  running: { word: 'Running', dot: 'bg-state-running', text: 'text-state-running' },
  rejoining: { word: 'Rejoining thread', dot: 'bg-state-running', text: 'text-state-running' },
  failed: { word: 'Failed', dot: 'bg-state-failed', text: 'text-state-failed' },
  idle: { word: 'Idle', dot: 'bg-muted-foreground/50', text: 'text-foreground' },
};

/**
 * What the run is doing, in precedence order. Blocked outranks running because a
 * run waiting on a person is the one thing on this rail that will not resolve by
 * itself; failed is only ever a resting state, because `send` clears the error.
 */
export function runState(
  shell: Pick<ShellValue, 'pending' | 'uiPrompt' | 'streaming' | 'reattaching' | 'error'>,
): RunState {
  if (shell.pending || shell.uiPrompt) return 'blocked';
  if (shell.reattaching) return 'rejoining';
  if (shell.streaming) return 'running';
  if (shell.error) return 'failed';
  return 'idle';
}

/**
 * Tokens reported on this thread's assistant turns, and whether that is a floor.
 *
 * `usage` arrives on a streamed turn's terminal `done`, and on a turn
 * rebuilt from the session snapshot when the harness stored it — which it does
 * only for a single-step answer (see `storedUsage` in `@felix/client`). A turn
 * that ran tools, or was written by a durable run, may carry none — so a thread
 * holding any such turn has spent more than this adds up to, and the readout says
 * `floor` the way the Ledger says `Cost (floor)` rather than presenting a partial
 * sum as the total. There is no cost here at all: the frame carries tokens and
 * nothing priced, and the Ledger is where spend is read.
 */
export function threadTokens(turns: Turn[]): {
  input: number;
  output: number;
  reported: number;
  /** Assistant turns with content and no usage — what makes a sum a floor. */
  missing: number;
  floor: boolean;
} {
  let input = 0;
  let output = 0;
  let reported = 0;
  let missing = 0;
  for (const t of turns) {
    if (t.role !== 'assistant') continue;
    if (t.usage) {
      // The whole prompt; `input` alone leaves out whatever the cache served.
      input += promptTokens(t.usage);
      output += t.usage.output;
      reported += 1;
    } else if (t.content || t.tools?.length) {
      missing += 1;
    }
  }
  return { input, output, reported, missing, floor: reported > 0 && missing > 0 };
}

function lastAssistant(turns: Turn[]): Turn | undefined {
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn?.role === 'assistant') return turn;
  }
  return undefined;
}

/**
 * The call still open on the newest assistant turn — the one the run is inside
 * right now — as its name plus what it acts on (`callTarget`).
 */
export function inFlightTool(turns: Turn[]): { name: string; target: string | null } | null {
  const open = lastAssistant(turns)
    ?.tools?.filter((t) => !t.done)
    .at(-1);
  if (!open) return null;
  const args =
    open.input && typeof open.input === 'object' ? (open.input as Record<string, unknown>) : {};
  return { name: open.name, target: callTarget(open.name, args) };
}

const nf = new Intl.NumberFormat();

/**
 * The run on screen, at a glance, above anything that fetches.
 *
 * Everything here is derived from the shell — the engine's state and the tab's
 * own run clock — so it costs no request and is true the moment the rail opens.
 * It always renders, including at rest: a readout that appears only while
 * something is happening teaches the operator not to look at it, which is the
 * attention line's rule applied to the rail.
 *
 * Deliberately absent: a step counter. The client learns `recursion_limit` only
 * from the `max_turns` frame that reports it was hit, so a live "step n of m"
 * would need a number nothing sends. When it *was* hit, that is shown.
 */
function RunReadout() {
  const shell = useShell();
  const { turns, runClock, pending, uiPrompt, error, sessionPhase, threads, threadId } = shell;
  const state = runState(shell);
  const tone = RUN_STATE[state];
  const live = runClock.startedAt !== null && runClock.endedAt === null;

  // One re-render a second while a run is live, and none at rest. Scoped to this
  // component, so the tabs below do not repaint with it.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [live]);

  const elapsed =
    runClock.startedAt === null ? null : (runClock.endedAt ?? now) - runClock.startedAt;
  const tokens = threadTokens(turns);
  const tool = inFlightTool(turns);
  const last = lastAssistant(turns);
  const stopped = !live && last?.stop?.reason === 'max_turns' ? last.stop : null;
  /**
   * What the thread says about its last run when this tab never saw one.
   *
   * The stopwatch is this tab's own measurement, so a thread opened from history
   * has none — and "No run in this tab yet" above thirty completed turns was true
   * and useless. The index row's `updatedAt` is when the harness last recorded
   * anything on the thread (or, for a thread only this browser knows, when it
   * last sent), so it is the one time the client can honestly quote. A duration
   * is not derivable: the snapshot carries no start or end for a run.
   */
  const updatedAt = threads.find((t) => t.id === threadId)?.updatedAt;
  const hasHistory = last !== undefined;

  return (
    <section
      aria-label="Run status"
      className="shrink-0 border-b border-border/60 px-3 py-2.5 text-xs"
    >
      <div className="flex items-center gap-2">
        <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', tone.dot)} />
        {/* The word alone is the live region: the stopwatch beside it changes every
            second and would be read out every second. */}
        <p role="status" aria-live="polite" className={cn('text-sm font-medium', tone.text)}>
          {tone.word}
        </p>
        {sessionPhase && sessionPhase !== 'turn' && (
          <span className="font-mono text-muted-foreground" title="Session phase">
            {sessionPhase}
          </span>
        )}
        <span className="ml-auto shrink-0 text-muted-foreground">
          {elapsed === null ? (
            !hasHistory ? (
              'No runs on this thread yet'
            ) : updatedAt ? (
              <>
                last activity{' '}
                <span className="font-mono tabular-nums text-foreground">
                  {relativeTime(updatedAt)}
                </span>
              </>
            ) : (
              'Not run from this tab'
            )
          ) : (
            <>
              {live ? 'for ' : 'last run '}
              <span className="font-mono tabular-nums text-foreground">
                {formatElapsed(elapsed)}
              </span>
            </>
          )}
        </span>
      </div>

      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        {state === 'blocked' && (
          <>
            <dt className="text-muted-foreground">Asking</dt>
            <dd className="min-w-0 truncate">
              {pending
                ? describeGate(pending.toolName, pending.args)
                : (uiPrompt?.prompt ?? 'A question from the agent')}
            </dd>
          </>
        )}
        {tool && (
          <>
            <dt className="text-muted-foreground">Tool</dt>
            <dd className="flex min-w-0 gap-1.5">
              <span className="shrink-0 font-mono">{tool.name}</span>
              {tool.target && (
                <span
                  className="min-w-0 truncate font-mono text-muted-foreground"
                  title={tool.target}
                >
                  {tool.target}
                </span>
              )}
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">
          Tokens
          {tokens.floor && (
            <span title="Some turns on this thread reported no usage, so the true total is higher">
              {' '}
              (floor)
            </span>
          )}
        </dt>
        <dd className="min-w-0">
          {tokens.reported === 0 ? (
            // Two different truths: nothing has run, or things ran and the harness
            // stored no usage for any of them (every one called tools, or a
            // durable run wrote them). The second must not read as the first.
            <span className="text-muted-foreground">
              {tokens.missing === 0
                ? 'None yet'
                : `Not recorded for ${tokens.missing === 1 ? 'the turn' : `the ${tokens.missing} turns`} here`}
            </span>
          ) : (
            <>
              <span className="font-mono tabular-nums">{nf.format(tokens.input)}</span>{' '}
              <span className="text-muted-foreground">in ·</span>{' '}
              <span className="font-mono tabular-nums">{nf.format(tokens.output)}</span>{' '}
              <span className="text-muted-foreground">out, this thread</span>
            </>
          )}
        </dd>
        {stopped && (
          <>
            <dt className="text-muted-foreground">Stopped</dt>
            <dd className="min-w-0">
              Hit the step limit
              {stopped.limit !== undefined && (
                <>
                  {' '}
                  (<span className="font-mono tabular-nums">{stopped.limit}</span>)
                </>
              )}
              ; the answer is cut short
            </dd>
          </>
        )}
        {state === 'failed' && error && (
          <>
            <dt className="text-muted-foreground">Error</dt>
            <dd className="line-clamp-2 min-w-0 break-words font-mono text-state-failed">
              {error}
            </dd>
          </>
        )}
      </dl>
    </section>
  );
}

// --- section shell ---

// --- Activity ---

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
        // Plans are written only by the `deep` pattern's plan tools, so an empty
        // list usually means no manifest in use runs that pattern. Named by
        // pattern rather than by manifest, because a manifest called `deep` is a
        // deployment's choice and may not exist here.
        emptyText="No plans. They are written by manifests that run the deep pattern."
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
        // Tenant-wide over a window, so a thread that visibly ran tools yesterday
        // is not a contradiction of an empty list — the copy has to say why.
        emptyText="No tool calls on any thread in the last 60 minutes."
        status={
          data ? `${tools.length} tools called on all threads in the last 60 minutes` : undefined
        }
      >
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
