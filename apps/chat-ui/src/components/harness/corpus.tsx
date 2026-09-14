import { describeError } from '@felix/client';
import { Button } from '@felix/ui/button';
import { BookOpenIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { addDocument, deleteDocument, listDocuments, searchDocuments } from '@/api';
import { ConfirmButton } from '@/components/confirm-button';
import { Section, SectionBody } from '@/components/inspector/primitives';
import { usePoll } from '@/hooks/usePoll';
import { cn } from '@/lib/utils';
import type { DocumentHit, DocumentRecord } from '@/types';
import { DOCUMENT_LIMITS } from '@/types';

/**
 * Corpus: what the agent *retrieves* from, where memory is what it *learned*.
 *
 * Same operator question, so deliberately the same shape — with two differences
 * that change what the UI may say. A search hit is a **chunk**, not a document,
 * so the passage is what gets rendered. And `DELETE` here is **hard**: it removes
 * every chunk and answers with how many, which is why the confirmation names the
 * count rather than offering a forget.
 */

/**
 * The corpus the agent retrieves from.
 *
 * `/memory` is what the agent *learned*; this is what it was *given*. The
 * operator question is the same one and it is asked the same way — find the
 * passage behind a bad answer and remove it — so this mirrors the memory panel
 * rather than inventing a second idiom for the same job.
 *
 * Two places where it must not mirror it, because the harness behaves
 * differently and a panel that says otherwise is lying:
 *
 * - Delete here is **hard**. Memory's is soft, and its button says "Forget" for
 *   that reason. This one removes every chunk and says how many went.
 * - A search hit is a **chunk**, not a document. Showing the document title
 *   alone would hide the thing actually retrieved.
 */
export function DocumentsSection({
  enabled,
  open,
  onToggle,
}: {
  enabled: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const [mode, setMode] = useState<'recent' | 'search' | 'add'>('recent');
  const [query, setQuery] = useState('');
  /** Debounced so a poll is not issued per keystroke, as the memory panel does. */
  const [committedQuery, setCommittedQuery] = useState('');

  useEffect(() => {
    const t = window.setTimeout(() => setCommittedQuery(query.trim()), 300);
    return () => window.clearTimeout(t);
  }, [query]);

  const searchReady = mode === 'search' && committedQuery.length > 0;

  const recent = usePoll(() => listDocuments({ limit: 100 }), {
    enabled: enabled && mode === 'recent',
  });
  const found = usePoll(() => searchDocuments(committedQuery, { limit: 12 }), {
    enabled: enabled && searchReady,
  });

  const active = mode === 'search' ? found : recent;
  const docs = mode === 'search' ? [] : (recent.data ?? []);
  const hits = mode === 'search' ? (found.data ?? []) : [];
  const rowCount = mode === 'search' ? hits.length : docs.length;

  const remove = async (docId: string) => {
    await deleteDocument(docId);
    recent.refresh();
  };

  return (
    <Section
      icon={<BookOpenIcon className="size-3.5" />}
      title="Corpus"
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
      <div className="mb-2 flex gap-1" role="group" aria-label="Corpus view">
        {(
          [
            ['recent', 'Documents'],
            ['search', 'Search'],
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
        <AddDocumentForm
          onAdded={() => {
            setMode('recent');
            recent.refresh();
          }}
        />
      )}

      {mode === 'search' && (
        <input
          type="search"
          aria-label="Search the corpus"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="What would it retrieve?"
          className="mb-2 h-8 w-full rounded-md border border-border/60 bg-background px-2 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
        />
      )}

      {mode === 'add' ? null : (
        <SectionBody
          onRetry={active.refresh}
          doing="read the document corpus"
          loading={active.loading && !active.data}
          error={active.error}
          empty={mode === 'search' && !searchReady ? true : rowCount === 0}
          emptyText={
            mode === 'search'
              ? searchReady
                ? 'Nothing retrieved for that.'
                : 'Type to reproduce what the agent would retrieve.'
              : 'No documents yet. Add one to give the agent something to retrieve.'
          }
          status={
            mode === 'search'
              ? hits.length
                ? `${hits.length} ${hits.length === 1 ? 'chunk' : 'chunks'}`
                : undefined
              : docs.length
                ? `${docs.length} ${docs.length === 1 ? 'document' : 'documents'}`
                : undefined
          }
        >
          {mode === 'search' ? (
            <ul className="space-y-2">
              {hits.map((h: DocumentHit) => (
                <li
                  key={h.chunk_id}
                  className="rounded-lg border border-border/60 px-2.5 py-2 text-xs"
                >
                  <p className="leading-snug break-words">{h.content}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-muted-foreground">
                    <span className="break-all">{h.title}</span>
                    {h.source && <span>· {h.source}</span>}
                    {/* Which passage, not just which document — the hit is a chunk. */}
                    <span>· chunk {h.chunk_index}</span>
                    <span>· score {h.score.toFixed(3)}</span>
                    {/*
                      `lexical` on its own means the vector retriever never ran —
                      no embedder configured — rather than that it ran and
                      disagreed. That distinction is the difference between
                      "retrieval is wrong" and "retrieval is half-configured".
                    */}
                    {h.channels?.length ? <span>· via {h.channels.join('+')}</span> : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="space-y-2">
              {docs.map((d: DocumentRecord) => (
                <li
                  key={d.doc_id}
                  className="rounded-lg border border-border/60 px-2.5 py-2 text-xs"
                >
                  <p className="leading-snug break-words">{d.title}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-muted-foreground">
                    {d.source && <span className="break-all">{d.source}</span>}
                    <span>
                      {d.source ? '· ' : ''}
                      {d.chunks} {d.chunks === 1 ? 'chunk' : 'chunks'}
                    </span>
                  </div>
                  <div className="mt-1.5">
                    {/*
                      "Delete", not "Forget". The harness removes the document and
                      every chunk of it, so the word memory's panel uses would
                      understate what this does.
                    */}
                    <ConfirmButton
                      size="sm"
                      variant="ghost"
                      destructive
                      question={`"${d.title.slice(0, 80)}" and all ${d.chunks} of its chunks will be removed.`}
                      confirmLabel="Delete it"
                      onConfirm={() => remove(d.doc_id)}
                    >
                      Delete
                    </ConfirmButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionBody>
      )}
    </Section>
  );
}

/**
 * Put text in front of the model that it will retrieve later.
 *
 * The same warning the Add-memory form carries, and for the same reason: this is
 * an injection ingress by design. Whatever lands here is text the model reads
 * back in a session nobody is watching, without the provenance a tool result
 * carries. Saying so is the honest framing; dressing it as an upload box is not.
 *
 * `(source, title)` is the document's identity upstream, so re-adding the same
 * pair replaces rather than duplicates — which also means a changed title makes
 * a *second* document rather than correcting the first. The form says that where
 * the decision is made rather than in a doc nobody opens.
 */
function AddDocumentForm({ onAdded }: { onAdded: () => void }) {
  const [title, setTitle] = useState('');
  const [source, setSource] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titleValue = title.trim();
  const textValue = text.trim();
  const ready =
    titleValue.length > 0 &&
    titleValue.length <= DOCUMENT_LIMITS.title &&
    textValue.length > 0 &&
    textValue.length <= DOCUMENT_LIMITS.text &&
    source.trim().length <= DOCUMENT_LIMITS.source;

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await addDocument({ title: titleValue, source: source.trim(), text: textValue });
      setTitle('');
      setSource('');
      setText('');
      onAdded();
    } catch (err) {
      setError(describeError(err, 'add a document').message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 text-xs">
      <p className="text-muted-foreground">
        The agent retrieves this text later and reads it as context. Treat it the way you would
        treat anything you put in front of the model.
      </p>
      <input
        aria-label="Document title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        maxLength={DOCUMENT_LIMITS.title}
        className="h-8 w-full rounded-md border border-border/60 bg-background px-2 outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
      />
      <input
        aria-label="Document source"
        value={source}
        onChange={(e) => setSource(e.target.value)}
        placeholder="Source, e.g. wiki/runbooks (optional)"
        maxLength={DOCUMENT_LIMITS.source}
        className="h-8 w-full rounded-md border border-border/60 bg-background px-2 outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
      />
      <textarea
        aria-label="Document text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="The text itself"
        rows={6}
        className="w-full resize-y rounded-md border border-border/60 bg-background px-2 py-1.5 outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-muted-foreground">
          {textValue.length.toLocaleString()} / {DOCUMENT_LIMITS.text.toLocaleString()}
        </span>
        <Button size="sm" disabled={!ready || busy} onClick={submit}>
          {busy ? 'Adding…' : 'Add document'}
        </Button>
      </div>
      {/*
        Stated at the point of decision: re-adding the same source and title
        replaces, so this is how a re-sync stays idempotent — and how a typo
        makes a duplicate instead of a correction.
      */}
      <p className="text-muted-foreground">Same source and title replaces what is already there.</p>
      {error && <p className="text-state-failed">{error}</p>}
    </div>
  );
}
