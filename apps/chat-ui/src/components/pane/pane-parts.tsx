import { Button } from '@felix/ui/button';
import { CheckIcon, CopyIcon, DownloadIcon } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * The pieces every item in the side pane is drawn with: the heading that says
 * what is open, and the two actions everything offers — copy and download.
 */

/**
 * Text cut from the middle by layout rather than by a character count: the head
 * truncates and the last `keep` characters never do, so a file keeps its
 * extension and a path keeps the part that tells it from its neighbours —
 * `packages/felix-client/src/…/really-long-name.ts`, not `packages/felix-cli…`.
 * It follows the width it is given, which a count cannot.
 */
export function MiddleCut({
  text,
  keep,
  className,
}: {
  text: string;
  keep: number;
  className?: string;
}) {
  const head = text.length > keep * 2 ? text.slice(0, -keep) : text;
  const tail = head === text ? '' : text.slice(-keep);
  return (
    <span className={cn('flex min-w-0', className)}>
      <span className="truncate">{head}</span>
      {tail && <span className="shrink-0 whitespace-pre">{tail}</span>}
    </span>
  );
}

export function ItemHeader({
  name,
  mono = false,
  keepName = 0,
  detail,
  meta,
  actions,
}: {
  /** The item's own name: a file name, a tool, a language. */
  name: string;
  /** The name is an identifier — a file or a tool — and is set in mono. */
  mono?: boolean;
  /** Cut the name from the middle, keeping this many characters at its end. */
  keepName?: number;
  /** Where it came from: a path, an id. Always an identifier, so always mono. */
  detail?: string;
  meta?: readonly (string | null | false | undefined)[];
  actions?: ReactNode;
}) {
  const facts = meta?.filter(Boolean) ?? [];
  return (
    <header className="flex min-w-0 shrink-0 items-start gap-3 px-4 pt-3 pb-2.5">
      <div className="min-w-0 flex-1">
        <h2
          className={cn('min-w-0 text-sm font-medium', mono && 'font-mono')}
          title={detail ?? name}
        >
          {keepName ? (
            <MiddleCut text={name} keep={keepName} />
          ) : (
            <span className="block truncate">{name}</span>
          )}
        </h2>
        {(detail || facts.length > 0) && (
          <p className="mt-0.5 flex min-w-0 gap-1.5 text-xs text-muted-foreground">
            {detail && <MiddleCut text={detail} keep={24} className="font-mono" />}
            {detail && facts.length > 0 && <span aria-hidden>·</span>}
            {facts.length > 0 && <span className="shrink-0">{facts.join(' · ')}</span>}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
    </header>
  );
}

/** A `role="group"` of pressed buttons: it switches how one thing is drawn, so it is not tabs. */
export function ViewSwitch<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: V;
  options: readonly { value: V; label: string }[];
  onChange: (v: V) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="mr-1 flex h-7 items-center rounded-full bg-ground p-0.5 text-xs"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-full rounded-full px-2.5 font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none',
            value === o.value
              ? 'bg-background text-foreground shadow-sheet'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function CopyAction({ text, what = 'contents' }: { text: string; what?: string }) {
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
      aria-label={copied ? 'Copied' : `Copy ${what}`}
      title={`Copy ${what}`}
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

export function DownloadAction({
  name,
  get,
}: {
  name: string;
  /** What to save, built on the click: a text, the bytes, or a URL already drawable here. */
  get: () => Blob | string | Promise<Blob | string>;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`Download ${name}`}
      title={`Download ${name}`}
      onClick={() => void Promise.resolve(get()).then((data) => saveAs(name, data))}
    >
      <DownloadIcon aria-hidden className="size-3.5" />
    </Button>
  );
}

/**
 * Hand the browser a file to save. A string is text; a `blob:` or `data:` URL
 * is used as is, since those are the only URLs the pane ever draws from.
 */
export function saveAs(name: string, data: Blob | string) {
  const isUrl = typeof data === 'string' && /^(blob|data):/.test(data);
  const href = isUrl
    ? (data as string)
    : URL.createObjectURL(
        typeof data === 'string' ? new Blob([data], { type: 'text/plain;charset=utf-8' }) : data,
      );
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (!isUrl) window.setTimeout(() => URL.revokeObjectURL(href), 0);
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

/** A file's last newline ends its last line; drawn as-is, the gutter numbered one past the count. */
export function withoutFinalNewline(text: string): string {
  return text.endsWith('\n') ? text.slice(0, -1) : text;
}

/** An extension for a fenced block's language, so a download opens in the right editor. */
export function extensionFor(language: string): string {
  const l = language.toLowerCase();
  const known: Record<string, string> = {
    typescript: 'ts',
    ts: 'ts',
    tsx: 'tsx',
    javascript: 'js',
    js: 'js',
    jsx: 'jsx',
    python: 'py',
    py: 'py',
    bash: 'sh',
    sh: 'sh',
    shell: 'sh',
    zsh: 'sh',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    markdown: 'md',
    md: 'md',
    html: 'html',
    css: 'css',
    sql: 'sql',
    rust: 'rs',
    go: 'go',
    java: 'java',
    ruby: 'rb',
    diff: 'diff',
  };
  return known[l] ?? (/^[a-z0-9]{1,8}$/.test(l) ? l : 'txt');
}
