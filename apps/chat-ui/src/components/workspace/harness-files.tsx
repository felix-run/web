import type { HarnessWorkspaceTree } from '@felix/client';
import { ChevronRightIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { workspaceTree } from '@/api';
import { WorkspaceFileTree } from '@/components/workspace/workspace-section';
import { requestFileAction, usePaneState } from '@/lib/side-pane';
import { cn } from '@/lib/utils';
import { WORKSPACE_WRITTEN } from '@/lib/workspace-events';
import { useShell } from '@/shell-context';

const OPEN_KEY = 'felix.sidebar.harnessFilesOpen';

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) !== '0';
  } catch {
    return true;
  }
}

/**
 * The thread's workspace on the harness — where an agent with server-side file
 * tools (`read_file`, `write_file`, …) actually works — as a tree whose files
 * open in the side pane and save back there (`/chat/workspace/*`,
 * felix-run/felix#578).
 *
 * The folder above it is the browser's, and an agent like that never reads it:
 * an edit made there reached the agent as a note about a file it then could not
 * find. So this is drawn only for an agent whose catalog entry says its tools
 * are the harness's (`felix.workspace.tools`), and not for a thread with a
 * repository checkout, whose files the repository section above already lists
 * and opens — the harness resolves the same checkout either way.
 */
export function HarnessFilesSection({ changed }: { changed: ReadonlySet<string> }) {
  const { threadId, threads, manifest, manifestEntries, streaming, openInPane } = useShell();
  // The agent the thread last ran under, else the one it will run under next.
  // (A partial shell — a test's — may carry none of these, and draws nothing.)
  const agent = threads?.find((t) => t.id === threadId)?.manifest?.trim() || manifest;
  const tools = manifestEntries?.find((m) => m.id === agent)?.workspace?.tools;
  const relevant = tools === 'server' || tools === 'both';

  const [tree, setTree] = useState<HarnessWorkspaceTree | null>(null);
  const [failed, setFailed] = useState(false);
  const refresh = useCallback(async () => {
    if (!relevant) return;
    try {
      setTree(await workspaceTree({ threadId, manifest: agent }));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [relevant, threadId, agent]);

  useEffect(() => {
    setTree(null);
    void refresh();
  }, [refresh]);
  // A run settling, or a save from the pane, is when the tree can have changed.
  useEffect(() => {
    if (!streaming) void refresh();
  }, [streaming, refresh]);
  useEffect(() => {
    const onWritten = () => void refresh();
    window.addEventListener(WORKSPACE_WRITTEN, onWritten);
    return () => window.removeEventListener(WORKSPACE_WRITTEN, onWritten);
  }, [refresh]);

  const [open, setOpen] = useState(readOpen);
  const toggle = () =>
    setOpen((o) => {
      try {
        localStorage.setItem(OPEN_KEY, o ? '0' : '1');
      } catch {
        // Storage blocked: the fold lasts for this page.
      }
      return !o;
    });

  const pane = usePaneState(threadId);
  const selected =
    pane.shown && pane.active?.startsWith('harness:') ? pane.active.slice('harness:'.length) : null;
  const paths = useMemo(
    () => (tree?.entries ?? []).map((e) => `${e.type === 'dir' ? 'd' : 'f'} ${e.path}`),
    [tree],
  );
  const files = tree?.entries.filter((e) => e.type === 'file').length ?? 0;

  if (!relevant || !tree || tree.rootKind === 'checkout') {
    return failed && relevant ? (
      <p className="text-xs text-muted-foreground">
        Could not list the thread's workspace on the harness.
      </p>
    ) : null;
  }

  return (
    <section aria-labelledby="harness-files-heading" data-slot="harness-files">
      <h3 id="harness-files-heading" className="mb-1.5">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="harness-files"
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
          On the harness
          {files > 0 && (
            <span className="ml-auto font-normal tabular-nums">
              {tree.truncated ? `${files.toLocaleString()}+` : files.toLocaleString()}
            </span>
          )}
        </button>
      </h3>
      <div id="harness-files" hidden={!open}>
        <p className="mb-1.5 text-xs text-muted-foreground">
          Where <span className="font-mono">{agent}</span>'s file tools work
          {tree.scope && tree.scope !== 'thread' ? ` (shared across the ${tree.scope})` : ''}.
        </p>
        {paths.length ? (
          <WorkspaceFileTree
            label="Files on the harness"
            paths={paths}
            changed={changed}
            selected={selected}
            onOpenFile={(path) => openInPane?.({ kind: 'file', path, source: 'harness' })}
            onFileAction={(path, action) => {
              const item = { kind: 'file' as const, path, source: 'harness' as const };
              openInPane?.(item);
              if (action !== 'open') requestFileAction(threadId, item, action);
            }}
          />
        ) : (
          <p className="text-xs text-muted-foreground">Nothing written here yet.</p>
        )}
        {tree.truncated && (
          <p className="mt-1 text-xs text-muted-foreground">
            Showing the first {files.toLocaleString()} files; the workspace holds more.
          </p>
        )}
      </div>
    </section>
  );
}
