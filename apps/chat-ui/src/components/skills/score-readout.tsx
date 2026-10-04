import type { SecurityStatus } from '@felix/client';
import { ShieldAlertIcon, ShieldCheckIcon, ShieldXIcon, SparklesIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const HELP = {
  quality:
    'Quality, 0-100: the harness’s automated review of the SKILL.md — structure, length, headings, steps.',
  security:
    'Security: the harness’s static scan for credentials, risky script constructs, prompt-injection phrasing and obfuscation. Fail blocks a publish.',
} as const;

const SECURITY = {
  pass: { icon: ShieldCheckIcon, tone: 'text-muted-foreground', word: 'pass' },
  advisory: { icon: ShieldAlertIcon, tone: 'text-state-blocked', word: 'advisory' },
  fail: { icon: ShieldXIcon, tone: 'text-state-failed', word: 'fail' },
} as const;

/**
 * Quality as a number and security as a word, in mono because both are values
 * the harness computed. Security is never colour alone: the word says it, and
 * the shield's shape changes with it (check, alert, cross). Colour is kept for
 * what needs a person — amber advisory, red fail — and `pass`, the routine
 * case, stays muted.
 *
 * The definitions are in `title` and in the accessible name rather than in a
 * tooltip, so the readout works on a touch screen and in a card mounted
 * outside any tooltip provider.
 */
export function ScoreReadout({
  quality,
  security,
  minQuality,
  className,
}: {
  quality?: number | null;
  security?: SecurityStatus | string | null;
  /** The policy's floor, drawn beside the score when the score is under it. */
  minQuality?: number | null;
  className?: string;
}) {
  if (quality == null && !security) return null;
  const sec = security ? SECURITY[security as SecurityStatus] : null;
  const below = quality != null && minQuality != null && quality < minQuality;
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs', className)}>
      {quality != null && (
        <span title={HELP.quality} className="inline-flex items-center gap-1.5">
          <SparklesIcon aria-hidden className="size-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">quality</span>
          <span className={cn('tabular-nums', below && 'text-state-blocked')}>{quality}</span>
          {below && <span className="text-state-blocked"> (under {minQuality})</span>}
        </span>
      )}
      {security && (
        <span
          title={HELP.security}
          className={cn('inline-flex items-center gap-1.5', sec?.tone ?? 'text-muted-foreground')}
        >
          {sec ? <sec.icon aria-hidden className="size-3.5" /> : null}
          <span className={sec ? undefined : 'text-muted-foreground'}>security</span>
          <span>{sec?.word ?? security}</span>
        </span>
      )}
    </div>
  );
}

/**
 * The same two values as a section heading's at-a-glance value, for a page
 * whose heading already names them — `quality` and `security` again in front
 * of the number would say the heading twice.
 */
export function QualityMeta({ score, min }: { score: number; min?: number | null }) {
  const below = min != null && score < min;
  return (
    <span title={HELP.quality} className="font-mono">
      <span className={cn('text-foreground', below && 'text-state-blocked')}>{score}</span>/100
      {below && <span className="text-state-blocked"> · under {min}</span>}
    </span>
  );
}

export function SecurityMeta({ status }: { status: SecurityStatus | string }) {
  const sec = SECURITY[status as SecurityStatus];
  return (
    <span title={HELP.security} className={cn('font-mono', sec?.tone)}>
      {sec?.word ?? status}
    </span>
  );
}
