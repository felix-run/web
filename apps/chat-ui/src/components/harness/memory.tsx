import { describeError } from '@felix/client';
import { Button } from '@felix/ui/button';
import { BrainIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { addMemory, forgetMemory, listMemories, memoriesAsOf, searchMemories } from '@/api';
import { ConfirmButton } from '@/components/confirm-button';
import { Section, SectionBody } from '@/components/inspector/primitives';
import { usePoll } from '@/hooks/usePoll';
import { cn } from '@/lib/utils';
import type { MemoryHit, MemoryRecord } from '@/types';

/**
 * Memory: what the agent has stored across sessions.
 *
 * Surfaced so a stale or hostile fact can be found and removed without a database
 * console. `DELETE` is **soft** — the row becomes `forgotten` and drops out of
 * recall rather than being erased — which is why the control says "forget", and
 * the Add tab is an injection ingress by design, which is why the form says so.
 */

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
export function MemorySection({
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
      {/*
        A toggle group, not tabs — and deliberately not the `@felix/ui/tabs` the
        Ledger and the run instrument use. Those switch between independent
        panels; these switch the *input* above a list all three modes share, so
        there is no panel per mode to point an `aria-controls` at. It previously
        carried `role="tablist"`/`role="tab"`/`aria-selected` with no `tabpanel`
        and no arrow-key roving focus, which announces a widget and then does not
        behave like one. `aria-pressed` on buttons in a named group promises only
        what this actually is.
      */}
      <div className="mb-2 flex gap-1" role="group" aria-label="Memory view">
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
            aria-pressed={mode === id}
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
