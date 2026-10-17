import { LeaseRefusedError, WorkspaceRouteError } from '@felix/client';
import { Button } from '@felix/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@felix/ui/dialog';
import { Input } from '@felix/ui/input';
import { type FormEvent, useEffect, useId, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { workspaceDeleteFolder, workspaceRenameFolder, workspaceTree } from '@/api';
import { outcomeLine, useTellAgent } from '@/components/pane/edit-notice';
import { invalidPath } from '@/components/pane/save-to-workspace';
import {
  deleteWorkspaceFolder,
  filesUnderWorkspaceFolder,
  getMountLabel,
  renameWorkspaceFolder,
} from '@/lib/cowork';
import { closePaneItem, isDirty, usePaneState } from '@/lib/side-pane';
import { WORKSPACE_WRITTEN } from '@/lib/workspace-events';
import { type EditNotice, useOptionalShell } from '@/shell-context';

export interface FolderRequest {
  path: string;
  action: 'rename' | 'delete';
  /** Where the folder lives: the browser's workspace, or the thread's on the harness. */
  source: 'browser' | 'harness';
}

// One request at a time, from whichever tree asked: the dialog is rendered once,
// by the workspace section, and every tree inside it reaches it here.
let current: FolderRequest | null = null;
const listeners = new Set<() => void>();
export function requestFolderAction(request: FolderRequest | null) {
  current = request;
  for (const l of listeners) l();
}
export function useFolderRequest(): FolderRequest | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => current,
  );
}

/** How many of a folder's files the delete dialog names before saying how many more. */
const NAMED = 8;

/**
 * Renaming or deleting a whole folder, from the sidebar tree.
 *
 * A dialog, where a file's actions are a strip in the pane: a folder is not
 * something the pane opens, and deleting one takes every file in it with no
 * undo — the one action here that earns an interruption. The delete names the
 * files it takes (the first few, and how many more), and the count it showed is
 * the count it is confirmed on: the harness and the browser stores both refuse
 * a folder that holds another number by the time the operator says yes.
 *
 * Both wait while a file under the folder holds an unsaved edit in the pane —
 * the edit would be lost with it, or left pointing at a path that is gone.
 */
export function FolderActionDialog({
  request,
  onClose,
}: {
  request: FolderRequest | null;
  onClose: () => void;
}) {
  const open = request !== null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {request && (
          <FolderAction
            key={`${request.source}:${request.path}:${request.action}`}
            request={request}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function FolderAction({ request, onClose }: { request: FolderRequest; onClose: () => void }) {
  const { path, action, source } = request;
  const shell = useOptionalShell();
  const threadId = shell?.threadId ?? '';
  const manifest = shell?.manifest;
  const tellAgent = useTellAgent();
  const pane = usePaneState(threadId);
  const id = useId();
  const harness = source === 'harness';
  const where = harness
    ? 'the thread’s workspace on the harness'
    : (getMountLabel() ?? 'this tab’s workspace');

  // Open tabs under the folder: an unsaved one holds the action back.
  const prefix = `${path.replace(/\/+$/, '')}/`;
  const keyPrefix = `${harness ? 'harness' : 'file'}:${prefix}`;
  const under = pane.items.filter((i) => i.key.startsWith(keyPrefix));
  const unsaved = under.filter(isDirty).length;

  const [files, setFiles] = useState<string[] | null>(null);
  const [countError, setCountError] = useState<string | null>(null);
  useEffect(() => {
    if (action !== 'delete') return;
    let live = true;
    void (async () => {
      try {
        let list: string[];
        if (harness) {
          const tree = await workspaceTree({ threadId, ...(manifest ? { manifest } : {}) });
          if (tree?.truncated) throw new Error('This workspace is too large to count from here.');
          list = (tree?.entries ?? [])
            .filter((e) => e.type === 'file' && e.path.startsWith(prefix))
            .map((e) => e.path);
        } else {
          list = await filesUnderWorkspaceFolder(path);
        }
        if (live) setFiles(list);
      } catch (err) {
        if (live) setCountError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      live = false;
    };
  }, [action, harness, threadId, manifest, path, prefix]);

  const [to, setTo] = useState(path.replace(/\/+$/, ''));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refusal = (err: unknown): string => {
    if (err instanceof WorkspaceRouteError) {
      switch (err.code) {
        case 'workspace_changed':
          return `It changed since you opened this: it now holds ${err.count ?? 'a different number of'} files. Close this and look again.`;
        case 'too_many_entries':
          return 'It holds more than 2,000 entries, which this does not delete or move.';
        case 'too_deep':
          return 'It is nested too deep to delete or move from here.';
        case 'not_a_directory':
          return 'That is a file now, not a folder.';
        case 'target_exists':
          return `Something is already at ${to.trim()}. Choose another path.`;
        case 'reserved_path':
          return 'It holds a .git folder or other reserved path, which this does not delete or move.';
        case 'not_found':
          return 'It is no longer there.';
        default:
          return `The harness refused it (${err.code}).`;
      }
    }
    if (err instanceof LeaseRefusedError) return 'Another tab is driving this thread.';
    if (err instanceof Error && err.name === 'FolderChangedError') {
      return `It changed since you opened this: it now holds ${(err as Error & { count?: number }).count ?? 'a different number of'} files. Close this and look again.`;
    }
    if (err instanceof Error && err.name === 'TargetExistsError') {
      return `Something is already at ${to.trim()}. Choose another path.`;
    }
    return err instanceof Error ? err.message : String(err);
  };

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      onClose();
    } catch (err) {
      setError(refusal(err));
    } finally {
      setBusy(false);
    }
  };

  const doDelete = () =>
    run(async () => {
      const expected = files?.length ?? 0;
      let notice: EditNotice | null;
      if (harness) {
        const done = await workspaceDeleteFolder({
          threadId,
          path,
          expectedCount: expected,
          ...(manifest ? { manifest } : {}),
        });
        window.dispatchEvent(new Event(WORKSPACE_WRITTEN));
        if (done.status === 'recorded') shell?.showRecordedNote?.();
        notice = done.status;
      } else {
        await deleteWorkspaceFolder(path, expected);
        notice = await tellAgent({ path, op: 'delete' });
      }
      for (const item of under) closePaneItem(threadId, item.key);
      toast(
        outcomeLine(
          `Deleted the folder ${path} and its ${expected} ${expected === 1 ? 'file' : 'files'}.`,
          notice,
        ),
      );
    });

  const doRename = (e: FormEvent) => {
    e.preventDefault();
    const target = to.trim().replace(/\/+$/, '');
    const problem = invalidPath(target);
    if (problem) {
      setError(problem);
      return;
    }
    if (target === path.replace(/\/+$/, '')) {
      onClose();
      return;
    }
    void run(async () => {
      let notice: EditNotice | null;
      if (harness) {
        const done = await workspaceRenameFolder({
          threadId,
          path,
          toPath: target,
          ...(manifest ? { manifest } : {}),
        });
        window.dispatchEvent(new Event(WORKSPACE_WRITTEN));
        if (done.status === 'recorded') shell?.showRecordedNote?.();
        notice = done.status;
      } else {
        await renameWorkspaceFolder(path, target);
        notice = await tellAgent({ path, op: 'rename', toPath: target });
      }
      // Their paths are gone: close them rather than leave tabs on files that moved.
      for (const item of under) closePaneItem(threadId, item.key);
      toast(outcomeLine(`Renamed the folder ${path} to ${target}.`, notice));
    });
  };

  if (unsaved > 0) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>
            {action === 'delete' ? 'Delete' : 'Rename'} {path}
          </DialogTitle>
          <DialogDescription>
            {unsaved === 1 ? 'A file' : `${unsaved} files`} under this folder{' '}
            {unsaved === 1 ? 'has' : 'have'} unsaved edits in the side pane. Save or revert{' '}
            {unsaved === 1 ? 'it' : 'them'} first.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </>
    );
  }

  if (action === 'rename') {
    return (
      <form onSubmit={doRename} className="contents">
        <DialogHeader>
          <DialogTitle>Rename the folder {path}</DialogTitle>
          <DialogDescription>
            Moves it and everything in it within {where}. Never over anything already there. The
            agent is told.
          </DialogDescription>
        </DialogHeader>
        <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
          New path
        </label>
        <Input
          id={id}
          autoFocus
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setError(null);
          }}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-invalid={error ? true : undefined}
          className="font-mono"
        />
        {error && (
          <p aria-live="polite" className="text-sm text-state-failed">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Renaming…' : 'Rename'}
          </Button>
        </DialogFooter>
      </form>
    );
  }

  const count = files?.length ?? null;
  return (
    <>
      <DialogHeader>
        <DialogTitle>Delete the folder {path}?</DialogTitle>
        <DialogDescription>
          {count === null
            ? countError
              ? countError
              : 'Counting what is in it…'
            : count === 0
              ? `It holds no files. It is removed from ${where}.`
              : `Deletes it and the ${count} ${count === 1 ? 'file' : 'files'} in it from ${where}. There is no undo here.`}
        </DialogDescription>
      </DialogHeader>
      {files && files.length > 0 && (
        <ul className="max-h-48 space-y-0.5 overflow-auto rounded-lg bg-ground px-3 py-2 font-mono text-xs">
          {files.slice(0, NAMED).map((f) => (
            <li key={f} className="truncate" title={f}>
              {f}
            </li>
          ))}
          {files.length > NAMED && (
            <li className="font-sans text-muted-foreground">and {files.length - NAMED} more</li>
          )}
        </ul>
      )}
      {error && (
        <p aria-live="polite" className="text-sm text-state-failed">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button variant="ghost" autoFocus onClick={onClose}>
          Keep it
        </Button>
        <Button
          variant="destructive"
          disabled={busy || count === null}
          onClick={() => void doDelete()}
        >
          {busy
            ? 'Deleting…'
            : count
              ? `Delete ${count} ${count === 1 ? 'file' : 'files'}`
              : 'Delete'}
        </Button>
      </DialogFooter>
    </>
  );
}
