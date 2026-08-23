/**
 * Deciding which candidate file names are real.
 *
 * The second half of the mention feature. `file-mentions.ts` proposes; this
 * confirms. Nothing is decorated until this says a path exists, so the
 * transcript never shows a link that leads nowhere — the cost being that links
 * appear a beat after the text, which beats both dead links and a blocking read
 * on every render.
 *
 * ## Why an index rather than a lookup per mention
 *
 * Most mentions are bare names (`todo.md`) that could live anywhere, so the
 * question is really "is there a file called this?". Answering it per mention
 * would walk the tree per mention. Instead one bounded walk builds a
 * basename → paths map, and every mention in the message is answered from it.
 *
 * The index is cached for a few seconds, not for the session: a file the agent
 * has just written should be clickable while you are still reading the message
 * that named it.
 */

import { hasMount, mountTree } from './fs-mount';
import type { VirtualFs } from './vfs';

/** How long a built index stays usable. */
export const INDEX_TTL_MS = 5_000;

/** Ceiling on the walk, so a large mount cannot stall the transcript. */
export const INDEX_MAX_ENTRIES = 2_000;

export interface MentionMatch {
  /** The query as asked. */
  query: string;
  /** Every path it could mean, best first. Empty means "not a file". */
  matches: string[];
}

export interface ResolverSource {
  /** `d path` / `f path` lines, the shape both the mount and the VFS produce. */
  tree(limit: number): Promise<string[]> | string[];
}

/** The live workspace: the mounted folder when there is one, else the tab VFS. */
export function workspaceSource(vfs: VirtualFs): ResolverSource {
  return {
    tree: (limit) => (hasMount() ? mountTree(limit) : vfs.tree(limit)),
  };
}

interface Index {
  builtAt: number;
  /** basename -> full paths carrying it. */
  byName: Map<string, string[]>;
  /** Every file path, for suffix matching. */
  files: string[];
}

/**
 * Shallower paths win, then alphabetical. A name that resolves several ways is
 * never guessed at — callers get the whole list — but the head of it is what a
 * single-target UI will use, so the order is part of the contract.
 */
function byPreference(a: string, b: string): number {
  const depth = a.split('/').length - b.split('/').length;
  return depth !== 0 ? depth : a.localeCompare(b);
}

/**
 * Strip the parts of a written path that carry no information about where the
 * file is: `./`, a leading `/`, and any number of `../`. What is left is matched
 * as a suffix.
 */
export function normalizeQuery(query: string): string {
  let out = query.trim();
  out = out.replace(/^~\//, '');
  while (out.startsWith('../')) out = out.slice(3);
  out = out.replace(/^\.\//, '').replace(/^\/+/, '');
  return out;
}

/**
 * Does `path` end with `query` on a segment boundary?
 *
 * The boundary check is the whole point: without it `webapp/src/main.ts` would
 * match `/other/xwebapp/src/main.ts`.
 */
export function matchesSuffix(path: string, query: string): boolean {
  if (path === query) return true;
  return path.endsWith(`/${query}`);
}

export class FileMentionResolver {
  #source: ResolverSource;
  #index: Index | null = null;
  #now: () => number;

  constructor(source: ResolverSource, now: () => number = Date.now) {
    this.#source = source;
    this.#now = now;
  }

  /** Drop the cached index, e.g. after a tool wrote something. */
  invalidate(): void {
    this.#index = null;
  }

  async #ensureIndex(): Promise<Index> {
    const current = this.#index;
    if (current && this.#now() - current.builtAt < INDEX_TTL_MS) return current;

    const lines = await this.#source.tree(INDEX_MAX_ENTRIES);
    const byName = new Map<string, string[]>();
    const files: string[] = [];
    for (const line of lines) {
      // `f path` is a file; `d path` is a directory and cannot be opened.
      if (!line.startsWith('f ')) continue;
      const path = line.slice(2);
      if (!path) continue;
      files.push(path);
      const name = path.slice(path.lastIndexOf('/') + 1);
      const bucket = byName.get(name);
      if (bucket) bucket.push(path);
      else byName.set(name, [path]);
    }
    const built: Index = { builtAt: this.#now(), byName, files };
    this.#index = built;
    return built;
  }

  /**
   * Resolve every query in one pass.
   *
   * Results come back **positionally**, not keyed by query: normalization is
   * lossy (`./foo.ts` and `foo.ts` both become `foo.ts`), so a caller keying off
   * the returned string would lose every mention written with a relative prefix.
   *
   * `hints` are paths the turn's own tool calls already named. They are how a
   * bare `foo.md` in prose resolves to the `/home/lars/foo.md` the agent just
   * wrote, even when it sits outside the indexed workspace.
   */
  async resolveAll(queries: string[], hints: readonly string[] = []): Promise<MentionMatch[]> {
    if (queries.length === 0) return [];
    const index = await this.#ensureIndex();

    return queries.map((query) => {
      const normalized = normalizeQuery(query);
      if (!normalized) return { query, matches: [] };

      // A hint is a path the agent demonstrably just touched, so it outranks
      // anything the index happens to hold under the same name — kept in its
      // own bucket, because the depth ordering that is right for index matches
      // would otherwise bury a deep path the agent literally just wrote.
      const hinted = new Set<string>();
      for (const hint of hints) {
        if (matchesSuffix(hint, normalized)) hinted.add(hint);
      }

      const indexed = new Set<string>();
      const exact = index.byName.get(normalized);
      if (exact) for (const p of exact) indexed.add(p);
      if (normalized.includes('/')) {
        for (const p of index.files) {
          if (matchesSuffix(p, normalized)) indexed.add(p);
        }
      }
      for (const p of hinted) indexed.delete(p);

      return {
        query,
        matches: [...[...hinted].sort(byPreference), ...[...indexed].sort(byPreference)],
      };
    });
  }
}
