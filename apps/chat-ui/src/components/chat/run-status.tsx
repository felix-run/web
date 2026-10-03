import { formatElapsed } from '@felix/client';
import { useElapsed } from '@/hooks/use-elapsed';
import { cn } from '@/lib/utils';
import type { Turn } from '@/types';

type Tone = NonNullable<Turn['runStatus']>;

const TONE: Record<Tone, { dot: string; text: string }> = {
  running: { dot: 'bg-state-running', text: 'text-state-running' },
  blocked: { dot: 'bg-state-blocked', text: 'text-state-blocked' },
};

/**
 * The run readout's 6px state dot, sized to sit in an icon's slot.
 *
 * It pulses only while `running` and live: the pulse means "still working", which
 * is why reduced motion slows it rather than stopping it (see `index.css`). A run
 * waiting on a person is not working, so `blocked` holds still, and a dot whose
 * run has ended drops to the idle grey — green would claim it succeeded.
 */
export function StateDot({ tone, live }: { tone: Tone; live: boolean }) {
  return (
    <span aria-hidden className="flex size-3.5 shrink-0 items-center justify-center">
      <span
        className={cn(
          'size-1.5 rounded-full',
          live ? TONE[tone].dot : 'bg-muted-foreground/50',
          live && tone === 'running' && 'animate-pulse',
        )}
      />
    </span>
  );
}

/**
 * A durable run's status, drawn as a status and not as the reply.
 *
 * The stream of a durable run carries no deltas, so until `final` the engine's
 * status line is the whole turn — and rendered through the markdown path it read
 * as the agent saying "Durable run accepted…" at reading size. This is the run
 * readout's grammar instead: dot, the line in the ramp colour, a stopwatch. The
 * line alone is the live region; a clock that speaks every second is noise.
 */
export function RunStatusLine({ text, tone, live }: { text: string; tone: Tone; live: boolean }) {
  const elapsed = useElapsed(live);
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-sm">
      <StateDot tone={tone} live={live} />
      <p
        role="status"
        aria-live="polite"
        className={cn(
          'min-w-0 wrap-anywhere',
          live ? cn('font-medium', TONE[tone].text) : 'text-muted-foreground',
          // Only while working: a run waiting on a person is not, and holds still.
          live && tone === 'running' && 'shimmer shimmer-color-foreground',
        )}
      >
        {text}
      </p>
      {/* Only while live: once the run has ended the answer replaces this line, and a
          line left behind by an abort is not a run whose length means anything. */}
      {live && elapsed !== null && (
        <span className="ml-1 shrink-0 text-xs text-muted-foreground">
          for <span className="font-mono tabular-nums">{formatElapsed(elapsed)}</span>
        </span>
      )}
    </div>
  );
}
