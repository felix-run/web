import { Button } from '@felix/ui/button';
import { ScrollArea } from '@felix/ui/scroll-area';
import { MessageSquareIcon, PlusIcon, SearchIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { searchSessions } from '@/api';
import type { ThreadMeta } from '@/lib/threads';
import { relativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';

/**
 * Left rail listing past conversations from localStorage. Selecting a thread
 * loads its cached transcript and hydrates it from the server event log; the
 * trash icon removes it locally (and best-effort server-side). Search queries
 * local titles first, then the server FTS index when available.
 */
export function ThreadList({
  threads,
  currentId,
  disabled,
  onSelect,
  onNew,
  onDelete,
  className,
}: {
  threads: ThreadMeta[];
  currentId: string;
  disabled?: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  /** Set by the shell when this renders inside a drawer instead of as a column. */
  className?: string;
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<
    Array<{ thread_id: string; content: string; event_id?: string }>
  >([]);
  const [searching, setSearching] = useState(false);

  const localFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter(
      (t) => t.title.toLowerCase().includes(q) || t.manifest.toLowerCase().includes(q),
    );
  }, [threads, query]);

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

  return (
    <aside
      aria-labelledby="history-heading"
      className={cn(
        // Grows with the viewport rather than staying at 240px: on a wide display the
        // extra width is worth more as thread title than as empty gutter beside a
        // reading column. Clamped, and the floor is the old fixed width, so the
        // drawer thresholds in App.tsx are untouched below ~1333px.
        'flex h-full w-[clamp(15rem,18vw,20rem)] flex-col border-r border-border/60 bg-card/30',
        className,
      )}
    >
      <div className="flex h-12 items-center justify-between border-b border-border/60 px-3">
        <h2 id="history-heading" className="text-base font-semibold">
          History
        </h2>
        <Button variant="ghost" size="sm" className="h-7 gap-1" disabled={disabled} onClick={onNew}>
          <PlusIcon className="size-3.5" /> New chat
        </Button>
      </div>
      <div className="border-b border-border/60 px-2 py-2">
        <label className="relative block">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            aria-label="Search sessions"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sessions…"
            className="h-8 w-full rounded-md border border-border/60 bg-background pr-2 pl-7 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
          />
        </label>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-0.5 p-2">
          {localFiltered.length === 0 && remoteOnly.length === 0 && (
            <div className="px-2 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                {query.trim() ? (searching ? 'Searching…' : 'No matches') : 'No chats yet'}
              </p>
              {!query.trim() && (
                <p className="mt-1 text-xs text-muted-foreground/80">
                  Start one from the composer below.
                </p>
              )}
            </div>
          )}
          {localFiltered.map((t) => (
            <div
              key={t.id}
              className={cn(
                'group flex items-center gap-2 rounded-lg px-2 py-2 text-sm',
                t.id === currentId ? 'bg-accent' : 'hover:bg-accent/50',
              )}
            >
              <MessageSquareIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left"
                title={`${t.title}\nAgent: ${t.manifest}`}
                onClick={() => onSelect(t.id)}
              >
                <span className="block truncate font-medium">{t.title}</span>
                <span className="block truncate font-mono text-xs text-muted-foreground">
                  {t.manifest} · {relativeTime(t.updatedAt)}
                </span>
              </button>
              <button
                type="button"
                aria-label="Delete conversation"
                className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-state-failed focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                onClick={() => onDelete(t.id)}
              >
                <Trash2Icon className="size-3.5" />
              </button>
            </div>
          ))}
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
                  <MessageSquareIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{t.snippet.slice(0, 48)}</span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">
                      {t.id.slice(0, 8)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}

/** Strip tenant prefix (`default:uuid` → `uuid`) for client thread ids. */
function threadSuffix(full: string): string {
  const i = full.indexOf(':');
  return i >= 0 ? full.slice(i + 1) : full;
}
