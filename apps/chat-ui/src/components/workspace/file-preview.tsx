import { Button } from '@felix/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@felix/ui/sheet';
import { CheckIcon, CopyIcon, RotateCwIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CodeBlock } from '@/components/ai-elements/code-block';
import { readWorkspaceFile } from '@/lib/cowork';
import { languageFor, type Preview, previewOf } from '@/lib/file-preview';
import { cn } from '@/lib/utils';

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
 * mounted folder, or the in-tab one — through the same `readExisting` the
 * approval diff uses, so the preview and the diff never disagree about a file.
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
    const text = await readWorkspaceFile(p);
    if (asked.current !== p) return;
    setRead(text === null ? { status: 'missing' } : { status: 'ready', preview: previewOf(text) });
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
                'Read-only',
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
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
          ) : read.preview.text === '' ? (
            <p className="text-sm text-muted-foreground">This file is empty.</p>
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
              {read.preview.truncated && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Showing the first {(read.preview.text.length / 1000).toFixed(0)} KB. The rest is
                  in the file.
                </p>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
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
