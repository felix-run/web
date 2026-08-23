import { describe, expect, it } from 'vitest';
import {
  FileMentionResolver,
  matchesSuffix,
  normalizeQuery,
  type ResolverSource,
} from '../src/file-mention-resolver';

/** A workspace listing in the `d path` / `f path` shape both sources produce. */
function source(paths: string[], onWalk?: () => void): ResolverSource {
  return {
    tree: () => {
      onWalk?.();
      return paths;
    },
  };
}

const WORKSPACE = [
  'd notes',
  'f notes/todo.md',
  'd apps',
  'd apps/float',
  'd apps/float/src',
  'f apps/float/src/App.tsx',
  'f apps/chat/src/App.tsx',
  'f README.md',
];

const resolver = (paths = WORKSPACE, now?: () => number) =>
  new FileMentionResolver(source(paths), now);

describe('normalizeQuery', () => {
  it('strips prefixes that say nothing about location', () => {
    expect(normalizeQuery('./foo.ts')).toBe('foo.ts');
    expect(normalizeQuery('/foo.ts')).toBe('foo.ts');
    expect(normalizeQuery('~/foo.ts')).toBe('foo.ts');
    expect(normalizeQuery('../../src/foo.ts')).toBe('src/foo.ts');
  });
});

describe('matchesSuffix', () => {
  it('matches on a segment boundary', () => {
    expect(matchesSuffix('/a/webapp/src/main.ts', 'webapp/src/main.ts')).toBe(true);
    expect(matchesSuffix('webapp/src/main.ts', 'webapp/src/main.ts')).toBe(true);
  });

  // Without the boundary check this is the bug: a longer word ending in the
  // query would match.
  it('does not match mid-segment', () => {
    expect(matchesSuffix('/a/xwebapp/src/main.ts', 'webapp/src/main.ts')).toBe(false);
  });
});

describe('resolving', () => {
  it('confirms a file that exists', async () => {
    const [r] = await resolver().resolveAll(['notes/todo.md']);
    expect(r?.matches).toEqual(['notes/todo.md']);
  });

  it('reports nothing for a file that does not', async () => {
    const [r] = await resolver().resolveAll(['nope.md']);
    expect(r?.matches).toEqual([]);
  });

  it('resolves a bare name to its full path', async () => {
    const [r] = await resolver().resolveAll(['todo.md']);
    expect(r?.matches).toEqual(['notes/todo.md']);
  });

  it('never guesses when a name is ambiguous', async () => {
    const [r] = await resolver().resolveAll(['App.tsx']);
    expect(r?.matches).toEqual(['apps/chat/src/App.tsx', 'apps/float/src/App.tsx']);
  });

  it('narrows an ambiguous name when a directory is given', async () => {
    const [r] = await resolver().resolveAll(['float/src/App.tsx']);
    expect(r?.matches).toEqual(['apps/float/src/App.tsx']);
  });

  it('ignores directories — they are not openable', async () => {
    const [r] = await resolver().resolveAll(['notes']);
    expect(r?.matches).toEqual([]);
  });

  // Normalization is lossy, so results must come back positionally.
  it('returns results by position, not keyed by the normalized query', async () => {
    const results = await resolver().resolveAll(['./README.md', 'README.md', 'nope.md']);
    expect(results.map((r) => r.query)).toEqual(['./README.md', 'README.md', 'nope.md']);
    expect(results[0]?.matches).toEqual(['README.md']);
    expect(results[1]?.matches).toEqual(['README.md']);
    expect(results[2]?.matches).toEqual([]);
  });

  it('prefers shallower paths', async () => {
    const [r] = await resolver(['f deep/nested/dir/thing.md', 'f thing.md']).resolveAll([
      'thing.md',
    ]);
    expect(r?.matches[0]).toBe('thing.md');
  });
});

describe('hints from the turn', () => {
  // A bare name in prose should resolve to what the agent just wrote, even
  // when that file is outside the indexed workspace.
  it('resolves a bare name to a path the turn already touched', async () => {
    const [r] = await resolver().resolveAll(['foo.md'], ['/home/lars/foo.md']);
    expect(r?.matches).toEqual(['/home/lars/foo.md']);
  });

  it('does not let an unrelated hint match', async () => {
    const [r] = await resolver().resolveAll(['bar.md'], ['/home/lars/foo.md']);
    expect(r?.matches).toEqual([]);
  });
});

describe('the index', () => {
  it('walks once for many queries', async () => {
    let walks = 0;
    const r = new FileMentionResolver(source(WORKSPACE, () => walks++));
    await r.resolveAll(['todo.md', 'README.md', 'App.tsx']);
    expect(walks).toBe(1);
  });

  it('does not walk at all when there is nothing to ask', async () => {
    let walks = 0;
    const r = new FileMentionResolver(source(WORKSPACE, () => walks++));
    expect(await r.resolveAll([])).toEqual([]);
    expect(walks).toBe(0);
  });

  it('reuses the index within its TTL', async () => {
    let walks = 0;
    let clock = 1_000;
    const r = new FileMentionResolver(
      source(WORKSPACE, () => walks++),
      () => clock,
    );
    await r.resolveAll(['todo.md']);
    clock += 1_000;
    await r.resolveAll(['todo.md']);
    expect(walks).toBe(1);
  });

  // A file the agent just wrote must become clickable while you are still
  // reading the message that named it.
  it('rebuilds once the TTL lapses', async () => {
    let walks = 0;
    let clock = 1_000;
    const r = new FileMentionResolver(
      source(WORKSPACE, () => walks++),
      () => clock,
    );
    await r.resolveAll(['todo.md']);
    clock += 60_000;
    await r.resolveAll(['todo.md']);
    expect(walks).toBe(2);
  });

  it('rebuilds when explicitly invalidated', async () => {
    let walks = 0;
    const r = new FileMentionResolver(source(WORKSPACE, () => walks++));
    await r.resolveAll(['todo.md']);
    r.invalidate();
    await r.resolveAll(['todo.md']);
    expect(walks).toBe(2);
  });
});

describe('hints beat the index', () => {
  const WITH_DUPES = ['f a/foo.md', 'f b/foo.md'];

  // The agent just wrote /home/lars/foo.md; prose says "foo.md". The index has
  // two other files by that name and cannot know which was meant.
  it('offers the just-written path first', async () => {
    const r = new FileMentionResolver(source(WITH_DUPES));
    const [res] = await r.resolveAll(['foo.md'], ['/home/lars/foo.md']);
    expect(res?.matches).toContain('/home/lars/foo.md');
    expect(res?.matches[0]).toBe('/home/lars/foo.md');
  });

  it('still reports the other candidates', async () => {
    const r = new FileMentionResolver(source(WITH_DUPES));
    const [res] = await r.resolveAll(['foo.md'], ['/home/lars/foo.md']);
    expect(res?.matches).toEqual(
      expect.arrayContaining(['/home/lars/foo.md', 'a/foo.md', 'b/foo.md']),
    );
  });

  it('does not invent a match from an unrelated hint', async () => {
    const r = new FileMentionResolver(source([]));
    const [res] = await r.resolveAll(['foo.md'], ['/home/lars/bar.md']);
    expect(res?.matches).toEqual([]);
  });
});
