import { relativeTime } from '@felix/client';
import { Button } from '@felix/ui/button';
import { useEffect, useState } from 'react';
import { retryHarnessReads, type TransientKind, useHarnessHealth } from '@/lib/harness-health';

/** The cause, in the product's words. Named for the mechanism, not the status code. */
const CAUSE: Record<TransientKind, string> = {
  rate_limited: 'The harness is shedding load',
  unavailable: 'The harness is briefly unavailable',
  unreachable: "Can't reach the harness",
};

/**
 * The one place a passing harness failure is said (`lib/harness-health.ts`).
 *
 * Under the header, beside the attention line's queue slot, on every address,
 * and only while a read is failing — unlike the attention line, it has no
 * all-clear to say, because every panel it speaks for keeps drawing what it last
 * had. **Neutral, never red**: a 429 is the harness answering, and the next tick
 * usually does; red on every one taught the operator to ignore red, which is the
 * attention line's rule too. Red stays with the panels, for failures that waiting
 * will not cure.
 *
 * The cause is the live region; the age sits outside it, because a sentence that
 * changes every minute is re-read every minute. The raw text is Debug's.
 */
export function HarnessHealthLine({ debug = false }: { debug?: boolean }) {
  const health = useHarnessHealth();
  const [, tick] = useState(0);
  const failing = health.state !== 'ok';
  // Ages the "showing what it said …" while the line is up, and only then.
  useEffect(() => {
    if (!failing) return;
    const id = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, [failing]);

  if (health.state === 'ok') return null;
  const age =
    health.lastOkAt != null
      ? `showing what it said ${relativeTime(health.lastOkAt)}`
      : 'nothing has loaded from it yet';
  return (
    <div
      data-slot="harness-health"
      className="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/60 px-3 py-1 text-sm text-muted-foreground sm:px-4"
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
      <span role="status">{CAUSE[health.state]}</span>
      <span aria-hidden>·</span>
      <span>{age}</span>
      {health.retryable && (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          onClick={() => retryHarnessReads()}
        >
          Retry
        </Button>
      )}
      {debug && health.detail && (
        <span className="basis-full font-mono text-xs break-words">
          {health.failing} {health.failing === 1 ? 'read' : 'reads'} failing · {health.detail}
        </span>
      )}
    </div>
  );
}
