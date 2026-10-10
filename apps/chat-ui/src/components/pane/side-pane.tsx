import { describeError } from '@felix/client';
import { Button } from '@felix/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@felix/ui/tabs';
import {
  BracesIcon,
  ChevronLeftIcon,
  FileTextIcon,
  ImageIcon,
  ImageOffIcon,
  PackageOpenIcon,
  XIcon,
} from 'lucide-react';
import { type KeyboardEvent, useEffect, useState } from 'react';
import { getArtifact } from '@/api';
import { CodeBlock } from '@/components/ai-elements/code-block';
import { FileView } from '@/components/pane/file-view';
import {
  CopyAction,
  DownloadAction,
  extensionFor,
  ItemHeader,
  withoutFinalNewline,
} from '@/components/pane/pane-parts';
import { useDrawableUrl } from '@/hooks/use-drawable-url';
import { middleTruncate } from '@/lib/format';
import {
  closeAllPaneItems,
  closePaneItem,
  isDirty,
  type PaneItem,
  setPaneActive,
  usePaneState,
} from '@/lib/side-pane';
import { cn } from '@/lib/utils';

/**
 * The side pane: what the operator opened beside the conversation — a
 * workspace file, a tool output the harness spilled, a code block from a reply,
 * an image a tool returned — read in full without covering the turn that
 * produced it.
 *
 * One tab per open item, built on `@felix/ui/tabs`, because each is a panel of
 * its own; an inactive tab renders no children, so only the item in front reads
 * anything. That is also why a file's unsaved edit lives in the pane's store
 * rather than in the editor: switching tabs unmounts the editor.
 */
export function SidePane({
  threadId,
  changedPaths,
  runPaths,
  streaming,
  onBack,
  className,
}: {
  threadId: string;
  /** Files a write or edit landed on, over the thread. */
  changedPaths: ReadonlySet<string>;
  /** …in the run still in flight. */
  runPaths: ReadonlySet<string>;
  streaming: boolean;
  /**
   * Where the pane covers the conversation (a phone), the way back to it. It
   * hides the pane and keeps its tabs; the close beside it still closes them.
   */
  onBack?: () => void;
  className?: string;
}) {
  const { items, active } = usePaneState(threadId);
  /** A close that would drop an edit, waiting on a yes: one item, or all of them. */
  const [discarding, setDiscarding] = useState<string | 'all' | null>(null);
  useEffect(() => {
    if (discarding && discarding !== 'all' && !items.some((i) => i.key === discarding)) {
      setDiscarding(null);
    }
  }, [items, discarding]);

  const requestClose = (key: string) => {
    const item = items.find((i) => i.key === key);
    if (item && isDirty(item)) setDiscarding(key);
    else closePaneItem(threadId, key);
  };
  const requestCloseAll = () => {
    if (items.some(isDirty)) setDiscarding('all');
    else closeAllPaneItems(threadId);
  };
  const unsaved = items.filter(isDirty);

  if (!items.length || !active) return null;

  return (
    <aside
      aria-label="Side pane"
      data-slot="side-pane"
      className={cn('flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background', className)}
    >
      <Tabs
        value={active}
        onValueChange={(key) => setPaneActive(threadId, key)}
        className="min-h-0 flex-1 gap-0"
      >
        <div
          className={cn(
            'flex h-12 shrink-0 items-center gap-2 border-b border-border/60 pr-2',
            onBack ? 'pl-1.5' : 'pl-3',
          )}
        >
          {onBack && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Back to the conversation"
              title="Back to the conversation"
              onClick={onBack}
            >
              <ChevronLeftIcon aria-hidden className="size-4" />
            </Button>
          )}
          <TabsList
            aria-label="Open in the pane"
            className="h-8 min-w-0 flex-1 justify-start overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {items.map((item) => (
              <PaneTab key={item.key} item={item} onClose={() => requestClose(item.key)} />
            ))}
          </TabsList>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close the pane"
            title="Close the pane"
            onClick={requestCloseAll}
          >
            <XIcon aria-hidden className="size-4" />
          </Button>
        </div>

        {discarding && (
          <div
            role="alertdialog"
            aria-label="Unsaved edits"
            className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 bg-ground px-4 py-2.5 text-sm"
          >
            <p className="min-w-0 flex-1">
              {discarding === 'all'
                ? unsaved.length === 1
                  ? `Discard your edits to ${labelOf(unsaved[0] as PaneItem)}?`
                  : `Discard your edits to ${unsaved.length} files?`
                : `Discard your edits to ${labelOf(items.find((i) => i.key === discarding) as PaneItem)}?`}
            </p>
            <div className="flex gap-1.5">
              <Button size="sm" variant="ghost" autoFocus onClick={() => setDiscarding(null)}>
                Keep editing
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  if (discarding === 'all') closeAllPaneItems(threadId);
                  else closePaneItem(threadId, discarding);
                  setDiscarding(null);
                }}
              >
                Discard
              </Button>
            </div>
          </div>
        )}

        {items.map((item) => (
          <TabsContent key={item.key} value={item.key} className="flex min-h-0 flex-col">
            {item.kind === 'file' ? (
              <FileView
                threadId={threadId}
                item={item}
                changed={changedPaths.has(item.path)}
                writtenThisRun={runPaths.has(item.path)}
                streaming={streaming}
              />
            ) : item.kind === 'artifact' ? (
              <ArtifactView item={item} />
            ) : item.kind === 'code' ? (
              <CodeView item={item} />
            ) : (
              <ImageView item={item} />
            )}
          </TabsContent>
        ))}
      </Tabs>
    </aside>
  );
}

function labelOf(item: PaneItem): string {
  switch (item.kind) {
    case 'file':
      return item.path.split('/').pop() || item.path;
    case 'artifact':
      return `${item.title} output`;
    case 'code':
      return item.title;
    case 'image':
      return item.title;
  }
}

const ICONS = {
  file: FileTextIcon,
  artifact: PackageOpenIcon,
  code: BracesIcon,
  image: ImageIcon,
} as const;

/**
 * A tab and its close button, side by side rather than nested — a button inside
 * a tab is two controls announced as one. The close is out of the Tab order;
 * Delete on a focused tab closes it, and so does a middle click.
 */
function PaneTab({ item, onClose }: { item: PaneItem; onClose: () => void }) {
  const Icon = ICONS[item.kind];
  const label = labelOf(item);
  const full = item.kind === 'file' ? item.path : label;
  const dirty = isDirty(item);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onClose();
    }
  };
  return (
    <div className="group/tab relative flex h-full shrink-0 items-center">
      <TabsTrigger
        value={item.key}
        title={full}
        onKeyDown={onKeyDown}
        onAuxClick={(e) => {
          if (e.button === 1) onClose();
        }}
        aria-keyshortcuts="Delete"
        className="peer max-w-44 gap-1.5 pr-7 pl-2.5 text-xs"
      >
        <Icon aria-hidden className="size-3.5 text-muted-foreground" />
        <span className={cn('truncate', item.kind === 'file' && 'font-mono')}>
          {middleTruncate(label, 26)}
        </span>
        {dirty && (
          <>
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-foreground" />
            <span className="sr-only">, unsaved</span>
          </>
        )}
      </TabsTrigger>
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Close ${label}`}
        title={`Close ${label}`}
        onClick={onClose}
        className={cn(
          'absolute right-1.5 grid size-5 place-items-center rounded-full text-muted-foreground transition-opacity hover:bg-muted hover:text-foreground',
          '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/tab:opacity-100 [@media(hover:hover)]:peer-data-[state=active]:opacity-100',
        )}
      >
        <XIcon aria-hidden className="size-3" />
      </button>
    </div>
  );
}

/** Fetched outputs, kept for the page: an inactive tab unmounts, and these are big by definition. */
const artifactCache = new Map<string, string>();

function ArtifactView({ item }: { item: Extract<PaneItem, { kind: 'artifact' }> }) {
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; text: string }
  >(() => {
    const cached = artifactCache.get(item.key);
    return cached === undefined ? { status: 'loading' } : { status: 'ready', text: cached };
  });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (artifactCache.has(item.key) && attempt === 0) return;
    let live = true;
    setState({ status: 'loading' });
    getArtifact(item.manifestId, item.artifactId)
      .then((artifact) => {
        const text = artifact.content ?? '';
        artifactCache.set(item.key, text);
        if (live) setState({ status: 'ready', text });
      })
      .catch((err) => {
        if (live)
          setState({
            status: 'error',
            message: describeError(err, 'read this tool output').message,
          });
      });
    return () => {
      live = false;
    };
  }, [item.key, item.manifestId, item.artifactId, attempt]);

  const text = state.status === 'ready' ? state.text : null;
  const json = text === null ? null : prettyJson(text);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ItemHeader
        name={`${item.title} output`}
        detail={`artifact ${item.artifactId.slice(0, 8)}`}
        meta={[`${item.chars.toLocaleString()} chars`, 'Stored by the harness']}
        actions={
          text !== null && (
            <>
              <CopyAction text={text} what="output" />
              <DownloadAction
                name={`${item.title}-${item.artifactId.slice(0, 8)}.${json ? 'json' : 'txt'}`}
                get={() => text}
              />
            </>
          )
        }
      />
      <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
        {state.status === 'loading' ? (
          <p className="text-xs text-muted-foreground">Reading the stored output…</p>
        ) : state.status === 'error' ? (
          <div className="space-y-2">
            <p className="text-sm text-state-failed">{state.message}</p>
            <Button size="sm" variant="outline" onClick={() => setAttempt((a) => a + 1)}>
              Try again
            </Button>
          </div>
        ) : json ? (
          <CodeBlock code={json} language="json" showLineNumbers className="text-xs" />
        ) : (
          <pre className="rounded-lg border border-border/60 bg-code-surface p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
            {state.text}
          </pre>
        )}
      </div>
    </div>
  );
}

/** Indented JSON for a tool output that is one JSON value, else null. */
function prettyJson(text: string): string | null {
  const t = text.trim();
  if (!(t.startsWith('{') || t.startsWith('['))) return null;
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return null;
  }
}

/**
 * Whether Shiki has a grammar for a fence's language. A language it lacks makes
 * the highlighter reject, and the code block does not catch that — so the
 * answer is asked of Shiki itself, which the reply that held the block has
 * already loaded.
 */
function useShikiKnows(language: string): boolean | null {
  const [known, setKnown] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    import('shiki')
      .then((m) => {
        if (live) setKnown(Object.hasOwn(m.bundledLanguages, language));
      })
      .catch(() => {
        if (live) setKnown(false);
      });
    return () => {
      live = false;
    };
  }, [language]);
  return known;
}

function CodeView({ item }: { item: Extract<PaneItem, { kind: 'code' }> }) {
  const known = useShikiKnows(item.language);
  const code = withoutFinalNewline(item.code);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ItemHeader
        name={item.title}
        meta={['From a reply']}
        actions={
          <>
            <CopyAction text={item.code} what="code" />
            <DownloadAction name={`snippet.${extensionFor(item.language)}`} get={() => item.code} />
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
        {known ? (
          <CodeBlock
            code={code}
            language={item.language as never}
            showLineNumbers
            className="text-xs"
          />
        ) : (
          <pre className="overflow-x-auto rounded-lg border border-border/60 bg-code-surface p-3 font-mono text-xs whitespace-pre">
            {code}
          </pre>
        )}
      </div>
    </div>
  );
}

function ImageView({ item }: { item: Extract<PaneItem, { kind: 'image' }> }) {
  const src = useDrawableUrl(item.url);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [actual, setActual] = useState(false);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ItemHeader
        name={item.title}
        meta={[natural && `${natural.w} × ${natural.h}`]}
        actions={
          src && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                aria-pressed={actual}
                onClick={() => setActual((v) => !v)}
              >
                {actual ? 'Fit' : 'Actual size'}
              </Button>
              <DownloadAction name={imageName(item.title, src)} get={() => src} />
            </>
          )
        }
      />
      <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
        {src === null ? (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <ImageOffIcon aria-hidden className="size-4" />
            The harness no longer holds this image.
          </p>
        ) : src === undefined ? (
          <div
            role="img"
            aria-label={`${item.title}, loading`}
            className="h-64 w-full animate-pulse rounded-lg bg-muted motion-reduce:animate-none"
          />
        ) : (
          <img
            src={src}
            alt={item.title}
            onLoad={(e) =>
              setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
            }
            className={cn(
              'rounded-lg border border-border/60 bg-[repeating-conic-gradient(var(--muted)_0_25%,transparent_0_50%)] bg-[length:16px_16px]',
              actual ? 'max-w-none' : 'mx-auto max-w-full',
            )}
          />
        )}
      </div>
    </div>
  );
}

function imageName(title: string, src: string): string {
  const type = /^data:image\/([a-z+]+)/.exec(src)?.[1] ?? 'png';
  const ext = type === 'jpeg' ? 'jpg' : type.replace('+xml', '');
  const base = title.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'image';
  return `${base}.${ext}`;
}
