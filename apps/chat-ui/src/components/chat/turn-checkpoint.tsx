import { Checkpoint, CheckpointIcon, CheckpointTrigger } from '@/components/ai-elements/checkpoint';

/**
 * A restore point after a labelled turn, with AI Elements' Checkpoint.
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
    <Checkpoint className="mt-3 gap-1.5 text-xs" data-slot="turn-checkpoint">
      <CheckpointIcon aria-hidden className="size-3.5" />
      <span className="shrink-0 font-medium">{label}</span>
      <CheckpointTrigger
        size="sm"
        className="h-6 shrink-0 px-2 text-xs"
        tooltip="Rewind the thread to this turn"
        aria-label={`Restore to ${label}`}
        onClick={onRestore}
      >
        Restore
      </CheckpointTrigger>
    </Checkpoint>
  );
}
