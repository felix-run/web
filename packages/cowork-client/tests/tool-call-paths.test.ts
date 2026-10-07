import { describe, expect, it } from 'vitest';
import { collectToolCallPaths, collectTouchedPaths } from '../src/tool-call-paths';

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

/**
 * "Touched" is what a workspace tool's path argument named — never a path that
 * happens to appear in some other argument's text. The case that motivated it:
 * a pull request's body listing the files it changed, which the walker above
 * reported as files the agent had touched.
 */
describe('collectTouchedPaths', () => {
  it('ignores paths written into the text of a tool that touches no files', () => {
    const body = 'Changes:\n- ./scripts/test.sh\n- tests/unit/test_audit_deny_control.py\n';
    expect(
      collectTouchedPaths('github__create_pull_request', {
        title: 'Deny control',
        head: 'fix/deny',
        body,
      }),
    ).toEqual([]);
  });

  it('takes the path of a local_* file tool the client ran', () => {
    expect(
      collectTouchedPaths('client · local_write', { path: 'notes/a.md', content: '' }),
    ).toEqual(['notes/a.md']);
    expect(collectTouchedPaths('local_edit', { path: 'src/x.ts' })).toEqual(['src/x.ts']);
  });

  it("does not take a remote tool's own path argument for a workspace path", () => {
    expect(
      collectTouchedPaths('github__create_or_update_file', { path: 'src/remote.ts', content: '' }),
    ).toEqual([]);
  });

  it("takes a workspace tool's path verbatim, bare names included", () => {
    expect(collectTouchedPaths('write_file', { path: 'notes.txt', content: 'see a/b.md' })).toEqual(
      ['notes.txt'],
    );
    expect(
      collectTouchedPaths('edit_file', { path: ' src/api.ts ', old_string: 'x/y.ts' }),
    ).toEqual(['src/api.ts']);
  });

  it('never reads a search query or a shell command as a path', () => {
    expect(collectTouchedPaths('search_files', { query: 'lib/foo.ts', path: 'src' })).toEqual([
      'src',
    ]);
    expect(collectTouchedPaths('local_shell', { command: 'cat notes/todo.md' })).toEqual([]);
    expect(collectTouchedPaths('client · local_shell', { command: 'ls', cwd: 'notes' })).toEqual([
      'notes',
    ]);
  });

  it('skips the workspace root and URLs', () => {
    expect(collectTouchedPaths('list_dir', { path: '.' })).toEqual([]);
    expect(collectTouchedPaths('local_open', { target: 'https://example.com/a/b.md' })).toEqual([]);
    expect(collectTouchedPaths('client · local_open', { target: 'docs/readme.md' })).toEqual([
      'docs/readme.md',
    ]);
  });

  it('survives arguments that are not an object', () => {
    expect(collectTouchedPaths('write_file', null)).toEqual([]);
    expect(collectTouchedPaths('write_file', 'Write notes.txt (4 chars)')).toEqual([]);
    expect(collectTouchedPaths('write_file', ['a/b.md'])).toEqual([]);
  });
});
