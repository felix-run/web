/**
 * A local record of manifest versions this browser has actually seen.
 *
 * The harness exposes no version-list route: `GET /manifests` returns active
 * pointers only, and a version is acted on by number. The manifest sheet responded
 * to that by asking the operator to type the number, so re-pointing production
 * traffic was an act of recall — and the field would happily accept v9999.
 *
 * This does not invent the missing route. It records the versions that pass through
 * the client anyway: every version created here, and the active and canary numbers
 * reported by each poll. That is enough to turn the common cases (roll back to the
 * one before, resume a canary) into something you can click.
 *
 * It is deliberately presented as "seen from this browser" rather than as history,
 * because it is not history: a version created from another tab, another machine, or
 * the API directly will not be here. An incomplete list offered honestly is useful;
 * the same list offered as the truth would be worse than none.
 */

const KEY = 'felix.manifestVersions';

export interface KnownVersion {
  version: number;
  /** Comment supplied when this client created it, when it was this client. */
  comment?: string;
  /** When this client first saw the version, ms. */
  seenAt: number;
  /** How it came to be known — a version we wrote, or one a pointer reported. */
  via: 'created' | 'observed';
}

type Store = Record<string, KnownVersion[]>;

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    // A corrupt blob should cost the version chips, not the sheet.
    return {};
  }
}

function write(store: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // Quota or a private-mode rejection. The sheet still works without chips.
  }
}

/** Versions known for one manifest, newest number first. */
export function knownVersions(name: string): KnownVersion[] {
  return [...(read()[name] ?? [])].sort((a, b) => b.version - a.version);
}

/**
 * Record a version, keeping the richer entry when one already exists — a version
 * first seen as a bare pointer number and later created here should keep the comment.
 */
export function recordVersion(
  name: string,
  entry: { version: number; comment?: string; via: KnownVersion['via'] },
  now: number = Date.now(),
): void {
  if (!Number.isInteger(entry.version) || entry.version <= 0) return;
  const store = read();
  const list = store[name] ?? [];
  const existing = list.find((v) => v.version === entry.version);
  if (existing) {
    if (entry.via === 'created') {
      existing.via = 'created';
      if (entry.comment) existing.comment = entry.comment;
    }
  } else {
    list.push({ version: entry.version, comment: entry.comment, seenAt: now, via: entry.via });
  }
  store[name] = list;
  write(store);
}

/** Record whatever version numbers a pointer row reports. */
export function recordFromPointer(
  name: string,
  pointer: { version?: number | null; canary_version?: number | null },
  now: number = Date.now(),
): void {
  for (const v of [pointer.version, pointer.canary_version]) {
    if (typeof v === 'number') recordVersion(name, { version: v, via: 'observed' }, now);
  }
}

/** Test seam. */
export function clearKnownVersions(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}
