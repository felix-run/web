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
  // A threshold of 0 is no threshold: every score clears it, so "at least 0"
  // described a gate that does not exist. Likewise a security result that never
  // blocks is not something publishing *needs*.
  const parts: string[] = [];
  if (policy.min_quality > 0) parts.push(`a quality score of at least ${policy.min_quality}`);
  if (policy.security_fail_blocks) parts.push('a security scan that does not fail');
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
  const lead = policy.min_quality > 0 ? '' : 'No minimum quality score. ';
  if (parts.length === 0) return `${lead}Nothing else in the policy blocks a publish.`;
  return `${lead}Publishing needs ${parts.join(', ')}. A rollback is held to the same gate, without the evaluation.`;
}

/** The personal-library refusals, each with words of its own in `RefusalNotice`. */
const PERSONAL_REFUSALS: ReadonlySet<string> = new Set([
  'no_personal_library',
  'personal_libraries_need_auth',
  'personal_library_read_only',
]);

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
  // A 403 that names its own reason — no personal library, a scope it spells out — is said in
  // those words below; only a bare one is the team library's write scope.
  const named =
    isSkillLibraryError(error) &&
    !!error.refusal &&
    (PERSONAL_REFUSALS.has(error.code) || error.code.startsWith('missing_scope:'));
  if (isForbidden(error) && !named) {
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
    no_personal_library:
      'Your sign-in has no personal library. Each person signed in with their own account has one; a shared key or an anonymous session does not.',
    personal_libraries_need_auth:
      'This harness runs without sign-in, so nobody has a personal library.',
    personal_library_read_only:
      'Someone else’s personal library can be read and archived, not changed.',
    personal_library_full:
      'Your personal library is full. Archive skills you no longer use to make room.',
    promotion_pending:
      'An earlier promotion of this skill is still waiting for review in the team library. It has to be decided first.',
    origin_mismatch:
      'The team library’s skill of this name came from an import. An operator has to adopt it before anything else can be saved over it.',
    too_recent:
      'These files are newer than the import age this tenant requires. Nothing was saved; they can be imported once they have been seen for long enough.',
    rate_limited:
      'This tenant has used its hourly allowance of GitHub requests. Try again later in the hour.',
    upstream_rate_limited: 'GitHub is rate-limiting the harness. Try again in a few minutes.',
    upstream_error: 'GitHub did not answer as expected. Try again in a moment.',
    egress_blocked:
      'This harness is not allowed to reach GitHub (its network allow-list refuses it).',
    source_not_found: 'No such repository, folder or ref on GitHub — or it is private.',
    source_not_allowed: 'This harness is not allowed to import from that repository.',
    invalid_source:
      'That is not a source the harness can read. Use github:owner/repo, optionally followed by /path.',
    source_too_large: 'That repository folder is larger than an import may be.',
    commit_not_in_repo: 'That commit is not in the repository.',
    ambiguous_ref: 'That ref names more than one thing (a branch and a tag). Name it more exactly.',
    not_imported: 'This skill did not come from an import, so it has no source to check.',
    agent_draft:
      'An agent’s draft cannot be adopted: decide it, or adopt the version it was based on.',
    adopt_mismatch: 'That version is not one an adoption can start from.',
    reason_required: 'Say why you vouch for these files: the reason is recorded with the adoption.',
    publish_not_allowed: 'An import is always saved as a draft; publish it after review.',
    invalid_policy:
      'Every policy field needs a value; only the evaluation uplift floor can be left empty.',
  };
  return (
    <Notice action={action}>
      <p>
        {lead[code] ??
          (code.startsWith('missing_scope:')
            ? `Your credential needs the ${code.slice('missing_scope:'.length)} scope to ${doing}.`
            : `Could not ${doing}.`)}
      </p>
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
