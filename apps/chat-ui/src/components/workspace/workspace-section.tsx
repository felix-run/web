import { Button } from '@felix/ui/button';
import { ChevronRightIcon, FileIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  FileTree,
  FileTreeFile,
  FileTreeFolder,
  FileTreeIcon,
  FileTreeName,
} from '@/components/ai-elements/file-tree';
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
import { ancestorsOf, buildTree, type TreeNode } from '@/lib/file-tree';
import { cn } from '@/lib/utils';
import { useShell } from '@/shell-context';

/**
 * The workspace: the folder the agent works on, as a section of the sidebar.
 *
 * It was the whole left zone, with threads hung off its header in a popover —
 * which made that popover the only door to another conversation at any width.
 * The sidebar gave threads back a list of their own, so this is one section of
 * it: what is mounted, what this thread's calls changed, and the files. It
 * folds, and remembers that it did, because on a thread with no workspace work
 * it is a tall block between the thread list and the harness.
 *
 * Its first state on many mornings is not a tree. `restoreMount()` can only
 * return `needs-permission`, because the readwrite grant belongs to the document
 * and boot is not allowed to ask for it — so "reconnect <name>" is a normal
 * resting state here, not an error.
 */

const TREE_VISIBLE = 200;

const FOLD_KEY = 'felix.sidebar.workspaceFolded';

function readFolded(): boolean {
  try {
    return localStorage.getItem(FOLD_KEY) === '1';
  } catch {
    return false;
  }
}

export function WorkspaceSection({ className }: { className?: string }) {
  const { turns, streaming } = useShell();
  const [folded, setFolded] = useState(readFolded);
  const toggleFolded = () =>
    setFolded((f) => {
      try {
        localStorage.setItem(FOLD_KEY, f ? '0' : '1');
      } catch {
        // Storage blocked: the fold lasts for this page.
      }
      return !f;
    });

  const [mountLabel, setMountLabel] = useState<string | null>(getMountLabel());
  const [reconnectName, setReconnectName] = useState<string | null>(null);
  const [files, setFiles] = useState<string[]>([]);
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
  /** Paths a write or edit landed on, normalised to the tree's spelling. */
  const changedPaths = useMemo(
    () => new Set(changes.filter((c) => c.changed).map((c) => normalisePath(c.path))),
    [changes],
  );
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

  return (
    <section
      aria-labelledby="workspace-heading workspace-mount"
      data-slot="workspace-section"
      className={cn('px-2 py-2', className)}
    >
      {/*
        The sidebar's section header, the same row the Harness section draws: a
        small muted label, its one value, and the fold at the right edge — so the
        three sections read as one list with three headings rather than three
        components. It used to be an icon and a bold title, louder than both of
        its neighbours for a section that is often folded. The value is what is
        mounted, the question this header exists to answer.
      */}
      <div className="flex h-7 min-w-0 items-center px-2">
        {/* The label and its value as one group with no control in it: the value
            is a fact. The fold is the row's, beside the group. */}
        <div className="flex min-w-0 items-center gap-1.5">
          <h2 id="workspace-heading" className="shrink-0 text-xs font-medium text-muted-foreground">
            Workspace
          </h2>
          {/* Mono for a folder name, because it is the filesystem's word; the
            in-tab state is ours. A folder waiting on a reconnect is not mounted
            yet, so until it is, the honest value is where tools run now. */}
          <span
            id="workspace-mount"
            className={cn(
              'min-w-0 truncate text-xs',
              mountLabel ? 'font-mono text-foreground' : 'text-muted-foreground',
            )}
            title={mountLabel ?? undefined}
          >
            {mountLabel ?? 'in-tab'}
          </span>
        </div>
        {/* `-mr-[5px]` sets the chevron's glyph, not its box, on the Harness
            fold's line: that one is a bare 14px icon at the row's padding, this
            one is centred in a 24px target. */}
        <button
          type="button"
          aria-expanded={!folded}
          aria-controls="workspace-body"
          aria-label={folded ? 'Show workspace' : 'Hide workspace'}
          onClick={toggleFolded}
          className="-mr-[5px] ml-auto grid size-6 shrink-0 coarse:size-9 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
        >
          <ChevronRightIcon
            aria-hidden
            className={cn(
              'size-3.5 transition-transform duration-200 ease-out motion-reduce:transition-none',
              !folded && 'rotate-90',
            )}
          />
        </button>
      </div>
      <div className="px-2">
        <p className="truncate text-xs text-muted-foreground">
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
      </div>

      <div id="workspace-body" hidden={folded} className="mt-3 space-y-4 px-2">
        <ChangesSection changes={changes} durableGap={durableGap} />

        <section aria-labelledby="workspace-files-heading">
          <h3
            id="workspace-files-heading"
            className="mb-1.5 text-xs font-semibold text-muted-foreground"
          >
            Files
          </h3>
          {files.length ? (
            <WorkspaceFileTree paths={files.slice(0, TREE_VISIBLE)} changed={changedPaths} />
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
    </section>
  );
}

/** A tool's path argument as the tree spells it: no `./`, no leading slash. */
function normalisePath(path: string): string {
  return path.replace(/^\.\//, '').replace(/^\/+/, '');
}

/**
 * The workspace's files as a tree rather than a flat column of paths.
 *
 * It opens onto the work: the folders holding a path this thread wrote or edited
 * start expanded, and those paths are drawn in the foreground while the rest stay
 * muted — the same distinction *Changes on this thread* draws above, carried into
 * the place an operator looks for a file. Everything else starts folded, so a
 * mounted repository is one row per top-level entry instead of two hundred paths.
 */
function WorkspaceFileTree({
  paths,
  changed,
}: {
  paths: readonly string[];
  changed: ReadonlySet<string>;
}) {
  const tree = useMemo(() => buildTree(paths), [paths]);
  // Seeded once, from the changes on screen when the tree first draws: after that
  // the folds are the operator's.
  const [expanded, setExpanded] = useState(() => ancestorsOf(changed));
  const render = (nodes: TreeNode[]) =>
    nodes.map((node) =>
      node.kind === 'folder' ? (
        <FileTreeFolder key={node.path} path={node.path} name={node.name} title={node.path}>
          {render(node.children)}
        </FileTreeFolder>
      ) : (
        <FileTreeFile key={node.path} path={node.path} name={node.name} title={node.path}>
          <span aria-hidden className="size-4 shrink-0" />
          <FileTreeIcon>
            <FileIcon aria-hidden className="size-3.5 text-muted-foreground" />
          </FileTreeIcon>
          <FileTreeName
            className={changed.has(node.path) ? 'text-foreground' : 'text-muted-foreground'}
          >
            {node.name}
            {changed.has(node.path) && <span className="sr-only">, changed on this thread</span>}
          </FileTreeName>
        </FileTreeFile>
      ),
    );
  return (
    <FileTree
      aria-label="Files"
      expanded={expanded}
      onExpandedChange={setExpanded}
      className="max-h-64 overflow-y-auto rounded-none border-0 bg-transparent text-xs [&>div]:p-0"
    >
      {render(tree)}
    </FileTree>
  );
}
