/**
 * `major.minor.patch` bumping and comparison, as `felix/skills/semver.py` does
 * it. Deliberately lenient — a non-numeric segment counts as 0 and a prerelease
 * or build suffix is ignored — because versions are regex-gated upstream.
 */

export type SemverBump = 'major' | 'minor' | 'patch';

function parts(version: string): [number, number, number] {
  const p = version.split('.').map((n) => Number.parseInt(n.trim() || '0', 10) || 0);
  return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0];
}

export function bumpSemver(version: string, bump: SemverBump = 'patch'): string {
  const [major, minor, patch] = parts(version);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** -1, 0 or 1 as `a` is older, equal or newer, ignoring any prerelease/build suffix. */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = parts(a.split('+')[0]?.split('-')[0] ?? '');
  const pb = parts(b.split('+')[0]?.split('-')[0] ?? '');
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/** An explicit version wins; else bump `current`; else the first version, 0.1.0. */
export function resolveNextSemver(
  current: string | null | undefined,
  options: { semver?: string; bump?: SemverBump },
): string {
  if (options.semver) return options.semver;
  if (current) return bumpSemver(current, options.bump ?? 'patch');
  return '0.1.0';
}
