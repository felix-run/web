import { Button } from '@felix/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@felix/ui/collapsible';
import { Input } from '@felix/ui/input';
import { Label } from '@felix/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@felix/ui/select';
import { Skeleton } from '@felix/ui/skeleton';
import { Textarea } from '@felix/ui/textarea';
import { ChevronRightIcon, FlaskConicalIcon, PlayIcon, PlusIcon } from 'lucide-react';
import { type ComponentProps, type ReactNode, useCallback, useEffect, useState } from 'react';
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
import { compact, usd } from '@/components/harness/activity';
import {
  CREATE_FORM,
  CreateToggle,
  PageEmpty,
  PageHeader,
  PageSection,
  Panel,
  PanelBody,
  plural,
} from '@/components/harness/panel';
import { ReadFailure, withAge } from '@/components/inspector/primitives';
import { cn } from '@/lib/utils';
import type { EvalComparison, EvalDataset, EvalDatasetItem, EvalRun, Rubric } from '@/types';

/**
 * Eval workbench — the `/eval` offline-benchmark surface as a `/harness` page.
 * Create a golden dataset, append items with a rubric the scorer reads, replay
 * the dataset against the currently-selected manifest, and read back per-item
 * scores with the rule that decided each. Tenant-scoped.
 *
 * The harness writes datasets whole — there is no per-item route — so appending
 * an item is a read-modify-write of the whole dataset.
 *
 * The rubric and score shapes here follow `felix.eval.runner`, and the previous
 * version of this file did not: it wrote `must_include` and `pass_threshold`,
 * which the scorer never reads, and rendered `verdict`, `reasoning` and
 * `response`, which it never writes. Every item the form produced fell through
 * to `nonempty` — any non-blank answer passes — and every score row drew an
 * empty verdict in the failed colour. Nothing mechanical could catch it: the
 * rubric is free-form on the wire and the scores are nested inside the run row,
 * so `check-payload-shapes` sees neither. The docs' rubric table is the contract.
 */
export function EvalSheet({
  manifest,
  manifestOptions = [],
  picker,
}: {
  manifest: string;
  /** The agent picker, drawn in this page's header because it scopes it. */
  picker?: ReactNode;
  /** Agents the harness knows, for picking a comparison baseline. */
  manifestOptions?: string[];
}) {
  const [datasets, setDatasets] = useState<EvalDataset[]>([]);
  /** Whether `datasets` is an answer yet: `0 datasets` before the first list is a claim. */
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  // Error and verb travel together: one hardcoded phrase meant a failed eval *run*
  // reported itself as a failure to reach the harness.
  const [failure, setFailure] = useState<{ err: unknown; doing: string } | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  /** Whether the new-dataset form is open; `creating` is the request in flight. */
  const [naming, setNaming] = useState(false);

  // The list's own read, apart from the actions' `failure` — so a failed
  // reload keeps the datasets it last had, under a line saying how old they are.
  const [listError, setListError] = useState<unknown>(null);
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);

  const refreshDatasets = useCallback(async () => {
    try {
      const ds = await listEvalDatasets();
      setDatasets(ds);
      setLoaded(true);
      setListError(null);
      setLastOkAt(Date.now());
      setSelected((cur) => cur ?? ds[0]?.name ?? null);
    } catch (err) {
      setListError(err);
    }
  }, []);

  // Stable, so the dataset panel's read does not re-run on every render of
  // this page. It was an inline arrow in that read's dependencies, so each
  // re-render — a failure message, a keystroke in the new-dataset field —
  // fetched the items and runs again, and on a 429 the failure re-rendered the
  // page, which fetched again: a loop, against the one harness that was
  // already saying slow down.
  const reportFailure = useCallback(
    (err: unknown, doing: string) => setFailure({ err, doing }),
    [],
  );

  useEffect(() => {
    // No `open` guard: a route mounts this only while it is the address, so being
    // rendered *is* being open. Left in place, `open` silently resolved to
    // `window.open` — always truthy, and a condition that reads as a gate while
    // gating nothing.
    void refreshDatasets();
  }, [refreshDatasets]);

  async function create() {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setFailure(null);
    try {
      await putEvalDataset(name);
      setNewName('');
      setNaming(false);
      await refreshDatasets();
      setSelected(name);
    } catch (err) {
      setFailure({ err, doing: `create the dataset ${name}` });
    } finally {
      setCreating(false);
    }
  }

  return (
    <Panel>
      <PageHeader
        icon={<FlaskConicalIcon />}
        title="Eval"
        value={withAge(
          loaded ? plural(datasets.length, 'dataset') : undefined,
          listError != null ? lastOkAt : undefined,
        )}
        controls={
          <>
            {picker}
            <CreateToggle
              open={naming}
              onToggle={() => setNaming((v) => !v)}
              controls="eval-new-dataset-form"
            >
              New dataset
            </CreateToggle>
          </>
        }
      />

      <PanelBody>
        {/* Which agent a run replays against is the one sentence here that
            changes what pressing Run does, so it left the header's subline for
            the body rather than being dropped with it. */}
        {/* `max-w-prose`: a sentence, held to a line length that reads as one
            — the page measure is for rows and let it run to 113 characters. */}
        <p className="mb-3 max-w-prose text-sm text-muted-foreground">
          {/* Not "the active agent": *active* is Manifests' word for a version. */}
          Golden datasets, replayed and judged per item against{' '}
          <span className="font-mono text-foreground">{manifest}</span>, the agent picked in the
          header.
        </p>
        {listError != null && (
          <ReadFailure
            error={listError}
            doing="list eval datasets"
            lastOkAt={lastOkAt}
            onRetry={() => void refreshDatasets()}
          />
        )}
        {/* An action's failure — a create, a run, a compare. No retry: re-running
            one is a deliberate act, and its control is still on the page. */}
        {failure && (
          <div className="mb-3">
            <ErrorNotice error={failure.err} doing={failure.doing} />
          </div>
        )}

        {/* Behind the header's toggle, as every page's create is, and opening as
            the page's first section. It was an always-visible row beside the
            picker — one of four different places "add" lived under /harness. */}
        {naming && (
          <div id="eval-new-dataset-form" className={CREATE_FORM}>
            <PageSection title="New dataset">
              <div className="flex max-w-md items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Label htmlFor="eval-new-dataset">Name</Label>
                  <Input
                    id="eval-new-dataset"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="mt-1 h-8 font-mono text-sm"
                    onKeyDown={(e) => e.key === 'Enter' && create()}
                  />
                </div>
                <Button
                  size="sm"
                  className="gap-1"
                  disabled={creating || !newName.trim()}
                  onClick={create}
                >
                  <PlusIcon className="size-3.5" /> Create
                </Button>
              </div>
            </PageSection>
          </div>
        )}

        {/*
            Capped and scrollable. It wrapped without a height, so twenty of
            these pushed the panel they select *for* off the bottom of the sheet
            — the control growing until the thing it controls is unreachable.
            Read from the code rather than measured: the local harness has one.
          */}
        {datasets.length > 0 ? (
          <div
            role="group"
            aria-label="Datasets"
            className="mb-5 flex max-h-24 flex-wrap items-center gap-1.5 overflow-y-auto"
          >
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
          </div>
        ) : // Only once a list has answered: "No datasets yet" under a first read
        // that failed says the tenant has none *and* that nobody could check.
        // After a good read it is the last answer, and the line above says so.
        loaded ? (
          naming ? null : (
            <div className="mb-5">
              <PageEmpty>
                No datasets yet. A dataset is a set of prompts with rules; New dataset starts one.
              </PageEmpty>
            </div>
          )
        ) : listError ? null : (
          <div className="mb-5 space-y-1.5">
            <Skeleton className="h-8 w-full rounded-md" />
            <Skeleton className="h-8 w-full rounded-md" />
          </div>
        )}

        {selected ? (
          <DatasetPanel
            key={selected}
            dataset={selected}
            manifest={manifest}
            manifestOptions={manifestOptions}
            onError={reportFailure}
          />
        ) : null}
      </PanelBody>
    </Panel>
  );
}

function DatasetPanel({
  dataset,
  manifest,
  manifestOptions,
  onError,
}: {
  dataset: string;
  manifest: string;
  manifestOptions: string[];
  onError: (err: unknown, doing: string) => void;
}) {
  const [addingItem, setAddingItem] = useState(false);
  const [items, setItems] = useState<EvalDatasetItem[]>([]);
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [running, setRunning] = useState(false);
  const [comparing, setComparing] = useState(false);

  // Its own read, drawn here beside the rows it keeps rather than sent up to
  // the page's action slot as if loading a dataset were something that failed
  // to *happen*.
  const [readError, setReadError] = useState<unknown>(null);
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);
  const refresh = useCallback(async () => {
    try {
      const [its, rns] = await Promise.all([listEvalItems(dataset), listEvalRuns(dataset)]);
      setItems(its);
      setRuns(rns);
      setReadError(null);
      setLastOkAt(Date.now());
    } catch (err) {
      setReadError(err);
    }
  }, [dataset]);

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

  // Runs first: reading how the last one went is why this page is opened, far
  // more often than to edit the items it replays. The form that led the old
  // layout sat above both.
  // A first read that failed has nothing to keep, and the sections below would
  // say "Add an item before running" about a dataset nobody could read.
  if (readError != null && lastOkAt == null) {
    return (
      <ReadFailure
        error={readError}
        doing={`load the dataset ${dataset}`}
        lastOkAt={null}
        onRetry={() => void refresh()}
      />
    );
  }

  return (
    <>
      {readError != null && (
        <ReadFailure
          error={readError}
          doing={`load the dataset ${dataset}`}
          lastOkAt={lastOkAt}
          onRetry={() => void refresh()}
        />
      )}
      <PageSection
        title="Runs"
        meta={runs.length > 0 ? plural(runs.length, 'run') : undefined}
        actions={
          <>
            <Button
              size="sm"
              variant="ghost"
              disabled={items.length === 0}
              aria-expanded={comparing}
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
          </>
        }
      >
        {/*
          Inline, not a `title`. The reason this button is unavailable used to live
          in a tooltip on the button itself — and a `title` fires on hover, which
          disabled elements do not emit. So the one message that said how to
          proceed existed only in the state where nothing could read it.
        */}
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Add an item before running: a dataset with nothing in it has nothing to score.
          </p>
        ) : runs.length === 0 && !comparing ? (
          <p className="text-sm text-muted-foreground">Not run yet.</p>
        ) : null}

        {comparing && (
          <ComparePanel
            dataset={dataset}
            manifest={manifest}
            manifestOptions={manifestOptions}
            onDone={refresh}
            onError={onError}
          />
        )}

        {runs.length > 0 && (
          <ol>
            {runs.map((r) => (
              <RunCard key={r.id} run={r} />
            ))}
          </ol>
        )}
      </PageSection>

      {/* Adding an item is a create like any other, so it sits behind a toggle on
          its section rather than as nine fields always open under the list. */}
      <PageSection
        title="Items"
        meta={plural(items.length, 'item')}
        actions={
          <CreateToggle
            open={addingItem}
            onToggle={() => setAddingItem((v) => !v)}
            controls="eval-add-item"
          >
            Add item
          </CreateToggle>
        }
      >
        {addingItem && (
          <div id="eval-add-item" className={CREATE_FORM}>
            <AddItemForm
              dataset={dataset}
              onAdded={() => {
                setAddingItem(false);
                void refresh();
              }}
              onError={onError}
            />
          </div>
        )}
        {items.length > 0 && (
          <ul>
            {items.map((it) => (
              <li
                key={it.item_id}
                className="border-b border-border/60 py-2 text-sm first:border-t"
              >
                <div className="font-medium">{it.user_input}</div>
                <RubricSummary rubric={it.rubric} />
              </li>
            ))}
          </ul>
        )}
      </PageSection>
    </>
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
  manifestOptions,
  onDone,
  onError,
}: {
  dataset: string;
  manifest: string;
  manifestOptions: string[];
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
    // A tonal step, not a border: it is a tool opened *inside* Runs, and a second
    // box drawn in the section would read as a second section.
    <div className="mb-3 space-y-2 rounded-md bg-muted/50 p-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {/*
          `htmlFor`/`id` rather than wrapping, now that the control is a
          component: a label that contains its input satisfies the rule by
          structure, and the linter can only see that structure when the input is
          a DOM element it recognises.
        */}
        {/* A select, as Jobs' agent is: the baseline is one of the agents the
            harness knows, and typing it was a way to compare against a typo. */}
        <div className="flex items-center gap-1.5">
          <Label htmlFor="eval-compare-baseline" className="text-xs text-muted-foreground">
            Baseline
          </Label>
          <Select value={baseline} onValueChange={setBaseline}>
            <SelectTrigger
              id="eval-compare-baseline"
              size="sm"
              className="h-8 w-36 font-mono text-sm"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(manifestOptions.includes(manifest)
                ? manifestOptions
                : [manifest, ...manifestOptions]
              ).map((m) => (
                <SelectItem key={m} value={m} className="font-mono text-sm">
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
    </div>
  );
}

/**
 * What the scorer will do with a rubric, in the order it does it. Exported so the
 * test can pin the reading without rendering.
 *
 * Mirrors `_score_answer`: trajectory rules first (each can only reject), then the
 * one answer rule it stops at — `expect`/`equals`, else `contains`, else
 * `min_chars` — and a judge only when one of the three selecting keys is set.
 * `rules` empty means the item scores `nonempty`, which passes any non-blank
 * answer, and that is the case worth saying loudest.
 */
export function describeRubric(r: Rubric): string[] {
  const rules: string[] = [];
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String).join(', ') : String(v));
  if (r.tools_called != null) rules.push(`must call ${list(r.tools_called)}`);
  if (r.tools_not_called != null) rules.push(`must not call ${list(r.tools_not_called)}`);
  if (r.max_tool_calls != null) rules.push(`at most ${r.max_tool_calls} tool calls`);
  if (r.max_errors != null) rules.push(`at most ${r.max_errors} tool errors`);
  const expect = r.expect ?? r.equals;
  if (expect != null) rules.push(`answer equals “${expect}”`);
  else if (r.contains != null) rules.push(`answer contains “${r.contains}”`);
  else if (r.min_chars != null && r.min_chars !== '') {
    rules.push(`answer is at least ${r.min_chars} characters`);
  }
  const judged = r.llm_judge !== false && Boolean(r.llm_judge || r.judge_criteria || r.judge_model);
  if (judged) rules.push(`judged on “${r.judge_criteria ?? r.criteria ?? 'relevance'}”`);
  return rules;
}

function RubricSummary({ rubric }: { rubric: Rubric }) {
  const rules = describeRubric(rubric);
  if (rules.length === 0) {
    return (
      // The harness's own warning, on the item, where the decision to fix it is made.
      // Foreground, not amber: amber means a person is being asked to act, and
      // this is a dataset that needs editing, not a run that is waiting.
      <div className="mt-1 text-xs text-foreground">
        No rule: any non-empty answer passes, so this item gates nothing.
      </div>
    );
  }
  return <div className="mt-1 text-xs text-muted-foreground">{rules.join(' · ')}</div>;
}

const csv = (s: string) =>
  s
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

/**
 * The rubric an item will be scored by, field by field, and a live reading of it.
 *
 * Three answer inputs rather than a rule picker, because that is how the scorer
 * reads them: `expect` wins over `contains` wins over `min_chars`, and a form that
 * lets two be filled and says which one counts is truer than one that forbids it.
 * The trajectory rules are the four the harness added for coding agents — what a
 * run *did* rather than what it said — and a judge is selected by naming criteria
 * for it, which is the one spelling (`judge_criteria`) that actually selects one.
 */
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
  const [equals, setEquals] = useState('');
  const [contains, setContains] = useState('');
  const [minChars, setMinChars] = useState('');
  const [called, setCalled] = useState('');
  const [notCalled, setNotCalled] = useState('');
  const [maxCalls, setMaxCalls] = useState('');
  const [maxErrors, setMaxErrors] = useState('');
  const [judge, setJudge] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const rubric: Rubric = {
    ...(equals.trim() ? { expect: equals.trim() } : {}),
    ...(contains.trim() ? { contains: contains.trim() } : {}),
    ...(minChars.trim() ? { min_chars: Number(minChars) } : {}),
    ...(csv(called).length ? { tools_called: csv(called) } : {}),
    ...(csv(notCalled).length ? { tools_not_called: csv(notCalled) } : {}),
    ...(maxCalls.trim() ? { max_tool_calls: Number(maxCalls) } : {}),
    ...(maxErrors.trim() ? { max_errors: Number(maxErrors) } : {}),
    ...(judge.trim() ? { judge_criteria: judge.trim() } : {}),
  };
  const reading = describeRubric(rubric);

  async function add() {
    if (!input.trim()) return;
    setBusy(true);
    try {
      const stored = await addEvalItem(dataset, { user_input: input.trim(), rubric });
      // The harness warns on a 200 for an item that is legal and gates nothing.
      // Cleared on the next successful add rather than on typing, so it stays
      // readable for as long as the item it describes is the newest one.
      setWarnings(stored.warnings ?? []);
      setInput('');
      setEquals('');
      setContains('');
      setMinChars('');
      setCalled('');
      setNotCalled('');
      setMaxCalls('');
      setMaxErrors('');
      setJudge('');
      onAdded();
    } catch (err) {
      onError(err, `add an item to ${dataset}`);
    } finally {
      setBusy(false);
    }
  }

  const field = (
    id: string,
    label: string,
    value: string,
    set: (v: string) => void,
    placeholder: string,
    extra: Partial<ComponentProps<typeof Input>> = {},
  ) => (
    <div className="min-w-0">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder={placeholder}
        className="mt-0.5 h-8 text-sm"
        {...extra}
      />
    </div>
  );

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="eval-item-input">User input</Label>
        <Textarea
          id="eval-item-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. What is 7 × 6?"
          rows={2}
          className="mt-0.5 min-h-0 resize-none bg-transparent px-2 py-1.5 shadow-none"
        />
      </div>

      <Heading>Answer rule (the first one filled in counts)</Heading>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {field('eval-item-equals', 'Equals', equals, setEquals, 'exact answer')}
        {field('eval-item-contains', 'Contains', contains, setContains, 'e.g. 42')}
        {field('eval-item-min-chars', 'At least N characters', minChars, setMinChars, 'e.g. 80', {
          type: 'number',
          min: 1,
        })}
      </div>

      <Heading>Trajectory rules (each can only reject)</Heading>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {field('eval-item-called', 'Must call', called, setCalled, 'tools, comma-separated')}
        {field('eval-item-not-called', 'Must not call', notCalled, setNotCalled, 'tools')}
        {field('eval-item-max-calls', 'Max tool calls', maxCalls, setMaxCalls, 'e.g. 6', {
          type: 'number',
          min: 0,
        })}
        {field('eval-item-max-errors', 'Max tool errors', maxErrors, setMaxErrors, 'e.g. 0', {
          type: 'number',
          min: 0,
        })}
      </div>

      {field(
        'eval-item-judge',
        'Judge criteria (selects a judge model; its verdict replaces the answer rule)',
        judge,
        setJudge,
        'e.g. answers the question and cites the file',
      )}

      {/* The reading the scorer will have, before the item is stored — the same
          function that labels stored items, so the two cannot disagree. */}
      <p className={cn('text-xs', reading.length ? 'text-muted-foreground' : 'text-foreground')}>
        {reading.length
          ? `Will score: ${reading.join(' · ')}`
          : 'No rule yet: this item would pass any non-empty answer.'}
      </p>
      {warnings.length > 0 && (
        <ul className="space-y-0.5 text-xs text-foreground">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <Button size="sm" className="gap-1" disabled={busy || !input.trim()} onClick={add}>
        <PlusIcon className="size-3.5" /> Add
      </Button>
    </div>
  );
}

/**
 * What a run did, summed off its scores.
 *
 * `EvalRun` carries `started_at` and `finished_at`; every score carries
 * `tool_calls` and `tool_errors`, the trajectory the rules were checked against.
 * Two runs of the same dataset against the same manifest are otherwise identical
 * on screen, which is the state this list is normally in.
 *
 * Cost and tokens come from `run.stats`, which the harness sums from the score
 * rows (felix-run/felix#345); a harness before that sends none and the line
 * simply has no cost on it. The cost is the candidate's own turns, not the
 * judge's, and it is labelled a floor whenever an item metered tokens with no
 * price, as the Activity page labels one — an unpriced model costs something, just not
 * something the harness knows.
 */
export function runTotals(run: EvalRun): {
  wallMs: number | null;
  toolCalls: number;
  toolErrors: number;
  tokens: number;
  cost: number | null;
  costIsFloor: boolean;
  judgeFallbacks: number;
} {
  let toolCalls = 0;
  let toolErrors = 0;
  let costIsFloor = false;
  for (const s of run.scores) {
    toolCalls += s.tool_calls ?? 0;
    toolErrors += s.tool_errors ?? 0;
    if (s.cost_usd === 0 && (s.tokens_input ?? 0) + (s.tokens_output ?? 0) > 0) costIsFloor = true;
  }
  const stats = run.stats;
  return {
    tokens: stats ? stats.tokens_input + stats.tokens_output : 0,
    cost: stats ? stats.cost_usd : null,
    costIsFloor,
    judgeFallbacks: stats?.judge_fallbacks ?? run.scores.filter((s) => s.judge_fallback).length,
    // Both ends required, or the subtraction yields `NaN` and renders as one.
    wallMs:
      run.finished_at == null || !Number.isFinite(run.started_at)
        ? null
        : run.finished_at - run.started_at,
    toolCalls,
    toolErrors,
  };
}

/**
 * What each `rule` the runner names means, for the row that names it. The rule
 * itself is rendered verbatim above this — it is the harness's word and the one
 * to grep for — and this is the sentence under it.
 */
const RULE_TEXT: Record<string, string> = {
  equals: 'The answer had to equal the expected text, after trimming.',
  contains: 'The answer had to contain the expected text, case-insensitively.',
  min_chars: 'The answer had to reach the minimum length.',
  nonempty: 'The rubric named no rule, so any non-empty answer passes.',
  tools_called: 'A tool the rubric requires was never called.',
  tools_not_called: 'A tool the rubric forbids was called.',
  max_tool_calls: 'The run made more tool calls than the rubric allows.',
  max_errors: 'More tool calls errored or were denied than the rubric allows.',
  invalid_rubric: 'The rubric could never reject anything, so it fails closed.',
  llm_judge: 'A judge model scored the answer against the criteria.',
};

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
    <li className="border-b border-border/60 py-2.5 text-sm first:border-t">
      <div className="flex flex-wrap items-center gap-2">
        {/*
          Read against the state palette rather than by swapping two variants.
          `default` is the primary fill and `secondary` is muted grey, so a clean
          run shouted and a failing one whispered — backwards, and inconsistent
          with the score rows below, which already use the state colours.
        */}
        {/* The state chip every failure count uses — `state-*` at `/15` —
            rather than `destructive`'s solid red, which is tuned to carry white
            and shouted louder than any other failure under /harness. */}
        <span
          className={cn(
            'rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums',
            run.fail_count === 0
              ? 'bg-state-done/15 text-state-done'
              : 'bg-state-failed/15 text-state-failed',
          )}
        >
          {run.pass_count}/{total} pass · {rate}%
        </span>
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
        {t.toolCalls > 0 ? ` · ${t.toolCalls} tool ${t.toolCalls === 1 ? 'call' : 'calls'}` : ''}
        {t.toolErrors > 0
          ? ` · ${t.toolErrors} tool ${t.toolErrors === 1 ? 'error' : 'errors'}`
          : ''}
        {/* Counted inside `fail_count` too, so this is the subset that never reached
            the scorer: a malformed item or a run that threw, which reads differently
            from an answer the rubric rejected. */}
        {run.error_count ? (
          <span className="text-state-failed" title="Items that never reached the scorer">
            {` · ${run.error_count} errored`}
          </span>
        ) : null}
        {t.tokens > 0 ? ` · ${compact(t.tokens)} tokens` : ''}
        {t.cost != null && t.tokens > 0 ? (
          <span
            title={
              t.costIsFloor
                ? 'At least this much: an item metered tokens on a model with no price, so its cost is not in here'
                : "The candidate's own turns; the judge's spend is not included"
            }
          >
            {` · ${usd(t.cost)}${t.costIsFloor ? ' (floor)' : ''}`}
          </span>
        ) : null}
        {/* Foreground rather than a failure colour: nothing failed, and that is the
            problem — the judge could not run, the heuristic scored those items, and
            the run reads as clean. */}
        {t.judgeFallbacks > 0 ? (
          <span
            className="text-foreground"
            title="The LLM judge could not run for these items, so the heuristic scored them instead"
          >
            {` · judge fell back on ${t.judgeFallbacks} ${t.judgeFallbacks === 1 ? 'item' : 'items'}`}
          </span>
        ) : null}
      </p>
      {run.scores.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {run.scores.map((s) => (
            <ScoreRow key={s.item_id} score={s} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * One item's verdict, the rule that decided it, and the answer it decided on.
 *
 * The rule **is** the output of an eval — it is the thing that says why a case
 * failed — so it sits on the collapsed row, verbatim, in the harness's own word.
 * `invalid_rubric` is drawn in plain foreground rather than failed: nothing about
 * the run was wrong, the rubric could never have said no, and the fix is to the
 * dataset. Not amber either — that means someone is being asked to act *now*. An item that never reached the scorer carries `error` instead of a
 * verdict and is drawn as its own third state.
 *
 * Expanding is the only way to the answer and the reason. Collapsed by default
 * because a run of twenty items is a list to scan first; the trigger is the row
 * itself rather than a separate control, since the row is what someone is
 * already looking at when they want more.
 */
function ScoreRow({ score }: { score: EvalRun['scores'][number] }) {
  const [open, setOpen] = useState(false);
  const verdict = score.error != null ? 'error' : score.pass ? 'pass' : 'fail';
  const invalid = score.rule === 'invalid_rubric';
  const summary = score.reason || score.answer || score.error || '';
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
              verdict === 'pass' ? 'text-state-done' : 'text-state-failed',
            )}
          >
            {verdict}
          </span>
          {score.rule && (
            <span
              className={cn(
                'mt-0.5 shrink-0 font-mono text-xs',
                invalid ? 'text-foreground' : 'text-muted-foreground',
              )}
              title={RULE_TEXT[score.rule]}
            >
              {score.rule}
            </span>
          )}
          {score.judge_fallback && (
            <span
              className="mt-0.5 shrink-0 font-mono text-xs text-foreground"
              title={`The judge could not run${score.judge_error ? ` (${score.judge_error})` : ''}; the heuristic scored this item`}
            >
              heuristic
            </span>
          )}
          {/*
            Truncated by CSS rather than by `slice`, so the ellipsis is real and
            the full string is still in the DOM for find-in-page and for a screen
            reader — neither of which a cut string leaves anything to work with.
          */}
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{summary}</span>
          {score.score != null && (
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              {score.score.toFixed(2)}
            </span>
          )}
        </CollapsibleTrigger>
        <CollapsibleContent className="ml-5 space-y-1.5 pt-1 pb-1.5">
          {score.rule && RULE_TEXT[score.rule] && (
            <p className={cn('text-xs', invalid ? 'text-foreground' : 'text-muted-foreground')}>
              {RULE_TEXT[score.rule]}
            </p>
          )}
          {score.error && (
            <div>
              <Heading>Error</Heading>
              <p className="mt-0.5 text-xs break-words whitespace-pre-wrap text-state-failed">
                {score.error}
              </p>
            </div>
          )}
          {score.answer && (
            <div>
              <Heading>Answer{score.mock ? ' (mocked)' : ''}</Heading>
              <p className="mt-0.5 text-xs break-words whitespace-pre-wrap">{score.answer}</p>
            </div>
          )}
          {score.reason && (
            <div>
              <Heading>
                {score.rule === 'llm_judge' ? `Why the judge said ${verdict}` : 'Reason'}
              </Heading>
              <p className="mt-0.5 text-xs break-words whitespace-pre-wrap text-muted-foreground">
                {score.reason}
              </p>
            </div>
          )}
          {score.judge_fallback && (
            <p className="text-xs text-foreground">
              The judge could not run
              {score.judge_error ? (
                <>
                  {' '}
                  (<span className="font-mono">{score.judge_error}</span>)
                </>
              ) : null}
              , so the heuristic scored this item. Its verdict is weaker than a judged one.
            </p>
          )}
          {score.tool_calls != null && (
            <p className="font-mono text-xs text-muted-foreground">
              {`${score.tool_calls} tool ${score.tool_calls === 1 ? 'call' : 'calls'}`}
              {score.tool_errors ? `, ${score.tool_errors} errored` : ''}
            </p>
          )}
          {itemSpend(score) && (
            <p className="font-mono text-xs text-muted-foreground">{itemSpend(score)}</p>
          )}
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

/** One item's own turn: how long, how many tokens, what it cost. */
export function itemSpend(score: EvalRun['scores'][number]): string {
  const parts: string[] = [];
  if (score.duration_ms != null) parts.push(duration(score.duration_ms));
  const tokens = (score.tokens_input ?? 0) + (score.tokens_output ?? 0);
  if (tokens > 0) {
    parts.push(`${compact(tokens)} tokens`);
    if (score.cost_usd != null) parts.push(score.cost_usd === 0 ? 'unpriced' : usd(score.cost_usd));
  }
  return parts.join(' · ');
}

function Heading({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-medium text-muted-foreground">{children}</div>;
}
