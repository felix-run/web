import { relativeTime, type ThreadMeta, threadSuffix } from '@felix/client';
import { Button } from '@felix/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
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
  SearchIcon,
  ShrinkIcon,
  Trash2Icon,
} from 'lucide-react';
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { searchSessions } from '@/api';
import { CutId } from '@/components/cut-id';
import { groupThreads, matchExcerpt, type ThreadGroupKey, threadLabel } from '@/lib/threads';
import { cn } from '@/lib/utils';

const NO_BLOCKED: ReadonlySet<string> = new Set();
const NO_PINS: ReadonlySet<string> = new Set();
const NO_RUNNING: ReadonlySet<string> = new Set();

/**
 * Characters of an id a row draws: what the row's width holds in 13px mono. A
 * UUID is 36, so it is still cut from the middle, keeping the tail where two of
 * them differ; a name like `self-triage-296-findings-b` now fits whole.
 */
const ID_CHARS = 30;

/** Message hits asked for at first, and when the operator asks for more. */
const HIT_LIMIT = 12;
const HIT_LIMIT_MORE = 50;

/**
 * A row's actions, laid over the end of the row rather than beside it.
 *
 * Beside it, the buttons held ~56px of every row while invisible, so at rest a
 * title cut off a third of the way across a sidebar that had room for it. Over
 * it, the title takes the full width and the actions fade in on its tail, on a
 * gradient of the row's own colour (`--row-bg`) so the words they cover go
 * under them rather than through them.
 *
 * Only where the device can hover. On touch nothing reveals them, so they stay
 * in the row, visible, holding their width — the trade the hover was buying.
 */
const ROW_ACTIONS = cn(
  'flex shrink-0 items-center gap-0.5',
  '[@media(hover:hover)]:absolute [@media(hover:hover)]:inset-y-0 [@media(hover:hover)]:right-0',
  '[@media(hover:hover)]:rounded-r-md [@media(hover:hover)]:pr-1 [@media(hover:hover)]:pl-5',
  '[@media(hover:hover)]:bg-[linear-gradient(to_right,transparent,var(--row-bg)_1.25rem)]',
  '[@media(hover:hover)]:opacity-0 transition-opacity duration-150 ease-out motion-reduce:transition-none',
  '[@media(hover:hover)]:group-hover/thread:opacity-100',
  '[@media(hover:hover)]:group-focus-within/thread:opacity-100',
  '[@media(hover:hover)]:has-[[data-state=open]]:opacity-100',
);

/**
 * The row's colour, as a variable the actions' gradient can read. A hovered or
 * focused row is `accent` at half over the page — mixed with `--background`
 * rather than with transparent, so the gradient ends on the same pixel the row
 * paints. Spelled out per variant rather than interpolated: Tailwind generates
 * only the classes it finds written whole in the source.
 */
const ROW_LIT = cn(
  '[--row-bg:var(--background)]',
  'hover:[--row-bg:color-mix(in_oklab,var(--accent)_50%,var(--background))]',
  'focus-within:[--row-bg:color-mix(in_oklab,var(--accent)_50%,var(--background))]',
  'has-[[data-state=open]]:[--row-bg:color-mix(in_oklab,var(--accent)_50%,var(--background))]',
);

/**
 * A group's label, held at the top of the list while its rows scroll under it,
 * so a reader deep in a long group still knows which one they are in. Older's
 * months stick one label-height lower, under Older's own.
 */
const STICKY_LABEL =
  'sticky top-0 z-10 flex h-6 items-center gap-1 bg-background px-2 text-xs font-medium text-muted-foreground';

/** A row to draw: the thread, and the stretch of a message that matched a search, if one did. */
type Row = { thread: ThreadMeta; excerpt?: string };

/**
 * Every thread this client can reach, as the sidebar's Threads section.
 *
 * Grouped the way a returning operator looks for one: what is waiting on them,
 * what they pinned, then by last activity — Today, Yesterday, Previous 7 days,
 * Older. Older starts folded with its count showing, because on a long-lived
 * harness it is most of the list. A search drops the groups: a match is a match,
 * whenever it last moved.
 *
 * **The list scrolls inside itself.** The sidebar's other sections — the
 * workspace and the harness's pages — sit below it, and with the list in the
 * sidebar's one scroller an opened Older pushed them fifty rows down. The section
 * shrinks to the room they leave (never below 40% of the viewport, unless it is
 * shorter than that), so they stay in reach whatever the list holds; the heading and search stay above the scroll.
 *
 * One noun: **thread**. This list was headed "History", searched "sessions" and
 * deleted "conversations" while its trigger said "Threads" — four names for the
 * object a returning operator is trying to find.
 *
 * The list is `GET /chat/sessions` merged over the localStorage index, so a
 * thread started in another browser shows up here — see `mergeSessions`. A row
 * the harness does not know is marked local-only rather than hidden, because
 * its transcript may exist nowhere else.
 *
 * Search matches what a row shows (title, id, agent) at once, then the harness's
 * message index. **A message hit on a listed thread is a result** — the merged
 * list holds every thread the harness returned, so an earlier version that kept
 * only hits on threads it did not list showed none, and said "No matches" about
 * a word the harness had found. Such a row carries the matched words as its
 * second line.
 *
 * The keyboard: the list is one Tab stop. Arrow keys move between rows, → reaches
 * a row's actions and ← comes back, Shift+F10 (or the context-menu key, or a
 * right click) opens them, and Delete deletes — undoable from the toast, as the
 * menu's Delete is. ↓ from the search field enters the results and Enter there
 * opens the first.
 *
 * A row is read by someone coming back, so what it says has to tell rows apart
 * without hovering: the best title there is (see `threadLabel`), the agent when
 * this client knows it, how long ago, and whether the thread is running or
 * waiting on a person. There is no per-row icon — an icon on every row marks a
 * row, not a kind, and the width is worth more as title.
 */
export function ThreadList({
  threads,
  currentId,
  onSelect,
  onDelete,
  onRename,
  onFork,
  onCompact,
  onExport,
  readOnlyId,
  blocked = NO_BLOCKED,
  running = NO_RUNNING,
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
  /** Threads with a run this tab is carrying, by suffix. */
  running?: ReadonlySet<string>;
  /** Pinned thread ids, from this browser's own store (`readPins`). */
  pinned?: ReadonlySet<string>;
  /** Pin or unpin a thread. Omit to hide the action. */
  onTogglePin?: (id: string) => void;
  /** The search field, so a shortcut can land focus there rather than on New chat. */
  searchRef?: Ref<HTMLInputElement>;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  /** Persist a name via POST /chat/sessions/name. Omit to hide the action. */
  onRename?: (id: string, name: string) => void;
  onFork?: (id: string) => void;
  onCompact?: (id: string) => void;
  onExport?: (id: string) => void;
  /**
   * The thread this tab only watches — another client drives it — so the
   * actions that write it (Rename, Compact context) are off for that row.
   */
  readOnlyId?: string;
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

  /** The row whose actions menu is open. Controlled, so the keyboard and a right click can open it. */
  const [menuFor, setMenuFor] = useState<string | null>(null);
  /** The row that holds the list's one Tab stop, once the reader has moved it. */
  const [activeId, setActiveId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  /**
   * The section's natural height — heading, search and every row drawn — which
   * caps its floor (see the section's class).
   */
  const headRef = useRef<HTMLDivElement | null>(null);
  const listContentRef = useRef<HTMLDivElement | null>(null);
  const [naturalHeight, setNaturalHeight] = useState(0);
  const measureNatural = useCallback(() => {
    const head = headRef.current;
    const list = listContentRef.current;
    // 10px: the scroller's own vertical padding, around the rows.
    if (head && list) setNaturalHeight(Math.ceil(head.offsetHeight + list.offsetHeight) + 10);
  }, []);
  // Anything else that resizes it — a font loading, the sidebar's width.
  useEffect(() => {
    const head = headRef.current;
    const list = listContentRef.current;
    if (!head || !list || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measureNatural);
    observer.observe(head);
    observer.observe(list);
    return () => observer.disconnect();
  }, [measureNatural]);

  const [hits, setHits] = useState<
    Array<{ thread_id: string; content: string; event_id?: string }>
  >([]);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  /** How many message hits to ask for. Back to the default for every new query. */
  const [hitLimit, setHitLimit] = useState(HIT_LIMIT);
  /** The row asking whether to stop its run before it is deleted. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const confirmJustStarted = useRef(false);
  useEffect(() => {
    if (!confirming) return;
    // After paint, for the reason the rename field waits: the menu that asked
    // returns focus to its trigger as it closes.
    const frame = requestAnimationFrame(() => confirmRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [confirming]);

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
    setSearchFailed(false);
    if (q.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void searchSessions(q, hitLimit)
        .then((rows) => {
          if (!cancelled) setHits(rows);
        })
        .catch(() => {
          // Said, not swallowed: an empty list here would read as "nothing
          // matched" about a search that never ran.
          if (!cancelled) {
            setHits([]);
            setSearchFailed(true);
          }
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, hitLimit]);

  /**
   * Search results: what matched on the row first, then threads whose messages
   * matched, each with the words that did; and last, hits on threads this list
   * does not hold at all.
   */
  const { results, elsewhere } = useMemo(() => {
    const q = query.trim();
    const byId = new Map(threads.map((t) => [t.id, t]));
    const listed = new Set(localFiltered.map((t) => t.id));
    const rows: Row[] = localFiltered.map((thread) => ({ thread }));
    const outside: Array<{ id: string; excerpt: string }> = [];
    const seen = new Set<string>();
    for (const hit of hits) {
      const id = threadSuffix(hit.thread_id);
      if (listed.has(id) || seen.has(id)) continue;
      seen.add(id);
      const excerpt = matchExcerpt(hit.content, q);
      const thread = byId.get(id);
      if (thread) rows.push({ thread, excerpt });
      else outside.push({ id, excerpt });
    }
    return { results: rows, elsewhere: outside };
  }, [threads, localFiltered, hits, query]);

  const filtering = query.trim() !== '';
  const groups = useMemo(
    () => groupThreads(threads, pinned, Date.now(), blocked, running),
    [threads, pinned, blocked, running],
  );
  const [olderOpen, setOlderOpen] = useState(false);
  const ids = useId();

  /**
   * What is drawn, in order: one list the arrow keys walk. A folded Older still
   * draws the thread on screen when it is one of them — arriving on an old thread
   * from a link would otherwise leave no row marked current — and only that one,
   * so being on an old thread does not hold fifty others open.
   */
  const sections = useMemo(
    () =>
      groups.map((g) => {
        const folded = g.key === 'older' && !olderOpen;
        const rows = folded ? g.threads.filter((t) => t.id === currentId) : g.threads;
        return { group: g, folded, rows: rows.map((thread): Row => ({ thread })) };
      }),
    [groups, olderOpen, currentId],
  );
  const order = filtering
    ? [...results.map((r) => r.thread.id), ...elsewhere.map((r) => r.id)]
    : sections.flatMap((s) => s.rows.map((r) => r.thread.id));
  const tabStop =
    activeId && order.includes(activeId)
      ? activeId
      : order.includes(currentId)
        ? currentId
        : order[0];

  // Before paint, whenever the rows drawn change: a ResizeObserver reports a
  // frame later, and a page the browser is not rendering (a background tab)
  // gets no report at all until it is.
  useLayoutEffect(measureNatural, [
    measureNatural,
    order.length,
    filtering,
    searching,
    searchFailed,
  ]);

  const rowButtons = () =>
    Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-thread-row]') ?? []);
  const focusRow = (id: string) =>
    rowButtons()
      .find((b) => b.dataset.threadRow === id)
      ?.focus();

  /**
   * Delete, or ask first. A thread with a run going, or with something waiting
   * on a person, asks — deleting stops the run at once, and the toast's Undo
   * brings back the transcript but never the run. Anything else is deleted
   * straight away; its Undo restores all of it.
   */
  function requestDelete(id: string, fromMenu = false) {
    if (running.has(id) || blocked.has(id)) {
      if (fromMenu) confirmJustStarted.current = true;
      setConfirming(id);
      return;
    }
    // The focus goes to the row that takes this one's place, not to the page.
    const buttons = rowButtons();
    const at = buttons.findIndex((b) => b.dataset.threadRow === id);
    const next = (buttons[at + 1] ?? buttons[at - 1])?.dataset.threadRow;
    onDelete(id);
    if (next) requestAnimationFrame(() => focusRow(next));
  }

  function onRowKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const target = e.currentTarget;
    const id = target.dataset.threadRow;
    if (!id) return;
    const buttons = rowButtons();
    const at = buttons.indexOf(target);
    const move = (to: number) => {
      e.preventDefault();
      buttons[Math.max(0, Math.min(buttons.length - 1, to))]?.focus();
    };
    if (e.key === 'ArrowDown') move(at + 1);
    else if (e.key === 'ArrowUp') move(at - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(buttons.length - 1);
    else if (e.key === 'ArrowRight') {
      const menu = target
        .closest('[data-thread]')
        ?.querySelector<HTMLElement>('[data-thread-menu]');
      if (menu) {
        e.preventDefault();
        menu.focus();
      }
    } else if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
      if (!threads.some((t) => t.id === id)) return;
      e.preventDefault();
      setMenuFor(id);
    } else if (e.key === 'Delete' && threads.some((t) => t.id === id)) {
      e.preventDefault();
      requestDelete(id);
    }
  }

  function onSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      const first = rowButtons()[0];
      if (first) {
        e.preventDefault();
        first.focus();
      }
    } else if (e.key === 'Enter' && filtering && order[0]) {
      e.preventDefault();
      onSelect(order[0]);
    }
  }

  function renderRow({ thread: t, excerpt }: Row, inGroup?: ThreadGroupKey) {
    const label = labels.get(t.id) ?? { text: t.title, isId: false };
    const waiting = blocked.has(t.id);
    const live = running.has(t.id);
    const isPinned = pinned.has(t.id);
    const local = t.onServer === false;
    const readOnly = t.id === readOnlyId;
    return (
      // `group/thread`, named: the sidebar's root is an unnamed `group`, so a bare
      // `group-hover` here matched the pointer anywhere in the sidebar and lit
      // every row's actions at once. The focus ring is the row's, not the
      // button's: the actions are laid over the button's end and would cover it.
      <div
        key={t.id}
        data-thread={t.id}
        className={cn(
          'group/thread relative flex items-center gap-2 rounded-md bg-(--row-bg) px-2 py-1.5 text-sm',
          'has-[[data-thread-row]:focus-visible]:ring-[3px] has-[[data-thread-row]:focus-visible]:ring-ring',
          t.id === currentId ? '[--row-bg:var(--accent)]' : ROW_LIT,
        )}
      >
        {confirming === t.id ? (
          // In the row rather than a dialog: the question is about this row,
          // and the row is where the eye already is.
          <div
            role="group"
            aria-labelledby={`${ids}-confirm`}
            className="flex min-w-0 flex-1 flex-col gap-1.5"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setConfirming(null);
                requestAnimationFrame(() => focusRow(t.id));
              }
            }}
          >
            <p id={`${ids}-confirm`} className="text-xs text-foreground">
              {live
                ? `Deleting stops the run on ${label.isId ? 'this thread' : `“${label.text}”`}.`
                : `${label.isId ? 'This thread' : `“${label.text}”`} has something waiting on you.`}
            </p>
            <div className="flex gap-1.5">
              <Button
                ref={confirmRef}
                size="sm"
                variant="destructive"
                className="h-7"
                onClick={() => {
                  setConfirming(null);
                  onDelete(t.id);
                }}
              >
                {live ? 'Stop and delete' : 'Delete'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7"
                onClick={() => {
                  setConfirming(null);
                  requestAnimationFrame(() => focusRow(t.id));
                }}
              >
                Keep
              </Button>
            </div>
          </div>
        ) : renaming?.id === t.id ? (
          <input
            // Renaming is a text edit, so it happens in place rather than in
            // a dialog: the row already shows the name being changed.
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
                if (name && name !== t.title) onRename?.(t.id, name);
                setRenaming(null);
                requestAnimationFrame(() => focusRow(t.id));
              }
              if (e.key === 'Escape') {
                setRenaming(null);
                requestAnimationFrame(() => focusRow(t.id));
              }
            }}
            className="min-w-0 flex-1 rounded border border-border/60 bg-background px-1.5 py-1 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        ) : (
          <button
            type="button"
            data-thread-row={t.id}
            tabIndex={t.id === tabStop ? 0 : -1}
            onFocus={() => setActiveId(t.id)}
            onKeyDown={onRowKeyDown}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenuFor(t.id);
            }}
            className="min-w-0 flex-1 truncate text-left outline-none"
            aria-current={t.id === currentId ? 'page' : undefined}
            // The full title only: everything else is on the row, and a
            // truncated title is the one thing that needs a way to be read whole.
            title={label.text}
            onClick={() => onSelect(t.id)}
          >
            {label.isId ? (
              // An untitled thread is listed by its id, cut from the middle:
              // ids that differ differ at the end, and an end-cut kept only
              // the half they share. Whole in `title` and to a reader.
              // Muted, so a row the operator can read ranks above one they
              // would have to recall: an id is distinct, not memorable.
              <span className="block truncate font-mono text-muted-foreground">
                <CutId id={label.text} max={ID_CHARS} />
              </span>
            ) : (
              <span className="block truncate font-medium">{label.text}</span>
            )}
            {excerpt ? (
              // A message matched, so the second line is why: the words around
              // the match, marked, and how long ago — identical excerpts are
              // common, and the time is what tells them apart.
              <span className="flex min-w-0 gap-1 text-xs text-muted-foreground">
                <span className="min-w-0 truncate">
                  <Marked text={excerpt} query={query} />
                </span>
                <span className="shrink-0">· {relativeTime(t.updatedAt)}</span>
              </span>
            ) : (
              <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                {/*
                  First, because it is the one fact on the row that asks
                  something of the reader. A word beside the dot, never the
                  dot alone. Under its own group's label it would only repeat it.
                */}
                {waiting && inGroup !== 'waiting' && (
                  <StateMark className="text-state-blocked">Waiting on you</StateMark>
                )}
                {live && !waiting && inGroup !== 'running' && (
                  <StateMark className="text-state-running">Running</StateMark>
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
                  {local && ' · local only'}
                </span>
              </span>
            )}
          </button>
        )}
        {renaming?.id !== t.id && confirming !== t.id && (
          <div data-slot="thread-actions" className={ROW_ACTIONS}>
            <DropdownMenu
              open={menuFor === t.id}
              onOpenChange={(open) => setMenuFor(open ? t.id : null)}
            >
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  data-thread-menu
                  // Reached with → from the row, not with Tab: the list is one
                  // Tab stop, and three per row put 167 between the search and
                  // the workspace.
                  tabIndex={-1}
                  aria-label={`Actions for ${label.text}`}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowLeft') {
                      e.preventDefault();
                      focusRow(t.id);
                    }
                  }}
                  className="grid size-6 shrink-0 coarse:size-10 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none data-[state=open]:bg-accent data-[state=open]:text-foreground"
                >
                  <MoreHorizontalIcon className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-56"
                onCloseAutoFocus={(e) => {
                  e.preventDefault();
                  if (renameJustStarted.current || confirmJustStarted.current) {
                    renameJustStarted.current = false;
                    confirmJustStarted.current = false;
                    return;
                  }
                  // Back to the row, which holds the list's Tab stop, rather
                  // than to a trigger the Tab order skips.
                  focusRow(t.id);
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
                    disabled={readOnly}
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
                  <DropdownMenuItem disabled={local} onSelect={() => onFork(t.id)}>
                    <GitBranchIcon className="size-3.5" /> Fork
                  </DropdownMenuItem>
                )}
                {/* The rare ones, apart from the everyday ones. */}
                {(onCompact || onExport) && <DropdownMenuSeparator />}
                {onCompact && (
                  <DropdownMenuItem disabled={local || readOnly} onSelect={() => onCompact(t.id)}>
                    <ShrinkIcon className="size-3.5" /> Compact context
                  </DropdownMenuItem>
                )}
                {onExport && (
                  <DropdownMenuItem disabled={local} onSelect={() => onExport(t.id)}>
                    <DownloadIcon className="size-3.5" /> Export JSONL
                  </DropdownMenuItem>
                )}
                {/* A greyed item with no reason reads as broken. */}
                {(local || readOnly) && (
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                    {local
                      ? 'The harness has no record of this thread yet, so it cannot be forked, compacted or exported.'
                      : 'Another client is driving this thread, so it cannot be renamed or compacted here.'}
                  </DropdownMenuLabel>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => requestDelete(t.id, true)}>
                  <Trash2Icon className="size-3.5" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    );
  }

  const count = results.length + elsewhere.length;
  // The harness returned as many hits as were asked for, so there may be more.
  const capped = filtering && !searching && !searchFailed && hits.length >= hitLimit;
  const status = !filtering
    ? ''
    : searching
      ? 'Searching message text…'
      : searchFailed
        ? 'Message search failed. Showing title matches only.'
        : capped
          ? `Showing the first ${hitLimit} message matches.`
          : '';

  return (
    <section
      aria-labelledby="history-heading"
      data-slot="thread-list"
      // Shrinks to what the sections below leave, so they stay in reach, but
      // keeps at least 40% of the viewport (12rem at the least) — at 12rem
      // alone a phone's drawer kept two rows and gave the rest to the harness's
      // pages — and never more than it has rows for, or a short list would
      // hold empty space above the workspace. CSS has no portable "floor, up to
      // the content" (`calc-size` is not in Safari), so the natural height
      // comes in as `--thread-list-h`. Past the floor the sidebar scrolls as a
      // whole. `shrink!` beats the sidebar's `*:shrink-0`.
      style={{ '--thread-list-h': `${naturalHeight}px` } as CSSProperties}
      className={cn(
        'flex min-h-[min(var(--thread-list-h),max(12rem,40svh))] shrink! flex-col',
        className,
      )}
    >
      <div ref={headRef} className="shrink-0 px-2 pt-1 pb-2">
        <div className="flex h-7 items-center px-2">
          <h2 id="history-heading" className="text-xs font-medium text-muted-foreground">
            Threads
          </h2>
        </div>
        <label className="relative mt-1 block">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={searchRef}
            type="search"
            aria-label="Search threads"
            data-shortcut-target="thread-search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHitLimit(HIT_LIMIT);
            }}
            onKeyDown={onSearchKeyDown}
            placeholder="Search titles and messages…"
            className="h-8 w-full rounded-md border border-border/60 bg-background pr-2 pl-7 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
          />
        </label>
        {status && (
          <p className="flex items-center gap-2 px-2 pt-1.5 text-xs text-muted-foreground">
            {status}
            {capped && hitLimit < HIT_LIMIT_MORE && (
              <button
                type="button"
                onClick={() => setHitLimit(HIT_LIMIT_MORE)}
                className="rounded font-medium text-foreground underline underline-offset-2 focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
              >
                Search more
              </button>
            )}
          </p>
        )}
        {/* What a search found, said to a reader once it settles. */}
        <p role="status" className="sr-only">
          {filtering && !searching
            ? `${count === 0 ? 'No' : count} ${count === 1 ? 'thread matches' : 'threads match'}${searchFailed ? '; message search failed' : capped ? `; the first ${hitLimit} message matches` : ''}`
            : ''}
        </p>
      </div>
      <div
        ref={listRef}
        data-slot="thread-scroll"
        // Scroll chains to the drawer at either end, rather than trapping a
        // touch inside a list inside a scrolling drawer.
        className="min-h-0 flex-1 scroll-fade-b overflow-y-auto px-2 pt-0.5 pb-2"
      >
        <div ref={listContentRef}>
          {count === 0 && (filtering || threads.length === 0) && (
            <div className="px-2 py-6 text-center">
              <p className="text-sm text-muted-foreground">
                {filtering
                  ? searching
                    ? 'Searching…'
                    : `No thread matches “${query.trim()}”.`
                  : 'No threads yet'}
              </p>
              {!filtering && (
                <p className="mt-1 text-xs text-muted-foreground">Your first message starts one.</p>
              )}
            </div>
          )}
          {filtering ? (
            <div className="space-y-0.5">{results.map((r) => renderRow(r))}</div>
          ) : (
            sections.map(({ group: g, folded, rows }) => {
              const labelId = `${ids}-${g.key}`;
              return (
                <div key={g.key} role="group" aria-labelledby={labelId} className="pt-2 first:pt-0">
                  {g.key === 'older' ? (
                    // A disclosure, not a label: Older is the one group that starts
                    // folded, and its count is the reason to open it.
                    <button
                      type="button"
                      id={labelId}
                      aria-expanded={!folded}
                      onClick={() => setOlderOpen((o) => !o)}
                      className={cn(
                        STICKY_LABEL,
                        'w-full rounded-md text-left hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none',
                      )}
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
                      className={cn(
                        STICKY_LABEL,
                        g.key === 'waiting' && 'text-state-blocked',
                        g.key === 'running' && 'text-state-running',
                      )}
                    >
                      {(g.key === 'waiting' || g.key === 'running') && (
                        <span aria-hidden className="size-1.5 rounded-full bg-current" />
                      )}
                      {g.label}
                      {g.key === 'pinned' && (
                        <span className="ml-auto font-normal">this browser</span>
                      )}
                    </p>
                  )}
                  {folded
                    ? // Folded draws nothing of the group but the thread on screen,
                      // when it is one of its own — every branch below is the open
                      // group, so none of them may be reached from here.
                      rows.length > 0 && (
                        // The thread on screen, kept in view from a folded group —
                        // said, so a collapsed group holding a row is not a puzzle.
                        <div
                          role="group"
                          aria-label="This thread, from Older"
                          className="space-y-0.5"
                        >
                          {rows.map((r) => renderRow(r, g.key))}
                        </div>
                      )
                    : g.months && g.months.length > 1
                      ? g.months.map((m) => (
                          <div
                            key={m.key}
                            role="group"
                            aria-labelledby={`${labelId}-${m.key}`}
                            className="pt-1"
                          >
                            <p
                              id={`${labelId}-${m.key}`}
                              className={cn(STICKY_LABEL, 'top-6 z-[9] pl-6 font-normal')}
                            >
                              {m.label}
                              <span className="ml-auto tabular-nums">{m.threads.length}</span>
                            </p>
                            <div className="space-y-0.5">
                              {m.threads.map((thread) => renderRow({ thread }, g.key))}
                            </div>
                          </div>
                        ))
                      : rows.length > 0 && (
                          <div className="space-y-0.5">{rows.map((r) => renderRow(r, g.key))}</div>
                        )}
                </div>
              );
            })
          )}
          {elsewhere.length > 0 && (
            <div role="group" aria-labelledby={`${ids}-elsewhere`} className="pt-2">
              {/* Hits on threads past the end of the index this client fetched. */}
              <p
                id={`${ids}-elsewhere`}
                className="flex h-6 items-center px-2 text-xs font-medium text-muted-foreground"
              >
                More on the harness
              </p>
              <div className="space-y-0.5">
                {elsewhere.map((t) => (
                  <div
                    key={t.id}
                    className={cn(
                      'rounded-md bg-(--row-bg) px-2 py-1.5 text-sm',
                      'has-[[data-thread-row]:focus-visible]:ring-[3px] has-[[data-thread-row]:focus-visible]:ring-ring',
                      t.id === currentId ? '[--row-bg:var(--accent)]' : ROW_LIT,
                    )}
                  >
                    <button
                      type="button"
                      data-thread-row={t.id}
                      tabIndex={t.id === tabStop ? 0 : -1}
                      onFocus={() => setActiveId(t.id)}
                      onKeyDown={onRowKeyDown}
                      className="block w-full min-w-0 text-left outline-none"
                      title={t.id}
                      onClick={() => onSelect(t.id)}
                    >
                      <span className="block truncate font-mono font-medium">
                        <CutId id={t.id} max={ID_CHARS} />
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        <Marked text={t.excerpt} query={query} />
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** A state word with its dot, ahead of a row's metadata. */
function StateMark({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className={cn('flex shrink-0 items-center gap-1', className)}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {children} ·
    </span>
  );
}

/** `text` with the first occurrence of `query` set in the foreground, so the match is what the eye lands on. */
function Marked({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  const at = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="bg-transparent font-medium text-foreground">
        {text.slice(at, at + q.length)}
      </mark>
      {text.slice(at + q.length)}
    </>
  );
}
