import type { SkillFileMeta } from '@felix/client';

export type FileChangeKind = 'added' | 'removed' | 'changed';

export interface FileChange {
  path: string;
  kind: FileChangeKind;
}

/**
 * Which files differ between two stored versions, by the digests the harness
 * recorded for each — not by content, which the read side secret-redacts, so
 * two different secrets would read as the same `[REDACTED]`.
 *
 * SKILL.md first, then the rest by path, so the file a reviewer reads first is
 * the one listed first.
 */
export function compareBundles(before: SkillFileMeta[], after: SkillFileMeta[]): FileChange[] {
  const old = new Map(before.map((f) => [f.path, f.sha256]));
  const now = new Map(after.map((f) => [f.path, f.sha256]));
  const changes: FileChange[] = [];
  for (const [path, sha] of now) {
    if (!old.has(path)) changes.push({ path, kind: 'added' });
    else if (old.get(path) !== sha) changes.push({ path, kind: 'changed' });
  }
  for (const path of old.keys()) if (!now.has(path)) changes.push({ path, kind: 'removed' });
  return changes.sort(
    (a, b) =>
      Number(b.path === 'SKILL.md') - Number(a.path === 'SKILL.md') || a.path.localeCompare(b.path),
  );
}
