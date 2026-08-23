import { describe, expect, it } from 'vitest';
import { collectToolCallPaths } from '../src/tool-call-paths';

/**
 * A hint's whole value is carrying the directory a message never mentions, so
 * bare names are dropped and the noise tool arguments are full of — versions,
 * hostnames, URLs — has to stay out.
 */
describe('collectToolCallPaths', () => {
  it('finds the path a write named', () => {
    expect(collectToolCallPaths({ path: '/home/lars/foo.md', content: 'hi' })).toEqual([
      '/home/lars/foo.md',
    ]);
  });

  it('finds a path inside a shell command', () => {
    expect(collectToolCallPaths({ command: 'cat notes/todo.md' })).toEqual(['notes/todo.md']);
  });

  it('drops bare names — the index already knows those', () => {
    expect(collectToolCallPaths({ path: 'foo.md' })).toEqual([]);
  });

  it('drops the noise that tool arguments are full of', () => {
    expect(
      collectToolCallPaths({
        version: '1.2.3',
        host: 'example.com',
        url: 'https://example.com/app.js',
        note: 'that is done.',
      }),
    ).toEqual([]);
  });

  it('deduplicates', () => {
    expect(collectToolCallPaths({ a: 'src/api.ts', b: 'src/api.ts', c: 'see src/api.ts' })).toEqual(
      ['src/api.ts'],
    );
  });

  it('walks arrays and nested objects', () => {
    expect(collectToolCallPaths({ edits: [{ path: 'a/one.ts' }, { path: 'b/two.ts' }] })).toEqual([
      'a/one.ts',
      'b/two.ts',
    ]);
  });

  it('survives values that are not objects', () => {
    expect(collectToolCallPaths(null)).toEqual([]);
    expect(collectToolCallPaths(undefined)).toEqual([]);
    expect(collectToolCallPaths(42)).toEqual([]);
    expect(collectToolCallPaths('src/api.ts')).toEqual(['src/api.ts']);
  });

  it('stops descending rather than walking an arbitrarily deep payload', () => {
    const deep = { a: { b: { c: { d: 'very/deep.ts' } } } };
    expect(collectToolCallPaths(deep)).toEqual([]);
  });

  it('caps how many strings it reads', () => {
    const wide = Object.fromEntries(
      Array.from({ length: 200 }, (_, i) => [`k${i}`, `dir${i}/file${i}.ts`]),
    );
    expect(collectToolCallPaths(wide).length).toBeLessThanOrEqual(24);
  });
});
