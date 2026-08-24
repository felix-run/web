import { Badge } from '@felix/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@felix/ui/collapsible';
import { CheckCircle2Icon, ChevronDownIcon, LoaderIcon, WrenchIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type { ToolCall } from '@/types';

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
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div>
      <pre
        className={cn(
          'max-h-64 overflow-auto rounded-lg bg-background/80 p-2.5 text-xs leading-relaxed',
          emphasis ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {render(value)}
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
