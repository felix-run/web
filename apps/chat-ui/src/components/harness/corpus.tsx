import { describeError } from '@felix/client';
import { Button } from '@felix/ui/button';
import { Input } from '@felix/ui/input';
import { Label } from '@felix/ui/label';
import { Textarea } from '@felix/ui/textarea';
import { BookOpenIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { addDocument, deleteDocument, listDocuments, searchDocuments } from '@/api';
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
import type { DocumentHit, DocumentRecord } from '@/types';
import { DOCUMENT_LIMITS } from '@/types';

/**
 * The corpus the agent retrieves from.
 *
 * `/memory` is what the agent *learned*; this is what it was *given*. The
 * operator question is the same one and it is asked the same way — find the
 * passage behind a bad answer and remove it — so this mirrors the memory page:
 * the view switch and Add in the header, the view and query in the address,
 * rows between hairlines.
 *
 * Two places where it must not mirror it, because the harness behaves
 * differently and a panel that says otherwise is lying:
 *
 * - Delete here is **hard**. Memory's is soft, and its button says "Forget" for
 *   that reason. This one removes every chunk and says how many went.
 * - A search hit is a **chunk**, not a document. Showing the document title
 *   alone would hide the thing actually retrieved.
 */
/** The fetch caps, named because the header's value has to know them to stay true. */
const RECENT_LIMIT = 100;
const SEARCH_LIMIT = 12;

const VIEWS = [
  ['recent', 'Documents'],
  ['search', 'Search'],
] as const;

export function DocumentsSection({
  enabled,
  open,
  onToggle,
}: {
  enabled: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const [params, setParams] = useSearchParams();
  const mode: 'recent' | 'search' = params.get('view') === 'search' ? 'search' : 'recent';
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState(() => params.get('q') ?? '');
  /** Debounced so a poll is not issued per keystroke, as the memory page does. */
  const [committedQuery, setCommittedQuery] = useState(() => (params.get('q') ?? '').trim());

  useEffect(() => {
    const t = window.setTimeout(() => setCommittedQuery(query.trim()), 300);
    return () => window.clearTimeout(t);
  }, [query]);

  // `replace`, as on Memory: a refined query is not a place Back steps through.
  useEffect(() => {
    const next = keepAgent(params, {});
    if (mode === 'search') {
      next.set('view', 'search');
      if (committedQuery) next.set('q', committedQuery);
    }
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [mode, committedQuery, params, setParams]);

  const setMode = (next: 'recent' | 'search') =>
    setParams(keepAgent(params, next === 'search' ? { view: 'search' } : {}), { replace: true });

  const searchReady = mode === 'search' && committedQuery.length > 0;

  const recent = usePoll(() => listDocuments({ limit: RECENT_LIMIT }), {
    enabled: enabled && mode === 'recent',
  });
  const found = usePoll(() => searchDocuments(committedQuery, { limit: SEARCH_LIMIT }), {
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
      // A search hit is a chunk, not a document, so the two views count different
      // things and say so. Nothing while the first fetch is in flight.
      meta={
        mode === 'recent' && recent.data
          ? plural(recent.data.length, 'document', 'documents', RECENT_LIMIT)
          : mode === 'search' && searchReady && found.data
            ? plural(found.data.length, 'passage', 'passages', SEARCH_LIMIT)
            : undefined
      }
      metaAsOf={active.error ? active.lastOkAt : undefined}
      open={open}
      onToggle={onToggle}
      controls={
        <>
          <ViewSwitch label="Corpus view" value={mode} options={VIEWS} onChange={setMode} />
          <CreateToggle open={adding} onToggle={() => setAdding((a) => !a)} controls="corpus-add">
            Add document
          </CreateToggle>
        </>
      }
    >
      {adding && (
        <div id="corpus-add" className={CREATE_FORM}>
          <PageSection title="New document">
            <AddDocumentForm
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

      {mode === 'search' && (
        <div className="mb-3">
          <Label htmlFor="corpus-search">What would it retrieve?</Label>
          <Input
            id="corpus-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="mt-1 h-8 max-w-md text-sm"
          />
        </div>
      )}

      <SectionBody
        onRetry={active.refresh}
        lastOkAt={active.lastOkAt}
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
        {/* Rows between hairlines, as the Ledger's and Memory's are; they were
            bordered boxes at 11px. */}
        {mode === 'search' ? (
          <ul>
            {hits.map((h: DocumentHit) => (
              <li key={h.chunk_id} className="border-b border-border/60 py-2.5 first:border-t">
                <p className="text-sm leading-snug break-words">{h.content}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-xs text-muted-foreground">
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
          <ul>
            {docs.map((d: DocumentRecord) => (
              <li
                key={d.doc_id}
                className="flex items-start gap-3 border-b border-border/60 py-2.5 first:border-t"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug break-words">{d.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-xs text-muted-foreground">
                    {d.source && <span className="break-all">{d.source}</span>}
                    <span>
                      {d.source ? '· ' : ''}
                      {d.chunks} {d.chunks === 1 ? 'chunk' : 'chunks'}
                    </span>
                  </div>
                </div>
                {/*
                  "Delete", not "Forget". The harness removes the document and
                  every chunk of it, so the word memory's page uses would
                  understate what this does.
                */}
                <ConfirmButton
                  size="xs"
                  variant="ghost"
                  className="shrink-0 text-muted-foreground hover:text-state-failed"
                  destructive
                  question={`"${d.title.slice(0, 80)}" and all ${d.chunks} of its chunks will be removed.`}
                  confirmLabel="Delete it"
                  onConfirm={() => remove(d.doc_id)}
                >
                  Delete
                </ConfirmButton>
              </li>
            ))}
          </ul>
        )}
      </SectionBody>
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
function AddDocumentForm({ onAdded, onCancel }: { onAdded: () => void; onCancel: () => void }) {
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

  // The shared primitives with labels that stay on screen, as Memory's form
  // now has; these were hand-rolled 11px fields with a 1px focus ring.
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        The agent retrieves this text later and reads it as context. Treat it the way you would
        treat anything you put in front of the model.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="corpus-title">Title</Label>
          <Input
            id="corpus-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={DOCUMENT_LIMITS.title}
            className="mt-1 h-8 text-sm"
          />
        </div>
        <div>
          <Label htmlFor="corpus-source">Source (optional)</Label>
          <Input
            id="corpus-source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="wiki/runbooks"
            maxLength={DOCUMENT_LIMITS.source}
            className="mt-1 h-8 font-mono text-sm placeholder:font-sans"
          />
        </div>
      </div>
      {/*
        Stated at the point of decision: re-adding the same source and title
        replaces, so this is how a re-sync stays idempotent — and how a typo
        makes a duplicate instead of a correction.
      */}
      <p className="text-xs text-muted-foreground">
        The same source and title replaces what is already there.
      </p>
      <div>
        <Label htmlFor="corpus-text">Text</Label>
        <Textarea
          id="corpus-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          aria-describedby="corpus-text-count"
          className="mt-1 resize-y text-sm"
        />
        <p id="corpus-text-count" className="mt-1 font-mono text-xs text-muted-foreground">
          {textValue.length.toLocaleString()} / {DOCUMENT_LIMITS.text.toLocaleString()}
        </p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={!ready || busy} onClick={submit}>
          {busy ? 'Adding…' : 'Add document'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-state-failed">
          {error}
        </p>
      )}
    </div>
  );
}
