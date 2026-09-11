import { Badge } from '@felix/ui/badge';
import { Button } from '@felix/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@felix/ui/collapsible';
import { Input } from '@felix/ui/input';
import { Label } from '@felix/ui/label';
import { ScrollArea } from '@felix/ui/scroll-area';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@felix/ui/sheet';
import { Textarea } from '@felix/ui/textarea';
import { ChevronRightIcon, FlaskConicalIcon, PlayIcon, PlusIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  addEvalItem,
  compareEvalRuns,
  listEvalDatasets,
  listEvalItems,
  listEvalRuns,
  putEvalDataset,
  runEvalDataset,
} from '@/api';
import { ErrorNotice } from '@/components/error-notice';
import { cn } from '@/lib/utils';
import type { EvalComparison, EvalDataset, EvalDatasetItem, EvalRun } from '@/types';

/**
 * Eval workbench — the `/eval` offline-benchmark surface as a slide-over.
 * Create a golden dataset, append items with a (simplified) rubric, replay the
 * dataset against the currently-selected manifest, and read back per-item
 * pass/fail scores. Tenant-scoped.
 *
 * The harness writes datasets whole — there is no per-item route — so appending
 * an item is a read-modify-write of the whole dataset.
 */
export function EvalSheet({
  open,
  onOpenChange,
  manifest,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  manifest: string;
}) {
  const [datasets, setDatasets] = useState<EvalDataset[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  // Error and verb travel together: one hardcoded phrase meant a failed eval *run*
  // reported itself as a failure to reach the harness.
  const [failure, setFailure] = useState<{ err: unknown; doing: string } | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const refreshDatasets = useCallback(async () => {
    try {
      const ds = await listEvalDatasets();
      setDatasets(ds);
      setFailure(null);
      setSelected((cur) => cur ?? ds[0]?.name ?? null);
    } catch (err) {
      setFailure({ err, doing: 'list eval datasets' });
    }
  }, []);

  useEffect(() => {
    if (open) void refreshDatasets();
  }, [open, refreshDatasets]);

  async function create() {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setFailure(null);
    try {
      await putEvalDataset(name);
      setNewName('');
      await refreshDatasets();
      setSelected(name);
    } catch (err) {
      setFailure({ err, doing: `create the dataset ${name}` });
    } finally {
      setCreating(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2">
            <FlaskConicalIcon className="size-4" /> Eval harness
          </SheetTitle>
          <SheetDescription>
            Golden datasets replayed against a manifest and judged per item. Runs against the active{' '}
            <span className="font-mono">{manifest}</span> agent.
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
          {failure && <ErrorNotice error={failure.err} doing={failure.doing} />}

          {/* Dataset picker + create */}
          {/*
            Capped and scrollable. It wrapped without a height, so twenty of
            these pushed the panel they select *for* off the bottom of the sheet
            — the control growing until the thing it controls is unreachable.
            Read from the code rather than measured: the local harness has one.
          */}
          <div className="flex max-h-24 flex-wrap items-center gap-1.5 overflow-y-auto">
            {datasets.map((d) => (
              <Button
                key={d.name}
                size="sm"
                variant={selected === d.name ? 'secondary' : 'ghost'}
                className="font-mono text-sm"
                aria-pressed={selected === d.name}
                onClick={() => setSelected(d.name)}
              >
                {d.name}
              </Button>
            ))}
            {datasets.length === 0 && (
              <span className="text-sm text-muted-foreground">
                No datasets yet. Create one below.
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Input
              aria-label="New dataset name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="new-dataset-name"
              className="h-8 font-mono text-sm"
              onKeyDown={(e) => e.key === 'Enter' && create()}
            />
            <Button
              size="sm"
              className="gap-1"
              disabled={creating || !newName.trim()}
              onClick={create}
            >
              <PlusIcon className="size-3.5" /> New
            </Button>
          </div>

          {selected ? (
            <DatasetPanel
              key={selected}
              dataset={selected}
              manifest={manifest}
              onError={(err, doing) => setFailure({ err, doing })}
            />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DatasetPanel({
  dataset,
  manifest,
  onError,
}: {
  dataset: string;
  manifest: string;
  onError: (err: unknown, doing: string) => void;
}) {
  const [items, setItems] = useState<EvalDatasetItem[]>([]);
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [running, setRunning] = useState(false);
  const [comparing, setComparing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [its, rns] = await Promise.all([listEvalItems(dataset), listEvalRuns(dataset)]);
      setItems(its);
      setRuns(rns);
    } catch (err) {
      onError(err, `load the dataset ${dataset}`);
    }
  }, [dataset, onError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run() {
    setRunning(true);
    try {
      await runEvalDataset(dataset, manifest);
      await refresh();
    } catch (err) {
      onError(err, `run ${dataset} against ${manifest}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {items.length} item{items.length === 1 ? '' : 's'}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          disabled={items.length === 0}
          onClick={() => setComparing((c) => !c)}
        >
          {comparing ? 'Hide compare' : 'Compare…'}
        </Button>
        <Button
          size="sm"
          className="gap-1"
          disabled={running || items.length === 0}
          onClick={run}
          title={items.length === 0 ? undefined : `Replay against ${manifest}`}
        >
          <PlayIcon className="size-3.5" />
          {running ? 'Running…' : `Run vs ${manifest}`}
        </Button>
      </div>
      {/*
        Inline, not a `title`. The reason this button is unavailable used to live
        in a tooltip on the button itself — and a `title` fires on hover, which
        disabled elements do not emit. So the one message that said how to
        proceed existed only in the state where nothing could read it.
      */}
      {items.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Add an item before running: a dataset with nothing in it has nothing to score.
        </p>
      )}

      {comparing && (
        <ComparePanel dataset={dataset} manifest={manifest} onDone={refresh} onError={onError} />
      )}

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 pr-3">
          <AddItemForm dataset={dataset} onAdded={refresh} onError={onError} />

          {items.length > 0 && (
            <section className="space-y-1.5">
              <Heading>Items</Heading>
              {items.map((it) => (
                <div key={it.item_id} className="rounded-md border bg-background p-2 text-sm">
                  <div className="font-medium">{it.user_input}</div>
                  {it.rubric.criteria && (
                    <div className="mt-1 text-muted-foreground">criteria: {it.rubric.criteria}</div>
                  )}
                  {!!it.rubric.must_include?.length && (
                    <div className="mt-0.5 text-muted-foreground">
                      must include: {it.rubric.must_include.join(', ')}
                    </div>
                  )}
                </div>
              ))}
            </section>
          )}

          {runs.length > 0 && (
            <section className="space-y-2">
              <Heading>Runs</Heading>
              {runs.map((r) => (
                <RunCard key={r.id} run={r} />
              ))}
            </section>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

/**
 * Baseline against candidates, on one dataset.
 *
 * `Run vs {manifest}` answers "does this pass". The question anyone editing a
 * manifest actually has is "is the new one better", and that needs the same
 * items replayed against both — which is what `POST /eval/runs/compare` does and
 * what nothing here could ask for.
 *
 * Every candidate is a full run. Two candidates against a baseline is three
 * passes over the dataset, billed and timed like three, which is why the button
 * says how many.
 */
function ComparePanel({
  dataset,
  manifest,
  onDone,
  onError,
}: {
  dataset: string;
  manifest: string;
  onDone: () => Promise<void> | void;
  onError: (err: unknown, doing: string) => void;
}) {
  const [baseline, setBaseline] = useState(manifest);
  const [candidates, setCandidates] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<EvalComparison | null>(null);

  const names = candidates
    .split(/[,\s]+/)
    .map((n) => n.trim())
    .filter(Boolean);
  const ready = baseline.trim().length > 0 && names.length > 0;

  async function compare() {
    setBusy(true);
    try {
      const comparison = await compareEvalRuns({
        dataset,
        baseline: { name: 'baseline', manifest: baseline.trim() },
        candidates: names.map((m) => ({ name: m, manifest: m })),
      });
      setResult(comparison);
      await onDone();
    } catch (err) {
      onError(err, `compare ${names.join(', ')} against ${baseline}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-2 rounded-md border bg-background p-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {/*
          `htmlFor`/`id` rather than wrapping, now that the control is a
          component: a label that contains its input satisfies the rule by
          structure, and the linter can only see that structure when the input is
          a DOM element it recognises.
        */}
        <label
          htmlFor="eval-compare-baseline"
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          Baseline
          <Input
            id="eval-compare-baseline"
            value={baseline}
            onChange={(e) => setBaseline(e.target.value)}
            className="h-8 w-32 px-2 text-xs"
          />
        </label>
        <label
          htmlFor="eval-compare-candidates"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted-foreground"
        >
          Candidates
          <Input
            id="eval-compare-candidates"
            value={candidates}
            onChange={(e) => setCandidates(e.target.value)}
            placeholder="deep, quick-v2"
            className="h-8 min-w-0 flex-1 px-2 text-xs"
          />
        </label>
        <Button size="sm" disabled={!ready || busy} onClick={compare}>
          {busy ? 'Running…' : `Compare (${names.length + 1} runs)`}
        </Button>
      </div>

      {result && (
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 text-left font-medium">Manifest</th>
              <th className="py-1 text-right font-medium">Pass rate</th>
              <th className="py-1 text-right font-medium">Lift</th>
            </tr>
          </thead>
          <tbody>
            {result.results.map((row) => (
              <tr key={`${row.name}:${row.manifest}`} className="border-t">
                <td className="py-1">
                  {row.manifest}
                  {row.is_baseline && <span className="ml-1 text-muted-foreground">baseline</span>}
                  {row.below_threshold && (
                    <span className="ml-1 text-state-failed">below threshold</span>
                  )}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {(row.pass_rate * 100).toFixed(0)}%
                </td>
                <td
                  className={cn(
                    'py-1 text-right tabular-nums',
                    row.is_baseline
                      ? 'text-muted-foreground'
                      : row.lift_pp > 0
                        ? 'text-state-done'
                        : row.lift_pp < 0
                          ? 'text-state-failed'
                          : 'text-muted-foreground',
                  )}
                >
                  {row.is_baseline
                    ? '—'
                    : `${row.lift_pp > 0 ? '+' : ''}${row.lift_pp.toFixed(1)}pp`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function AddItemForm({
  dataset,
  onAdded,
  onError,
}: {
  dataset: string;
  onAdded: () => void;
  onError: (err: unknown, doing: string) => void;
}) {
  const [input, setInput] = useState('');
  const [criteria, setCriteria] = useState('');
  const [mustInclude, setMustInclude] = useState('');
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!input.trim()) return;
    setBusy(true);
    try {
      await addEvalItem(dataset, {
        user_input: input.trim(),
        rubric: {
          criteria: criteria.trim(),
          must_include: mustInclude
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        },
      });
      setInput('');
      setCriteria('');
      setMustInclude('');
      onAdded();
    } catch (err) {
      onError(err, `add an item to ${dataset}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-1.5 rounded-md border border-dashed p-2.5">
      <Heading>Add item</Heading>
      <Label htmlFor="eval-item-input">User input</Label>
      <Textarea
        id="eval-item-input"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="e.g. What is 7 × 6?"
        rows={2}
        className="min-h-0 resize-none bg-transparent px-2 py-1.5 shadow-none"
      />
      <Label htmlFor="eval-item-criteria">Pass criteria, judged by the model</Label>
      <Input
        id="eval-item-criteria"
        value={criteria}
        onChange={(e) => setCriteria(e.target.value)}
        placeholder="e.g. answers 42"
        className="h-8 text-sm"
      />
      <Label htmlFor="eval-item-must-include">Must include, checked literally</Label>
      <Input
        id="eval-item-must-include"
        value={mustInclude}
        onChange={(e) => setMustInclude(e.target.value)}
        placeholder="comma-separated, e.g. 42"
        className="h-8 text-sm"
      />
      <Button size="sm" className="gap-1" disabled={busy || !input.trim()} onClick={add}>
        <PlusIcon className="size-3.5" /> Add
      </Button>
    </section>
  );
}

/**
 * A run's own instrumentation, which it was collecting and throwing away.
 *
 * `EvalRun` carries `started_at` and `finished_at`; every `ItemScore` carries
 * `duration_ms`, `tokens_input`, `tokens_output` and `tool_call_count`. None of
 * it was rendered, so two runs of the same dataset stacked with nothing to tell
 * them apart and nothing to answer "what did it cost" — one of the three
 * questions PRODUCT.md says this surface has to answer at a glance.
 *
 * The per-item numbers are optional on the wire, so a run where the harness
 * reported none shows the timing it always has and no token line at all, rather
 * than a row of zeroes that reads as a free run.
 */
function runTotals(run: EvalRun): {
  wallMs: number | null;
  tokensIn: number;
  tokensOut: number;
  toolCalls: number;
  metered: boolean;
} {
  let tokensIn = 0;
  let tokensOut = 0;
  let toolCalls = 0;
  let metered = false;
  for (const s of run.scores) {
    if (s.tokens_input != null || s.tokens_output != null) metered = true;
    tokensIn += s.tokens_input ?? 0;
    tokensOut += s.tokens_output ?? 0;
    toolCalls += s.tool_call_count ?? 0;
  }
  return {
    // Both ends required, or the subtraction yields `NaN` and renders as one.
    wallMs:
      run.finished_at == null || !Number.isFinite(run.started_at)
        ? null
        : run.finished_at - run.started_at,
    tokensIn,
    tokensOut,
    toolCalls,
    metered,
  };
}

/** Milliseconds at a scale a person reads, not a number they convert. */
function duration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  return `${m}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function RunCard({ run }: { run: EvalRun }) {
  const total = run.pass_count + run.fail_count;
  const rate = total ? Math.round((run.pass_count / total) * 100) : 0;
  const t = runTotals(run);
  const at = new Date(run.started_at);
  const startedAt = Number.isFinite(at.getTime()) ? at : null;
  return (
    <div className="rounded-md border bg-background p-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {/*
          Read against the state palette rather than by swapping two variants.
          `default` is the primary fill and `secondary` is muted grey, so a clean
          run shouted and a failing one whispered — backwards, and inconsistent
          with the score rows below, which already use the state colours.
        */}
        <Badge
          variant={run.fail_count === 0 ? 'secondary' : 'destructive'}
          className={cn('py-0', run.fail_count === 0 && 'text-state-done')}
        >
          {run.pass_count}/{total} pass · {rate}%
        </Badge>
        <span className="font-mono text-xs text-muted-foreground">{run.candidate_manifest}</span>
        <span className="ml-auto text-xs text-muted-foreground">{run.status}</span>
      </div>
      {/*
        The ordering cue. Two runs of the same dataset against the same manifest
        are otherwise identical on screen, which is the state this list is
        normally in — you run it, change something, run it again.
      */}
      <p className="mt-1 font-mono text-xs text-muted-foreground">
        {/*
          Guarded, because `new Date(undefined).toISOString()` throws a
          `RangeError` rather than returning anything — and thrown from a render
          it takes the whole sheet down, not just the line it could not draw.
          `started_at` is required on the wire and a run without one is still a
          run worth listing.
        */}
        {startedAt ? (
          <time dateTime={startedAt.toISOString()}>{startedAt.toLocaleString()}</time>
        ) : (
          'start time unreported'
        )}
        {t.wallMs == null ? ' · still running' : ` · ${duration(t.wallMs)}`}
        {t.metered
          ? ` · ${t.tokensIn.toLocaleString()} in / ${t.tokensOut.toLocaleString()} out`
          : ''}
        {t.toolCalls > 0 ? ` · ${t.toolCalls} tool ${t.toolCalls === 1 ? 'call' : 'calls'}` : ''}
      </p>
      {run.scores.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {run.scores.map((s) => (
            <ScoreRow key={s.item_id} score={s} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One item's verdict, and the judge's reasoning behind it.
 *
 * The reasoning **is** the output of an eval — it is the thing that says why a
 * case failed — and it was reachable only as a `title` on hover, over a response
 * already cut at 80 characters with no ellipsis and no way to expand. Invisible
 * to touch, invisible to a keyboard, and truncated for everyone.
 *
 * So it expands. Collapsed by default because a run of twenty items is a list to
 * scan first; the trigger is the row itself rather than a separate control,
 * since the row is what someone is already looking at when they want more.
 */
function ScoreRow({ score }: { score: EvalRun['scores'][number] }) {
  const [open, setOpen] = useState(false);
  const summary = score.response || score.reasoning;
  return (
    <li>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="group flex w-full items-start gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronRightIcon
            aria-hidden
            className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 group-data-[state=open]:rotate-90"
          />
          <span
            className={cn(
              'mt-0.5 font-mono text-xs uppercase',
              score.verdict === 'pass' ? 'text-state-done' : 'text-state-failed',
            )}
          >
            {score.verdict}
          </span>
          {/*
            Truncated by CSS rather than by `slice`, so the ellipsis is real and
            the full string is still in the DOM for find-in-page and for a screen
            reader — neither of which a cut string leaves anything to work with.
          */}
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{summary}</span>
          <span className="shrink-0 font-mono text-xs text-muted-foreground">
            {score.score.toFixed(2)}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="ml-5 space-y-1.5 pt-1 pb-1.5">
          {score.response && (
            <div>
              <Heading>Response</Heading>
              <p className="mt-0.5 text-xs break-words whitespace-pre-wrap">{score.response}</p>
            </div>
          )}
          {score.reasoning && (
            <div>
              <Heading>Why the judge said {score.verdict}</Heading>
              <p className="mt-0.5 text-xs break-words whitespace-pre-wrap text-muted-foreground">
                {score.reasoning}
              </p>
            </div>
          )}
          {(score.duration_ms != null || score.tool_call_count != null) && (
            <p className="font-mono text-xs text-muted-foreground">
              {score.duration_ms != null ? duration(score.duration_ms) : ''}
              {score.duration_ms != null && score.tool_call_count != null ? ' · ' : ''}
              {score.tool_call_count != null
                ? `${score.tool_call_count} tool ${score.tool_call_count === 1 ? 'call' : 'calls'}`
                : ''}
            </p>
          )}
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-medium text-muted-foreground">{children}</div>;
}
