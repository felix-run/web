import { describeError } from '@felix/client';
import { Badge } from '@felix/ui/badge';
import { Button } from '@felix/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@felix/ui/collapsible';
import { CheckCircle2Icon, ChevronDownIcon, LoaderIcon, WrenchIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getArtifact } from '@/api';
import { cn } from '@/lib/utils';
import { type ArtifactRef, parseArtifactMarker, type ToolCall } from '@/types';

/**
 * Collapsible tool-call card driven by SSE `ToolCall.done`.
 * In verbose mode, input/output stay expanded.
 */
export function Tool({ tool, verbose = false }: { tool: ToolCall; verbose?: boolean }) {
  const [open, setOpen] = useState(verbose);
  useEffect(() => {
    if (verbose) setOpen(true);
  }, [verbose]);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="overflow-hidden rounded-xl border border-border/60 bg-muted/30 text-sm"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-xs hover:bg-muted/40">
        <WrenchIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate font-medium">{tool.name}</span>
        {tool.done ? (
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
        {tool.done ? (
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

function render(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
