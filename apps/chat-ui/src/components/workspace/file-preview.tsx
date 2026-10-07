import { Button } from '@felix/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@felix/ui/sheet';
import { CheckIcon, CopyIcon, RotateCwIcon } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { CodeBlock } from '@/components/ai-elements/code-block';
import { readWorkspaceBytes } from '@/lib/cowork';
import {
  isMarkdown,
  languageFor,
  type MediaKind,
  type Preview,
  previewOfBytes,
} from '@/lib/file-preview';
import { cn } from '@/lib/utils';

// The skill library's renderer, because it is the one that already trusts its
// input less than the transcript does: no inline HTML becomes an element, and no
// remote image is fetched. Lazy, since it and its imports ride in that chunk.
const SkillMarkdown = lazy(() =>
  import('@/components/skills/skill-markdown').then((m) => ({ default: m.SkillMarkdown })),
);

type Read = { status: 'loading' } | { status: 'missing' } | { status: 'ready'; preview: Preview };

/**
 * One workspace file, read-only, in a drawer beside the conversation.
 *
 * The tree said which files exist and which this thread changed; what it could
 * not say is what is in them, which is usually the next question — did the
 * write land, is that the config the agent meant. A drawer rather than a page,
 * because the answer is wanted next to the transcript that raised it, and
 * read-only because the agent's writes go through an approval and an edit made
 * here would go through nothing.
 *
 * The file is read from whichever store the tools are running against — the
 * mounted folder, or the in-tab one — with the same precedence the approval
 * diff uses, so the preview and the diff never disagree about a file. It is
 * read as bytes, so an image, a PDF, audio or video is drawn as itself; markdown
 * opens rendered with its source a toggle away. HTML and SVG stay source.
 * It is re-read when a run settles, since that is when a write can have landed
 * under an open preview.
 */
export function FilePreview({
  path,
  changed,
  streaming,
  onClose,
}: {
  /** The file to show, or null for a closed drawer. */
  path: string | null;
  changed: boolean;
  streaming: boolean;
  onClose: () => void;
}) {
  const [read, setRead] = useState<Read>({ status: 'loading' });
  // A slow mount read for the previous file must not land on this one.
  const asked = useRef<string | null>(null);

  const load = useCallback(async (p: string) => {
    asked.current = p;
    setRead({ status: 'loading' });
    const bytes = await readWorkspaceBytes(p);
    if (asked.current !== p) return;
    setRead(
      bytes === null ? { status: 'missing' } : { status: 'ready', preview: previewOfBytes(bytes) },
    );
  }, []);

  useEffect(() => {
    if (path) void load(path);
    else asked.current = null;
  }, [path, load]);

  useEffect(() => {
    if (!streaming && asked.current) void load(asked.current);
  }, [streaming, load]);

  const name = path?.split('/').pop() ?? '';
  const language = path ? languageFor(path) : null;
  const preview = read.status === 'ready' ? read.preview : null;
  const markdown = !!path && isMarkdown(path) && preview?.kind === 'text' && preview.text !== '';
  const [view, setView] = useState<'rendered' | 'source'>('rendered');

  return (
    <Sheet open={path !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-[min(44rem,100vw)] max-w-full gap-0 p-0 sm:max-w-none"
        data-slot="file-preview"
      >
        <header className="flex min-w-0 items-start gap-2 border-b px-4 pt-4 pb-3 pr-12">
          <div className="min-w-0 flex-1">
            <SheetTitle className="truncate font-mono text-sm" title={path ?? undefined}>
              {name}
            </SheetTitle>
            <SheetDescription
              className="mt-0.5 truncate font-mono text-xs"
              title={path ?? undefined}
            >
              {path}
            </SheetDescription>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {[
                changed ? 'Changed on this thread' : null,
                preview?.kind === 'text' ? `${preview.lines.toLocaleString()} lines` : null,
                preview?.kind === 'media' ? mediaLabel(preview.type, preview.bytes.length) : null,
                'Read-only',
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {markdown && (
              <div
                role="group"
                aria-label="Markdown view"
                className="mr-1 flex gap-0.5 text-xs text-muted-foreground"
              >
                {(['rendered', 'source'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={view === v}
                    onClick={() => setView(v)}
                    className={cn(
                      'rounded px-1.5 py-0.5 capitalize',
                      view === v ? 'bg-muted text-foreground' : 'hover:text-foreground',
                    )}
                  >
                    {v}
                  </button>
                ))}
              </div>
            )}
            {preview?.kind === 'text' && <CopyButton text={preview.text} />}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Read the file again"
              title="Read the file again"
              onClick={() => path && void load(path)}
            >
              <RotateCwIcon aria-hidden className="size-3.5" />
            </Button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {read.status === 'loading' ? (
            <p className="text-xs text-muted-foreground">Reading…</p>
          ) : read.status === 'missing' ? (
            // Not an error: a file the agent removed, or one listed before the
            // folder was changed. The tree catches up on its next read.
            <p className="text-sm text-muted-foreground">
              This file is no longer in the workspace.
            </p>
          ) : read.preview.kind === 'binary' ? (
            <p className="text-sm text-muted-foreground">
              Binary file — not shown. Open it from the folder on disk.
            </p>
          ) : read.preview.kind === 'media' ? (
            <MediaView
              key={path}
              name={name}
              media={read.preview.media}
              type={read.preview.type}
              bytes={read.preview.bytes}
            />
          ) : read.preview.text === '' ? (
            <p className="text-sm text-muted-foreground">This file is empty.</p>
          ) : markdown && view === 'rendered' ? (
            <Suspense fallback={<p className="text-xs text-muted-foreground">Reading…</p>}>
              <SkillMarkdown markdown={read.preview.text} />
              {read.preview.truncated && <TruncatedNote shown={read.preview.text.length} />}
            </Suspense>
          ) : (
            <>
              {language ? (
                <CodeBlock
                  code={withoutFinalNewline(read.preview.text)}
                  language={language}
                  showLineNumbers
                  className="text-xs"
                />
              ) : (
                <pre
                  className={cn(
                    'overflow-x-auto rounded-md border bg-background p-3 font-mono text-xs whitespace-pre',
                  )}
                >
                  {withoutFinalNewline(read.preview.text)}
                </pre>
              )}
              {read.preview.truncated && <TruncatedNote shown={read.preview.text.length} />}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
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
function mediaLabel(type: string, size: number): string {
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
 * is not — a re-read or another file makes a new one, so nothing leaks while a
 * preview is left open across a run that keeps rewriting the file.
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
        className="mx-auto max-h-[70vh] max-w-full rounded-md border bg-[repeating-conic-gradient(var(--muted)_0_25%,transparent_0_50%)] bg-[length:16px_16px]"
      />
    );
  }
  if (media === 'pdf') {
    return <iframe src={url} title={name} className="h-[75vh] w-full rounded-md border" />;
  }
  if (media === 'audio') {
    // biome-ignore lint/a11y/useMediaCaption: a workspace file has no captions to offer.
    return <audio src={url} controls className="w-full" />;
  }
  return (
    // biome-ignore lint/a11y/useMediaCaption: a workspace file has no captions to offer.
    <video src={url} controls className="max-h-[70vh] w-full rounded-md border bg-black" />
  );
}

/**
 * A file's last newline ends its last line; it does not start another. Drawn
 * as-is, the gutter numbered an empty line past the count in the header.
 */
function withoutFinalNewline(text: string): string {
  return text.endsWith('\n') ? text.slice(0, -1) : text;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);
  const Icon = copied ? CheckIcon : CopyIcon;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={copied ? 'Copied' : 'Copy contents'}
      title="Copy contents"
      onClick={() =>
        void navigator.clipboard
          ?.writeText(text)
          .then(() => setCopied(true))
          .catch(() => {})
      }
    >
      <Icon aria-hidden className="size-3.5" />
    </Button>
  );
}
