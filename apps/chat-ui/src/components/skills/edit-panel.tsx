import { isStaleWrite } from '@felix/client';
import { isBinaryAssetPath } from '@felix/skill-format';
import { Button } from '@felix/ui/button';
import { Skeleton } from '@felix/ui/skeleton';
import { TriangleAlertIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ErrorNotice } from '@/components/error-notice';
import { PageSection } from '@/components/harness/panel';
import { isMacPlatform } from '@/lib/shortcuts';
import type { FileChange } from './bundle-compare';
import type { CodeEditorHandle } from './code-editor';
import { DiffView } from './diff-view';
import { errorLinesForSkillMd } from './frontmatter-lines';
import { useSkillFile } from './queries';
import { RefusalNotice } from './refusal';
import { SaveDialog } from './save-dialog';
import { ScoreReadout } from './score-readout';
import { SkillBundleEditor } from './skill-bundle-editor';
import { REDACTED, type Resolution, type SkillEditor } from './use-skill-editor';
import { ValidationPanel } from './validation-panel';

/**
 * The Edit tab: the bundle editor, what the harness will say about it, and the
 * save.
 *
 * Cmd/Ctrl+S opens the save dialog rather than the browser's "save page" —
 * and only the dialog, because a version needs a reason and a size of change.
 * A stale save (someone saved a newer version since this was loaded) stops at
 * a choice between the two honest outcomes; the editor never picks one.
 */
export function EditPanel({ name, editor }: { name: string; editor: SkillEditor }) {
  const { bundle, files, issues, errorLines, local, save, stale, parent } = editor;
  const editorRef = useRef<CodeEditorHandle>(null);
  const [saving, setSaving] = useState(false);
  const [dialogKey, setDialogKey] = useState(0);
  const issuesId = useId();

  const openSave = () => {
    if (editor.saveBlocked) {
      toast.error(editor.saveBlocked);
      return;
    }
    // A save always mints a version, so an unchanged bundle would be a second
    // copy of the one it was loaded from under a new number.
    if (!bundle.dirty) {
      toast(`Nothing to save: this is ${parent} as it was saved.`);
      return;
    }
    if (issues.length > 0) {
      toast.error(
        `Fix ${issues.length} issue${issues.length === 1 ? '' : 's'} first: the harness would refuse this bundle.`,
      );
      return;
    }
    save.reset();
    setSaving(true);
  };

  // Ref'd, so the listener is attached once and never reads a stale `openSave`.
  // The dialog handles the shortcut itself while it is open — as "save" — so
  // this one stands down rather than resetting a save in flight.
  const openRef = useRef(openSave);
  openRef.current = openSave;
  const savingRef = useRef(saving);
  savingRef.current = saving;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 's' || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      if (!savingRef.current) openRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (files.error) {
    return <ErrorNotice error={files.error} doing={`read ${name}'s files to edit`} />;
  }
  if (!files.data || !parent) return <Skeleton className="h-96 w-full rounded-lg" />;

  const shortcut = isMacPlatform() ? '⌘S' : 'Ctrl+S';
  const lastSave = editor.lastSave;

  return (
    <div className="space-y-4">
      {stale && (
        <StaleChoice
          stale={stale}
          onReload={editor.reloadFrom}
          onKeep={editor.keepEditsOnto}
          dirty={bundle.dirty}
        />
      )}
      {editor.rebase && (
        <RebasePanel
          name={name}
          rebase={editor.rebase}
          mine={bundle.files}
          onResolve={editor.resolve}
        />
      )}

      {editor.redacted.length > 0 && (
        <div
          role="note"
          className="flex items-start gap-2 rounded-lg border border-state-blocked/30 bg-state-blocked/10 px-2.5 py-2 text-sm text-state-blocked"
        >
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <p className="min-w-0">
            The harness replaced a secret with <span className="font-mono">{REDACTED}</span> in{' '}
            {editor.redacted.map((p, i) => (
              <span key={p}>
                {i > 0 && ', '}
                <span className="font-mono">{p}</span>
              </span>
            ))}
            . Saving writes that placeholder, not the original value — put the real value back by
            hand, or keep it out of the skill.
          </p>
        </div>
      )}

      {lastSave && (
        <div
          role="status"
          className="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm"
        >
          <div className="min-w-0">
            {lastSave.published ? (
              <p>
                Saved and published <span className="font-mono">{lastSave.version}</span>.
              </p>
            ) : lastSave.publish_blocked ? (
              <>
                <p>
                  Saved <span className="font-mono">{lastSave.version}</span> as a draft. Publishing
                  it was refused:
                </p>
                <ul className="mt-1 list-disc pl-5 text-state-failed">
                  {(lastSave.publish_blocked.reasons?.length
                    ? lastSave.publish_blocked.reasons
                    : [lastSave.publish_blocked.message]
                  ).map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p>
                Saved <span className="font-mono">{lastSave.version}</span> as a draft. It enters no
                catalog until it is published.
              </p>
            )}
          </div>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={editor.clearLastSave}>
            Dismiss
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-xs text-muted-foreground">
          Editing from <span className="font-mono text-foreground">{parent}</span>
          {bundle.dirty ? ' · unsaved changes' : ''}
        </span>
        {local && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            if saved now:
            <ScoreReadout quality={local.review.score} security={local.scan.status} />
          </span>
        )}
        <Button
          size="sm"
          variant={bundle.dirty ? 'default' : 'outline'}
          className="ml-auto"
          onClick={openSave}
          disabled={save.isPending || !bundle.dirty}
          title={bundle.dirty ? undefined : `No changes from ${parent} yet`}
          aria-keyshortcuts={isMacPlatform() ? 'Meta+S' : 'Control+S'}
        >
          Save version… <span className="ml-1 text-xs opacity-70">{shortcut}</span>
        </Button>
      </div>

      <SkillBundleEditor
        bundle={bundle}
        slug={name}
        validationErrors={issues}
        errorLines={errorLines}
        editorRef={editorRef}
        issuesId={issues.length > 0 ? issuesId : undefined}
      />

      <PageSection
        title="Validation"
        meta={
          issues.length ? `${issues.length} issue${issues.length === 1 ? '' : 's'}` : 'no issues'
        }
      >
        <ValidationPanel
          id={issuesId}
          errors={issues}
          onFocusError={(error) => {
            bundle.setActivePath(
              error.path.startsWith('frontmatter') || error.path === 'SKILL.md'
                ? 'SKILL.md'
                : error.path,
            );
            const line =
              errorLinesForSkillMd(bundle.files['SKILL.md'] ?? '', [error])
                .values()
                .next().value ?? 1;
            requestAnimationFrame(() => editorRef.current?.focusLine(line));
          }}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Checked here as you type, with the harness's rules. The harness checks the save again, and
          its answer is the one that counts.
        </p>
      </PageSection>

      <SaveDialog
        key={dialogKey}
        open={saving}
        onOpenChange={(open) => {
          setSaving(open);
          if (!open) setDialogKey((k) => k + 1);
        }}
        parent={parent}
        bodyBytes={editor.bodyBytes}
        busy={save.isPending}
        error={
          save.error && !stale ? (
            <RefusalNotice error={save.error} doing={`save a new version of ${name}`} />
          ) : null
        }
        onSave={(choice) => {
          if (editor.saveBlocked) return;
          save.mutate(
            { ...choice, files: bundle.files, parent },
            {
              onSuccess: (result) => {
                setSaving(false);
                setDialogKey((k) => k + 1);
                toast.success(
                  result.published
                    ? `Published ${name} ${result.version}.`
                    : `Saved ${name} ${result.version} as a draft.`,
                );
              },
              onError: (err) => {
                // A stale save closes the dialog: the choice it needs is on the page.
                if (isStaleWrite(err)) setSaving(false);
              },
            },
          );
        }}
      />
    </div>
  );
}

/**
 * The two honest outcomes of a stale save, and nothing in between. Reload
 * discards this tab's edits for the newer version; keep makes the newer
 * version the parent and shows what it changed, so saving over it is a choice
 * made with that diff in view.
 */
function StaleChoice({
  stale,
  onReload,
  onKeep,
  dirty,
}: {
  stale: { code: string; newest: string | null };
  onReload: (v: string) => void;
  onKeep: (v: string) => void;
  dirty: boolean;
}) {
  return (
    <div
      role="alert"
      className="space-y-2 rounded-lg border border-state-blocked/40 bg-state-blocked/10 p-3 text-sm"
    >
      <p className="font-medium text-state-blocked">
        {stale.code === 'version_conflict'
          ? 'That version number was taken while you were editing.'
          : 'Someone saved a newer version while you were editing.'}{' '}
        Nothing was saved.
      </p>
      {stale.newest ? (
        <>
          <p className="text-muted-foreground">
            The newest is now <span className="font-mono text-foreground">{stale.newest}</span>.
            Choose what happens to your edits:
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => onKeep(stale.newest ?? '')}>
              Keep my edits, review {stale.newest}'s changes
            </Button>
            <Button size="sm" variant="outline" onClick={() => onReload(stale.newest ?? '')}>
              {dirty ? `Discard my edits, load ${stale.newest}` : `Load ${stale.newest}`}
            </Button>
          </div>
        </>
      ) : (
        <p className="text-muted-foreground">
          The newer version could not be read. Your edits are still here; reload the page to see the
          library as it is now.
        </p>
      )}
    </div>
  );
}

/**
 * What keeping the edits on top of a newer version means, file by file.
 *
 * A save sends the whole bundle, so every file the newer version changed —
 * other than SKILL.md, which is diffed against the working copy — would be
 * undone by it unless taken. Each is listed with what happened to it upstream,
 * a diff on request, and a choice; the save waits until every one is made. The
 * copy above the list says what saving does, and only that.
 */
function RebasePanel({
  name,
  rebase,
  mine,
  onResolve,
}: {
  name: string;
  rebase: NonNullable<SkillEditor['rebase']>;
  mine: Record<string, string>;
  onResolve: (change: FileChange, choice: Resolution) => void;
}) {
  const { onto, base, upstream, unresolved, resolutions } = rebase;
  const theirs = useSkillFile(name, onto);
  return (
    <PageSection title={`Saving over ${onto}`}>
      <p className="mb-2 text-sm text-muted-foreground">
        Your next save is based on <span className="font-mono text-foreground">{onto}</span>. In
        SKILL.md, anything it changed that is not in your edits below is undone by that save.
      </p>
      {theirs.error ? (
        <ErrorNotice error={theirs.error} doing={`read ${name} ${onto}'s SKILL.md`} />
      ) : theirs.data ? (
        <DiffView
          before={theirs.data.content}
          after={mine['SKILL.md'] ?? ''}
          beforeLabel={`${onto} SKILL.md`}
          afterLabel="your SKILL.md"
        />
      ) : (
        <Skeleton className="h-24 w-full rounded-lg" />
      )}

      <div className="mt-3">
        {rebase.error ? (
          <ErrorNotice error={rebase.error} doing={`compare ${base} with ${onto}`} />
        ) : upstream === null ? (
          <p role="status" className="text-sm text-muted-foreground">
            Comparing the other files of <span className="font-mono">{base}</span> and{' '}
            <span className="font-mono">{onto}</span>…
          </p>
        ) : upstream.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <span className="font-mono">{onto}</span> changed no other file, so the rest of your
            bundle is saved as it is.
          </p>
        ) : (
          <>
            <p className="mb-1.5 text-sm">
              <span className="font-mono">{onto}</span> also changed{' '}
              {upstream.length === 1 ? 'this file' : `these ${upstream.length} files`} since{' '}
              <span className="font-mono">{base}</span>. For each, take its version or keep yours
              {unresolved && unresolved.length > 0
                ? ` — ${unresolved.length} still to choose before saving.`
                : '.'}
            </p>
            <ul aria-label={`Files ${onto} changed`} className="divide-y divide-border/60">
              {upstream.map((change) => (
                <UpstreamRow
                  key={change.path}
                  change={change}
                  onto={onto}
                  base={rebase.baseFiles?.[change.path]}
                  theirs={rebase.ontoFiles?.[change.path]}
                  canTake={rebase.ontoFiles !== undefined}
                  choice={resolutions[change.path]}
                  onResolve={(c) => onResolve(change, c)}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </PageSection>
  );
}

const UPSTREAM_WORD = { added: 'added', removed: 'deleted', changed: 'changed' } as const;

function UpstreamRow({
  change,
  onto,
  base,
  theirs,
  canTake,
  choice,
  onResolve,
}: {
  change: FileChange;
  onto: string;
  base: string | undefined;
  theirs: string | undefined;
  canTake: boolean;
  choice: Resolution | undefined;
  onResolve: (choice: Resolution) => void;
}) {
  const [open, setOpen] = useState(false);
  const binary = isBinaryAssetPath(change.path);
  const takeLabel = change.kind === 'removed' ? 'Delete it, as ' : 'Take ';
  return (
    <li className="space-y-1.5 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="font-mono">{change.path}</span>
        <span className="text-xs text-muted-foreground">
          {UPSTREAM_WORD[change.kind]} in {onto}
        </span>
        {choice && (
          <span className="text-xs font-medium">
            {choice === 'theirs'
              ? change.kind === 'removed'
                ? '· deleted, as in the newer version'
                : "· the newer version's file"
              : '· yours kept'}
          </span>
        )}
        {!binary && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="ml-auto rounded-sm text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {open ? 'Hide diff' : 'Show diff'}
          </button>
        )}
      </div>
      {open && !binary && (
        <DiffView
          before={base ?? ''}
          after={theirs ?? ''}
          beforeLabel={base === undefined ? 'absent' : 'before'}
          afterLabel={theirs === undefined ? `absent in ${onto}` : onto}
          maxHeight="max-h-64"
        />
      )}
      <div
        role="group"
        aria-label={`${change.path}: which version to save`}
        className="flex flex-wrap gap-2"
      >
        <Button
          size="sm"
          variant={choice === 'theirs' ? 'secondary' : 'outline'}
          aria-pressed={choice === 'theirs'}
          className="h-7 text-xs"
          disabled={!canTake}
          onClick={() => onResolve('theirs')}
        >
          {takeLabel}
          {change.kind === 'removed' ? onto : `${onto}'s`}
        </Button>
        <Button
          size="sm"
          variant={choice === 'mine' ? 'secondary' : 'outline'}
          aria-pressed={choice === 'mine'}
          className="h-7 text-xs"
          onClick={() => onResolve('mine')}
        >
          Keep mine
        </Button>
      </div>
    </li>
  );
}
