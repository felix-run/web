import { Button } from '@felix/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@felix/ui/popover';
import { ScrollArea } from '@felix/ui/scroll-area';
import { ChevronsUpDownIcon, FolderIcon, HardDriveIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ThreadList } from '@/components/chat/thread-list';
import {
  clearMount,
  collectTouchedPaths,
  getMountLabel,
  hasMount,
  mountTree,
  pickDirectory,
  reconnectMount,
  restoreMount,
  supportsDirectoryPicker,
  vfs,
} from '@/lib/cowork';
import { ariaShortcut, isMacPlatform, shortcutLabel } from '@/lib/shortcuts';
import { threadLabel } from '@/lib/threads';
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
    tenantApprovals,
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
   * What this thread's tool calls touched.
   *
   * Derived from the transcript rather than tracked separately: the tool calls
   * are already the record of what the agent touched, and a second list would be
   * a second thing to keep true. Newest first, deduped.
   *
   * "Touched" means a workspace tool's *path argument* — `collectTouchedPaths`,
   * not the mention heuristic. The heuristic walks every string a call carries,
   * so a `github__create_pull_request` whose body listed the files it changed put
   * `./scripts/test.sh` here as though the agent had opened it. A bare name still
   * counts: `notes.txt` at the root of the workspace is exactly the write this
   * exists to report.
   *
   * It covers the whole thread as hydrated, not this tab's visit to it — which is
   * why the heading says "this thread": on a thread from two days ago "this
   * session" read as "since I opened the tab", and the list is older than that.
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
        for (const path of collectTouchedPaths(tool.name, tool.input)) seen.add(path);
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
  const currentLabel = useMemo(() => (current ? threadLabel(current) : null), [current]);
  const threadSearchRef = useRef<HTMLInputElement | null>(null);

  /**
   * Threads with a pending approval, from the shell's tenant-wide poll. The last
   * list that arrived, so a failed tick keeps the marks it had — an approval does
   * not stop waiting because a request failed, and the attention line is where
   * the staleness is said.
   */
  const blocked = useMemo(() => {
    const ids = new Set<string>();
    for (const a of tenantApprovals.pending) if (a.thread_id) ids.add(a.thread_id);
    return ids;
  }, [tenantApprovals.pending]);

  return (
    <aside
      aria-labelledby="workspace-heading workspace-mount"
      className={cn(
        'flex h-full w-72 shrink-0 flex-col border-r border-border/60 bg-card/40',
        className,
      )}
    >
      <div className="shrink-0 border-b border-border/60 px-3 py-2.5">
        {/*
          Icon · title · one value, like every other header. The value is what is
          mounted, which is the question this header exists to answer; it used to
          hold the Mount *action*, so the header said what to do rather than what
          is, and in the narrow drawer that button sat against the close X. The
          actions are a row of their own below.
        */}
        <div className="flex min-w-0 items-center gap-2">
          {mountLabel ? (
            <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          ) : (
            <HardDriveIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <h2 id="workspace-heading" className="shrink-0 text-sm font-semibold">
            Workspace
          </h2>
          {/* Mono for a folder name, because it is the filesystem's word; the
              in-tab state is ours. A folder waiting on a reconnect is not mounted
              yet, so until it is, the honest value is where tools run now. */}
          <span
            id="workspace-mount"
            className={cn(
              'min-w-0 truncate text-xs text-muted-foreground',
              mountLabel && 'font-mono',
            )}
            title={mountLabel ?? undefined}
          >
            {mountLabel ?? 'in-tab'}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {mountLabel ? 'Client tools run against this folder' : 'Client tools run in this tab'}
        </p>

        {canMount ? (
          <div className="mt-2 flex gap-2">
            {mountLabel ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 min-w-0 flex-1 text-xs"
                  onClick={() => void onMount()}
                >
                  Change folder
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 min-w-0 flex-1 text-xs"
                  onClick={() => {
                    clearMount();
                    setMountLabel(null);
                    setReconnectName(null);
                    void refresh();
                  }}
                >
                  Disconnect
                </Button>
              </>
            ) : reconnectName ? (
              <>
                {/* A folder mounted last session, waiting on a grant only a click
                    can ask for. The name is the one thing that says which. */}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 min-w-0 flex-1 text-xs"
                  onClick={() => void onReconnect()}
                >
                  <span className="truncate">
                    Reconnect <span className="font-mono">{reconnectName}</span>
                  </span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 text-xs"
                  onClick={() => void onMount()}
                >
                  Other folder
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-full text-xs"
                onClick={() => void onMount()}
              >
                Mount a folder
              </Button>
            )}
          </div>
        ) : !mountLabel && reconnectName ? (
          // Unreachable in practice — a stored mount implies the API — but the
          // reconnect path must never depend on a second feature check.
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
              data-shortcut="threads"
              aria-keyshortcuts={ariaShortcut('open-threads', isMacPlatform())}
              title={`Threads (${shortcutLabel('open-threads', isMacPlatform())})`}
            >
              <span className={cn('min-w-0 truncate text-left', currentLabel?.isId && 'font-mono')}>
                {currentLabel?.text ?? 'New conversation'}
              </span>
              <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-[19rem] p-0"
            // Land on the search field, not on New chat. Radix focuses the first
            // tabbable element, which here is the one control that throws away the
            // thread you are on; `mod+k` opens this to *find* a thread, and the
            // pointer path loses nothing by starting in the same place.
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              threadSearchRef.current?.focus();
            }}
          >
            <ThreadList
              threads={threads}
              currentId={threadId}
              blocked={blocked}
              searchRef={threadSearchRef}
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
                Touched on this thread
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
