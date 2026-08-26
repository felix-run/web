import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@felix/ui/collapsible';
import { BrainIcon, ChevronDownIcon } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * A stretch of the model's reasoning, rendered where it happened.
 *
 * Collapsed by default and never as prose: reasoning shown with the same weight as
 * the answer invites it to be read as the answer, which is worse than not showing
 * it at all. The transcript's job here is to make it *available* — enough to see
 * that thinking occurred and to open it when a reply is surprising.
 *
 * Plain text, deliberately. Reasoning is not addressed to the reader and is often
 * half-formed markdown; running it through the renderer would style fragments into
 * headings and lists the model never meant.
 */
export function Reasoning({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="text-sm">
      <CollapsibleTrigger className="flex items-center gap-1.5 rounded-md py-0.5 text-xs text-muted-foreground hover:text-foreground">
        <BrainIcon className="size-3.5 shrink-0" />
        <span>{streaming ? 'Thinking…' : 'Thought for a moment'}</span>
        <ChevronDownIcon
          className={cn(
            'size-3.5 shrink-0 transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1.5 whitespace-pre-wrap border-l-2 border-border/60 pl-3 text-sm text-muted-foreground">
          {text}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
