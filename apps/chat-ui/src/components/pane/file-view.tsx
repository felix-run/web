import { Button } from '@felix/ui/button';
import { RotateCwIcon } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { CodeBlock } from '@/components/ai-elements/code-block';
import {
  CopyAction,
  DownloadAction,
  ItemHeader,
  Note,
  ViewSwitch,
  withoutFinalNewline,
} from '@/components/pane/pane-parts';
import { DiffView } from '@/components/skills/diff-view';
import { getMountLabel, readWorkspaceBytes, writeWorkspaceFile } from '@/lib/cowork';
import {
  isMarkdown,
  languageFor,
  type MediaKind,
  type Preview,
  previewOfBytes,
} from '@/lib/file-preview';
import { hasConflict, isDirty, type PaneItem, updatePaneFile } from '@/lib/side-pane';
import { cn } from '@/lib/utils';

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
type Read = { status: 'loading' } | { status: 'missing' } | { status: 'ready'; preview: Preview };
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
  const [read, setRead] = useState<Read>({ status: 'loading' });
  // A slow mount read for one load must not land after the next.
  const seq = useRef(0);
  const itemRef = useRef(item);
  itemRef.current = item;

  const load = useCallback(async () => {
    const mine = ++seq.current;
    const bytes = await readWorkspaceBytes(path);
    if (mine !== seq.current) return;
    const preview = bytes === null ? null : previewOfBytes(bytes);
    setRead(preview ? { status: 'ready', preview } : { status: 'missing' });
    // An open edit is measured against what is on disk now.
    const now = itemRef.current;
    if (preview?.kind === 'text' && isDirty(now)) {
      const disk = preview.text === now.base ? undefined : preview.text;
      if (disk !== now.disk) updatePaneFile(threadId, key, (i) => ({ ...i, disk }));
    }
  }, [path, key, threadId]);

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

  const [view, setView] = useState<View>(() =>
    isDirty(item) ? 'edit' : isMarkdown(path) ? 'rendered' : 'source',
  );
  const shownView: View = !editable && view === 'edit' ? 'source' : view;
  const value = item.draft ?? text ?? '';

  const edit = (next: string) =>
    updatePaneFile(threadId, key, (i) => {
      const base = i.base ?? text ?? '';
      return next === base
        ? { kind: 'file', key: i.key, path: i.path }
        : { ...i, draft: next, base };
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
          </>
        }
      />

      {conflict && item.disk !== undefined && item.base !== undefined && (
        <Conflict
          base={item.base}
          disk={item.disk}
          onTakeTheirs={() =>
            updatePaneFile(threadId, key, (i) => ({ kind: 'file', key: i.key, path: i.path }))
          }
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
          onRevert={() =>
            updatePaneFile(threadId, key, (i) => ({ kind: 'file', key: i.key, path: i.path }))
          }
          onSave={async () => {
            await writeWorkspaceFile(path, value);
            updatePaneFile(threadId, key, (i) => ({ kind: 'file', key: i.key, path: i.path }));
            await load();
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
  onSave,
}: {
  path: string;
  dirty: boolean;
  /** A conflict is open: it has to be answered before anything is saved. */
  blocked: boolean;
  /** The run still going wrote this file. */
  warnRun: boolean;
  onRevert: () => void;
  onSave: () => Promise<void>;
}) {
  const [armed, setArmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!saved) return;
    const t = window.setTimeout(() => setSaved(false), 2000);
    return () => window.clearTimeout(t);
  }, [saved]);
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
      await onSave();
      setSaved(true);
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
          'Saved.'
        ) : dirty ? (
          <>Unsaved. The agent isn't told about edits made here.</>
        ) : (
          <>
            Saves to {store ? <span className="font-mono">{store}</span> : "this tab's workspace"}.
            The agent isn't told.
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
