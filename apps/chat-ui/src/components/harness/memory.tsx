import { describeError, relativeTime, threadSuffix } from '@felix/client';
import { Button } from '@felix/ui/button';
import { Input } from '@felix/ui/input';
import { Label } from '@felix/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@felix/ui/select';
import { Textarea } from '@felix/ui/textarea';
import { BrainIcon } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  addMemory,
  forgetMemory,
  listMemories,
  memoriesAsOf,
  restoreMemory,
  searchMemories,
} from '@/api';
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
import { middleTruncate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useShell } from '@/shell-context';
import type { MemoryHit, MemoryRecord } from '@/types';

/**
 * What the agent has stored across sessions, and how to get rid of it.
 *
 * The store is otherwise invisible: when a run starts answering from a fact that
 * is stale, wrong, or was extracted from a hostile tool result, this is the only
 * place to find that fact without a database console.
 *
 * Four views over the same store, because they answer different questions.
 * Recent says what is held. Search reproduces the agent's own hybrid ranking —
 * and reports which retriever produced each hit, since "why did it recall
 * *that*" is usually answered by the channel rather than the text. "As of"
 * replays what one conversation had stored at one of its turns, superseded facts
 * included. Forgotten is what a forget hid, and the way to bring it back.
 *
 * Every row leads with where it came from — the conversation, the turn, the
 * agent, when it was written and whether it has been recalled since — because
 * the hunt this page exists for ends at "which conversation taught it this?",
 * and a row that cannot answer sends the operator to the database after all.
 *
 * The view, the query, the conversation and the turn live in the address
 * (`?view=asof&thread=…&turn=12`), so "what it had at turn 12" is a link.
 *
 * Forgetting is soft on the harness side: the row moves to `forgotten` and drops
 * out of recall rather than being erased. The UI says "forget" rather than
 * "delete" so it does not promise more than that, and offers Undo because the
 * harness can.
 */
/** The fetch caps, named because the header's value has to know them to stay true. */
const PAGE = 50;
const LIST_MAX = 500;
const SEARCH_LIMIT = 12;
const AS_OF_LIMIT = 100;

type MemoryView = 'recent' | 'search' | 'asOf' | 'forgotten';
const VIEWS = [
  ['recent', 'Recent'],
  ['search', 'Search'],
  ['asOf', 'As of'],
  ['forgotten', 'Forgotten'],
] as const;

/** The view in the address. `asof` is the spelling in the URL; anything else is Recent. */
export function readView(params: URLSearchParams): MemoryView {
  const v = params.get('view');
  return v === 'search'
    ? 'search'
    : v === 'asof'
      ? 'asOf'
      : v === 'forgotten'
        ? 'forgotten'
        : 'recent';
}

/** The id each view's own input carries, so switching to it can put the caret there. */
const VIEW_FIELD: Partial<Record<MemoryView, string>> = {
  search: 'memory-search',
  asOf: 'memory-as-of-thread',
};

/** Radix refuses `''` as an item value, so "every agent" needs a spelling of its own. */
const EVERY_AGENT = '*';

/** What a row is about to lose, quoted in full sentences rather than cut mid-word. */
function quote(text: string, max = 80): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * The retriever names, in the words this page uses everywhere. Recent says a row
 * is "lexical only"; Search said the same channel was `fts` — one channel, two
 * names, a page apart.
 */
const CHANNEL: Record<string, string> = { fts: 'lexical', vector: 'vector', topic: 'topic' };

/**
 * The reading measure for prose on this page. `70ch` looked like the floor's 65–75
 * and was not: `ch` is the width of a "0", wider than average prose, so at 13px it
 * held ~94 characters a line. 30rem holds ~75.
 */
const PROSE = 'max-w-[30rem]';

/**
 * A link inside an 11px line of metadata: muted like the line, and marked as a link
 * by an underline that is always there rather than only on hover — colour alone
 * told it apart from the text around it by nothing. The negative margin gives it a
 * 24px target without making the line taller.
 */
const META_LINK =
  '-my-1 py-1 underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground hover:decoration-current focus-visible:rounded-sm focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none';

type Notice =
  | { kind: 'added'; content: string; agent: string }
  | { kind: 'forgot'; id: string; content: string }
  | { kind: 'restored'; content: string }
  | { kind: 'error'; message: string };

export function MemorySection({
  enabled,
  open,
  onToggle,
}: {
  enabled: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const { threads, manifest, manifestOptions } = useShell();
  const [params, setParams] = useSearchParams();
  const mode = readView(params);
  // Only an agent the address names explicitly. The rest of `/harness` falls back
  // to the chat's agent, but a store filtered to it by default would hide every
  // other agent's memories from the page that exists to find them.
  const agent = params.get('agent') ?? '';
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState(() => params.get('q') ?? '');
  // The conversation and turn are read from the address and written straight to
  // it, never mirrored in state: a row's "turn 4" link moves the address while
  // this view is mounted, and a mirrored copy raced the write-back below and
  // wiped the thread it had just been handed.
  const asOfThread = params.get('thread') ?? '';
  const asOfSeq = params.get('turn') ?? '';
  const [limit, setLimit] = useState(PAGE);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  /** The memory Add just stored, marked in the list until the next thing done here. */
  const [freshId, setFreshId] = useState<string | null>(null);
  /** Set by a user's switch, and only then: a page load on `?view=search` keeps focus where it was. */
  const focusNext = useRef<MemoryView | null>(null);
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
      if (asOfThread) next.set('thread', asOfThread);
      if (asOfSeq.trim()) next.set('turn', asOfSeq.trim());
    } else if (mode === 'forgotten') {
      next.set('view', 'forgotten');
    }
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [mode, committedQuery, asOfThread, asOfSeq, params, setParams]);

  const setAsOf = (key: 'thread' | 'turn', value: string) => {
    const out = new URLSearchParams(params);
    if (value.trim()) out.set(key, value.trim());
    else out.delete(key);
    setParams(out, { replace: true });
  };

  // The view's own field takes the caret once it exists, so a switch to Search is
  // a switch to typing rather than a Tab away from it.
  useEffect(() => {
    if (focusNext.current !== mode) return;
    focusNext.current = null;
    const id = VIEW_FIELD[mode];
    if (id) document.getElementById(id)?.focus();
  }, [mode]);

  // A larger page belongs to the list it was asked for; another view or agent starts over.
  useEffect(() => setLimit(PAGE), [mode, agent]);

  const setMode = (next: MemoryView) => {
    focusNext.current = next;
    // The notice survives a view change: Undo after a forget is the one way back,
    // and it used to vanish the moment the operator looked anywhere else.
    setParams(
      keepAgent(
        params,
        next === 'search'
          ? { view: 'search' }
          : next === 'asOf'
            ? { view: 'asof' }
            : next === 'forgotten'
              ? { view: 'forgotten' }
              : {},
      ),
      { replace: true },
    );
  };

  const setAgent = (next: string) => {
    const out = new URLSearchParams(params);
    if (next === EVERY_AGENT) out.delete('agent');
    else out.set('agent', next);
    setParams(out, { replace: true });
  };

  const seq = Number.parseInt(asOfSeq, 10);
  const asOfReady = mode === 'asOf' && asOfThread !== '' && Number.isFinite(seq) && seq >= 0;
  const searchReady = mode === 'search' && committedQuery.length > 0;
  const manifestId = agent || undefined;

  const recent = usePoll(() => listMemories({ limit, manifestId }), {
    enabled: enabled && mode === 'recent',
  });
  const found = usePoll(() => searchMemories(committedQuery, { limit: SEARCH_LIMIT, manifestId }), {
    enabled: enabled && searchReady,
  });
  const past = usePoll(
    () => memoriesAsOf(seq, { limit: AS_OF_LIMIT, manifestId, threadId: asOfThread }),
    { enabled: enabled && asOfReady },
  );
  const gone = usePoll(() => listMemories({ limit, manifestId, status: 'forgotten' }), {
    enabled: enabled && mode === 'forgotten',
  });

  const active =
    mode === 'search' ? found : mode === 'asOf' ? past : mode === 'forgotten' ? gone : recent;
  const rows: Array<MemoryRecord | MemoryHit> = active.data ?? [];
  const pageable = mode === 'recent' || mode === 'forgotten';

  const titleOf = (suffix: string) => threads.find((t) => t.id === suffix)?.title;

  const forget = async (row: MemoryRecord | MemoryHit) => {
    setRowErrors(({ [row.id]: _, ...rest }) => rest);
    try {
      await forgetMemory(row.id);
      setFreshId(null);
      setNotice({ kind: 'forgot', id: row.id, content: row.content });
      active.refresh();
    } catch (err) {
      // On the row, where the button that failed is. Before this the rejection
      // escaped the confirm, which stayed armed with nothing on screen to say the
      // fact was still being recalled.
      setRowErrors((e) => ({ ...e, [row.id]: describeError(err, 'forget this memory').message }));
    }
  };

  const restore = async (id: string, content: string, onRow: boolean) => {
    setRowErrors(({ [id]: _, ...rest }) => rest);
    try {
      await restoreMemory(id);
      setFreshId(null);
      setNotice({ kind: 'restored', content });
      active.refresh();
    } catch (err) {
      const message = explainRestore(err);
      if (onRow) setRowErrors((e) => ({ ...e, [id]: message }));
      else setNotice({ kind: 'error', message });
    }
  };

  // A harness older than the forgotten listing is not a failure to retry: asking
  // again gets the same answer. Said as what it is, in the empty state's voice.
  const tooOld =
    mode === 'forgotten' &&
    /does not list forgotten/.test(String((gone.error as Error | null)?.message ?? ''));
  // Hits from a harness that predates hit provenance carry no `thread_id` key at all
  // (a new one sends `''` for a memory written outside a conversation).
  const hitsWithoutOrigin =
    mode === 'search' && rows.length > 0 && rows.every((r) => !('thread_id' in r));

  return (
    <Section
      icon={<BrainIcon className="size-3.5" />}
      title="Memory"
      // The value follows the view, because each view is a different question:
      // what is held, what a query recalls, what one conversation had at a turn,
      // what was forgotten. Nothing while a view's first fetch is in flight — `0`
      // then would be a claim. It stays while the Add form is open, since the
      // list stays too.
      meta={
        mode === 'recent' && recent.data
          ? plural(recent.data.length, 'memory', 'memories', limit)
          : mode === 'search' && searchReady && found.data
            ? plural(found.data.length, 'match', 'matches', SEARCH_LIMIT)
            : mode === 'asOf' && asOfReady && past.data
              ? // The conversation is named once, in its own field below; repeated here
                // it was a long title pushing the controls onto a second row.
                `${plural(past.data.length, 'memory', 'memories', AS_OF_LIMIT)} at turn ${seq}`
              : mode === 'forgotten' && gone.data
                ? `${plural(gone.data.length, 'memory', 'memories', limit)} forgotten`
                : undefined
      }
      metaAsOf={active.error && !tooOld ? active.lastOkAt : undefined}
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
      {adding ? (
        <div id="memory-add" className={CREATE_FORM}>
          {/* Titled for what it makes, not for the button that opened it. */}
          <PageSection title="New memory">
            <AddMemoryForm
              defaultAgent={agent || manifest}
              chatAgent={manifest}
              agents={manifestOptions}
              onCancel={() => setAdding(false)}
              onAdded={(stored) => {
                setAdding(false);
                setMode('recent');
                setNotice({ kind: 'added', content: stored.content, agent: stored.agent });
                setFreshId(stored.id);
                recent.refresh();
              }}
            />
          </PageSection>
        </div>
      ) : (
        // The view's own inputs, hidden while Add is open: two forms stacked one on
        // the other read as one form, and the As-of field sat under "Remember it"
        // as if it were the next thing to fill in.
        <div className="mb-3 space-y-2">
          <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
            {mode === 'search' && (
              <div className="min-w-48 flex-1">
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
              <AsOfFields
                thread={asOfThread}
                turn={asOfSeq}
                threads={threads}
                onThread={(v) => setAsOf('thread', v)}
                onTurn={(v) => setAsOf('turn', v)}
              />
            )}
            <AgentFilter value={agent} options={manifestOptions} onChange={setAgent} />
          </div>
          {/* Its own line, under the row it explains. Inside the wrapping row it took
              whatever space was left, and the Agent filter landed beside it mid-row. */}
          {mode === 'asOf' && (
            <p id="memory-as-of-help" className={`${PROSE} text-xs text-muted-foreground`}>
              What the conversation had stored by that turn, including facts it later replaced.
              Every memory's turn is beside it; following one opens this view there.
            </p>
          )}
          {hitsWithoutOrigin && (
            <p className={`${PROSE} text-xs text-muted-foreground`}>
              This harness does not say where a search hit came from. The same memory under Recent
              does.
            </p>
          )}
        </div>
      )}

      {notice ? <NoticeLine notice={notice} onUndo={restore} /> : null}

      <SectionBody
        onRetry={active.refresh}
        lastOkAt={active.lastOkAt}
        doing={mode === 'forgotten' ? 'list forgotten memories' : 'read stored memory'}
        loading={active.loading && !active.data}
        error={tooOld ? undefined : active.error}
        empty={
          tooOld || (mode === 'search' && !searchReady) || (mode === 'asOf' && !asOfReady)
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
                ? 'This conversation had stored nothing by that turn.'
                : 'Pick a conversation and one of its turns to see what it had stored then.'
              : mode === 'forgotten'
                ? tooOld
                  ? 'This harness is older than this page: it keeps no list of forgotten memories, and a forget cannot be undone on it.'
                  : 'Nothing has been forgotten.'
                : 'Nothing stored yet. Memory accumulates as the agent works.'
        }
        status={
          rows.length
            ? mode === 'search'
              ? plural(rows.length, 'match', 'matches')
              : plural(rows.length, 'memory', 'memories')
            : undefined
        }
      >
        {/* Rows between hairlines, as the Activity page's are. The page header's
            rule is the first line, so the list draws none above its first row. */}
        <ul>
          {rows.map((m, i) => {
            const hit = mode === 'search' ? (m as MemoryHit) : null;
            const record = hit ? null : (m as MemoryRecord);
            const forgotten = (m.status ?? 'active') === 'forgotten';
            // A superseded row is already out of recall, so forgetting it changes
            // nothing and it offers nothing.
            const superseded = Boolean(record?.superseded_by) || m.status === 'superseded';
            return (
              // `flex-wrap`, so an armed Forget — a sentence and two buttons — drops to
              // its own line when the row has no room for it rather than crushing the fact.
              <li
                key={m.id}
                className={cn(
                  'flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-border/60 py-2.5',
                  // The memory just added, so the operator sees where it landed.
                  m.id === freshId && '-mx-2 rounded-sm bg-muted/60 px-2',
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className={`${PROSE} text-sm leading-snug break-words`}>{m.content}</p>
                  <Provenance
                    row={m}
                    titleOf={titleOf}
                    showAgent={!agent}
                    // As of already names its conversation and turn; each row repeating
                    // them was a link back to the view it was in.
                    hereThread={mode === 'asOf' ? asOfThread : undefined}
                    forgottenAt={forgotten ? record?.updated_at : undefined}
                  />
                  <Details row={m} hit={hit} rank={i + 1} record={record} />
                  {rowErrors[m.id] ? (
                    <p role="alert" className="mt-1 text-xs text-state-failed">
                      {rowErrors[m.id]}
                    </p>
                  ) : null}
                </div>
                {forgotten ? (
                  <Button
                    size="xs"
                    variant="outline"
                    className="shrink-0"
                    aria-label={`Restore “${quote(m.content, 40)}”`}
                    onClick={() => void restore(m.id, m.content, true)}
                  >
                    Restore
                  </Button>
                ) : superseded ? null : (
                  <ConfirmButton
                    size="xs"
                    variant="ghost"
                    // `shrink-0` on the resting button only: on `className` it reached the
                    // armed row too, which then could not narrow on a phone.
                    className="max-w-full"
                    restingClassName="shrink-0 text-muted-foreground hover:text-state-failed"
                    // A list of buttons read "Forget" once per row; the name says which.
                    aria-label={`Forget “${quote(m.content, 40)}”`}
                    destructive
                    question={`“${quote(m.content)}” will stop being recalled.`}
                    confirmLabel="Forget it"
                    onConfirm={() => forget(m)}
                  >
                    Forget
                  </ConfirmButton>
                )}
              </li>
            );
          })}
        </ul>
        {pageable && rows.length >= limit && limit < LIST_MAX ? (
          <Button
            size="sm"
            variant="ghost"
            className="mt-2"
            onClick={() => setLimit((n) => Math.min(n + PAGE, LIST_MAX))}
          >
            Show {Math.min(PAGE, LIST_MAX - limit)} more
          </Button>
        ) : null}
      </SectionBody>
    </Section>
  );
}

/** Restore's refusals, in words: the shared translation reads every 409 as an approval. */
function explainRestore(err: unknown): string {
  const raw = String((err as Error)?.message ?? err);
  const status = Number(raw.match(/:\s*(\d{3})\b/)?.[1]);
  if (status === 409) {
    return 'It is not forgotten: it is already recalled, or a newer memory replaced it.';
  }
  if (status === 403 && raw.includes('restore_refused')) {
    return 'It was forgotten by a writer this key cannot overrule.';
  }
  // A route the harness lacks is a 405 here (the path matches DELETE's) or a 404
  // that names no memory; a 404 that does is a row that has gone.
  if (status === 405 || (status === 404 && !raw.includes('unknown_memory'))) {
    return 'This harness cannot restore a forgotten memory; it is older than this page.';
  }
  return describeError(err, 'restore this memory').message;
}

/** A suffix nobody titled, cut from the middle at 20 with both ends kept (DESIGN.md). */
function shortId(suffix: string): string {
  return middleTruncate(suffix, 20);
}

/** An epoch the harness wrote in milliseconds, as this app's relative time. */
function ago(ms: number | null | undefined): string | null {
  return typeof ms === 'number' && ms > 0 ? relativeTime(ms) : null;
}

/**
 * Where a memory came from and whether it is still in play: the conversation and
 * turn that wrote it, the agent that recalls it, when, and when it was last
 * recalled. The first line under every fact, ahead of the harness's own fields,
 * because it is what decides whether a fact is stale or hostile.
 */
function Provenance({
  row,
  titleOf,
  showAgent,
  forgottenAt,
  hereThread,
}: {
  row: MemoryRecord | MemoryHit;
  titleOf: (suffix: string) => string | undefined;
  showAgent: boolean;
  forgottenAt?: number;
  /** The conversation the view is already about, whose name and turn the row skips. */
  hereThread?: string;
}) {
  const parts: ReactNode[] = [];
  const full = row.thread_id ?? undefined;
  const source = 'metadata' in row ? (row.metadata?.source as string | undefined) : undefined;

  if (full && threadSuffix(full) === hereThread) {
    // Named by the view; nothing to add.
  } else if (full) {
    const suffix = threadSuffix(full);
    // Trimmed: a title cut by the harness can end in a space, which the quotes then show.
    const title = titleOf(suffix)?.trim() || undefined;
    // "from" and quotes, because a bare title under a fact read as the fact's next
    // sentence — and titles are usually the first thing the user typed, so they
    // look exactly like memories. Cut from the middle, where two titles that share
    // an opening ("Create notes/…") still differ.
    parts.push(
      // A flex row, so the link inside is a block and its padding reaches 24px; inline,
      // the same padding measured 21.
      <span key="thread" className="inline-flex items-baseline gap-1">
        from
        <Link
          to={`/t/${encodeURIComponent(suffix)}`}
          className={META_LINK}
          title={title ?? suffix}
          aria-label={`Conversation ${title ? `“${title}”` : suffix}`}
        >
          {title ? (
            `“${middleTruncate(title, 32)}”`
          ) : (
            <span className="font-mono">{shortId(suffix)}</span>
          )}
        </Link>
      </span>,
    );
    if (typeof row.origin_seq === 'number') {
      const at = new URLSearchParams({
        view: 'asof',
        thread: suffix,
        turn: String(row.origin_seq),
      });
      parts.push(
        <Link
          key="turn"
          to={`?${at}`}
          replace
          className={META_LINK}
          title="What this conversation had stored at that turn"
        >
          turn {row.origin_seq}
        </Link>,
      );
    }
  } else if (full === '') {
    parts.push(
      <span key="thread">
        {source === 'management_api' ? 'added by an operator' : 'written outside a conversation'}
      </span>,
    );
  }
  if (showAgent && row.manifest_id) {
    parts.push(
      <span key="agent" className="font-mono">
        {row.manifest_id}
      </span>,
    );
  }
  const written = ago(row.created_at);
  if (written) {
    parts.push(
      <span key="written" title={new Date(row.created_at as number).toLocaleString()}>
        written {written}
      </span>,
    );
  }
  const forgot = ago(forgottenAt);
  if (forgot) parts.push(<span key="forgot">forgotten {forgot}</span>);
  else if ('last_used_at' in row && row.last_used_at !== undefined) {
    const used = ago(row.last_used_at);
    parts.push(<span key="used">{used ? `recalled ${used}` : 'never recalled'}</span>);
  }
  if (!parts.length) return null;
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
      {parts.flatMap((p, i) =>
        i === 0
          ? [p]
          : [
              <span key={`sep-${i}`} aria-hidden>
                ·
              </span>,
              p,
            ],
      )}
    </p>
  );
}

/**
 * The harness's own fields, after the provenance and in its spelling: kind,
 * topic, importance, and — for a hit — its place in the ranking and the
 * retrievers that found it. The fused score is a number nobody reads as a
 * quantity, so the rank is shown and the score is its tooltip.
 */
function Details({
  row,
  hit,
  rank,
  record,
}: {
  row: MemoryRecord | MemoryHit;
  hit: MemoryHit | null;
  rank: number;
  record: MemoryRecord | null;
}) {
  const parts: ReactNode[] = [<span key="kind">{row.kind}</span>];
  if (row.topic_key) parts.push(<span key="topic">{row.topic_key}</span>);
  if (typeof row.importance === 'number')
    parts.push(<span key="imp">importance {Number(row.importance.toFixed(2))}</span>);
  if (hit) {
    parts.push(
      <span key="rank" title={`Fused score ${hit.score.toFixed(3)}`}>
        #{rank}
      </span>,
    );
    // Which retriever fired. The usual answer to "why this result".
    if (hit.channels?.length)
      parts.push(<span key="via">via {hit.channels.map((c) => CHANNEL[c] ?? c).join(' + ')}</span>);
  }
  if (record?.superseded_by || row.status === 'superseded')
    parts.push(
      <span key="superseded" className="text-foreground">
        superseded
        {typeof record?.superseded_seq === 'number' ? ` at turn ${record.superseded_seq}` : ''}
      </span>,
    );
  /*
    How the row was embedded — the pair that answers "why did recall miss this".
    Shown only in the record views, where the question is about the row rather
    than about a ranking that already found it. `null` dim means no embedder ran,
    so the row is lexical-only; a dim that disagrees with the rest of the store
    means it was written under a different embedder and has quietly stopped
    matching.
  */
  if (record && record.embedding_dim == null)
    parts.push(
      <span key="lex" title="No embedder ran for this row; it is reachable by full text only.">
        lexical only
      </span>,
    );
  if (record?.embedding_model)
    parts.push(
      <span key="emb">
        {record.embedding_model}
        {record.embedding_dim ? `/${record.embedding_dim}` : ''}
      </span>,
    );
  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-xs text-muted-foreground">
      {parts.flatMap((p, i) =>
        i === 0
          ? [p]
          : [
              <span key={`sep-${i}`} aria-hidden>
                ·
              </span>,
              p,
            ],
      )}
    </p>
  );
}

/**
 * What the last forget or restore did, above the list it changed — and, for a
 * forget, the way back. Not a toast: it stays until the next action or view, so
 * Undo does not expire while the operator re-reads the fact.
 */
function NoticeLine({
  notice,
  onUndo,
}: {
  notice: Notice;
  onUndo: (id: string, content: string, onRow: boolean) => Promise<void>;
}) {
  return (
    <div
      role={notice.kind === 'error' ? 'alert' : 'status'}
      className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
    >
      {notice.kind === 'added' ? (
        // The one write here that used to end in silence, on the form that writes
        // model input: what was stored, and for whom.
        <span className={`${PROSE} text-muted-foreground`}>
          Stored for <span className="font-mono text-foreground">{notice.agent}</span>:{' '}
          <span className="text-foreground">“{quote(notice.content, 60)}”</span>. It can be recalled
          from that agent's next run.
        </span>
      ) : notice.kind === 'forgot' ? (
        <>
          <span className={`${PROSE} min-w-0 text-muted-foreground`}>
            Forgotten: <span className="text-foreground">“{quote(notice.content, 60)}”</span>. It is
            no longer recalled.
          </span>
          <Button
            size="xs"
            variant="outline"
            onClick={() => void onUndo(notice.id, notice.content, false)}
          >
            Undo
          </Button>
        </>
      ) : notice.kind === 'restored' ? (
        <span className={`${PROSE} text-muted-foreground`}>
          Restored: <span className="text-foreground">“{quote(notice.content, 60)}”</span> is
          recalled again.
        </span>
      ) : (
        <span className={`${PROSE} text-state-failed`}>{notice.message}</span>
      )}
    </div>
  );
}

/**
 * Which agent's memory to show. Every agent by default: the rest of `/harness`
 * looks at the chat's agent, but this page exists to find a fact wherever it is.
 */
function AgentFilter({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (next: string) => void;
}) {
  const all = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <div>
      <Label htmlFor="memory-agent">Agent</Label>
      <Select value={value || EVERY_AGENT} onValueChange={(v) => v && onChange(v)}>
        <SelectTrigger id="memory-agent" size="sm" className="mt-1 h-8 w-40 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={EVERY_AGENT}>Every agent</SelectItem>
          {all.map((m) => (
            <SelectItem key={m} value={m} className="font-mono">
              {m}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * The two halves of an As-of question. A turn number is an ordinal into one
 * conversation's log, so the conversation comes first: "turn 4" alone collected
 * whatever every conversation wrote at its own fourth turn.
 */
function AsOfFields({
  thread,
  turn,
  threads,
  onThread,
  onTurn,
}: {
  thread: string;
  turn: string;
  threads: ReadonlyArray<{ id: string; title: string }>;
  onThread: (suffix: string) => void;
  onTurn: (turn: string) => void;
}) {
  // A conversation reached from a row link may not be in this tab's index — one
  // another client started — so it is offered under its id rather than dropped.
  const known = threads.some((t) => t.id === thread);
  // One cluster: the two halves of one question stay side by side when the row wraps,
  // where they used to be flung to opposite edges.
  return (
    <div className="flex min-w-0 items-end gap-2">
      <div className="w-72 min-w-0">
        <Label htmlFor="memory-as-of-thread">Conversation</Label>
        <Select value={thread || undefined} onValueChange={(v) => v && onThread(v)}>
          <SelectTrigger id="memory-as-of-thread" size="sm" className="mt-1 h-8 w-full text-sm">
            <SelectValue placeholder="Choose a conversation" />
          </SelectTrigger>
          <SelectContent>
            {thread && !known ? (
              <SelectItem value={thread} className="font-mono">
                {shortId(thread)}
              </SelectItem>
            ) : null}
            {threads.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="memory-as-of">Turn</Label>
        <Input
          id="memory-as-of"
          type="number"
          min={0}
          value={turn}
          onChange={(e) => onTurn(e.target.value)}
          aria-describedby="memory-as-of-help"
          className="mt-1 h-8 w-20 font-mono text-sm"
        />
      </div>
    </div>
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
 *
 * It names the agent because the harness does: an agent recalls only memories
 * stored under its own manifest id. This sent none, and every memory added here
 * was a successful write no agent ever read back.
 */
function AddMemoryForm({
  defaultAgent,
  chatAgent,
  agents,
  onAdded,
  onCancel,
}: {
  defaultAgent: string;
  /** The agent Chat is talking to, so the form can say when the default is that one. */
  chatAgent: string;
  agents: string[];
  onAdded: (stored: { id: string; content: string; agent: string }) => void;
  onCancel: () => void;
}) {
  const [content, setContent] = useState('');
  const [topicKey, setTopicKey] = useState('');
  const [importance, setImportance] = useState('0.5');
  const [agent, setAgent] = useState(defaultAgent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = content.trim();
  const weight = Number(importance);
  const ready =
    value.length > 0 &&
    value.length <= MEMORY_CONTENT_MAX &&
    topicKey.length <= MEMORY_TOPIC_MAX &&
    agent !== '' &&
    Number.isFinite(weight) &&
    weight >= 0 &&
    weight <= 1;
  const options = agents.includes(agent) || !agent ? agents : [agent, ...agents];

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const stored = await addMemory({
        content: value,
        manifestId: agent,
        topicKey: topicKey.trim(),
        importance: weight,
      });
      setContent('');
      setTopicKey('');
      onAdded({ id: stored.id, content: value, agent });
    } catch (err) {
      setError(describeError(err, 'store this memory').message);
    } finally {
      setBusy(false);
    }
  };

  // The shared primitives at the body size, with labels that stay on screen.
  return (
    <div className="space-y-3">
      <p className={`${PROSE} text-sm text-muted-foreground`}>
        Stored as a fact the agent can recall. It becomes model input in later sessions, so write it
        the way you would write an instruction.
      </p>
      <div>
        <Label htmlFor="memory-content">What to remember</Label>
        {/* Focused on open: the operator pressed Add to type this. No placeholder,
            because example text in an empty field read as a memory already there. */}
        <Textarea
          id="memory-content"
          autoFocus
          value={content}
          maxLength={MEMORY_CONTENT_MAX}
          rows={3}
          onChange={(e) => setContent(e.target.value)}
          aria-describedby="memory-content-count"
          className="mt-1 resize-y text-sm"
        />
        <p id="memory-content-count" className="mt-1 text-xs text-muted-foreground tabular-nums">
          {value.length}/{MEMORY_CONTENT_MAX}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-[11rem_minmax(0,1fr)_10rem]">
        <div>
          <Label htmlFor="memory-recalled-by">Recalled by</Label>
          <Select value={agent || undefined} onValueChange={(v) => v && setAgent(v)}>
            <SelectTrigger
              id="memory-recalled-by"
              size="sm"
              aria-describedby="memory-recalled-by-help"
              className="mt-1 h-8 w-full font-mono text-sm"
            >
              <SelectValue placeholder="Choose an agent" />
            </SelectTrigger>
            <SelectContent>
              {options.map((m) => (
                <SelectItem key={m} value={m} className="font-mono">
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Each field's help under the field, not in a list two rows below them. */}
          <p id="memory-recalled-by-help" className="mt-1 text-xs text-muted-foreground">
            {agent === chatAgent
              ? 'Only this agent recalls it. It starts as the agent Chat is using.'
              : 'Only this agent recalls it.'}
          </p>
        </div>
        <div>
          <Label htmlFor="memory-topic">Topic (optional)</Label>
          <Input
            id="memory-topic"
            value={topicKey}
            maxLength={MEMORY_TOPIC_MAX}
            onChange={(e) => setTopicKey(e.target.value)}
            aria-describedby="memory-topic-help"
            className="mt-1 h-8 font-mono text-sm"
          />
          <p id="memory-topic-help" className="mt-1 text-xs text-muted-foreground">
            Replaces whatever this agent has stored under the same topic.
          </p>
        </div>
        <div>
          <Label htmlFor="memory-importance">Importance</Label>
          <Input
            id="memory-importance"
            type="number"
            min={0}
            max={1}
            step={0.1}
            value={importance}
            onChange={(e) => setImportance(e.target.value)}
            aria-describedby="memory-importance-help"
            className="mt-1 h-8 font-mono text-sm"
          />
          <p id="memory-importance-help" className="mt-1 text-xs text-muted-foreground">
            0 to 1. Higher is kept first when not everything fits.
          </p>
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
