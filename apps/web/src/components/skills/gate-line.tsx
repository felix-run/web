import type { SkillPreview } from '@felix/client';
import { CircleCheckIcon, CircleXIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSkillPreview } from './queries';

/**
 * The gate's verdict in one line, for a place where a decision is offered
 * beside it — a queue row, a draft on Versions, the chat card. The Gate tab
 * draws the whole of it; this is the sentence that has to be in front of a
 * Publish button, because a draft the gate would refuse looked exactly like
 * one it would pass until the button was pressed.
 *
 * It reads `GET …/preview` only while mounted, so a host mounts it where the
 * evidence is open rather than on every row of a long list.
 */
export function GateLine({
  name,
  version,
  className,
}: {
  name: string;
  version: string;
  className?: string;
}) {
  const preview = useSkillPreview(name, version);
  if (preview.error || (preview.data && typeof preview.data.policy_passes !== 'boolean')) {
    return (
      <p className={cn('text-xs text-muted-foreground', className)}>
        The gate's verdict could not be read; the harness checks again on publish.
      </p>
    );
  }
  if (!preview.data) {
    return (
      <p role="status" className={cn('text-xs text-muted-foreground', className)}>
        Asking the gate about {version}…
      </p>
    );
  }
  return <GateVerdictLine preview={preview.data} className={className} />;
}

/** One line from a preview already in hand — the confirm's, which reads it fresh. */
export function GateVerdictLine({
  preview: p,
  className,
}: {
  preview: SkillPreview;
  className?: string;
}) {
  // A span drawn as a block, so it can sit inside the confirm's own sentence.
  return (
    <span
      className={cn(
        'flex items-start gap-1.5 text-xs',
        p.policy_passes ? 'text-muted-foreground' : 'text-state-failed',
        className,
      )}
    >
      {p.policy_passes ? (
        <CircleCheckIcon aria-hidden className="mt-px size-3.5 shrink-0" />
      ) : (
        <CircleXIcon aria-hidden className="mt-px size-3.5 shrink-0" />
      )}
      <span className="min-w-0">{gateSentence(p)}</span>
    </span>
  );
}

export function gateSentence(p: SkillPreview): string {
  if (p.policy_passes) return `The gate would let ${p.version} through.`;
  const reasons = p.reasons ?? [];
  return reasons.length > 0
    ? `The gate would refuse ${p.version}: ${reasons.map((r) => r.replace(/\.$/, '')).join('; ')}.`
    : `The gate would refuse ${p.version}.`;
}
