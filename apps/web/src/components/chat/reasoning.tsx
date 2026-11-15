import { countWords, formatElapsed } from '@felix/client';
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@felix/ui/trace';
import { BrainIcon } from 'lucide-react';
import { useState } from 'react';
import { useElapsed } from '@/hooks/use-elapsed';
import { cn } from '@/lib/utils';
import { StateDot } from './run-status';

/**
 * A stretch of the model's reasoning, rendered where it happened.
 *
 * Collapsed by default and never as prose: reasoning shown with the same weight as
 * the answer invites it to be read as the answer, which is worse than not showing
 * it at all. The transcript's job here is to make it *available* — enough to see
 * that thinking occurred and to open it when a reply is surprising.
 *
 * While it is being written, the row has to prove it is alive. A static "Thinking…"
 * looked the same at second two as at minute two, and the same as a stream that had
 * stalled. So the live row carries the run readout's pulsing dot, a stopwatch and a
 * word count that move with the deltas, and one line of the newest reasoning under
 * it — the mechanism itself, muted and cut to a line, so it reads as a readout and
 * not as a reply. Settled, it says what it measured: how long, when this tab watched
 * it happen, and how many words, which a block rebuilt from history still has.
 *
 * Drawn as a Trace row (`@felix/ui/trace`), the same line a tool call or a plan is, so the
 * steps of a turn read as one list; the shimmer on the title is the line's own `running` state.
 *
 * Plain text, deliberately. Reasoning is not addressed to the reader and is often
 * half-formed markdown; running it through the renderer would style fragments into
 * headings and lists the model never meant.
 */
export function Reasoning({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const [open, setOpen] = useState(false);
  const elapsed = useElapsed(streaming);
  const words = countWords(text);

  const measure = [
    elapsed === null ? null : formatElapsed(elapsed),
    `${words.toLocaleString()} word${words === 1 ? '' : 's'}`,
  ].filter(Boolean);

  return (
    <TraceCollapsible open={open} onOpenChange={setOpen} className="text-sm">
      <TraceCollapsibleTrigger className="py-0.5">
        <TraceLine status={streaming ? 'running' : undefined} className="text-xs">
          <TraceIcon>
            {streaming ? <StateDot tone="running" live /> : <BrainIcon className="size-3.5" />}
          </TraceIcon>
          {/* The sweep says the block is still being written; it brightens toward
              the foreground, so the running blue never dips under its own contrast. */}
          <TraceTitle className={cn(streaming && 'font-medium text-state-running')}>
            {streaming ? 'Thinking' : elapsed === null ? 'Reasoning' : 'Thought for'}
          </TraceTitle>
          {/* `Thought for 14s · 312 words`; a block this tab never watched has no
              duration, so it leads with the noun instead of inventing one. */}
          <TraceDescription className="font-mono text-muted-foreground">
            {streaming || elapsed === null ? `· ${measure.join(' · ')}` : measure.join(' · ')}
          </TraceDescription>
        </TraceLine>
      </TraceCollapsibleTrigger>
      {/* Announced once when thinking starts, and once when it stops — not per word. */}
      <span role="status" aria-live="polite" className="sr-only">
        {streaming ? 'Thinking' : ''}
      </span>
      {streaming && !open && <ReasoningTail text={text} />}
      <TraceCollapsibleContent className="whitespace-pre-wrap wrap-anywhere text-sm">
        {text}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

/**
 * The newest line of reasoning, cut from the *front*.
 *
 * An end-cut would pin the row to the first words of the block and hide the ones
 * arriving, which is the only part that says it is still moving. `direction: rtl`
 * moves the overflow — and the ellipsis — to the left edge, and the inner `ltr`
 * span keeps the text itself reading left to right; `text-left` keeps a short line
 * where a short line belongs. Hidden from assistive tech: the expanded block is the
 * readable version, and a region rewritten on every delta is noise.
 */
function ReasoningTail({ text }: { text: string }) {
  const tail = text.slice(-400).replace(/\s+/g, ' ').trim();
  if (!tail) return null;
  return (
    <p
      aria-hidden
      className="mt-1 ml-[calc(--spacing(2)-1px)] overflow-hidden text-ellipsis whitespace-nowrap border-l pl-4 text-left text-sm text-muted-foreground [direction:rtl]"
    >
      <span dir="ltr">{tail}</span>
    </p>
  );
}
