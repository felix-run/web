import { Button } from '@felix/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@felix/ui/tooltip';
import { Trace, TraceIcon, TraceLine, TraceTitle } from '@felix/ui/trace';
import { BookmarkIcon } from 'lucide-react';

/**
 * A restore point after a labelled turn, drawn as a Trace line like the steps around it.
 *
 * A label already names the turn — "before the migration", "known good" — which
 * is exactly what a restore point is, but rewinding to it was only in the actions
 * row that appears on hover. This puts the way back on the line itself: the
 * label, a hairline, and Restore, which moves the thread's leaf to this turn, the
 * same rewind the actions row runs. Not offered on the last turn or during a run,
 * where it would rewind to where the thread already is or under a live reply.
 */
export function TurnCheckpoint({ label, onRestore }: { label: string; onRestore: () => void }) {
  return (
    <div data-slot="turn-checkpoint" className="mt-3 flex min-w-0 items-center gap-2">
      <Trace className="w-auto min-w-0 shrink">
        <TraceLine className="text-xs">
          <TraceIcon>
            <BookmarkIcon className="size-3.5" />
          </TraceIcon>
          <TraceTitle className="font-medium">{label}</TraceTitle>
        </TraceLine>
      </Trace>
      <span aria-hidden className="h-px min-w-4 flex-1 bg-border" />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-2 text-xs text-muted-foreground"
            aria-label={`Restore to ${label}`}
            onClick={onRestore}
          >
            Restore
          </Button>
        </TooltipTrigger>
        <TooltipContent align="end" side="bottom">
          Rewind the thread to this turn
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
