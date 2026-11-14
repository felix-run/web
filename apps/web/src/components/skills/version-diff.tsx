import { Skeleton } from '@felix/ui/skeleton';
import { ErrorNotice } from '@/components/error-notice';
import { BundleChanges } from './bundle-changes';
import { DiffView } from './diff-view';
import { useSkillFile } from './queries';

/**
 * Two stored versions' SKILL.md as a diff — the one view a reviewer needs
 * before deciding a draft. `before` may be null (nothing is live yet), and the
 * diff is then against an empty file, labelled as such rather than as a version.
 *
 * SKILL.md as a diff, because it is what a draft is mostly about, and every
 * other file that differs listed beneath it by digest — a reviewer approving
 * the SKILL.md alone would be approving a changed script they never saw.
 */
export function VersionDiff({
  name,
  before,
  after,
  afterLabel,
}: {
  name: string;
  before: string | null;
  after: string;
  afterLabel?: string;
}) {
  const left = useSkillFile(name, before);
  const right = useSkillFile(name, after);
  const error = left.error ?? right.error;
  if (error) return <ErrorNotice error={error} doing={`read ${name}'s SKILL.md to compare`} />;
  if ((before && left.isPending) || right.isPending) {
    return <Skeleton className="h-24 w-full rounded-lg" aria-label="Loading the comparison" />;
  }
  return (
    <div className="space-y-2">
      <DiffView
        before={before ? (left.data?.content ?? '') : ''}
        after={right.data?.content ?? ''}
        beforeLabel={before ?? 'nothing live'}
        afterLabel={afterLabel ?? after}
      />
      <BundleChanges name={name} before={before} after={after} skipSkillMd />
    </div>
  );
}
