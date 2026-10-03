import { Skeleton } from '@felix/ui/skeleton';
import { ErrorNotice } from '@/components/error-notice';
import { DiffView } from './diff-view';
import { useSkillFile } from './queries';

/**
 * Two stored versions' SKILL.md as a diff — the one view a reviewer needs
 * before deciding a draft. `before` may be null (nothing is live yet), and the
 * diff is then against an empty file, labelled as such rather than as a version.
 *
 * Only SKILL.md: a draft an agent saved through `update_skill` changes the body
 * and keeps the rest of the parent's files, so SKILL.md is where it differs.
 * The Files tab browses everything else.
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
    <DiffView
      before={before ? (left.data?.content ?? '') : ''}
      after={right.data?.content ?? ''}
      beforeLabel={before ?? 'nothing live'}
      afterLabel={afterLabel ?? after}
    />
  );
}
