import type { SecurityStatus, SkillPolicy } from '@felix/client';
import { ShieldAlertIcon, ShieldCheckIcon, ShieldXIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export const SCORE_HELP = {
  quality:
    'Quality, 0-100: the harness’s automated review of the SKILL.md — structure, length, headings, steps.',
  security:
    'Security: the harness’s static scan for credentials, risky script constructs, prompt-injection phrasing and obfuscation. A failing scan always blocks a publish.',
} as const;

/**
 * The security definition with what blocks *under this policy* — an advisory
 * finding blocks only where the policy says so, and the help used to state the
 * default beside a page an advisory was blocking.
 */
export function securityHelp(policy: Pick<SkillPolicy, 'block_on_advisory'> | undefined): string {
  if (!policy) return SCORE_HELP.security;
  return policy.block_on_advisory
    ? `${SCORE_HELP.security} Under this policy an advisory finding blocks one too.`
    : `${SCORE_HELP.security} Under this policy an advisory finding does not.`;
}

const SECURITY = {
  pass: { icon: ShieldCheckIcon, word: 'pass' },
  advisory: { icon: ShieldAlertIcon, word: 'advisory' },
  fail: { icon: ShieldXIcon, word: 'fail' },
} as const;

/** What the policy in force makes of a score: the two fields that decide whether one blocks. */
export type GatePolicy = Pick<SkillPolicy, 'min_quality' | 'block_on_advisory'>;

/**
 * A security result's colour, from whether it blocks a publish. Red is the one
 * colour for "the gate refuses this", the same red as the verdict that says
 * so; anything that does not block is a fact, told by the shield's shape and
 * the word in foreground. Amber stays for what waits on a person.
 */
function securityTone(status: string, policy: GatePolicy | undefined): string {
  if (status === 'fail') return 'text-state-failed';
  if (status === 'advisory')
    return policy?.block_on_advisory ? 'text-state-failed' : 'text-foreground';
  return 'text-muted-foreground';
}

/**
 * Quality as a number and security as a word, in mono because both are values
 * the harness computed. Security is never colour alone: the word says it, and
 * the shield's shape changes with it (check, alert, cross). With the policy in
 * hand, whatever would block a publish — a score under the floor, a failing
 * scan, an advisory finding where the policy counts one — is red, wherever the
 * readout is drawn; without it only a failing scan is, since that always blocks.
 *
 * Quality carries no icon: a sparkle beside a computed number read as
 * decoration, and the shield is there because its shape is the state.
 *
 * The definitions are said in full on the Gate tab, under the Quality and
 * Security headings; here they are only a `title`, a hover hint on rows that
 * repeat them dozens of times.
 */
export function ScoreReadout({
  quality,
  security,
  policy,
  className,
}: {
  quality?: number | null;
  security?: SecurityStatus | string | null;
  /** The policy in force, so a blocking score is marked wherever it is shown. */
  policy?: GatePolicy;
  className?: string;
}) {
  if (quality == null && !security) return null;
  const sec = security ? SECURITY[security as SecurityStatus] : null;
  const min = policy?.min_quality;
  const below = quality != null && min != null && quality < min;
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs', className)}>
      {quality != null && (
        <span title={SCORE_HELP.quality} className="inline-flex items-center gap-1.5">
          <span className="text-muted-foreground">quality</span>
          <span className={cn('tabular-nums', below && 'text-state-failed')}>{quality}</span>
          {below && <span className="text-state-failed"> (under {min})</span>}
        </span>
      )}
      {security && (
        <span
          title={securityHelp(policy)}
          className={cn('inline-flex items-center gap-1.5', securityTone(security, policy))}
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
    <span title={SCORE_HELP.quality} className="font-mono">
      <span className={cn('text-foreground', below && 'text-state-failed')}>{score}</span>/100
      {below && <span className="text-state-failed"> · under {min}</span>}
    </span>
  );
}

export function SecurityMeta({
  status,
  policy,
}: {
  status: SecurityStatus | string;
  policy?: GatePolicy;
}) {
  const sec = SECURITY[status as SecurityStatus];
  return (
    <span title={securityHelp(policy)} className={cn('font-mono', securityTone(status, policy))}>
      {sec?.word ?? status}
    </span>
  );
}
