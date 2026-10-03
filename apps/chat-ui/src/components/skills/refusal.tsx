import { isSkillLibraryError, type SkillPolicy } from '@felix/client';
import { CircleAlertIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { ErrorNotice } from '@/components/error-notice';

/** Whether a failed write was the key's scope rather than the library's state. */
export function isForbidden(err: unknown): boolean {
  return (
    (isSkillLibraryError(err) && err.status === 403) ||
    /:\s*403\b/.test(String((err as Error)?.message ?? ''))
  );
}

/**
 * The publish policy as a sentence — what a version has to clear, so a
 * "blocked" can say *against what*. Read from `/-/policy`, never assumed.
 */
export function policySentence(policy: SkillPolicy): string {
  const parts = [`a quality score of at least ${policy.min_quality}`];
  parts.push(
    policy.security_fail_blocks ? 'a security scan that does not fail' : 'any security result',
  );
  if (policy.block_on_advisory) parts.push('no advisory security finding');
  const uplift = policy.min_eval_uplift;
  if (uplift != null) {
    const signed = uplift > 0 ? `+${uplift}` : String(uplift);
    parts.push(
      `a succeeded evaluation that counts for the gate, with an uplift of at least ${signed}`,
    );
  } else if (policy.require_eval) {
    parts.push('a succeeded evaluation that counts for the gate');
  }
  return `Publishing needs ${parts.join(', ')}. A rollback is held to the same gate, without the evaluation.`;
}

/**
 * A refused library write, in the words its refusal calls for.
 *
 * `ErrorNotice` reads a status; this reads the library's `code`, because three
 * different 409s and two different 422s each need a different next step — and
 * the generic 409 copy ("someone else already decided this") is right for an
 * approval and wrong for a name clash. A publish the gate refused lists the
 * gate's own reasons, verbatim.
 */
export function RefusalNotice({
  error,
  doing,
  action,
}: {
  error: unknown;
  doing: string;
  action?: ReactNode;
}) {
  if (isForbidden(error)) {
    return (
      <Notice action={action}>
        This key can read the skill library but not change it. Deciding a draft needs the{' '}
        <span className="font-mono">skills:write</span> scope.
      </Notice>
    );
  }
  if (!isSkillLibraryError(error) || !error.refusal) {
    return <ErrorNotice error={error} doing={doing} action={action} />;
  }
  const { code, refusal } = error;
  const reasons = refusal.reasons ?? [];
  const issues = refusal.issues ?? [];
  const lead: Record<string, string> = {
    publish_blocked: 'The publish gate refused this version.',
    invalid_bundle: 'The harness refused the bundle.',
    parent_changed: 'Someone saved a newer version since this one was loaded.',
    version_conflict: 'That version number is taken or not newer than the newest.',
    skill_exists: 'The library already has a skill with this name.',
    name_shadows_host_skill:
      'That name belongs to a skill the harness ships; no edit changes that.',
    pending_cap_reached: 'Too many agent drafts are waiting; decide some and the queue drains.',
    version_cap_reached: 'This skill holds as many versions as the harness keeps.',
    version_corrupt: 'The stored bytes no longer match what was saved. This is a server fault.',
    payload_too_large: 'The save is over the harness’s request size limit.',
    not_found: 'The library no longer has this.',
    live_changed:
      'Another version went live while you were deciding. Nothing changed; check what is live and decide again.',
    parent_rejected:
      'The version this was based on has been rejected. Nothing was saved; start again from the newest version that was not.',
    skill_jobs_cap_reached:
      'Too many evaluations and AI improvements are queued for this tenant. Wait for some to finish.',
    feedback_conflict: 'That feedback has already been decided — reload to see what became of it.',
    feedback_cap_reached: 'Too much feedback is waiting on this skill. Decide some first.',
    eval_in_progress:
      'This version already has an evaluation queued or running. Wait for it to finish.',
    invalid_address: 'That is not a skill, version or item the library could hold.',
  };
  return (
    <Notice action={action}>
      <p>{lead[code] ?? `Could not ${doing}.`}</p>
      {code !== 'publish_blocked' || reasons.length === 0 ? (
        <p className="mt-0.5 break-words">{refusal.message}</p>
      ) : null}
      {reasons.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {issues.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {issues.map((i) => (
            <li key={`${i.path}:${i.message}`}>
              <span className="font-mono">{i.path}</span> {i.message}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-0.5 font-mono text-xs break-words">{error.message}</p>
    </Notice>
  );
}

function Notice({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-lg border border-state-failed/30 bg-state-failed/10 px-2.5 py-2 text-sm text-state-failed"
    >
      <div className="flex items-start gap-2">
        <CircleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <div className="min-w-0">{children}</div>
      </div>
      {action}
    </div>
  );
}
