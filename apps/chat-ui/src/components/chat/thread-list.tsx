import { MessageSquareIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { Button } from '@felix/ui/button';
import { ScrollArea } from '@felix/ui/scroll-area';
import type { ThreadMeta } from '@/lib/threads';
import { cn } from '@/lib/utils';

/**
 * Left rail listing past conversations from localStorage. Selecting a thread
 * loads its cached transcript and hydrates it from the server event log; the
 * trash icon removes it locally (and best-effort server-side).
 */
export function ThreadList({
  threads,
  currentId,
  disabled,
  onSelect,
  onNew,
  onDelete,
}: {
  threads: ThreadMeta[];
  currentId: string;
  disabled?: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <aside className="flex h-full w-60 flex-col border-r border-border/60 bg-card/30">
      <div className="flex h-12 items-center justify-between border-b border-border/60 px-3">
        <span className="text-sm font-medium">History</span>
        <Button variant="ghost" size="sm" className="h-7 gap-1" disabled={disabled} onClick={onNew}>
          <PlusIcon className="size-3.5" /> New
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-0.5 p-2">
          {threads.length === 0 && (
            <div className="px-2 py-8 text-center">
              <p className="text-sm text-muted-foreground">No chats yet</p>
              <p className="mt-1 text-xs text-muted-foreground/80">
                Start one from the composer below.
              </p>
            </div>
          )}
          {threads.map((t) => (
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
                title={t.title}
                onClick={() => onSelect(t.id)}
              >
                <span className="block truncate font-medium">{t.title}</span>
                <span className="block truncate font-mono text-[10px] text-muted-foreground">
                  {t.manifest} · {rel(t.updatedAt)}
                </span>
              </button>
              <button
                type="button"
                aria-label="Delete conversation"
                className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                onClick={() => onDelete(t.id)}
              >
                <Trash2Icon className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      </ScrollArea>
    </aside>
  );
}

/** Relative time like "2m ago" / "3h ago" / "5d ago" from a ms timestamp. */
function rel(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  return `${Math.round(diff / 86400000)}d ago`;
}
