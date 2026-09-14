import { Button } from '@felix/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@felix/ui/popover';
import { ScrollArea } from '@felix/ui/scroll-area';
import { ChevronsUpDownIcon, FolderIcon, HardDriveIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ThreadList } from '@/components/chat/thread-list';
import {
  clearMount,
  collectToolCallPaths,
  getMountLabel,
  hasMount,
  mountTree,
  pickDirectory,
  reconnectMount,
  restoreMount,
  supportsDirectoryPicker,
  vfs,
} from '@/lib/cowork';
import { cn } from '@/lib/utils';
import { useShell } from '@/shell-context';

/**
 * The workspace: the left zone, and the subject of the whole surface.
 *
 * The mounted folder is what the agent is working on; the thread is how you talk
 * to it. That is why this replaced the thread rail rather than joining it — two
 * peer rails asked the operator to hold "which conversation" and "which folder"
 * as separate questions, when the second is the one the work is about. Threads
 * are a popover off this header now: pick a folder, then a thread within it.
 *
 * Its first state on many mornings is not a tree. `restoreMount()` can only
 * return `needs-permission`, because the readwrite grant belongs to the document
 * and boot is not allowed to ask for it — so "reconnect <name>" is a normal
 * resting state here, not an error.
 */

/** How many touched paths to list before the footer says what was left out. */
const TOUCHED_VISIBLE = 8;
const TREE_VISIBLE = 200;

export function WorkspaceZone({ className }: { className?: string }) {
  const {
    turns,
    threads,
    threadId,
    streaming,
    selectThread,
    newThread,
    deleteThread,
    renameThread,
    forkThread,
    compactThread,
    exportThread,
  } = useShell();

  const [mountLabel, setMountLabel] = useState<string | null>(getMountLabel());
  const [reconnectName, setReconnectName] = useState<string | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [threadsOpen, setThreadsOpen] = useState(false);
  const canMount = supportsDirectoryPicker();

  const refresh = useCallback(async () => {
    setFiles(hasMount() ? await mountTree() : vfs.tree());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, mountLabel]);

  // A folder mounted last session may still be usable; whether it is depends on a
  // grant boot cannot ask for. See `restoreMount`.
  useEffect(() => {
    let cancelled = false;
    void restoreMount().then((result) => {
      if (cancelled) return;
      if (result.status === 'restored') setMountLabel(result.name);
      else if (result.status === 'needs-permission') setReconnectName(result.name);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-read the tree when a run stops, because that is when the agent's writes
  // have landed. Polling it would be a filesystem read every few seconds for a
  // panel that only changes when a tool runs.
  useEffect(() => {
    if (!streaming) void refresh();
  }, [streaming, refresh]);

  /**
   * What this session's tool calls named.
   *
   * Derived from the transcript rather than tracked separately: the tool calls
   * are already the record of what the agent touched, and a second list would be
   * a second thing to keep true. Newest first, deduped, and only paths — a bare
   * filename tells the operator nothing the tree does not already say.
   *
   * **It is empty during a durable run, and that is the run loop, not this list.**
   * A durable manifest's stream carries `run_accepted` → `run_status` → `final`
   * and no tool frames at all, so `Turn.tools` stays empty while the agent works;
   * the calls are in the harness's own transcript and arrive here only when the
   * thread is next hydrated from the session snapshot. Measured against `cowork`
   * on 2026-09-12: `write_file` was invisible here until a reload, at which point
   * `notes/workbench-check.md` appeared with its arguments intact. The same gap
   * hides the tool *cards* from the transcript, which is the bigger half of it.
   */
  const touched = useMemo(() => {
    const seen = new Set<string>();
    for (let i = turns.length - 1; i >= 0; i--) {
      for (const tool of turns[i]?.tools ?? []) {
        // A file tool's own `path` argument is a path *by construction*, so it needs
        // no heuristic and must not be filtered by one. `collectToolCallPaths` keeps
        // only strings containing a `/`, which is right for its own job — telling a
        // prose mention of `foo.md` apart from the three other `foo.md` — and wrong
        // here, where it dropped every write to the root of a flat workspace. The
        // agent writing `notes.txt` is exactly what this panel exists to report.
        const path = (tool.input as { path?: unknown } | null | undefined)?.path;
        if (typeof path === 'string' && path.trim()) seen.add(path.trim());
        // Everything else a call names — a shell command's `notes/todo.md` — still
        // goes through the heuristic, which is the only thing that can judge those.
        for (const found of collectToolCallPaths(tool.input)) seen.add(found);
      }
    }
    return [...seen];
  }, [turns]);

  /**
   * Must stay inside the click handler: the permission prompt is only allowed to
   * open while the user's gesture is still being processed.
   */
  const onReconnect = useCallback(async () => {
    const name = await reconnectMount();
    if (!name) {
      // Not an error: the operator was asked for a folder and said no. Reporting
      // a decision back as a failure is how a surface teaches people to stop
      // reading its red.
      toast.message('No folder attached. The chat is using the in-tab workspace.');
      return;
    }
    setReconnectName(null);
    setMountLabel(name);
    await refresh();
  }, [refresh]);

  const onMount = useCallback(async () => {
    try {
      const name = await pickDirectory();
      setReconnectName(null);
      setMountLabel(name);
      await refresh();
    } catch {
      // picker cancelled
    }
  }, [refresh]);

  const current = threads.find((t) => t.id === threadId);

  return (
    <aside
      aria-labelledby="workspace-heading"
      className={cn(
        'flex h-full w-72 shrink-0 flex-col border-r border-border/60 bg-card/40',
        className,
      )}
    >
      <div className="shrink-0 border-b border-border/60 px-3 py-2.5">
        <div className="flex items-center gap-2">
          {mountLabel ? (
            <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <HardDriveIcon className="size-4 shrink-0 text-muted-foreground" />
          )}
          <h2 id="workspace-heading" className="min-w-0 flex-1 truncate text-sm font-semibold">
            {mountLabel ?? 'In-tab workspace'}
          </h2>
          {canMount ? (
            <Button
              variant="ghost"
              size="xs"
              className="shrink-0 text-xs"
              onClick={() => {
                if (mountLabel) {
                  clearMount();
                  setMountLabel(null);
                  setReconnectName(null);
                  void refresh();
                } else {
                  void onMount();
                }
              }}
            >
              {mountLabel ? 'Unmount' : 'Mount'}
            </Button>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {mountLabel ? 'Client tools run against this folder' : 'Client tools run in this tab'}
        </p>

        {!mountLabel && reconnectName ? (
          <Button
            variant="outline"
            size="sm"
            className="mt-2 h-7 w-full text-xs"
            onClick={() => void onReconnect()}
          >
            Reconnect {reconnectName}
          </Button>
        ) : null}

        {/*
          Threads hang off the workspace rather than sitting beside it. The
          association is local-only — the harness records which threads exist but
          not which folder any of them used — so this is a flat list of every
          thread, and the trigger names the current one rather than claiming a
          folder owns it.
        */}
        <Popover open={threadsOpen} onOpenChange={setThreadsOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 h-8 w-full justify-between gap-2 px-2 text-xs font-normal"
            >
              <span className="min-w-0 truncate text-left">
                {current?.title ?? 'New conversation'}
              </span>
              <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[19rem] p-0">
            <ThreadList
              threads={threads}
              currentId={threadId}
              disabled={streaming}
              onSelect={(id) => {
                selectThread(id);
                setThreadsOpen(false);
              }}
              onNew={() => {
                newThread();
                setThreadsOpen(false);
              }}
              onDelete={deleteThread}
              onRename={renameThread}
              onFork={(id) => {
                forkThread(id);
                setThreadsOpen(false);
              }}
              onCompact={compactThread}
              onExport={exportThread}
              className="h-[24rem] w-full border-r-0 bg-transparent"
            />
          </PopoverContent>
        </Popover>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-3">
          {/* Named sections: a `<section>` with no accessible name is announced as
              an anonymous region, which is worse than no landmark at all. */}
          {touched.length > 0 && (
            <section aria-labelledby="workspace-touched-heading">
              <h3
                id="workspace-touched-heading"
                className="mb-1.5 text-xs font-semibold text-muted-foreground"
              >
                Touched this session
              </h3>
              <ul className="space-y-0.5">
                {touched.slice(0, TOUCHED_VISIBLE).map((path) => (
                  <li key={path} className="truncate font-mono text-xs" title={path}>
                    {path}
                  </li>
                ))}
              </ul>
              {touched.length > TOUCHED_VISIBLE && (
                <p className="mt-1 text-xs text-muted-foreground">
                  and {touched.length - TOUCHED_VISIBLE} more
                </p>
              )}
            </section>
          )}

          <section aria-labelledby="workspace-files-heading">
            <h3
              id="workspace-files-heading"
              className="mb-1.5 text-xs font-semibold text-muted-foreground"
            >
              Files
            </h3>
            {files.length ? (
              <ul className="space-y-0.5">
                {files.slice(0, TREE_VISIBLE).map((path) => (
                  <li
                    key={path}
                    className="truncate font-mono text-xs text-muted-foreground"
                    title={path}
                  >
                    {path}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                {mountLabel ? 'This folder is empty.' : 'Nothing written yet.'}
              </p>
            )}
            {files.length > TREE_VISIBLE && (
              <p className="mt-1 text-xs text-muted-foreground">
                Showing {TREE_VISIBLE} of {files.length} files
              </p>
            )}
          </section>
        </div>
      </ScrollArea>
    </aside>
  );
}
