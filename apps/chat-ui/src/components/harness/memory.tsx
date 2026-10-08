import { describeError } from '@felix/client';
import { Button } from '@felix/ui/button';
import { Input } from '@felix/ui/input';
import { Label } from '@felix/ui/label';
import { Textarea } from '@felix/ui/textarea';
import { BrainIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { addMemory, forgetMemory, listMemories, memoriesAsOf, searchMemories } from '@/api';
import { ConfirmButton } from '@/components/confirm-button';
import { keepAgent } from '@/components/harness/harness-agent';
import {
  CREATE_FORM,
  CreateToggle,
  PageSection,
  plural,
  ViewSwitch,
} from '@/components/harness/panel';
import { Section, SectionBody } from '@/components/inspector/primitives';
import { usePoll } from '@/hooks/usePoll';
import type { MemoryHit, MemoryRecord } from '@/types';

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
 * The view, the query and the turn live in the address (`?view=asof&turn=12`),
 * so "what it believed at turn 12" is a link rather than three steps to redo.
 *
 * Forgetting is soft on the harness side: the row moves to `forgotten` and drops
 * out of recall rather than being erased. The UI says "forget" rather than
 * "delete" so it does not promise more than that.
 */
/** The fetch caps, named because the header's value has to know them to stay true. */
const RECENT_LIMIT = 50;
const SEARCH_LIMIT = 12;
const AS_OF_LIMIT = 100;

type MemoryView = 'recent' | 'search' | 'asOf';
const VIEWS = [
  ['recent', 'Recent'],
  ['search', 'Search'],
  ['asOf', 'As of'],
] as const;

/** The view in the address. `asof` is the spelling in the URL; anything else is Recent. */
export function readView(params: URLSearchParams): MemoryView {
  const v = params.get('view');
  return v === 'search' ? 'search' : v === 'asof' ? 'asOf' : 'recent';
}

export function MemorySection({
  enabled,
  open,
  onToggle,
}: {
  enabled: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const [params, setParams] = useSearchParams();
  const mode = readView(params);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState(() => params.get('q') ?? '');
  const [asOfSeq, setAsOfSeq] = useState(() => params.get('turn') ?? '');
  /** Debounced so a poll is not issued per keystroke. */
  const [committedQuery, setCommittedQuery] = useState(() => (params.get('q') ?? '').trim());

  useEffect(() => {
    const t = window.setTimeout(() => setCommittedQuery(query.trim()), 300);
    return () => window.clearTimeout(t);
  }, [query]);

  // Written back with `replace`: refining a query or a turn is not a place Back
  // should step through, and each keystroke would otherwise be one.
  // Built on top of `?agent=`, which this page does not own and must not drop.
  useEffect(() => {
    const next = keepAgent(params, {});
    if (mode === 'search') {
      next.set('view', 'search');
      if (committedQuery) next.set('q', committedQuery);
    } else if (mode === 'asOf') {
      next.set('view', 'asof');
      if (asOfSeq.trim()) next.set('turn', asOfSeq.trim());
    }
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [mode, committedQuery, asOfSeq, params, setParams]);

  const setMode = (next: MemoryView) =>
    setParams(
      keepAgent(
        params,
        next === 'search' ? { view: 'search' } : next === 'asOf' ? { view: 'asof' } : {},
      ),
      { replace: true },
    );

  const seq = Number.parseInt(asOfSeq, 10);
  const asOfReady = mode === 'asOf' && Number.isFinite(seq) && seq >= 0;
  const searchReady = mode === 'search' && committedQuery.length > 0;

  const recent = usePoll(() => listMemories({ limit: RECENT_LIMIT }), {
    enabled: enabled && mode === 'recent',
  });
  const found = usePoll(() => searchMemories(committedQuery, { limit: SEARCH_LIMIT }), {
    enabled: enabled && searchReady,
  });
  const past = usePoll(() => memoriesAsOf(seq, { limit: AS_OF_LIMIT }), {
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
      // The value follows the view, because each view is a different question:
      // what is held, what a query recalls, what was believed at a turn. Nothing
      // while a view's first fetch is in flight — `0` then would be a claim. It
      // stays while the Add form is open, since the list stays too.
      meta={
        mode === 'recent' && recent.data
          ? plural(recent.data.length, 'memory', 'memories', RECENT_LIMIT)
          : mode === 'search' && searchReady && found.data
            ? plural(found.data.length, 'match', 'matches', SEARCH_LIMIT)
            : mode === 'asOf' && asOfReady && past.data
              ? `${plural(past.data.length, 'memory', 'memories', AS_OF_LIMIT)} at turn ${seq}`
              : undefined
      }
      metaAsOf={active.error ? active.lastOkAt : undefined}
      open={open}
      onToggle={onToggle}
      controls={
        <>
          <ViewSwitch label="Memory view" value={mode} options={VIEWS} onChange={setMode} />
          <CreateToggle open={adding} onToggle={() => setAdding((a) => !a)} controls="memory-add">
            Add memory
          </CreateToggle>
        </>
      }
    >
      {adding && (
        <div id="memory-add" className={CREATE_FORM}>
          {/* Titled for what it makes, not for the button that opened it. */}
          <PageSection title="New memory">
            <AddMemoryForm
              onCancel={() => setAdding(false)}
              onAdded={() => {
                setAdding(false);
                setMode('recent');
                recent.refresh();
              }}
            />
          </PageSection>
        </div>
      )}

      {/* The input each view needs, with a label that stays on screen. */}
      {mode === 'search' && (
        <div className="mb-3">
          <Label htmlFor="memory-search">What would it recall?</Label>
          <Input
            id="memory-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="mt-1 h-8 max-w-md text-sm"
          />
        </div>
      )}
      {mode === 'asOf' && (
        <div className="mb-3">
          <Label htmlFor="memory-as-of">Turn sequence</Label>
          <Input
            id="memory-as-of"
            type="number"
            min={0}
            value={asOfSeq}
            onChange={(e) => setAsOfSeq(e.target.value)}
            aria-describedby="memory-as-of-help"
            className="mt-1 h-8 w-32 font-mono text-sm"
          />
          {/* The numbers to type are the `seq` values on the rows themselves,
              which is what makes this usable without a separate lookup. */}
          <p id="memory-as-of-help" className="mt-1 text-xs text-muted-foreground">
            {/* Not "the seq on each row": on an empty store there are no rows,
                and the help pointed at a column nobody could see. */}
            A turn's number in its session. Each stored memory shows the{' '}
            <span className="font-mono">seq</span> it was written at, under Recent.
          </p>
        </div>
      )}

      <SectionBody
        onRetry={active.refresh}
        lastOkAt={active.lastOkAt}
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
        {/* Rows between hairlines, as the Activity page's are. Each was a bordered box
            at 11px — the generated default this product names as its nearest
            anti-reference, on the page `/harness` used to open to — with the
            fact itself, the thing being read, at the smallest size on the page. */}
        <ul>
          {rows.map((m) => {
            const hit = mode === 'search' ? (m as MemoryHit) : null;
            const record = mode === 'search' ? null : (m as MemoryRecord);
            return (
              <li
                key={m.id}
                className="flex items-start gap-3 border-b border-border/60 py-2.5 first:border-t"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug break-words">{m.content}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-xs text-muted-foreground">
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
                      // Foreground against the muted line, not red: `forgotten` is a
                      // deliberate soft delete, and the failed colour is for
                      // something that went wrong.
                      <span className="text-foreground">· {record.status}</span>
                    )}
                    {record?.superseded_by && <span>· superseded</span>}
                    {/*
                      How the row was embedded — the pair that answers "why did
                      recall miss this". Shown only in recent/as-of, where the
                      question is about the row rather than about a ranking that
                      already found it. `null` dim means no embedder ran, so the
                      row is lexical-only; a dim that disagrees with the rest of
                      the store means it was written under a different embedder
                      and has quietly stopped matching.
                    */}
                    {record && record.embedding_dim == null && (
                      <span title="No embedder ran for this row; it is reachable by full text only.">
                        · lexical only
                      </span>
                    )}
                    {record?.embedding_model ? (
                      <span>
                        · {record.embedding_model}
                        {record.embedding_dim ? `/${record.embedding_dim}` : ''}
                      </span>
                    ) : null}
                  </div>
                </div>
                {/* At the row's end, as Jobs puts its delete, rather than on a line
                    of its own under every fact. Forgetting a superseded row changes
                    nothing the agent can recall, so it offers nothing there. */}
                {/* The guard now does what the comment above always said: a
                    superseded row is already out of recall, so forgetting it
                    changes nothing and it offers nothing. */}
                {record?.status !== 'forgotten' && !record?.superseded_by && (
                  <ConfirmButton
                    size="xs"
                    variant="ghost"
                    className="shrink-0 text-muted-foreground hover:text-state-failed"
                    destructive
                    question={`"${m.content.slice(0, 80)}" will stop being recalled.`}
                    confirmLabel="Forget it"
                    onConfirm={() => forget(m.id)}
                  >
                    Forget
                  </ConfirmButton>
                )}
              </li>
            );
          })}
        </ul>
      </SectionBody>
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
function AddMemoryForm({ onAdded, onCancel }: { onAdded: () => void; onCancel: () => void }) {
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

  // The shared primitives at the body size, with labels that stay on screen.
  // These were hand-rolled at 11px with a `border/60` edge — about 6% white in
  // dark, well under the 3:1 a field's boundary owes — a 1px focus ring where
  // the system's is 3px, and an importance field that was a bare `0.5` box.
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Stored as a fact the agent can recall. It becomes model input in later sessions, so write it
        the way you would write an instruction.
      </p>
      <div>
        <Label htmlFor="memory-content">What to remember</Label>
        <Textarea
          id="memory-content"
          value={content}
          maxLength={MEMORY_CONTENT_MAX}
          rows={3}
          onChange={(e) => setContent(e.target.value)}
          placeholder="The staging harness runs on :8081, not :8080."
          aria-describedby="memory-content-count"
          className="mt-1 resize-y text-sm"
        />
        <p id="memory-content-count" className="mt-1 text-xs text-muted-foreground tabular-nums">
          {value.length}/{MEMORY_CONTENT_MAX}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
        <div>
          <Label htmlFor="memory-topic">Topic (optional)</Label>
          <Input
            id="memory-topic"
            value={topicKey}
            maxLength={MEMORY_TOPIC_MAX}
            onChange={(e) => setTopicKey(e.target.value)}
            className="mt-1 h-8 font-mono text-sm"
          />
        </div>
        <div>
          <Label htmlFor="memory-importance">Importance (0–1)</Label>
          <Input
            id="memory-importance"
            type="number"
            min={0}
            max={1}
            step={0.1}
            value={importance}
            onChange={(e) => setImportance(e.target.value)}
            className="mt-1 h-8 font-mono text-sm"
          />
        </div>
      </div>
      {/* A Cancel beside it, as Jobs has: the header toggle was the only way out,
          and it is not where anyone looks when a form is in front of them. */}
      <div className="flex gap-2">
        <Button size="sm" disabled={!ready || busy} onClick={() => void submit()}>
          {busy ? 'Storing…' : 'Remember it'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-state-failed">
          {error}
        </p>
      ) : null}
    </div>
  );
}
