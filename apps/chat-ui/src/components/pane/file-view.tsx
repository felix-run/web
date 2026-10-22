import { LeaseRefusedError, WorkspaceChangedError, WorkspaceRouteError } from '@felix/client';
import { Button } from '@felix/ui/button';
import { RotateCwIcon } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { workspaceDelete, workspaceRead, workspaceRename, workspaceWrite } from '@/api';
import { CodeBlock } from '@/components/ai-elements/code-block';
import {
  outcomeLine,
  savedLine,
  useTellAgent,
  useTellsAgent,
  utf8Bytes,
} from '@/components/pane/edit-notice';
import { type FileAction, FileActionStrip, FileActionsMenu } from '@/components/pane/file-actions';
import {
  CopyAction,
  DownloadAction,
  ItemHeader,
  Note,
  ViewSwitch,
  withoutFinalNewline,
} from '@/components/pane/pane-parts';
import { DiffView } from '@/components/skills/diff-view';
import {
  deleteWorkspaceFile,
  getMountLabel,
  readWorkspaceBytes,
  renameWorkspaceFile,
  writeWorkspaceFile,
} from '@/lib/cowork';
import {
  isMarkdown,
  languageFor,
  type MediaKind,
  type Preview,
  previewOfBytes,
} from '@/lib/file-preview';
import {
  cleanFile,
  clearFileRequest,
  closePaneItem,
  hasConflict,
  isDirty,
  openInPane,
  type PaneItem,
  updatePaneFile,
  usePaneState,
} from '@/lib/side-pane';
import { cn } from '@/lib/utils';
import { WORKSPACE_WRITTEN } from '@/lib/workspace-events';
import type { EditNotice } from '@/shell-context';
import { useOptionalShellPick } from '@/shell-context';

// The skill library's renderer, because it is the one that already trusts its
// input less than the transcript does: no inline HTML becomes an element, and no
// remote image is fetched.
const SkillMarkdown = lazy(() =>
  import('@/components/skills/skill-markdown').then((m) => ({ default: m.SkillMarkdown })),
);
const CodeEditor = lazy(() =>
  import('@/components/skills/code-editor').then((m) => ({ default: m.CodeEditor })),
);

type FileItem = Extract<PaneItem, { kind: 'file' }>;
type Read =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error'; message: string }
  | { status: 'ready'; preview: Preview };
type View = 'rendered' | 'source' | 'edit';

/**
 * One workspace file: read, and — when it is text short enough to hold whole —
 * edited and saved.
 *
 * The file is read from whichever store the tools run against — the mounted
 * folder, or the in-tab one — with the same precedence the approval diff uses,
 * so the pane and the diff never disagree about a file. It is read as bytes, so
 * an image, a PDF, audio or video is drawn as itself; HTML and SVG stay source,
 * since either can carry script and drawing one would run it in this origin.
 *
 * **A save is the operator's own write**, so it goes through no approval —
 * approvals gate the model — and the agent is not told; the footer says so where
 * the save is made. Two things make it safe beside a run that is also writing:
 * the file is re-read when a run settles, and an edit whose starting text is no
 * longer what is on disk stops on a choice (the agent's version, or keep the
 * edit) with what the agent wrote on screen — never a silent merge. And a save
 * over a file the run in flight has already written asks first.
 */
export function FileView({
  threadId,
  item,
  changed,
  writtenThisRun,
  streaming,
}: {
  threadId: string;
  item: FileItem;
  /** A write or edit landed on this file on this thread. */
  changed: boolean;
  /** …in the run that is still going. */
  writtenThisRun: boolean;
  streaming: boolean;
}) {
  const { path, key } = item;
  const harness = item.source === 'harness';
  const [read, setRead] = useState<Read>({ status: 'loading' });
  const tellAgent = useTellAgent();
  // The agent the thread will run under next, which the harness uses to find
  // the workspace of a thread that has never run (afterwards it uses its own).
  const shell = useOptionalShellPick('manifest', 'showRecordedNote');
  const manifest = shell?.manifest;
  const showRecordedNote = shell?.showRecordedNote;
  /** The harness file's hash as last read: a save is refused unless it still is. */
  const sha = useRef<string | null>(null);
  // A slow mount read for one load must not land after the next.
  const seq = useRef(0);
  const itemRef = useRef(item);
  itemRef.current = item;

  const load = useCallback(async () => {
    const mine = ++seq.current;
    let bytes: Uint8Array | null;
    if (harness) {
      try {
        const file = await workspaceRead({ threadId, path, ...(manifest ? { manifest } : {}) });
        if (mine !== seq.current) return;
        bytes = file.bytes;
        sha.current = file.sha256;
      } catch (err) {
        if (mine !== seq.current) return;
        if (!(err instanceof WorkspaceRouteError && err.code === 'not_found')) {
          setRead({ status: 'error', message: harnessReadProblem(err) });
          return;
        }
        bytes = null;
        sha.current = null;
      }
    } else {
      bytes = await readWorkspaceBytes(path);
      if (mine !== seq.current) return;
    }
    const preview = bytes === null ? null : previewOfBytes(bytes);
    setRead(preview ? { status: 'ready', preview } : { status: 'missing' });
    // An open edit is measured against what is on disk now.
    const now = itemRef.current;
    if (preview?.kind === 'text' && isDirty(now)) {
      const disk = preview.text === now.base ? undefined : preview.text;
      if (disk !== now.disk) updatePaneFile(threadId, key, (i) => ({ ...i, disk }));
    }
  }, [path, key, threadId, harness, manifest]);

  useEffect(() => {
    setRead({ status: 'loading' });
    void load();
  }, [load]);

  // A run settling is when a write can have landed under an open file.
  const wasStreaming = useRef(streaming);
  useEffect(() => {
    if (wasStreaming.current && !streaming) void load();
    wasStreaming.current = streaming;
  }, [streaming, load]);

  const name = path.split('/').pop() || path;
  const preview = read.status === 'ready' ? read.preview : null;
  const text = preview?.kind === 'text' ? preview.text : null;
  const editable = text !== null && preview?.kind === 'text' && !preview.truncated;
  const markdown = isMarkdown(path) && text !== null && text !== '';
  const dirty = isDirty(item);
  const conflict = hasConflict(item);

  // Rename and delete. Each acts on the store the file was read from — the
  // harness, in one request that also tells the agent, or the browser's, then
  // the browser path's own notice — and lands its outcome in a toast, because
  // the tab it was opened from is gone (deleted) or replaced (renamed).
  const [action, setAction] = useState<FileAction | null>(null);
  // Asked for from the sidebar tree, which opened this file to ask it.
  const request = usePaneState(threadId).request;
  useEffect(() => {
    if (request?.key !== key) return;
    clearFileRequest(threadId);
    setAction(request.action);
  }, [request, key, threadId]);
  // Held for an unsaved edit, the strip does not open: say why where it would have.
  useEffect(() => {
    if (action && dirty) {
      toast.message('Save or revert your edits first.');
      setAction(null);
    }
  }, [action, dirty]);
  const where = harness
    ? 'the thread\u2019s workspace on the harness'
    : (getMountLabel() ?? 'this tab\u2019s workspace');
  const blockedBy = dirty
    ? 'Save or revert your edits first.'
    : read.status !== 'ready'
      ? 'Nothing here to rename or delete.'
      : undefined;
  const refusal = async (err: unknown, verb: string, to?: string): Promise<Error> => {
    if (err instanceof WorkspaceChangedError) {
      await load();
      return new Error(
        `It changed on the harness since you opened it. Read it again, then ${verb}.`,
      );
    }
    if (
      (err instanceof WorkspaceRouteError && err.code === 'target_exists') ||
      (err instanceof Error && err.name === 'TargetExistsError')
    ) {
      return new Error(`A file is already at ${to}. Choose another path.`);
    }
    if (err instanceof WorkspaceRouteError && err.code === 'not_found') {
      return new Error('It is no longer there.');
    }
    if (err instanceof LeaseRefusedError) return new Error('Another tab is driving this thread.');
    return new Error(`Could not ${verb} it: ${err instanceof Error ? err.message : String(err)}`);
  };
  const onDelete = async () => {
    let notice: EditNotice | null;
    try {
      if (harness) {
        const done = await workspaceDelete({
          threadId,
          path,
          ...(sha.current ? { expectedSha256: sha.current } : {}),
          ...(manifest ? { manifest } : {}),
        });
        window.dispatchEvent(new Event(WORKSPACE_WRITTEN));
        if (done.status === 'recorded') showRecordedNote?.();
        notice = done.status;
      } else {
        await deleteWorkspaceFile(path);
        notice = await tellAgent({ path, op: 'delete' });
      }
    } catch (err) {
      throw await refusal(err, 'delete');
    }
    closePaneItem(threadId, key);
    toast(outcomeLine(`Deleted ${path}.`, notice));
  };
  const onRename = async (to: string) => {
    let notice: EditNotice | null;
    try {
      if (harness) {
        const done = await workspaceRename({
          threadId,
          path,
          toPath: to,
          ...(sha.current ? { expectedSha256: sha.current } : {}),
          ...(manifest ? { manifest } : {}),
        });
        window.dispatchEvent(new Event(WORKSPACE_WRITTEN));
        if (done.status === 'recorded') showRecordedNote?.();
        notice = done.status;
      } else {
        await renameWorkspaceFile(path, to);
        notice = await tellAgent({ path, op: 'rename', toPath: to });
      }
    } catch (err) {
      throw await refusal(err, 'rename', to);
    }
    closePaneItem(threadId, key);
    openInPane(threadId, {
      kind: 'file',
      path: to,
      ...(harness ? { source: 'harness' as const } : {}),
    });
    toast(outcomeLine(`Renamed ${path} to ${to}.`, notice));
  };

  const [view, setView] = useState<View>(() =>
    isDirty(item) ? 'edit' : isMarkdown(path) ? 'rendered' : 'source',
  );
  const shownView: View = !editable && view === 'edit' ? 'source' : view;
  const value = item.draft ?? text ?? '';

  const edit = (next: string) =>
    updatePaneFile(threadId, key, (i) => {
      const base = i.base ?? text ?? '';
      return next === base ? cleanFile(i) : { ...i, draft: next, base };
    });

  const views = [
    ...(markdown ? [{ value: 'rendered' as const, label: 'Rendered' }] : []),
    { value: 'source' as const, label: markdown ? 'Source' : 'Read' },
    ...(editable ? [{ value: 'edit' as const, label: 'Edit' }] : []),
  ];

  const lines =
    text === null ? null : value === '' ? 0 : value.replace(/\n$/, '').split('\n').length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ItemHeader
        name={name}
        mono
        keepName={12}
        detail={path}
        meta={[
          changed && 'Changed on this thread',
          lines !== null && `${lines.toLocaleString()} ${lines === 1 ? 'line' : 'lines'}`,
          preview?.kind === 'media' && mediaLabel(preview.type, preview.bytes.length),
          harness && 'On the harness',
          dirty && 'Edited',
          preview?.kind === 'text' && preview.truncated && 'Too large to edit here',
        ]}
        actions={
          <>
            {views.length > 1 && (
              <ViewSwitch label="View" value={shownView} options={views} onChange={setView} />
            )}
            {text !== null && <CopyAction text={value} />}
            {preview && preview.kind !== 'binary' && (
              <DownloadAction
                name={name}
                get={() =>
                  preview.kind === 'media'
                    ? new Blob([preview.bytes as BlobPart], { type: preview.type })
                    : value
                }
              />
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Read the file again"
              title="Read the file again"
              onClick={() => void load()}
            >
              <RotateCwIcon aria-hidden className="size-3.5" />
            </Button>
            <FileActionsMenu onChoose={setAction} {...(blockedBy ? { blockedBy } : {})} />
          </>
        }
      />

      {action && !blockedBy && (
        <FileActionStrip
          key={action}
          action={action}
          path={path}
          where={where}
          onRename={onRename}
          onDelete={onDelete}
          onDone={() => setAction(null)}
        />
      )}

      {conflict && item.disk !== undefined && item.base !== undefined && (
        <Conflict
          base={item.base}
          disk={item.disk}
          onTakeTheirs={() => updatePaneFile(threadId, key, cleanFile)}
          onKeepMine={() =>
            updatePaneFile(threadId, key, (i) => ({ ...i, base: i.disk, disk: undefined }))
          }
        />
      )}

      <div
        className={cn(
          'min-h-0 flex-1 overflow-auto px-4 pb-4',
          shownView === 'edit' && 'flex flex-col',
        )}
      >
        {read.status === 'loading' ? (
          <p className="text-xs text-muted-foreground">Reading…</p>
        ) : read.status === 'error' ? (
          <p className="text-sm text-state-failed">{read.message}</p>
        ) : read.status === 'missing' && harness ? (
          <Note>
            This file is not in the thread's workspace on the harness. It may have been removed.
          </Note>
        ) : read.status === 'missing' ? (
          // Not an error: a file the agent removed, one listed before the folder
          // was changed, or a Changes row for a write that ran on the harness.
          <Note>
            This file is not in the workspace. It may have been removed, or written by one of the
            harness's own tools, which write on the harness rather than here.
          </Note>
        ) : read.preview.kind === 'binary' ? (
          <Note>Binary file — not shown. Open it from the folder on disk.</Note>
        ) : read.preview.kind === 'media' ? (
          <MediaView
            key={path}
            name={name}
            media={read.preview.media}
            type={read.preview.type}
            bytes={read.preview.bytes}
          />
        ) : shownView === 'edit' ? (
          <Suspense fallback={<p className="text-xs text-muted-foreground">Opening the editor…</p>}>
            <CodeEditor
              path={path}
              value={value}
              onChange={edit}
              className="max-h-none min-h-64 flex-1 rounded-lg"
            />
          </Suspense>
        ) : value === '' ? (
          <Note>This file is empty.</Note>
        ) : markdown && shownView === 'rendered' ? (
          <Suspense fallback={<p className="text-xs text-muted-foreground">Reading…</p>}>
            <SkillMarkdown markdown={value} />
            {read.preview.truncated && <TruncatedNote shown={value.length} />}
          </Suspense>
        ) : (
          <>
            <SourceView path={path} text={value} />
            {read.preview.truncated && <TruncatedNote shown={value.length} />}
          </>
        )}
      </div>

      {editable && shownView === 'edit' && (
        <SaveBar
          path={path}
          dirty={dirty}
          blocked={conflict}
          warnRun={streaming && writtenThisRun}
          onRevert={() => updatePaneFile(threadId, key, cleanFile)}
          where={harness ? 'the thread\u2019s workspace on the harness' : undefined}
          onSave={async () => {
            if (harness) {
              // One request writes the file and tells the agent; it is refused if
              // the file is no longer the one this edit started from.
              let written: Awaited<ReturnType<typeof workspaceWrite>>;
              try {
                written = await workspaceWrite({
                  threadId,
                  path,
                  content: value,
                  ...(sha.current ? { expectedSha256: sha.current } : {}),
                  ...(manifest ? { manifest } : {}),
                });
              } catch (err) {
                if (err instanceof WorkspaceChangedError) {
                  // Read what is there now, which opens the choice above.
                  await load();
                  throw new Error('it changed on the harness since you opened it. Choose above.');
                }
                if (err instanceof LeaseRefusedError) {
                  throw new Error('another tab is driving this thread.');
                }
                throw err;
              }
              updatePaneFile(threadId, key, cleanFile);
              await load();
              window.dispatchEvent(new Event(WORKSPACE_WRITTEN));
              if (written.status === 'recorded') showRecordedNote?.();
              return written.status;
            }
            await writeWorkspaceFile(path, value);
            updatePaneFile(threadId, key, cleanFile);
            await load();
            return tellAgent({ path, bytes: utf8Bytes(value) });
          }}
        />
      )}
    </div>
  );
}

function SourceView({ path, text }: { path: string; text: string }) {
  const language = languageFor(path);
  return language ? (
    <CodeBlock
      code={withoutFinalNewline(text)}
      language={language}
      showLineNumbers
      className="text-xs"
    />
  ) : (
    <pre className="overflow-x-auto rounded-lg border border-border/60 bg-code-surface p-3 font-mono text-xs whitespace-pre">
      {withoutFinalNewline(text)}
    </pre>
  );
}

/**
 * The agent wrote the file under an edit. Amber, because it waits on a person;
 * the diff is what the agent wrote over the text the edit started from, which
 * is the thing a choice between the two needs in front of it.
 */
function Conflict({
  base,
  disk,
  onTakeTheirs,
  onKeepMine,
}: {
  base: string;
  disk: string;
  onTakeTheirs: () => void;
  onKeepMine: () => void;
}) {
  return (
    <div
      role="alert"
      className="mx-4 mb-3 shrink-0 space-y-2.5 rounded-xl border border-state-blocked/30 bg-solid-state-blocked/10 px-3 py-2.5"
    >
      <p className="text-sm text-foreground">
        <span className="font-medium text-state-blocked">The agent changed this file</span> while
        you were editing it. Saving now would replace what it wrote.
      </p>
      <details className="group">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
          What the agent wrote
        </summary>
        <DiffView
          before={base}
          after={disk}
          beforeLabel="when you started"
          afterLabel="on disk now"
          className="mt-2 bg-background"
          maxHeight="max-h-72"
        />
      </details>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onTakeTheirs}>
          Take the agent's version
        </Button>
        <Button size="sm" variant="ghost" onClick={onKeepMine}>
          Keep my edits
        </Button>
      </div>
    </div>
  );
}

function SaveBar({
  path,
  dirty,
  blocked,
  warnRun,
  onRevert,
  where,
  onSave,
}: {
  path: string;
  dirty: boolean;
  /** A conflict is open: it has to be answered before anything is saved. */
  blocked: boolean;
  /** The run still going wrote this file. */
  warnRun: boolean;
  onRevert: () => void;
  /** Where a save goes, when it is not the browser's workspace. */
  where?: string;
  /** Resolves with what came of telling the agent, once the file is written. */
  onSave: () => Promise<EditNotice | null>;
}) {
  const [armed, setArmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The line a landed save left, until the next edit or a few seconds pass. */
  const [saved, setSaved] = useState<string | null>(null);
  const tellsAgent = useTellsAgent();
  useEffect(() => {
    if (!saved) return;
    // Long enough to read a sentence about the agent, not only "Saved."
    const t = window.setTimeout(() => setSaved(null), saved === 'Saved.' ? 2000 : 8000);
    return () => window.clearTimeout(t);
  }, [saved]);
  useEffect(() => {
    if (dirty) setSaved(null);
  }, [dirty]);
  useEffect(() => {
    if (!dirty || !warnRun) setArmed(false);
  }, [dirty, warnRun]);

  const save = async () => {
    if (warnRun && !armed) {
      setArmed(true);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      setSaved(savedLine(await onSave()));
      setArmed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  // ⌘S / Ctrl+S from anywhere in the pane, not the browser's "save page".
  const saveRef = useRef(save);
  saveRef.current = save;
  const live = dirty && !blocked && !saving;
  useEffect(() => {
    if (!live) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        const target = e.target as Element | null;
        if (!target?.closest('[data-slot="side-pane"]')) return;
        e.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [live]);

  const store = getMountLabel();
  return (
    <footer className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-t border-border/60 px-4 py-2.5">
      <p aria-live="polite" className="min-w-0 flex-1 text-xs text-muted-foreground">
        {error ? (
          <span className="text-state-failed">
            Could not save {path}: {error}
          </span>
        ) : armed ? (
          <span className="text-foreground">
            The running agent wrote this file in this run. Saving replaces what it wrote.
          </span>
        ) : saved ? (
          saved
        ) : dirty ? (
          tellsAgent ? (
            'Unsaved. Saving tells the agent the file changed.'
          ) : (
            <>Unsaved. The agent isn't told about edits made here.</>
          )
        ) : (
          <>
            Saves to{' '}
            {where ?? (store ? <span className="font-mono">{store}</span> : "this tab's workspace")}
            . {tellsAgent ? 'The agent is told when you save.' : "The agent isn't told."}
          </>
        )}
      </p>
      <div className="flex shrink-0 items-center gap-1.5">
        {armed ? (
          <Button size="sm" variant="ghost" onClick={() => setArmed(false)}>
            Cancel
          </Button>
        ) : (
          dirty && (
            <Button size="sm" variant="ghost" onClick={onRevert} disabled={saving}>
              Revert
            </Button>
          )
        )}
        <Button
          size="sm"
          onClick={() => void save()}
          disabled={!live}
          aria-keyshortcuts="Meta+S Control+S"
        >
          {saving ? 'Saving…' : armed ? 'Save anyway' : 'Save'}
        </Button>
      </div>
    </footer>
  );
}

function TruncatedNote({ shown }: { shown: number }) {
  return (
    <p className="mt-2 text-xs text-muted-foreground">
      Showing the first {(shown / 1000).toFixed(0)} KB. The rest is in the file.
    </p>
  );
}

/** `PNG image · 48 KB`: what the bytes said, and how many there are. */
export function mediaLabel(type: string, size: number): string {
  const sub = type.split('/')[1] ?? type;
  const format = sub === 'mpeg' ? 'MP3' : sub === 'quicktime' ? 'MOV' : sub.toUpperCase();
  const noun = type.startsWith('image/')
    ? 'image'
    : type.startsWith('audio/')
      ? 'audio'
      : type.startsWith('video/')
        ? 'video'
        : 'document';
  const kb = size < 1024 ? `${size} B` : `${Math.round(size / 1024).toLocaleString()} KB`;
  return `${format} ${noun} · ${kb}`;
}

/**
 * Media through an object URL, made when the file is shown and revoked when it
 * is not — a re-read or another file makes a new one, so nothing leaks while
 * the pane is left open across a run that keeps rewriting the file.
 */
function MediaView({
  name,
  media,
  type,
  bytes,
}: {
  name: string;
  media: MediaKind;
  type: string;
  bytes: Uint8Array;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const next = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [bytes, type]);
  if (!url) return null;
  if (media === 'image') {
    return (
      <img
        src={url}
        alt={name}
        className="mx-auto max-w-full rounded-lg border border-border/60 bg-[repeating-conic-gradient(var(--muted)_0_25%,transparent_0_50%)] bg-[length:16px_16px]"
      />
    );
  }
  if (media === 'pdf') {
    return (
      <iframe src={url} title={name} className="h-full min-h-[70vh] w-full rounded-lg border" />
    );
  }
  if (media === 'audio') {
    // biome-ignore lint/a11y/useMediaCaption: a workspace file has no captions to offer.
    return <audio src={url} controls className="w-full" />;
  }
  return (
    // biome-ignore lint/a11y/useMediaCaption: a workspace file has no captions to offer.
    <video src={url} controls className="max-h-[70vh] w-full rounded-lg border bg-black" />
  );
}

/** A harness read that failed for a reason the operator can act on, said as such. */
function harnessReadProblem(err: unknown): string {
  if (err instanceof WorkspaceRouteError) {
    switch (err.code) {
      case 'too_large':
        return 'Over 500 KB, which is more than the harness will send. Open it from the workspace itself.';
      case 'not_a_file':
        return 'That is a folder, not a file.';
      case 'reserved_path':
        return 'The harness does not serve files under .git.';
      case 'workspace_unavailable':
        return 'The thread\u2019s workspace on the harness is not available right now. Try again in a moment.';
      case 'workspace_not_configured':
        return 'This harness has no workspace configured.';
      default:
        return `The harness refused to read it (${err.code}).`;
    }
  }
  return 'Could not reach the harness.';
}
