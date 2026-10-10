import { Button } from '@felix/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@felix/ui/dropdown-menu';
import { Input } from '@felix/ui/input';
import { EllipsisIcon, PencilLineIcon, Trash2Icon } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { invalidPath } from '@/components/pane/save-to-workspace';
import { cn } from '@/lib/utils';

export type FileAction = 'rename' | 'delete';

/**
 * The file's own actions, behind one control: renaming and deleting are rarer
 * than reading, copying and saving, and a delete one click from Copy is a
 * delete made by a slip. Each opens a strip under the header that names what
 * will happen before it does.
 *
 * Both wait while the file holds an unsaved edit — the edit would be lost with
 * it, or follow the file to a name it was not written under — and say so in
 * the menu rather than leaving two dead items.
 */
export function FileActionsMenu({
  onChoose,
  blockedBy,
}: {
  onChoose: (action: FileAction) => void;
  /** Why neither action is offered now, when one is not. */
  blockedBy?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="More file actions" title="More">
          <EllipsisIcon aria-hidden className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem disabled={!!blockedBy} onSelect={() => onChoose('rename')}>
          <PencilLineIcon aria-hidden />
          Rename…
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!!blockedBy}
          variant="destructive"
          onSelect={() => onChoose('delete')}
        >
          <Trash2Icon aria-hidden />
          Delete…
        </DropdownMenuItem>
        {blockedBy && (
          <p className="max-w-56 px-2 pt-1 pb-1.5 text-xs text-muted-foreground">{blockedBy}</p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The rename's path field, or the delete's question, under the header. */
export function FileActionStrip({
  action,
  path,
  where,
  onRename,
  onDelete,
  onDone,
}: {
  action: FileAction;
  path: string;
  /** Which workspace, in words: a delete there is not one the browser can undo. */
  where: string;
  /** Resolves when it is done; rejects with the sentence to show. */
  onRename: (to: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onDone: () => void;
}) {
  const id = useId();
  const [to, setTo] = useState(path);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const submitRename = (e: FormEvent) => {
    e.preventDefault();
    const target = to.trim();
    const problem = invalidPath(target);
    if (problem) {
      setError(problem);
      return;
    }
    if (target === path) {
      onDone();
      return;
    }
    void run(() => onRename(target));
  };

  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onDone();
    }
  };

  return action === 'rename' ? (
    <form
      aria-label="Rename the file"
      onSubmit={submitRename}
      onKeyDown={keys}
      className="mx-4 mb-3 shrink-0 space-y-2 rounded-xl bg-ground px-3 py-2.5"
    >
      <label htmlFor={id} className="block text-xs font-medium text-muted-foreground">
        New path in {where}
      </label>
      <div className="flex flex-wrap items-center gap-2">
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
          aria-describedby={`${id}-note`}
          className="h-8 min-w-48 flex-1 bg-background font-mono text-xs"
        />
        <div className="flex gap-1.5">
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? 'Renaming…' : 'Rename'}
          </Button>
        </div>
      </div>
      <p
        id={`${id}-note`}
        aria-live="polite"
        className={cn('text-xs', error ? 'text-state-failed' : 'text-muted-foreground')}
      >
        {error ?? 'Moves the file; never replaces one already there. The agent is told.'}
      </p>
    </form>
  ) : (
    <div
      role="alertdialog"
      aria-label="Delete the file"
      onKeyDown={keys}
      className="mx-4 mb-3 shrink-0 space-y-2 rounded-xl bg-ground px-3 py-2.5"
    >
      <p className="text-sm">
        Delete <span className="font-mono">{path}</span> from {where}? There is no undo here.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" autoFocus onClick={onDone}>
          Keep it
        </Button>
        <Button size="sm" variant="destructive" disabled={busy} onClick={() => void run(onDelete)}>
          {busy ? 'Deleting…' : 'Delete'}
        </Button>
        {error && (
          <p aria-live="polite" className="w-full text-xs text-state-failed">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
