import { Button } from '@felix/ui/button';
import { ChevronRightIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ItemHeader } from '@/components/pane/pane-parts';
import {
  FolderActionDialog,
  requestFolderAction,
  useFolderRequest,
} from '@/components/workspace/folder-action';
import { HarnessFilesSection } from '@/components/workspace/harness-files';
import { ThreadRepoSection } from '@/components/workspace/thread-repo';
import { WorkspaceFileTree } from '@/components/workspace/workspace-section';
import { collectChanges, treePath } from '@/lib/changes';
import { hasMount, mountTree, supportsDirectoryPicker, vfs } from '@/lib/cowork';
import { disconnectFolder, mountFolder, reconnectFolder, useMount } from '@/lib/mount-state';
import { lastOpenedFile, requestFileAction, usePaneState } from '@/lib/side-pane';
import { cn } from '@/lib/utils';
import { WORKSPACE_WRITTEN } from '@/lib/workspace-events';
import { inBrowser, onHarness, useWorkspaceTools } from '@/lib/workspace-tools';
import { useShell } from '@/shell-context';

/**
 * How many entries the browser's tree reads. It used to be 200, which a mounted
 * repository spent before reaching most of its own top level; one more is asked
 * for so the tree can say it stopped rather than pass a cut list off as the folder.
 */
const TREE_VISIBLE = 5_000;

const BROWSER_OPEN_KEY = 'felix.files.browserOpen';

/**
 * Files: the workspace the thread's agent works in, as the side pane's first tab.
 *
 * It was a section of the sidebar, folded by default because a mounted
 * repository's tree was taller than the region it shared with the harness's
 * pages — so the tree was a click away, and the file it opened appeared on the
 * other side of the screen. Here a file opens in the tab beside the tree it came
 * from, and the sidebar keeps one row that says what is mounted.
 *
 * Which trees it holds follows the agent (`felix.workspace.tools`): the browser's
 * folder for client tools, the harness's workspace — or the thread's repository
 * checkout, which is the same place — for server tools, both for both. An agent
 * with no file tools has no Files at all; see `useWorkspaceTools`.
 */
export function FilesView() {
  const { turns, streaming, threadId, openInPane, watching } = useShell();
  const tools = useWorkspaceTools();
  const browser = inBrowser(tools);
  const harness = onHarness(tools);
  const folderRequest = useFolderRequest();
  const mount = useMount();
  const canMount = supportsDirectoryPicker();

  /**
   * Which files this thread's calls changed, so the trees open onto them and draw
   * them in the foreground. The list itself is the instrument's Changes tab; see
   * `collectChanges` for what counts as a change.
   */
  const changes = useMemo(() => collectChanges(turns), [turns]);
  const changedPaths = useMemo(
    () => new Set(changes.filter((c) => c.changed).map((c) => treePath(c.path))),
    [changes],
  );

  const facts = [
    browser &&
      (mount.label ? 'Client tools run against this folder' : 'Client tools run in this tab'),
    harness && !browser && 'File tools run on the harness',
  ];

  return (
    <section aria-label="Files" data-slot="files-view" className="flex min-h-0 flex-1 flex-col">
      <ItemHeader
        name={browser && mount.label ? mount.label : 'Workspace'}
        mono={Boolean(browser && mount.label)}
        meta={facts}
        actions={
          browser && !watching ? (
            <MountActions canMount={canMount} label={mount.label} reconnect={mount.reconnect} />
          ) : undefined
        }
      />
      {browser && !canMount && !mount.label && (
        // Without the directory picker (Safari, Firefox, every iPhone and iPad) the
        // mount buttons do not exist, and their silent absence read as a missing
        // feature rather than a browser that cannot offer it.
        <p className="-mt-1 px-4 pb-2.5 text-xs text-muted-foreground">
          Mounting a folder needs Chrome or Edge on a computer; files here stay in this tab.
        </p>
      )}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain border-t border-border/60 px-4 pt-3 pb-6">
        <ThreadRepoSection threadId={threadId} streaming={streaming} />
        {harness && <HarnessFilesSection changed={changedPaths} />}
        {browser && (
          <BrowserFiles
            threadId={threadId}
            changedPaths={changedPaths}
            anyChange={changes.some((c) => c.changed)}
            mounted={mount.label}
            streaming={streaming}
            labelled={harness}
            onOpenFile={(path) => openInPane?.({ kind: 'file', path })}
          />
        )}
      </div>
      <FolderActionDialog request={folderRequest} onClose={() => requestFolderAction(null)} />
    </section>
  );
}

/** Mount, change, disconnect or reconnect the browser's folder. Each must run inside its click. */
function MountActions({
  canMount,
  label,
  reconnect,
}: {
  canMount: boolean;
  label: string | null;
  reconnect: string | null;
}) {
  if (!canMount) {
    // Unreachable in practice — a stored mount implies the API — but the reconnect
    // path must never depend on a second feature check.
    return !label && reconnect ? (
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        onClick={() => void reconnectFolder()}
      >
        Reconnect <span className="font-mono">{reconnect}</span>
      </Button>
    ) : null;
  }
  if (label) {
    return (
      <>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => void mountFolder()}
        >
          Change folder
        </Button>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={disconnectFolder}>
          Disconnect
        </Button>
      </>
    );
  }
  if (reconnect) {
    // A folder mounted last session, waiting on a grant only a click can ask for.
    // The name is the one thing that says which.
    return (
      <>
        <Button
          variant="outline"
          size="sm"
          className="h-7 max-w-56 text-xs"
          onClick={() => void reconnectFolder()}
        >
          <span className="truncate">
            Reconnect <span className="font-mono">{reconnect}</span>
          </span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => void mountFolder()}
        >
          Other folder
        </Button>
      </>
    );
  }
  return (
    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => void mountFolder()}>
      Mount a folder
    </Button>
  );
}

function readBrowserOpen(): boolean {
  try {
    return localStorage.getItem(BROWSER_OPEN_KEY) !== '0';
  } catch {
    return true;
  }
}

/**
 * The browser's tree: the mounted folder, or the tab's own store. A root of its
 * own, folding on its own, beside the harness's when the agent works in both.
 */
function BrowserFiles({
  threadId,
  changedPaths,
  anyChange,
  mounted,
  streaming,
  labelled,
  onOpenFile,
}: {
  threadId: string;
  changedPaths: ReadonlySet<string>;
  /** A write landed somewhere on this thread — on the harness, perhaps, not here. */
  anyChange: boolean;
  mounted: string | null;
  streaming: boolean;
  /** Beside another root, so it needs its name. */
  labelled: boolean;
  onOpenFile: (path: string) => void;
}) {
  const [files, setFiles] = useState<string[] | null>(null);
  const refresh = useCallback(async () => {
    setFiles(hasMount() ? await mountTree(TREE_VISIBLE + 1) : vfs.tree(TREE_VISIBLE + 1));
  }, []);
  // Read on mount, then when it can have changed: a save from the pane or a mount
  // changing (both `WORKSPACE_WRITTEN`), and a run stopping, which is when the
  // agent's writes have landed. Polling would be a filesystem read every few
  // seconds for a tree that only changes when a tool runs.
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    const onWritten = () => void refresh();
    window.addEventListener(WORKSPACE_WRITTEN, onWritten);
    return () => window.removeEventListener(WORKSPACE_WRITTEN, onWritten);
  }, [refresh]);
  useEffect(() => {
    if (!streaming) void refresh();
  }, [streaming, refresh]);

  const [open, setOpen] = useState(readBrowserOpen);
  const toggle = () =>
    setOpen((o) => {
      try {
        localStorage.setItem(BROWSER_OPEN_KEY, o ? '0' : '1');
      } catch {
        // Storage blocked: the fold lasts for this page.
      }
      return !o;
    });

  const pane = usePaneState(threadId);
  const selected = lastOpenedFile(pane);
  const count = files?.length ?? 0;

  const body =
    files === null ? null : (
      <>
        {count ? (
          <WorkspaceFileTree
            label={labelled ? 'Files in this browser' : 'Files'}
            paths={files.slice(0, TREE_VISIBLE)}
            changed={changedPaths}
            selected={selected}
            onOpenFile={onOpenFile}
            onFileAction={(path, action) => {
              onOpenFile(path);
              if (action !== 'open') requestFileAction(threadId, { kind: 'file', path }, action);
            }}
            onFolderAction={(path, action) =>
              requestFolderAction({ path, action, source: 'browser' })
            }
          />
        ) : (
          // The instrument's Changes is every workspace call on the thread, including
          // the harness's own tools, which never touch this store. "Nothing written
          // yet" beside "+5 written" read as a contradiction, so an empty store says
          // which store it is.
          <p className="text-xs text-muted-foreground">
            {mounted
              ? 'This folder is empty.'
              : anyChange && !labelled
                ? "Nothing in this tab. This thread's writes ran on the harness."
                : 'Nothing here yet. Files the agent writes appear here.'}
          </p>
        )}
        {count > TREE_VISIBLE && (
          <p className="mt-1 text-xs text-muted-foreground">
            Showing the first {TREE_VISIBLE.toLocaleString()} entries; the folder holds more.
          </p>
        )}
      </>
    );

  if (!labelled) return <div data-slot="browser-files">{body}</div>;
  return (
    <section aria-labelledby="browser-files-heading" data-slot="browser-files">
      <h3 id="browser-files-heading" className="mb-1.5">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="browser-files"
          onClick={toggle}
          className="flex w-full items-center gap-1 rounded-md text-left text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
        >
          <ChevronRightIcon
            aria-hidden
            className={cn(
              'size-3 transition-transform duration-200 ease-out motion-reduce:transition-none',
              open && 'rotate-90',
            )}
          />
          This browser
          {count > 0 && (
            <span className="ml-auto font-normal tabular-nums">
              {count > TREE_VISIBLE ? `${TREE_VISIBLE.toLocaleString()}+` : count.toLocaleString()}
            </span>
          )}
        </button>
      </h3>
      <div id="browser-files" hidden={!open}>
        {body}
      </div>
    </section>
  );
}
