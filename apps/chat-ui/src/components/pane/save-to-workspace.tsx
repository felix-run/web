import { Button } from '@felix/ui/button';
import { Input } from '@felix/ui/input';
import { FilePlusIcon } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { toast } from 'sonner';
import { savedLine, useTellAgent, useTellsAgent, utf8Bytes } from '@/components/pane/edit-notice';
import { getMountLabel, readWorkspaceBytes, writeWorkspaceFile } from '@/lib/cowork';
import { openInPane } from '@/lib/side-pane';
import { cn } from '@/lib/utils';

/**
 * The control that turns content the pane was handed — a reply's code block,
 * a spilled tool output — into a workspace file.
 *
 * It is the operator's write, like a save in the editor: no approval, and the
 * agent is not told. Two things it will not do silently. It never replaces a
 * file without saying one is there and asking again, because the path is typed
 * and a typo of an existing name is a lost file. And it never writes outside
 * the workspace: a path is relative, with no `..` segment, checked here before
 * the store's own containment refuses it with a less useful message.
 */
export function SaveToWorkspaceButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Button
      variant={open ? 'secondary' : 'ghost'}
      size="icon-sm"
      aria-label="Save to the workspace"
      aria-expanded={open}
      title="Save to the workspace"
      onClick={onToggle}
    >
      <FilePlusIcon aria-hidden className="size-3.5" />
    </Button>
  );
}

/**
 * The name a code block most likely wants: the path a model so often writes on
 * its first line (`// src/app.ts`, `# file: deploy.sh`, `<!-- index.html -->`),
 * else `snippet` with the language's extension.
 */
export function suggestedName(code: string, extension: string): string {
  const first = code.split('\n', 1)[0] ?? '';
  const named =
    /^\s*(?:\/\/|#|--|;|<!--|\/\*)\s*(?:file(?:name)?:\s*)?([\w.-]+(?:\/[\w.-]+)*\.\w+)\s*(?:-->|\*\/)?\s*$/i.exec(
      first,
    )?.[1];
  return named && !invalidPath(named) ? named : `snippet.${extension}`;
}

/** Why a typed path cannot be written, or null when it can. */
export function invalidPath(path: string): string | null {
  const p = path.trim();
  if (!p) return 'Name the file.';
  if (p.startsWith('/') || /^[a-z]:[\\/]/i.test(p))
    return 'Use a path inside the workspace, not an absolute one.';
  if (p.endsWith('/')) return 'That is a folder. Add a file name.';
  if (p.split(/[\\/]/).some((part) => part === '..')) return 'A path cannot leave the workspace.';
  if (p.split('/').some((part) => part === '')) return 'That path has an empty folder in it.';
  return null;
}

export function SaveToWorkspaceForm({
  threadId,
  suggested,
  text,
  onDone,
}: {
  threadId: string;
  suggested: string;
  text: string;
  onDone: () => void;
}) {
  const id = useId();
  const [path, setPath] = useState(suggested);
  /** The path last found to hold a file: asking again for the same path replaces it. */
  const [occupied, setOccupied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tellAgent = useTellAgent();
  const tellsAgent = useTellsAgent();
  const target = path.trim();
  const replacing = occupied !== null && occupied === target;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = invalidPath(target);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (!replacing && (await readWorkspaceBytes(target)) !== null) {
        setOccupied(target);
        return;
      }
      await writeWorkspaceFile(target, text);
      openInPane(threadId, { kind: 'file', path: target });
      onDone();
      // The form and the view holding it are gone once the new file's tab is in
      // front, so what came of telling the agent is said where it will be read.
      const notice = await tellAgent({ path: target, bytes: utf8Bytes(text) });
      toast(savedLine(notice).replace(/^Saved\./, `Saved ${target}.`));
    } catch (err) {
      setError(`Could not save ${target}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const store = getMountLabel();
  return (
    <form
      aria-label="Save to the workspace"
      onSubmit={(e) => void submit(e)}
      className="mx-4 mb-3 shrink-0 space-y-2 rounded-xl bg-ground px-3 py-2.5"
    >
      <label htmlFor={id} className="block text-xs font-medium text-muted-foreground">
        Save as a file in{' '}
        {store ? (
          <span className="font-mono text-foreground">{store}</span>
        ) : (
          "this tab's workspace"
        )}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          size="sm"
          id={id}
          autoFocus
          value={path}
          onChange={(e) => {
            setPath(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onDone();
            }
          }}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-note`}
          className="min-w-48 flex-1 bg-background font-mono"
        />
        <div className="flex gap-1.5">
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            variant={replacing ? 'destructive' : 'default'}
            disabled={busy}
          >
            {busy ? 'Saving…' : replacing ? 'Replace' : 'Save'}
          </Button>
        </div>
      </div>
      <p
        id={`${id}-note`}
        aria-live="polite"
        className={cn('text-xs', error ? 'text-state-failed' : 'text-muted-foreground')}
      >
        {error ??
          (replacing ? (
            <>
              <span className="text-foreground">A file is already at {target}.</span> Saving
              replaces it.
            </>
          ) : tellsAgent ? (
            'The agent is told when you save. The file opens here.'
          ) : (
            "The agent isn't told. The file opens here once it is saved."
          ))}
      </p>
    </form>
  );
}
