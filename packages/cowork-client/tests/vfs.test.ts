import { beforeEach, describe, expect, it } from 'vitest';
import { getVfs, VirtualFs } from '../src/vfs';

/**
 * The VFS is the surface the *model* drives: `tool_request` frames arrive with
 * model-chosen paths, and a prompt-injected model chooses them adversarially.
 * Path containment is therefore a security property, not a nicety.
 */

let n = 0;
const freshKey = () => `test.vfs.${Date.now()}.${n++}`;
let vfs: VirtualFs;

beforeEach(() => {
  localStorage.clear();
  vfs = new VirtualFs(freshKey());
});

describe('path containment', () => {
  const escapes = [
    '../secret',
    '../../secret',
    'a/../../secret',
    './../secret',
    '..',
    'a/b/../../../secret',
    '..\\secret', // backslashes are normalized to / before the check
    'a\\..\\..\\secret',
    'a/..\\../secret', // mixed separators
  ];

  for (const path of escapes) {
    it(`refuses to write above the root: ${JSON.stringify(path)}`, () => {
      expect(() => vfs.write(path, 'pwned')).toThrow(/escapes vfs root/);
    });

    it(`refuses to read above the root: ${JSON.stringify(path)}`, () => {
      expect(() => vfs.read(path)).toThrow(/escapes vfs root/);
    });
  }

  it('refuses mkdir above the root', () => {
    expect(() => vfs.mkdir('../evil')).toThrow(/escapes vfs root/);
  });

  it('refuses list above the root', () => {
    expect(() => vfs.list('../')).toThrow(/escapes vfs root/);
  });

  it('allows traversal that stays inside the root', () => {
    vfs.write('a/b/../c', 'ok');
    expect(vfs.read('a/c')).toBe('ok');
  });

  it('clamps an absolute path to the root instead of escaping it', () => {
    vfs.write('/etc/passwd', 'contained');
    expect(vfs.read('etc/passwd')).toBe('contained');
    expect(vfs.tree()).toContain('f etc/passwd');
  });

  it('ignores . segments', () => {
    vfs.write('./a/./b', 'ok');
    expect(vfs.read('a/b')).toBe('ok');
  });

  // Names that merely begin with dots are ordinary names. Treating them as
  // traversal would be a false positive; treating '..' as a name would be a hole.
  for (const name of ['..foo', '...', '....', '.hidden', 'a..b']) {
    it(`treats ${JSON.stringify(name)} as a plain name, not traversal`, () => {
      vfs.write(name, 'ok');
      expect(vfs.read(name)).toBe('ok');
    });
  }

  // Nothing decodes these, so they can only ever be literal names — which is
  // exactly why they cannot escape.
  for (const name of ['%2e%2e/x', '..%2fx', '．．/x']) {
    it(`does not decode ${JSON.stringify(name)} into traversal`, () => {
      expect(() => vfs.write(name, 'ok')).not.toThrow();
      expect(vfs.read(name)).toBe('ok');
    });
  }
});

describe('filesystem semantics', () => {
  it('creates implicit parent directories on write', () => {
    vfs.write('a/b/c.txt', 'hi');
    expect(vfs.list('a')).toEqual([{ path: 'a/b', type: 'dir' }]);
    expect(vfs.list('a/b')).toEqual([{ path: 'a/b/c.txt', type: 'file' }]);
  });

  it('refuses to write through a file as if it were a directory', () => {
    vfs.write('a', 'i am a file');
    expect(() => vfs.write('a/b', 'nope')).toThrow(/not a directory/);
  });

  it('refuses to mkdir over an existing file', () => {
    vfs.write('a', 'file');
    expect(() => vfs.mkdir('a')).toThrow(/file exists/);
  });

  it('refuses to read a directory as a file', () => {
    vfs.mkdir('d');
    expect(() => vfs.read('d')).toThrow(/not a file/);
  });

  it('refuses to read a file that does not exist', () => {
    expect(() => vfs.read('nope.txt')).toThrow(/not a file/);
  });

  it('appends only when asked, and overwrites otherwise', () => {
    vfs.write('f', 'one');
    vfs.write('f', '-two', true);
    expect(vfs.read('f')).toBe('one-two');
    vfs.write('f', 'replaced');
    expect(vfs.read('f')).toBe('replaced');
  });

  it('appending to a missing file creates it', () => {
    vfs.write('new', 'content', true);
    expect(vfs.read('new')).toBe('content');
  });

  it('lists only the top level at the root', () => {
    vfs.write('top.txt', 'x');
    vfs.write('dir/nested.txt', 'x');
    vfs.write('dir/deeper/leaf.txt', 'x');
    expect(vfs.list()).toEqual([
      { path: 'dir', type: 'dir' },
      { path: 'top.txt', type: 'file' },
    ]);
  });

  it('caps tree output at the limit', () => {
    for (let i = 0; i < 10; i++) vfs.write(`f${i}`, 'x');
    expect(vfs.tree(4)).toHaveLength(4);
    expect(vfs.tree()).toHaveLength(10);
  });

  it('reset empties the filesystem', () => {
    vfs.write('a/b', 'x');
    vfs.reset();
    expect(vfs.tree()).toEqual([]);
    expect(vfs.list()).toEqual([]);
  });
});

describe('persistence', () => {
  it('survives a reload under the same storage key', () => {
    const key = freshKey();
    new VirtualFs(key).write('kept.txt', 'value');
    expect(new VirtualFs(key).read('kept.txt')).toBe('value');
  });

  it('keeps separate storage keys isolated', () => {
    const a = new VirtualFs(freshKey());
    const b = new VirtualFs(freshKey());
    a.write('only-in-a', 'x');
    expect(() => b.read('only-in-a')).toThrow(/not a file/);
  });

  it('recovers from corrupt stored data instead of throwing at construction', () => {
    const key = freshKey();
    localStorage.setItem(key, 'not json {{{');
    const recovered = new VirtualFs(key);
    expect(recovered.tree()).toEqual([]);
    recovered.write('fresh', 'x');
    expect(recovered.read('fresh')).toBe('x');
  });
});

describe('getVfs', () => {
  it('returns one shared instance per storage key', () => {
    const key = freshKey();
    expect(getVfs(key)).toBe(getVfs(key));
    expect(getVfs(freshKey())).not.toBe(getVfs(freshKey()));
  });

  it('shares state through the cached instance', () => {
    const key = freshKey();
    getVfs(key).write('shared', 'x');
    expect(getVfs(key).read('shared')).toBe('x');
  });
});
