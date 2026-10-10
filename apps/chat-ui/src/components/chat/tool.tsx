import { describeError, fileToolOp, parseTabular, summarizeToolArgs } from '@felix/client';
import { Badge } from '@felix/ui/badge';
import { Button } from '@felix/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@felix/ui/collapsible';
import {
  BanIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleAlertIcon,
  ImageOffIcon,
  LoaderIcon,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { getArtifact } from '@/api';
import { CodeBlock, CodeBlockCopyButton } from '@/components/ai-elements/code-block';
import {
  Terminal,
  TerminalActions,
  TerminalContent,
  TerminalCopyButton,
  TerminalHeader,
  TerminalTitle,
} from '@/components/ai-elements/terminal';
import { useDrawableUrl } from '@/hooks/use-drawable-url';
import { parseSkillCall } from '@/lib/skill-calls';
import { cn } from '@/lib/utils';
import { type ArtifactRef, classifyToolResult, parseArtifactMarker, type ToolCall } from '@/types';
import { ToolTable } from './tool-table';

/**
 * The skill proposal card, loaded only when a transcript holds a skill call:
 * it brings TanStack Query and the library client with it, which a thread with
 * no `create_skill` in it should not pay for on every load.
 */
const SkillProposalCard = lazy(() =>
  import('@/components/skills/skill-proposal-card').then((m) => ({
    default: m.SkillProposalCardEntry,
  })),
);

/**
 * Collapsible tool-call card driven by SSE `ToolCall.done`.
 * In verbose mode, input/output stay expanded.
 *
 * Collapsed, the header reads `name · target · duration` and then the state. It
 * used to read a wrench and the name, so a run of five `read_file` cards was five
 * identical rows and the only way to learn which file each one read was to open
 * it. The target is the half of the call that differs between rows; the wrench
 * was the half that never did, on every card, which is an icon marking a row
 * rather than a kind.
 */
export function Tool({ tool, verbose = false }: { tool: ToolCall; verbose?: boolean }) {
  const [open, setOpen] = useState(verbose);
  useEffect(() => {
    if (verbose) setOpen(true);
  }, [verbose]);
  const shell = tool.done ? parseShellResult(tool.output) : null;
  const shellState = shell ? shellStatus(shell) : null;
  // A call that failed or was refused. Its result is a marker the model reads,
  // not a sentence a person does, and `done` is true and useless here for the
  // same reason it is on a shell command that exited 1: a write that failed
  // with Errno 13 sat under a green `done` badge on the reference deployment.
  const issue = tool.done ? classifyToolResult(tool.name, tool.output) : null;
  // Only a finished, successful result is read as a table; a failure says so in words.
  // Memoised on the tool's own fields: a transcript re-renders on every streamed
  // delta, and a large result would otherwise be re-parsed each time.
  const table = useMemo(
    () =>
      tool.done && !parseShellResult(tool.output) && !classifyToolResult(tool.name, tool.output)
        ? parseTabular(tool.output)
        : null,
    [tool.done, tool.name, tool.output],
  );
  const target = toolTarget(tool.name, tool.input);
  // A skill an agent drafted is a decision waiting on a person, so it gets the
  // proposal card above the ordinary one — which stays, folded, for the raw call.
  const skillCall = useMemo(
    () => (tool.done ? parseSkillCall(tool.name, tool.output) : null),
    [tool.done, tool.name, tool.output],
  );

  const card = (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn(
        'overflow-hidden rounded-xl border bg-card text-sm shadow-sheet',
        // Nothing disappears, it cancels: a call that changed nothing keeps its card,
        // dashed, with its summary struck through, so it still reads as something tried.
        issue ? 'border-dashed border-state-failed/40' : 'border-border',
      )}
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left hover:bg-accent/50">
        {/* Our sentence first, in our face; the harness's name for it after, in mono
            (the Provenance Rule). A call with no summary leads with its name. */}
        {target ? (
          <>
            <span
              className={cn(
                'min-w-0 truncate font-medium text-foreground',
                issue && 'line-through decoration-state-failed/60',
              )}
              title={target}
            >
              {target}
            </span>
            <span className="shrink-0 font-mono text-xs text-muted-foreground">{tool.name}</span>
          </>
        ) : (
          <span className="shrink-0 font-mono text-xs font-medium">{tool.name}</span>
        )}
        {/* Only a shell result carries timing; the frames carry none for any
            other tool, and a duration measured here would be the network's. */}
        {shell?.duration_ms != null && (
          <>
            <span aria-hidden className="text-muted-foreground">
              ·
            </span>
            <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
              {formatDuration(shell.duration_ms)}
            </span>
          </>
        )}
        {shellState ? (
          // A shell tool's "done" is its exit status. `done` on a command that
          // exited 1 is true and useless.
          <Badge
            variant="secondary"
            className={cn(
              'ml-auto gap-1 py-0 font-sans',
              shellState.failed ? 'text-state-failed' : 'text-state-done',
            )}
          >
            {shellState.label}
          </Badge>
        ) : issue ? (
          <Badge variant="secondary" className="ml-auto gap-1 py-0 font-sans text-state-failed">
            {issue.kind === 'refused' ? (
              <BanIcon className="size-3" />
            ) : (
              <CircleAlertIcon className="size-3" />
            )}
            {issue.label}
          </Badge>
        ) : tool.done ? (
          <Badge variant="secondary" className="ml-auto gap-1 py-0 font-sans">
            <CheckCircle2Icon className="size-3 text-state-done" />
            done
          </Badge>
        ) : (
          <Badge variant="secondary" className="ml-auto gap-1 py-0 font-sans">
            <LoaderIcon className="size-3 motion-safe:animate-spin" />
            <span className="shimmer shimmer-color-foreground">{tool.phase ?? 'running'}</span>
          </Badge>
        )}
        <ChevronDownIcon
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none',
            open && 'rotate-180',
          )}
        />
      </CollapsibleTrigger>
      {/* Outside the fold: a screenshot is the result a person wants to see, and
          hiding it behind the chevron made every browser call read as text. */}
      {tool.images?.length ? <ToolImages images={tool.images} label={target ?? tool.name} /> : null}
      <CollapsibleContent className="space-y-2 border-t border-border/60 px-3.5 py-3">
        <Field label="Input" value={tool.input} />
        {shell ? (
          <ShellOutput result={shell} />
        ) : issue ? (
          <p className="whitespace-pre-wrap text-xs text-state-failed">{issue.message}</p>
        ) : tool.done ? (
          table ? (
            <ToolTable table={table} raw={render(tool.output)} />
          ) : (
            <Field label="Output" value={tool.output} emphasis />
          )
        ) : (
          verbose && (
            <p className="text-xs text-muted-foreground italic">Waiting for tool output…</p>
          )
        )}
      </CollapsibleContent>
    </Collapsible>
  );
  if (!skillCall) return card;
  return (
    <div className="space-y-1.5">
      <Suspense fallback={null}>
        <SkillProposalCard toolName={tool.name} input={tool.input} result={skillCall} />
      </Suspense>
      {card}
    </div>
  );
}

/**
 * The images a tool returned, drawn in the card rather than named in its output.
 * Each one fits a fixed height so a full-page screenshot does not push the
 * conversation off the screen, and opens to its own width on a click.
 */
function ToolImages({ images, label }: { images: NonNullable<ToolCall['images']>; label: string }) {
  return (
    <div className="flex flex-wrap gap-2 border-t border-border/50 px-3 py-2.5">
      {images.map((image, i) => (
        <ToolImage
          key={image.url}
          url={image.url}
          alt={images.length === 1 ? `Image from ${label}` : `Image ${i + 1} from ${label}`}
        />
      ))}
    </div>
  );
}

function ToolImage({ url, alt }: { url: string; alt: string }) {
  const src = useDrawableUrl(url);
  const [full, setFull] = useState(false);
  if (src === null) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ImageOffIcon aria-hidden className="size-3.5" />
        Image no longer stored
      </p>
    );
  }
  if (src === undefined) {
    return (
      <div
        role="img"
        aria-label={`${alt}, loading`}
        className="h-40 w-64 max-w-full animate-pulse rounded-md bg-muted motion-reduce:animate-none"
      />
    );
  }
  return (
    <button
      type="button"
      aria-pressed={full}
      title={full ? 'Fit to the card' : 'Show at full size'}
      onClick={() => setFull((v) => !v)}
      className={cn(
        'overflow-auto rounded-md border border-border/60 focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none',
        full ? 'w-full cursor-zoom-out' : 'cursor-zoom-in',
      )}
    >
      <img
        src={src}
        alt={alt}
        className={cn('block', full ? 'max-w-none' : 'max-h-72 max-w-full object-contain')}
      />
    </button>
  );
}

function Field({ label, value, emphasis }: { label: string; value: unknown; emphasis?: boolean }) {
  const text = render(value);
  const spilled = parseArtifactMarker(text);
  const json = useMemo(() => prettyJson(value), [value]);
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div>
      {spilled ? (
        <SpilledOutput ref_={spilled} />
      ) : json !== null ? (
        <JsonBlock json={json} label={label} />
      ) : (
        // Wrapped, not scrolled sideways. Unwrapped, an expanded Output was one line
        // of escaped JSON under a horizontal scrollbar — present, and unreadable
        // without dragging it a screen at a time. The height cap still scrolls.
        <pre
          className={cn(
            'max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-background p-2.5 text-xs leading-relaxed',
            emphasis ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {text}
        </pre>
      )}
    </div>
  );
}

/**
 * A tool result the harness spilled to the object store.
 *
 * What the transcript holds is a preview and a reference; the rest is stored and
 * reachable only through `/artifacts`. Showing the marker as though it were
 * output — which is what happened before this — tells the operator that a
 * result was truncated and nothing about how to see it.
 *
 * Fetched on request rather than on render: a long transcript can hold many of
 * these, and the whole point is that they are big.
 */
function SpilledOutput({ ref_ }: { ref_: ArtifactRef }) {
  const [full, setFull] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    getArtifact(ref_.manifestId, ref_.artifactId)
      .then((artifact) => setFull(artifact.content ?? ''))
      .catch((err) => setError(describeError(err, 'read this tool output').message))
      .finally(() => setLoading(false));
  };

  const shown = full ?? ref_.preview;
  return (
    <div className="space-y-1.5">
      <pre
        className={cn(
          'overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-background p-2.5 text-xs leading-relaxed text-foreground',
          full ? 'max-h-96' : 'max-h-64',
        )}
      >
        {shown}
      </pre>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>
          {full
            ? `${ref_.chars.toLocaleString()} chars`
            : `${ref_.chars.toLocaleString()} chars, ${ref_.preview.length.toLocaleString()} shown`}
        </span>
        {full ? (
          <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => setFull(null)}>
            Show preview
          </Button>
        ) : (
          <Button variant="ghost" size="sm" className="h-6 px-2" disabled={loading} onClick={load}>
            {loading ? 'Loading…' : 'Show full output'}
          </Button>
        )}
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

/**
 * A `spec.shell_tools` result: the harness runs an allowlisted argv and returns one
 * JSON object with the exit code, the tail of each stream, and whether either was
 * cut. Recognised by shape rather than by tool name, because the name is whatever
 * the manifest called it (`run`, `test`, `gates`) and the shape is the contract.
 *
 * A result the harness spilled to the object store ends in an artifact marker and
 * is not JSON, so it falls through to the generic field and its "show full output"
 * control, which is right: the exit code is inside the part that was spilled.
 */
export interface ShellResult {
  argv?: string[];
  cwd?: string;
  exit_code: number | null;
  timed_out: boolean;
  truncated: boolean;
  stdout: string;
  stderr: string;
  duration_ms?: number;
}

export function parseShellResult(output: unknown): ShellResult | null {
  let v = output;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s.startsWith('{')) return null;
    try {
      v = JSON.parse(s);
    } catch {
      return null;
    }
  }
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  // The three that every shell result carries and nothing else does together.
  if (!('exit_code' in o) || typeof o.stdout !== 'string' || typeof o.stderr !== 'string') {
    return null;
  }
  return {
    ...(Array.isArray(o.argv) ? { argv: o.argv.map(String) } : {}),
    ...(typeof o.cwd === 'string' ? { cwd: o.cwd } : {}),
    exit_code: typeof o.exit_code === 'number' ? o.exit_code : null,
    timed_out: o.timed_out === true,
    truncated: o.truncated === true,
    stdout: o.stdout,
    stderr: o.stderr,
    ...(typeof o.duration_ms === 'number' ? { duration_ms: o.duration_ms } : {}),
  };
}

/** `exit 0`, `exit 1`, or `timed out` — the one word the card leads with. */
function shellStatus(r: ShellResult): { label: string; failed: boolean } {
  if (r.timed_out) return { label: 'timed out', failed: true };
  if (r.exit_code === null) return { label: 'no exit code', failed: true };
  return { label: `exit ${r.exit_code}`, failed: r.exit_code !== 0 };
}

/**
 * The shell result drawn as what it is: a command, its exit, and its two streams.
 *
 * Rendered as one JSON blob, `exit_code: 1` sat between `"cwd"` and `"timed_out"`
 * in the same grey as everything else, and the reason a gate failed was a `\n`-
 * escaped string inside a string. The exit status carries the colour; stderr is
 * drawn plainly, because a warning on stderr from a command that exited 0 is not a
 * failure and should not be painted as one.
 */
function ShellOutput({ result: r }: { result: ShellResult }) {
  const status = shellStatus(r);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs">
        {r.argv && (
          <span className="min-w-0 truncate text-foreground" title={r.argv.join(' ')}>
            $ {r.argv.join(' ')}
          </span>
        )}
        <span className={status.failed ? 'text-state-failed' : 'text-state-done'}>
          {status.label}
        </span>
        {r.duration_ms != null && (
          <span className="text-muted-foreground">{formatDuration(r.duration_ms)}</span>
        )}
        {r.cwd && <span className="text-muted-foreground">in {r.cwd}</span>}
      </div>
      <Stream label="stdout" text={r.stdout} sayEmpty />
      <Stream label="stderr" text={r.stderr} />
      {r.truncated && (
        <p className="text-xs text-muted-foreground">
          Cut to the tail the harness keeps. The process wrote more than is shown here.
        </p>
      )}
    </div>
  );
}

function Stream({ label, text, sayEmpty }: { label: string; text: string; sayEmpty?: boolean }) {
  if (!text) {
    // An empty stdout is worth a word — the command printed nothing — where an
    // empty stderr is the normal case and saying so on every card is noise.
    return sayEmpty ? <p className="text-xs text-muted-foreground">{label}: nothing</p> : null;
  }
  // A terminal rather than a <pre>: commands colour their output with ANSI codes,
  // and a <pre> printed them as `\u001b[32m` noise around the words. The surface is
  // the code slab, not the vendored near-black, so it sits in both themes like
  // every other block of tool output.
  return (
    <Terminal
      output={text}
      autoScroll={false}
      className="border-border/60 bg-code-surface text-foreground"
    >
      <TerminalHeader className="border-border/60 px-2.5 py-1">
        <TerminalTitle className="text-xs text-muted-foreground [&>svg]:size-3.5">
          {label}
        </TerminalTitle>
        <TerminalActions>
          <TerminalCopyButton aria-label={`Copy ${label}`} className="size-6" />
        </TerminalActions>
      </TerminalHeader>
      <TerminalContent className="max-h-64 p-2.5 text-xs" />
    </Terminal>
  );
}

/**
 * A value worth highlighting as JSON — an object or array, or a string holding
 * one — pretty-printed; `null` for anything else, which stays plain text.
 */
export function prettyJson(value: unknown): string | null {
  let v = value;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!(s.startsWith('{') || s.startsWith('['))) return null;
    try {
      v = JSON.parse(s);
    } catch {
      return null;
    }
  }
  if (typeof v !== 'object' || v === null) return null;
  return JSON.stringify(v, null, 2);
}

/**
 * Tool arguments and results as highlighted JSON, with a copy control.
 *
 * Still wrapped rather than scrolled sideways — the reason `Field` wraps — and
 * capped at the same height, so a card is no taller than it was.
 */
function JsonBlock({ json, label }: { json: string; label: string }) {
  return (
    <CodeBlock
      code={json}
      language="json"
      className="max-h-64 overflow-y-auto rounded-lg border-border/60 bg-background [&_code]:text-xs [&_pre]:!bg-transparent [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:p-2.5 [&_pre]:pr-9 [&_pre]:text-xs"
    >
      <CodeBlockCopyButton
        aria-label={`Copy ${label.toLowerCase()}`}
        className="absolute top-1 right-1 z-10 size-6"
      />
    </CodeBlock>
  );
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** Tools with a sentence in `summarizeToolArgs`; everything else falls back to JSON there. */
const summarized = (name: string) =>
  fileToolOp(name) === 'write' || name === 'local_shell' || name === 'local_open';

/**
 * The argument names that say what a call is *about*, in the order they are
 * tried. The workspace tools and most harness tools spell their subject one of
 * these ways; a call with none of them falls through to `distinguishingArgs`.
 */
const TARGET_KEYS = ['path', 'file', 'target', 'command', 'query', 'pattern', 'url', 'name', 'id'];

/** The keys that number an issue or pull request, as GitHub-shaped MCP tools spell them. */
const NUMBER_KEYS = ['issue_number', 'pull_number', 'pr_number', 'number'];

/**
 * Arguments that page, sort or cap a listing. Nearly every call sets them the
 * same way, so spending the header on them spends it on what every card has in
 * common — the opposite of what the target is for.
 */
const NOISE_KEYS = new Set([
  'page',
  'per_page',
  'perPage',
  'limit',
  'offset',
  'cursor',
  'after',
  'before',
  'sort',
  'direction',
  'order',
]);

/**
 * What a call acted on, as one line for the card's header — or null when the
 * call had no arguments to speak of.
 *
 * Known client tools get `summarizeToolArgs`'s sentence, the same words the
 * approval card uses for them. A call naming a repository — which the
 * GitHub-shaped MCP tools (`github__list_issues`, `github__get_issue`) all do —
 * leads with `owner/repo#number`. Anything else leads with its subject argument
 * when it has one, because `{"path":"src/a.ts"}` says less than `src/a.ts` in
 * more characters; failing that, the arguments that tell one call from the next.
 *
 * That last step used to be the whole argument object as compact JSON, cut by
 * the header's width. Every GitHub call starts `{"owner":"…","repo":"…"`, so two
 * `github__list_issues` cards asking different questions truncated to the same
 * row, and the difference sat past the ellipsis on both. Compact JSON is still
 * the last resort, for arguments that have nothing but noise in them.
 */
export function toolTarget(name: string, input: unknown): string | null {
  let args = input;
  if (typeof args === 'string') {
    const s = args.trim();
    if (!s) return null;
    if (!s.startsWith('{')) return oneLine(s);
    try {
      args = JSON.parse(s);
    } catch {
      return oneLine(s);
    }
  }
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return null;
  const o = args as Record<string, unknown>;
  if (Object.keys(o).length === 0) return null;
  if (summarized(name)) return oneLine(summarizeToolArgs(name, o));

  const repo = repoRef(o);
  if (repo) {
    const rest = distinguishingArgs(o, new Set(['owner', 'repo', ...NUMBER_KEYS]));
    return oneLine(rest ? `${repo} · ${rest}` : repo);
  }
  for (const key of TARGET_KEYS) {
    const v = o[key];
    if (typeof v === 'string' && v.trim()) return oneLine(v);
  }
  const rest = distinguishingArgs(o, new Set());
  if (rest) return oneLine(rest);
  try {
    return oneLine(JSON.stringify(o));
  } catch {
    return null;
  }
}

/** `owner/repo`, plus `#12` when the call names an issue or pull request. */
function repoRef(o: Record<string, unknown>): string | null {
  const { owner, repo } = o;
  if (typeof owner !== 'string' || !owner || typeof repo !== 'string' || !repo) return null;
  for (const key of NUMBER_KEYS) {
    const n = o[key];
    if (typeof n === 'number' || (typeof n === 'string' && /^\d+$/.test(n))) {
      return `${owner}/${repo}#${n}`;
    }
  }
  return `${owner}/${repo}`;
}

/**
 * `key=value` for the arguments that make this call this call: everything except
 * what `skip` has already said, the paging in `NOISE_KEYS`, empty values, and
 * `state=open` — the default filter of every listing tool that takes one, so it
 * earns a place only when it is something else.
 */
function distinguishingArgs(o: Record<string, unknown>, skip: Set<string>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (skip.has(k) || NOISE_KEYS.has(k)) continue;
    if (k === 'state' && v === 'open') continue;
    const text = argText(v);
    if (text) parts.push(`${k}=${text}`);
  }
  return parts.join(' · ');
}

function argText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number')) {
    return v.join(',');
  }
  try {
    const json = JSON.stringify(v);
    return json === '{}' || json === '[]' ? '' : json;
  } catch {
    return '';
  }
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * A tool's input or output as text for its pane.
 *
 * Output arrives as a string far more often than as an object, and a JSON string
 * printed as-is is one line of escaped quotes. Input was already pretty-printed
 * because it usually arrives parsed; output gets the same treatment when the
 * whole string parses, so the two panes of one card read alike. A string that
 * merely *starts* with a brace and does not parse is left exactly as sent.
 */
function render(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') {
    const s = value.trim();
    if (!(s.startsWith('{') || s.startsWith('['))) return value;
    try {
      return JSON.stringify(JSON.parse(s), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
