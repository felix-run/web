import { relativeTime, type ThreadMeta, threadSuffix } from '@felix/client';
import { Button } from '@felix/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@felix/ui/dropdown-menu';
import {
  ChevronRightIcon,
  DownloadIcon,
  GitBranchIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  SearchIcon,
  ShrinkIcon,
  Trash2Icon,
} from 'lucide-react';
import { type Ref, useEffect, useId, useMemo, useRef, useState } from 'react';
import { searchSessions } from '@/api';
import { CutId } from '@/components/cut-id';
import { groupThreads, threadLabel } from '@/lib/threads';
import { cn } from '@/lib/utils';

const NO_BLOCKED: ReadonlySet<string> = new Set();
const NO_PINS: ReadonlySet<string> = new Set();

/**
 * Characters of an id a row draws. A UUID is 36; this keeps eleven of its head
 * and twelve of its tail, which is where two of them differ.
 */
const ID_CHARS = 24;

/**
 * Every thread this client can reach, as the sidebar's Threads section.
 *
 * Grouped the way a returning operator looks for one: what they pinned, then by
 * last activity — Today, Yesterday, Previous 7 days, Older. Older starts folded
 * with its count showing, because on a long-lived harness it is most of the list
 * and the reason the other sections would scroll out of reach. A search drops
 * the groups: a match is a match, whenever it last moved.
 *
 * One noun: **thread**. This list was headed "History", searched "sessions" and
 * deleted "conversations" while its trigger said "Threads" — four names for the
 * object a returning operator is trying to find. "New chat" stays as the action's
 * name, because it is a verb phrase for starting one rather than a second noun.
 *
 * The list is `GET /chat/sessions` merged over the localStorage index, so a
 * thread started in another browser shows up here — see `mergeSessions`. A row
 * the harness does not know is marked local-only rather than hidden, because
 * its transcript may exist nowhere else.
 *
 * Selecting a thread loads its cached transcript and hydrates it from the server
 * event log; the trash icon removes it locally (and best-effort server-side).
 * Search queries local titles first, then the server FTS index when available.
 *
 * A row is read by someone coming back, so what it says has to tell rows apart
 * without hovering: the best title there is (see `threadLabel`), the agent when
 * this client knows it, how long ago, and whether a call on that thread is
 * waiting on a person. There is no per-row icon — an icon on every row marks a
 * row, not a kind, and the width is worth more as title.
 */
export function ThreadList({
  threads,
  currentId,
  disabled,
  onSelect,
  onNew,
  onDelete,
  onRename,
  onFork,
  onCompact,
  onExport,
  blocked = NO_BLOCKED,
  pinned = NO_PINS,
  onTogglePin,
  searchRef,
  className,
}: {
  threads: ThreadMeta[];
  currentId: string;
  /**
   * Threads with an approval pending, by suffix — from the shell's tenant-wide
   * `/approvals` poll, which names each row's originating thread. Only positive
   * evidence marks a row: an approval with no thread marks none.
   */
  blocked?: ReadonlySet<string>;
  /** Pinned thread ids, from this browser's own store (`readPins`). */
  pinned?: ReadonlySet<string>;
  /** Pin or unpin a thread. Omit to hide the action. */
  onTogglePin?: (id: string) => void;
  /** The search field, so a shortcut can land focus there rather than on New chat. */
  searchRef?: Ref<HTMLInputElement>;
  disabled?: boolean;
  onSelect: (id: string) => void;
  /** Draws New chat beside the heading. The sidebar omits it: its own header holds New chat. */
  onNew?: () => void;
  onDelete: (id: string) => void;
  /** Persist a name via POST /chat/sessions/name. Omit to hide the action. */
  onRename?: (id: string, name: string) => void;
  onFork?: (id: string) => void;
  onCompact?: (id: string) => void;
  onExport?: (id: string) => void;
  /** Set by the shell when this renders inside a drawer instead of as a column. */
  className?: string;
}) {
  const [query, setQuery] = useState('');
  /** Thread being renamed inline, and the draft. Null when nothing is being renamed. */
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  /**
   * Set when "Rename" is chosen, read as the menu closes.
   *
   * Radix returns focus to the menu trigger on close, and it does so *after* the
   * rename input has mounted and taken focus — so without this the field appears
   * with the caret still on the button behind it, and typing goes nowhere.
   */
  const renameJustStarted = useRef(false);
  /**
   * Move focus into the rename field once it exists.
   *
   * Deliberately an effect rather than a mount-time ref callback: the field is
   * opened from a menu, and Radix returns focus to the trigger as that menu
   * unmounts — which happens *after* the field mounts, so a synchronous focus
   * there is silently undone. `onCloseAutoFocus` below stops the steal; this
   * runs after paint so it wins regardless of ordering.
   */
  // Keyed on the id alone: re-running on every keystroke would re-select the text.
  useEffect(() => {
    if (!renaming) return;
    const frame = requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [renaming?.id]);

  const [hits, setHits] = useState<
    Array<{ thread_id: string; content: string; event_id?: string }>
  >([]);
  const [searching, setSearching] = useState(false);

  // Keyed on the list, not the query: a placeholder-titled row reads its cached
  // transcript once per index change rather than once per keystroke.
  const labels = useMemo(() => new Map(threads.map((t) => [t.id, threadLabel(t)])), [threads]);

  const localFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return threads;
    // Matches what the row *shows*, so a thread listed by its first message or
    // its id can be found by typing what is on screen.
    return threads.filter(
      (t) =>
        (labels.get(t.id)?.text ?? t.title).toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q) ||
        t.manifest.toLowerCase().includes(q),
    );
  }, [threads, labels, query]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void searchSessions(q, 12)
        .then((rows) => {
          if (!cancelled) setHits(rows);
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const remoteOnly = useMemo(() => {
    const localIds = new Set(threads.map((t) => t.id));
    const seen = new Set<string>();
    const out: Array<{ id: string; snippet: string }> = [];
    for (const hit of hits) {
      const id = threadSuffix(hit.thread_id);
      if (localIds.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, snippet: hit.content });
    }
    return out;
  }, [hits, threads]);

  const filtering = query.trim() !== '';
  const groups = useMemo(() => groupThreads(threads, pinned), [threads, pinned]);
  const currentIsOlder = groups.some(
    (g) => g.key === 'older' && g.threads.some((t) => t.id === currentId),
  );
  const [olderOpen, setOlderOpen] = useState(false);
  // The thread on screen is never folded away: arriving on an old thread from a
  // link would otherwise leave the sidebar with no row marked current.
  const olderShown = olderOpen || currentIsOlder;
  const ids = useId();

  function renderRow(t: ThreadMeta) {
    const label = labels.get(t.id) ?? { text: t.title, isId: false };
    const waiting = blocked.has(t.id);
    const isPinned = pinned.has(t.id);
    return (
      <div
        key={t.id}
        className={cn(
          'group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
          t.id === currentId ? 'bg-accent' : 'hover:bg-accent/50',
        )}
      >
        {renaming?.id === t.id ? (
          <input
            // Renaming is a text edit, so it happens in place rather than in
            // a dialog: the row already shows the name being changed. Focus
            // moves here via a stable callback ref rather than `autoFocus`,
            // which only reads as helpful because the user just asked for it.
            ref={renameInputRef}
            aria-label="Thread name"
            value={renaming.draft}
            onChange={(e) => setRenaming({ id: t.id, draft: e.target.value })}
            onBlur={() => {
              // Commit rather than discard. A stray click losing a typed
              // name is worse than an unintended rename, which is undone
              // by renaming again.
              const name = renaming.draft.trim();
              if (name && name !== t.title) onRename?.(t.id, name);
              setRenaming(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const name = renaming.draft.trim();
                if (name) onRename?.(t.id, name);
                setRenaming(null);
              }
              if (e.key === 'Escape') setRenaming(null);
            }}
            className="min-w-0 flex-1 rounded border border-border/60 bg-background px-1.5 py-1 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        ) : (
          <button
            type="button"
            className="min-w-0 flex-1 truncate text-left"
            aria-current={t.id === currentId ? 'page' : undefined}
            // The full title only: everything else the old tooltip carried is
            // on the row now, and a truncated title is the one thing that
            // still needs a way to be read whole.
            title={label.text}
            onClick={() => onSelect(t.id)}
          >
            {label.isId ? (
              // An untitled thread is listed by its id, cut from the middle:
              // ids that differ differ at the end, and an end-cut kept only
              // the half they share. Whole in `title` and to a reader.
              <span className="block truncate font-mono font-medium">
                <CutId id={label.text} max={ID_CHARS} />
              </span>
            ) : (
              <span className="block truncate font-medium">{label.text}</span>
            )}
            <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              {/*
              First, because it is the one fact on the row that asks
              something of the reader. A word beside the dot, never the
              dot alone. From `/approvals`' `thread_id`, so it marks the
              thread that first asked — an identical call elsewhere shares
              the row.
            */}
              {waiting && (
                <span className="flex shrink-0 items-center gap-1 text-state-blocked">
                  <span aria-hidden className="size-1.5 rounded-full bg-state-blocked" />
                  Waiting on you ·
                </span>
              )}
              <span className="min-w-0 truncate">
                {/* A thread from another browser has no local manifest
                  record; the row says nothing rather than a placeholder. */}
                {t.manifest && (
                  <>
                    <span className="font-mono">{t.manifest}</span> ·{' '}
                  </>
                )}
                {relativeTime(t.updatedAt)}
                {t.onServer === false && ' · local only'}
              </span>
            </span>
          </button>
        )}
        {(onTogglePin || onRename || onFork || onCompact || onExport) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Actions for ${label.text}`}
                className="grid size-6 shrink-0 coarse:size-10 place-items-center rounded text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100"
              >
                <MoreHorizontalIcon className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-44"
              onCloseAutoFocus={(e) => {
                if (!renameJustStarted.current) return;
                renameJustStarted.current = false;
                e.preventDefault();
              }}
            >
              {onTogglePin && (
                <DropdownMenuItem onSelect={() => onTogglePin(t.id)}>
                  {isPinned ? (
                    <>
                      <PinOffIcon className="size-3.5" /> Unpin
                    </>
                  ) : (
                    <>
                      <PinIcon className="size-3.5" /> Pin
                    </>
                  )}
                </DropdownMenuItem>
              )}
              {onRename && (
                <DropdownMenuItem
                  onSelect={() => {
                    renameJustStarted.current = true;
                    setRenaming({ id: t.id, draft: t.named ? t.title : '' });
                  }}
                >
                  <PencilIcon className="size-3.5" /> Rename
                </DropdownMenuItem>
              )}
              {/* The three below all act on server state, so a thread the
                harness has never seen cannot offer them. */}
              {onFork && (
                <DropdownMenuItem disabled={t.onServer === false} onSelect={() => onFork(t.id)}>
                  <GitBranchIcon className="size-3.5" /> Duplicate
                </DropdownMenuItem>
              )}
              {onCompact && (
                <DropdownMenuItem disabled={t.onServer === false} onSelect={() => onCompact(t.id)}>
                  <ShrinkIcon className="size-3.5" /> Compact context
                </DropdownMenuItem>
              )}
              {onExport && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem disabled={t.onServer === false} onSelect={() => onExport(t.id)}>
                    <DownloadIcon className="size-3.5" /> Export JSONL
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <button
          type="button"
          aria-label="Delete thread"
          className="grid size-6 shrink-0 coarse:size-10 place-items-center rounded text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-state-failed focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
          onClick={() => onDelete(t.id)}
        >
          <Trash2Icon className="size-3.5" />
        </button>
      </div>
    );
  }

  return (
    <section
      aria-labelledby="history-heading"
      data-slot="thread-list"
      className={cn('flex min-h-0 flex-col', className)}
    >
      {/* Heading and search ride the top of the scroller, so a long list never
          scrolls away the way to find something in it. */}
      <div className="sticky top-0 z-10 bg-background px-2 pt-1 pb-2">
        <div className="flex h-7 items-center justify-between px-2">
          <h2 id="history-heading" className="text-xs font-medium text-muted-foreground">
            Threads
          </h2>
          {onNew && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1"
              disabled={disabled}
              onClick={onNew}
            >
              <PlusIcon className="size-3.5" /> New chat
            </Button>
          )}
        </div>
        <label className="relative mt-1 block">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={searchRef}
            type="search"
            aria-label="Search threads"
            data-shortcut-target="thread-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search threads…"
            className="h-8 w-full rounded-md border border-border/60 bg-background pr-2 pl-7 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
          />
        </label>
      </div>
      <div className="px-2 pb-2">
        {localFiltered.length === 0 && remoteOnly.length === 0 && (
          <div className="px-2 py-6 text-center">
            <p className="text-sm text-muted-foreground">
              {filtering ? (searching ? 'Searching…' : 'No matches') : 'No threads yet'}
            </p>
            {!filtering && (
              <p className="mt-1 text-xs text-muted-foreground">
                {onNew ? 'Start one with New chat above.' : 'Your first message starts one.'}
              </p>
            )}
          </div>
        )}
        {filtering ? (
          <div className="space-y-0.5">{localFiltered.map(renderRow)}</div>
        ) : (
          groups.map((g) => {
            const labelId = `${ids}-${g.key}`;
            const folded = g.key === 'older' && !olderShown;
            return (
              <div key={g.key} role="group" aria-labelledby={labelId} className="pt-2 first:pt-0">
                {g.key === 'older' ? (
                  // A disclosure, not a label: Older is the one group that starts
                  // folded, and its count is the reason to open it.
                  <button
                    type="button"
                    id={labelId}
                    aria-expanded={!folded}
                    disabled={currentIsOlder}
                    onClick={() => setOlderOpen((o) => !o)}
                    className="flex h-6 w-full items-center gap-1 rounded-md px-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default disabled:hover:text-muted-foreground"
                  >
                    <ChevronRightIcon
                      aria-hidden
                      className={cn(
                        'size-3 transition-transform duration-200 ease-out motion-reduce:transition-none',
                        !folded && 'rotate-90',
                      )}
                    />
                    {g.label}
                    <span className="ml-auto font-normal tabular-nums">{g.threads.length}</span>
                  </button>
                ) : (
                  <p
                    id={labelId}
                    className="flex h-6 items-center px-2 text-xs font-medium text-muted-foreground"
                  >
                    {g.label}
                    {g.key === 'pinned' && (
                      <span className="ml-auto font-normal">this browser</span>
                    )}
                  </p>
                )}
                {!folded && <div className="space-y-0.5">{g.threads.map(renderRow)}</div>}
              </div>
            );
          })
        )}
        {remoteOnly.length > 0 && (
          <div className="pt-2">
            <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">Server</p>
            {remoteOnly.map((t) => (
              <button
                key={t.id}
                type="button"
                className={cn(
                  'flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-accent/50',
                  t.id === currentId && 'bg-accent',
                )}
                onClick={() => onSelect(t.id)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{t.snippet.slice(0, 48)}</span>
                  <span
                    className="block truncate font-mono text-xs text-muted-foreground"
                    title={t.id}
                  >
                    <CutId id={t.id} max={ID_CHARS} />
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
