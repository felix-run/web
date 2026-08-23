import { Badge } from '@felix/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@felix/ui/collapsible';
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  LoaderIcon,
  WrenchIcon,
  XCircleIcon,
} from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { TimelineItem } from '@/types';

/**
 * A tool call, collapsed to one line until asked for.
 *
 * A run makes far more tool calls than it makes statements, and their argument
 * and output blobs used to push the assistant's actual answer off screen. The
 * summary line is what the reader needs by default; the body is there when a
 * call misbehaves.
 */
export function ToolCard({ item, action }: { item: TimelineItem; action?: React.ReactNode }) {
  const running = item.status === 'running';
  const failed = item.status === 'error';
  const [open, setOpen] = useState(false);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn(
        'overflow-hidden rounded-md border border-border bg-muted/30 text-sm',
        failed && 'border-destructive/40',
      )}
    >
      <div className="flex items-center gap-2 pr-2">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left font-mono text-xs hover:bg-muted/40">
          <WrenchIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate font-medium">{item.title}</span>
          <Badge variant="secondary" className="ml-auto gap-1 py-0 font-sans">
            {running ? (
              <LoaderIcon className="size-3 animate-spin" />
            ) : failed ? (
              <XCircleIcon className="size-3 text-destructive" />
            ) : (
              <CheckCircle2Icon className="size-3 text-emerald-500" />
            )}
            {running ? (item.phase ?? 'running') : (item.status ?? 'done')}
          </Badge>
          <ChevronDownIcon
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform duration-200',
              open && 'rotate-180',
            )}
          />
        </CollapsibleTrigger>
        {action}
      </div>
      <CollapsibleContent>
        <pre className="max-h-64 overflow-auto border-t border-border/50 px-3 py-2 font-mono text-xs leading-relaxed text-muted-foreground">
          {item.body || '(no output)'}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}
