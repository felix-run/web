import { Button } from '@felix/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@felix/ui/popover';
import { ScrollArea } from '@felix/ui/scroll-area';
import { ChevronsUpDownIcon, FolderIcon, HardDriveIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ThreadList } from '@/components/chat/thread-list';
import { CutId } from '@/components/cut-id';
import { ChangesSection } from '@/components/workspace/changes-list';
import { collectChanges, durableRunInFlight, runHasToolCalls } from '@/lib/changes';
import {
  clearMount,
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
   * What this thread's tool calls did to the workspace, per path.
   *
   * Derived from the transcript rather than tracked separately: the tool calls
   * are already the record of what the agent did, and a second list would be a
   * second thing to keep true. `collectChanges` says what a row may claim.
   *
   * A path is a workspace tool's *path argument* — `collectTouchedPaths`, not
   * the mention heuristic. The heuristic walks every string a call carries, so a
   * `github__create_pull_request` whose body listed the files it changed put
   * `./scripts/test.sh` here as though the agent had opened it.
   *
   * It covers the whole thread as hydrated, not this tab's visit to it — which is
   * why the heading says "this thread": on a thread from two days ago "this
   * session" read as "since I opened the tab", and the list is older than that.
   *
   * **It is empty during a durable run until the harness says otherwise.** A
   * durable manifest's stream carries `run_accepted` → `run_status` → `final` and
   * no tool frames, so `Turn.tools` stays empty while the agent works unless the
   * harness tails its session events onto the stream; otherwise the calls arrive
   * when the thread is hydrated after the run settles. Measured against `cowork`
   * on 2026-09-12: `write_file` was invisible here until a reload. So the section
   * says the list is coming rather than showing nothing — `durableGap`.
   */
  const changes = useMemo(() => collectChanges(turns), [turns]);
  const durableGap = durableRunInFlight(turns, streaming) && !runHasToolCalls(turns);

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

  /**
   * Approvals waiting on a thread other than this one — the reason to open the
   * popover at all, said on the trigger so it does not have to be opened to find
   * out. Only rows that name another thread count: one with no `thread_id`
   * (absent and empty mean the same) is unattributed, not evidence of being
   * elsewhere, and this thread's own are in the banner and the attention line.
   */
  const waitingElsewhere = useMemo(
    () => tenantApprovals.pending.filter((a) => a.thread_id && a.thread_id !== threadId).length,
    [tenantApprovals.pending, threadId],
  );

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
        ) : (
          // Without the directory picker (Safari, Firefox, every iPhone and iPad)
          // the mount buttons do not exist, and their silent absence read as a
          // missing feature rather than a browser that cannot offer it.
          <p className="mt-1 text-xs text-muted-foreground">
            Mounting a folder needs Chrome or Edge on a computer; files here stay in this tab.
          </p>
        )}

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
              {currentLabel?.isId ? (
                // An untitled thread's id, cut from the middle like every id that
                // has to be told apart from another. Whole to a reader.
                <span className="min-w-0 truncate text-left font-mono">
                  <CutId id={currentLabel.text} max={28} />
                </span>
              ) : (
                <span className="min-w-0 truncate text-left">
                  {currentLabel?.text ?? 'New thread'}
                </span>
              )}
              <span className="flex shrink-0 items-center gap-2">
                {waitingElsewhere > 0 && (
                  // A word beside the dot, never the dot alone; the visible pair is
                  // terse for the width, so what is announced is the whole sentence.
                  <span className="flex items-center gap-1 text-state-blocked">
                    <span aria-hidden className="size-1.5 rounded-full bg-state-blocked" />
                    <span aria-hidden className="tabular-nums">
                      {waitingElsewhere} waiting
                    </span>
                    <span className="sr-only">
                      {waitingElsewhere === 1
                        ? '1 approval waiting on another thread'
                        : `${waitingElsewhere} approvals waiting on other threads`}
                    </span>
                  </span>
                )}
                <ChevronsUpDownIcon className="size-3.5 text-muted-foreground" />
              </span>
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
              // As tall as its rows, up to the viewport below the trigger. It was a
              // fixed 24rem, which drew five of fifty threads on a screen with
              // room for twenty. Radix measures the room and publishes it; the
              // fallback is the old height, for a render with no popper around it.
              className="h-auto max-h-[calc(var(--radix-popover-content-available-height,24rem)_-_0.75rem)] w-full border-r-0 bg-transparent"
            />
          </PopoverContent>
        </Popover>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-3">
          <ChangesSection changes={changes} durableGap={durableGap} />

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
              // Files is this tab's own store; Changes above is every workspace
              // call on the thread, including the harness's own tools, which never
              // touch it. "Nothing written yet" under "+5 written" read as a
              // contradiction, so an empty store says which store it is.
              <p className="text-xs text-muted-foreground">
                {mountLabel
                  ? 'This folder is empty.'
                  : changes.some((c) => c.changed)
                    ? 'Nothing in this tab. The writes above ran on the harness.'
                    : 'Nothing written in this tab yet.'}
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
