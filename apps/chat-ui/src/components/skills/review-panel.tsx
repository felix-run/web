import type { SkillPreview, SkillSecurityIssue } from '@felix/client';
import { Button } from '@felix/ui/button';
import { Skeleton } from '@felix/ui/skeleton';
import { CircleCheckIcon, CircleXIcon } from 'lucide-react';
import { PageSection } from '@/components/harness/panel';
import { ReadFailure } from '@/components/inspector/primitives';
import { cn } from '@/lib/utils';
import { PolicyEditor } from './policy-form';
import { usePublishPolicy, useSkillPreview } from './queries';
import { policySentence } from './refusal';
import { ScoreReadout } from './score-readout';

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 } as const;

/**
 * Why a version can or cannot be published, from the harness itself.
 *
 * Everything here is `GET …/preview`: the harness re-reads the stored bytes,
 * re-runs review and the security scan, and says whether its publish policy
 * would let them through *today* — which can differ from the scores saved with
 * the version, because the policy and the scanner move on. Nothing is decided
 * by this page; a refusal is the gate's, in the gate's words, beside the
 * policy it was measured against.
 *
 * Whether the gate *passes* is separate from whether the version's state
 * allows a publish: only a draft publishes, and only a once-live version rolls
 * back. Both are said.
 */
export function ReviewPanel({
  name,
  version,
  liveVersion,
}: {
  name: string;
  version: string;
  liveVersion: string | null;
}) {
  const preview = useSkillPreview(name, version);
  const policy = usePublishPolicy();

  if (preview.error) {
    return (
      <ReadFailure
        error={preview.error}
        doing={`review ${name} ${version}`}
        lastOkAt={null}
        onRetry={() => void preview.refetch()}
      />
    );
  }
  if (!preview.data) return <Skeleton className="h-40 w-full rounded-lg" />;
  const p = preview.data;

  return (
    <div className="space-y-1">
      <PageSection
        title="Publish gate"
        actions={
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => void preview.refetch()}
            disabled={preview.isFetching}
          >
            {preview.isFetching ? 'Re-checking…' : 'Re-check'}
          </Button>
        }
      >
        <GateVerdict preview={p} liveVersion={liveVersion} />
        {policy.data ? (
          <>
            <p className="mt-2 text-xs text-muted-foreground">{policySentence(policy.data)}</p>
            <PolicyEditor policy={policy.data} />
          </>
        ) : policy.error ? (
          <p className="mt-2 text-xs text-muted-foreground">
            The policy itself could not be read, so only the gate's verdict is shown.
          </p>
        ) : null}
      </PageSection>

      {!p.valid && (
        <PageSection title="Validation" meta={`${p.validation_issues.length} issues`}>
          <ul className="space-y-1 text-sm">
            {p.validation_issues.map((i) => (
              <li key={`${i.path}:${i.message}`}>
                <span className="font-mono">{i.path}</span>{' '}
                <span className="text-muted-foreground">{i.message}</span>
              </li>
            ))}
          </ul>
        </PageSection>
      )}

      <PageSection
        title="Quality"
        meta={p.quality_score != null ? `${p.quality_score}/100` : undefined}
      >
        <ScoreReadout
          quality={p.quality_score}
          minQuality={policy.data?.min_quality}
          className="mb-2"
        />
        <ul aria-label="Review checks" className="space-y-1">
          {p.review_checks.map((c) => (
            <li key={c.id} className="flex items-start gap-2 text-sm">
              {c.passed ? (
                <CircleCheckIcon
                  aria-hidden
                  className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                />
              ) : (
                <CircleXIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-state-blocked" />
              )}
              <span className="min-w-0">
                <span className="sr-only">{c.passed ? 'Passed: ' : 'Not met: '}</span>
                <span className={c.passed ? 'text-muted-foreground' : undefined}>{c.label}</span>
                {!c.passed && c.message ? (
                  <span className="block text-xs text-muted-foreground">{c.message}</span>
                ) : null}
              </span>
              <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                {c.weight}
              </span>
            </li>
          ))}
        </ul>
      </PageSection>

      <PageSection title="Security" meta={p.security_status ?? undefined}>
        <ScoreReadout security={p.security_status} className="mb-2" />
        {p.security_issues.length === 0 ? (
          <p className="text-sm text-muted-foreground">The scan found nothing.</p>
        ) : (
          <SecurityIssues issues={p.security_issues} />
        )}
      </PageSection>
    </div>
  );
}

function GateVerdict({
  preview: p,
  liveVersion,
}: {
  preview: SkillPreview;
  liveVersion: string | null;
}) {
  const stateNote =
    p.status === 'draft'
      ? null
      : p.status === 'published' || p.version === liveVersion
        ? `${p.version} is the live version already.`
        : `${p.version} is archived: it cannot be published, only rolled back to if it was once live.`;
  return (
    <div className="space-y-1.5">
      <p
        className={cn(
          'flex items-start gap-2 text-sm font-medium',
          p.policy_passes ? 'text-foreground' : 'text-state-failed',
        )}
      >
        {p.policy_passes ? (
          <CircleCheckIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
        ) : (
          <CircleXIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
        )}
        {p.policy_passes
          ? `The gate would let ${p.version} through.`
          : `Publishing ${p.version} is blocked, because:`}
      </p>
      {!p.policy_passes && p.reasons.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-10 text-sm">
          {p.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {stateNote && <p className="text-sm text-muted-foreground">{stateNote}</p>}
    </div>
  );
}

function SecurityIssues({ issues }: { issues: SkillSecurityIssue[] }) {
  const sorted = [...issues].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.path.localeCompare(b.path),
  );
  return (
    <ul aria-label="Security findings" className="divide-y divide-border/60">
      {sorted.map((i) => (
        <li
          key={`${i.path}:${i.rule_id ?? i.message}`}
          className="flex flex-wrap items-baseline gap-x-2 py-1.5 text-sm"
        >
          <span
            className={cn(
              'rounded-full px-1.5 py-0.5 font-mono text-xs font-medium',
              i.severity === 'critical' || i.severity === 'high'
                ? 'bg-state-failed/15 text-state-failed'
                : i.severity === 'medium'
                  ? 'bg-state-blocked/15 text-state-blocked'
                  : 'bg-muted text-muted-foreground',
            )}
          >
            {i.severity}
          </span>
          <span className="font-mono text-xs">{i.path}</span>
          <span className="min-w-0 break-words">{i.message}</span>
          {i.rule_id && (
            <span className="font-mono text-xs text-muted-foreground">{i.rule_id}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
