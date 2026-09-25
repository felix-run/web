import { describeError } from '@felix/client';
import { Badge } from '@felix/ui/badge';
import { Button } from '@felix/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@felix/ui/collapsible';
import {
  BanIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleAlertIcon,
  LoaderIcon,
  WrenchIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { getArtifact } from '@/api';
import { cn } from '@/lib/utils';
import { type ArtifactRef, classifyToolResult, parseArtifactMarker, type ToolCall } from '@/types';

/**
 * Collapsible tool-call card driven by SSE `ToolCall.done`.
 * In verbose mode, input/output stay expanded.
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

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="overflow-hidden rounded-xl border border-border/60 bg-muted/30 text-sm"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-xs hover:bg-muted/40">
        <WrenchIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate font-medium">{tool.name}</span>
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
            <LoaderIcon className="size-3 animate-spin" />
            {tool.phase ?? 'running'}
          </Badge>
        )}
        <ChevronDownIcon
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 border-t border-border/50 px-3 py-2.5">
        <Field label="Input" value={tool.input} />
        {shell ? (
          <ShellOutput result={shell} />
        ) : issue ? (
          <p className="whitespace-pre-wrap text-xs text-state-failed">{issue.message}</p>
        ) : tool.done ? (
          <Field label="Output" value={tool.output} emphasis />
        ) : (
          verbose && (
            <p className="text-xs text-muted-foreground italic">Waiting for tool output…</p>
          )
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function Field({ label, value, emphasis }: { label: string; value: unknown; emphasis?: boolean }) {
  const text = render(value);
  const spilled = parseArtifactMarker(text);
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div>
      {spilled ? (
        <SpilledOutput ref_={spilled} />
      ) : (
        <pre
          className={cn(
            'max-h-64 overflow-auto rounded-lg bg-background p-2.5 text-xs leading-relaxed',
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
          'overflow-auto rounded-lg bg-background p-2.5 text-xs leading-relaxed text-foreground',
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
          <span className="text-muted-foreground">
            {r.duration_ms < 1000 ? `${r.duration_ms}ms` : `${(r.duration_ms / 1000).toFixed(1)}s`}
          </span>
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
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div>
      <pre className="max-h-64 overflow-auto rounded-lg bg-background p-2.5 text-xs leading-relaxed text-foreground">
        {text}
      </pre>
    </div>
  );
}

function render(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
