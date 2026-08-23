import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearMount,
  getMountLabel,
  hasMount,
  mountList,
  mountMkdir,
  mountRead,
  mountTree,
  mountWrite,
  pickDirectory,
  readExisting,
  supportsDirectoryPicker,
} from '../src/fs-mount';

/**
 * The mount is a real folder on the user's disk, reached through the File
 * System Access API, and the paths come from tool calls the model chooses.
 * Containment here is the difference between "the agent edited a file in the
 * project you picked" and "the agent read your SSH key".
 *
 * The mock below enforces the same name rules the real API does — it rejects
 * '.', '..', and any name containing a separator — so these tests show both
 * that our own check fires and that the platform would refuse anyway if it did
 * not. Defense in depth, asserted rather than assumed.
 */

class MockFileHandle {
  readonly kind = 'file';
  constructor(
    readonly name: string,
    public content = '',
  ) {}

  async getFile() {
    const content = this.content;
    return { text: async () => content };
  }

  async createWritable() {
    return {
      write: async (data: string) => {
        this.content = data;
      },
      close: async () => {},
    };
  }
}

class MockDirHandle {
  readonly kind = 'directory';
  readonly children = new Map<string, MockDirHandle | MockFileHandle>();
  constructor(readonly name: string) {}

  /** Mirrors the platform's own validation. */
  private check(name: string): void {
    if (name === '' || name === '.' || name === '..' || /[/\\]/.test(name)) {
      throw new TypeError(`Name is not allowed: ${JSON.stringify(name)}`);
    }
  }

  async getDirectoryHandle(name: string, opts: { create?: boolean } = {}) {
    this.check(name);
    const existing = this.children.get(name);
    if (existing) {
      if (existing.kind !== 'directory') throw new TypeError('not a directory');
      return existing;
    }
    if (!opts.create) throw new Error(`NotFoundError: ${name}`);
    const dir = new MockDirHandle(name);
    this.children.set(name, dir);
    return dir;
  }

  async getFileHandle(name: string, opts: { create?: boolean } = {}) {
    this.check(name);
    const existing = this.children.get(name);
    if (existing) {
      if (existing.kind !== 'file') throw new TypeError('not a file');
      return existing;
    }
    if (!opts.create) throw new Error(`NotFoundError: ${name}`);
    const file = new MockFileHandle(name);
    this.children.set(name, file);
    return file;
  }

  async *entries(): AsyncGenerator<[string, MockDirHandle | MockFileHandle]> {
    for (const entry of [...this.children.entries()]) yield entry;
  }
}

let root: MockDirHandle;

beforeEach(async () => {
  root = new MockDirHandle('project');
  // pickDirectory() is the only way to set the module's root handle.
  (globalThis as { window?: unknown }).window = {
    showDirectoryPicker: async () => root,
  };
  await pickDirectory();
});

afterEach(() => {
  clearMount();
  (globalThis as { window?: unknown }).window = undefined;
});

describe('mount lifecycle', () => {
  it('reports the picked folder', () => {
    expect(hasMount()).toBe(true);
    expect(getMountLabel()).toBe('project');
    expect(supportsDirectoryPicker()).toBe(true);
  });

  it('forgets the folder when cleared', () => {
    clearMount();
    expect(hasMount()).toBe(false);
    expect(getMountLabel()).toBeNull();
  });

  it('refuses to read once the mount is gone', async () => {
    clearMount();
    await expect(mountRead('a.txt')).rejects.toThrow(/no folder mounted/);
  });
});

describe('path containment', () => {
  // Backslash spellings are the reason the check is shared: mountList used to
  // skip the fold, so `..\..\x` reached it as one opaque segment.
  const escapes = [
    '../outside',
    '../../outside',
    'a/../../outside',
    '..',
    '..\\outside',
    'a\\..\\..\\outside',
    'a/..\\../outside',
  ];

  for (const path of escapes) {
    it(`mountRead refuses ${JSON.stringify(path)}`, async () => {
      await expect(mountRead(path)).rejects.toThrow(/escapes mount/);
    });

    it(`mountWrite refuses ${JSON.stringify(path)}`, async () => {
      await expect(mountWrite(path, 'pwned')).rejects.toThrow(/escapes mount/);
      expect(root.children.size).toBe(0);
    });

    it(`mountMkdir refuses ${JSON.stringify(path)}`, async () => {
      await expect(mountMkdir(path)).rejects.toThrow(/escapes mount/);
    });

    it(`mountList refuses ${JSON.stringify(path)}`, async () => {
      await expect(mountList(path)).rejects.toThrow(/escapes mount/);
    });
  }

  // Stricter than the VFS on purpose. VirtualFs.normalize() pops '..' and only
  // rejects a net escape, because it is a map in memory. The mount is a real
  // folder, so any '..' at all is refused rather than resolved — there is no
  // upside to letting a model-chosen path walk around inside it.
  it('refuses even a .. that would resolve inside the mount', async () => {
    await expect(mountWrite('a/b/../c.txt', 'x')).rejects.toThrow(/escapes mount/);
  });

  it('treats a leading slash as mount-relative rather than absolute', async () => {
    await mountWrite('/notes.txt', 'contained');
    expect(await mountRead('notes.txt')).toBe('contained');
  });

  it('ignores . segments', async () => {
    await mountWrite('./a/./b.txt', 'ok');
    expect(await mountRead('a/b.txt')).toBe('ok');
  });

  it('treats dot-prefixed names as ordinary names', async () => {
    await mountWrite('..foo', 'ok');
    expect(await mountRead('..foo')).toBe('ok');
  });
});

describe('reading and writing', () => {
  it('creates parent directories on write', async () => {
    await mountWrite('deep/nested/file.txt', 'hello');
    expect(await mountRead('deep/nested/file.txt')).toBe('hello');
  });

  it('overwrites by default and appends when asked', async () => {
    await mountWrite('f.txt', 'one');
    await mountWrite('f.txt', '-two', true);
    expect(await mountRead('f.txt')).toBe('one-two');
    await mountWrite('f.txt', 'replaced');
    expect(await mountRead('f.txt')).toBe('replaced');
  });

  it('appending to a missing file creates it', async () => {
    await mountWrite('new.txt', 'content', true);
    expect(await mountRead('new.txt')).toBe('content');
  });

  it('refuses to read a file that is not there', async () => {
    await expect(mountRead('missing.txt')).rejects.toThrow();
  });

  it('rejects an empty path as a file target', async () => {
    await expect(mountRead('')).rejects.toThrow(/not a file/);
  });
});

describe('listing and walking', () => {
  beforeEach(async () => {
    await mountWrite('top.txt', 'x');
    await mountWrite('dir/one.txt', 'x');
    await mountWrite('dir/sub/two.txt', 'x');
  });

  it('lists the root', async () => {
    expect(await mountList()).toEqual([
      { path: 'dir', type: 'dir' },
      { path: 'top.txt', type: 'file' },
    ]);
  });

  it('lists a subdirectory with mount-relative paths', async () => {
    expect(await mountList('dir')).toEqual([
      { path: 'dir/one.txt', type: 'file' },
      { path: 'dir/sub', type: 'dir' },
    ]);
  });

  it('normalizes the listed path the same way it resolves it', async () => {
    expect(await mountList('./dir')).toEqual(await mountList('dir'));
    expect(await mountList('dir\\sub')).toEqual(await mountList('dir/sub'));
  });

  it('walks the whole tree', async () => {
    expect(await mountTree()).toEqual([
      'f top.txt',
      'd dir',
      'f dir/one.txt',
      'd dir/sub',
      'f dir/sub/two.txt',
    ]);
  });

  it('caps the walk at the limit', async () => {
    expect((await mountTree(2)).length).toBeLessThanOrEqual(2);
  });

  it('returns nothing when no folder is mounted', async () => {
    clearMount();
    expect(await mountTree()).toEqual([]);
  });
});

describe('readExisting', () => {
  const vfs = {
    read: (p: string) => {
      if (p === 'from-vfs.txt') return 'vfs content';
      throw new Error('not a file');
    },
  };

  it('prefers the mount when one is set', async () => {
    await mountWrite('shared.txt', 'mount content');
    expect(await readExisting('shared.txt', vfs)).toBe('mount content');
  });

  it('strips a leading slash before looking up', async () => {
    await mountWrite('rooted.txt', 'mount content');
    expect(await readExisting('/rooted.txt', vfs)).toBe('mount content');
  });

  it('falls back to the VFS with no mount', async () => {
    clearMount();
    expect(await readExisting('from-vfs.txt', vfs)).toBe('vfs content');
  });

  it('returns null rather than throwing when the file is missing', async () => {
    expect(await readExisting('nowhere.txt', vfs)).toBeNull();
  });

  it('returns null rather than leaking an escape attempt to the caller', async () => {
    expect(await readExisting('../outside', vfs)).toBeNull();
  });
});
