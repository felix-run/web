import { cn } from '@/lib/utils';
import type { Turn } from '@/types';

/** At or above this share the meter says so in words, not only with the bar. */
export const NEARLY_FULL = 0.9;

/**
 * How full the context window was after the newest reply, or `null` when that
 * cannot be said.
 *
 * Reads the last assistant turn that reported one — the final model call's prompt
 * plus its reply, which is the whole active branch as the model last saw it. A
 * newer turn without a figure (a durable run not yet re-read, a provider that
 * reports nothing) falls back to the one before it rather than to nothing, which
 * understates by one exchange at most and says "as of" so the reader knows.
 */
export function contextFill(turns: Turn[], window: number | undefined) {
  if (!window || window <= 0) return null;
  for (let i = turns.length - 1; i >= 0; i--) {
    const used = turns[i]?.contextTokens;
    if (turns[i]?.role === 'assistant' && used !== undefined) {
      return { used, window, share: used / window };
    }
  }
  return null;
}

const compact = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, '')}k` : `${n}`;

/**
 * The context window, as a fact about the next send: it sits beside the agent and
 * Thinking pickers because the window is the selected agent's, and the history it
 * measures is what the next message is appended to.
 *
 * Neutral on purpose. The state ramp's hues each mean one thing about a run —
 * amber is "waiting on a person" — and a filling window is none of them, so
 * nearly full is said in words rather than borrowed from a colour that already
 * means something else.
 */
export function ContextMeter({
  used,
  window,
  agent,
}: {
  used: number;
  window: number;
  agent?: string;
}) {
  const share = Math.min(1, used / window);
  const pct = Math.round(share * 100);
  const full = share >= NEARLY_FULL;
  const detail = `${used.toLocaleString()} of ${window.toLocaleString()} tokens in ${
    agent ? `${agent}'s` : 'the'
  } context window, as of the last reply${
    full ? '. Nearly full: the harness compacts or the model truncates past this.' : '.'
  }`;
  return (
    <div
      role="meter"
      aria-label="Context window used"
      aria-valuemin={0}
      aria-valuemax={window}
      aria-valuenow={Math.min(used, window)}
      aria-valuetext={`${pct}% — ${detail}`}
      title={detail}
      // Below `sm` it yields to the agent picker, whose name it otherwise squeezed
      // to a bare chevron at 390px — which agent the next message goes to matters
      // more than how full its window is. Nearly full is the exception: that is
      // the one reading worth the agent's name truncating for.
      className={cn(
        'shrink-0 items-center gap-1.5 px-1 text-xs text-muted-foreground',
        full ? 'flex' : 'hidden sm:flex',
      )}
    >
      <span className="hidden h-1 w-8 overflow-hidden rounded-full bg-muted sm:block" aria-hidden>
        <span
          className={full ? 'block h-full bg-foreground' : 'block h-full bg-muted-foreground/70'}
          style={{ width: `${Math.max(pct, used > 0 ? 3 : 0)}%` }}
        />
      </span>
      <span className={full ? 'tabular-nums text-foreground' : 'tabular-nums'}>
        {pct}%
        <span className="hidden sm:inline">
          {' '}
          of {compact(window)}
          {full ? ' · nearly full' : ''}
        </span>
      </span>
    </div>
  );
}
