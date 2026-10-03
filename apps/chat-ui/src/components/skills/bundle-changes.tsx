import { isBinaryAssetPath } from '@felix/skill-format';
import { Skeleton } from '@felix/ui/skeleton';
import { useMemo, useState } from 'react';
import { ErrorNotice } from '@/components/error-notice';
import { compareBundles, type FileChange } from './bundle-compare';
import { DiffView } from './diff-view';
import { useSkillFile, useSkillVersion } from './queries';

const WORD = { added: 'added', removed: 'removed', changed: 'changed' } as const;

/**
 * Every file that differs between two stored versions, by digest — the half
 * of a review a SKILL.md diff cannot show. An `update_skill` keeps its parent's
 * other files, but a draft saved from the editor, or one edited from an older
 * version than the live one, can differ anywhere, and a script that changed is
 * exactly what a reviewer must not miss.
 *
 * `before` null means nothing is live: every file is listed as added. Text
 * files open a diff on request; a binary asset says it changed and no more.
 */
export function BundleChanges({
  name,
  before,
  after,
  skipSkillMd = false,
}: {
  name: string;
  before: string | null;
  after: string;
  /** For a host that already draws SKILL.md's diff. */
  skipSkillMd?: boolean;
}) {
  const left = useSkillVersion(name, before);
  const right = useSkillVersion(name, after);
  const changes = useMemo(() => {
    if (!right.data || (before && !left.data)) return null;
    const all = compareBundles(left.data?.files ?? [], right.data.files);
    return skipSkillMd ? all.filter((c) => c.path !== 'SKILL.md') : all;
  }, [left.data, right.data, before, skipSkillMd]);

  const error = left.error ?? right.error;
  if (error) return <ErrorNotice error={error} doing={`compare ${name}'s files`} />;
  if (changes === null) return <Skeleton className="h-8 w-full rounded-md" />;
  if (changes.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {skipSkillMd ? 'No other file differs.' : 'No file differs.'}
      </p>
    );
  }
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">
        {skipSkillMd ? 'Other files' : 'Files'} that differ from{' '}
        <span className="font-mono">{before ?? 'nothing live'}</span>:
      </p>
      <ul aria-label={`Files that differ in ${after}`} className="divide-y divide-border/60">
        {changes.map((c) => (
          <ChangeRow key={c.path} name={name} change={c} before={before} after={after} />
        ))}
      </ul>
    </div>
  );
}

function ChangeRow({
  name,
  change,
  before,
  after,
}: {
  name: string;
  change: FileChange;
  before: string | null;
  after: string;
}) {
  const [open, setOpen] = useState(false);
  const binary = isBinaryAssetPath(change.path);
  return (
    <li className="py-1.5">
      <div className="flex flex-wrap items-center gap-x-2 text-sm">
        <span className="font-mono">{change.path}</span>
        <span
          className={
            change.kind === 'changed' ? 'text-xs text-muted-foreground' : 'text-xs font-medium'
          }
        >
          {WORD[change.kind]}
        </span>
        {binary ? (
          <span className="text-xs text-muted-foreground">(binary: not diffed)</span>
        ) : (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="ml-auto rounded-sm text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {open ? 'Hide diff' : 'Show diff'}
          </button>
        )}
      </div>
      {open && !binary && (
        <FileDiff name={name} path={change.path} change={change} before={before} after={after} />
      )}
    </li>
  );
}

function FileDiff({
  name,
  path,
  change,
  before,
  after,
}: {
  name: string;
  path: string;
  change: FileChange;
  before: string | null;
  after: string;
}) {
  const left = useSkillFile(name, change.kind === 'added' ? null : before, path);
  const right = useSkillFile(name, change.kind === 'removed' ? null : after, path);
  const error = left.error ?? right.error;
  if (error) return <ErrorNotice error={error} doing={`read ${path} to compare`} />;
  const leftReady = change.kind === 'added' || left.data;
  const rightReady = change.kind === 'removed' || right.data;
  if (!leftReady || !rightReady) return <Skeleton className="mt-1 h-16 w-full rounded-md" />;
  return (
    <DiffView
      className="mt-1"
      maxHeight="max-h-64"
      before={left.data?.content ?? ''}
      after={right.data?.content ?? ''}
      beforeLabel={change.kind === 'added' ? 'absent' : `${before} ${path}`}
      afterLabel={change.kind === 'removed' ? 'removed' : `${after} ${path}`}
    />
  );
}
