import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredMount } from '../src/mount-store';

/**
 * What a remembered folder is worth on a fresh page load.
 *
 * A directory handle survives IndexedDB; its readwrite grant does not — that
 * lives on the document. So a stored handle is a hint, never an entitlement,
 * and each of the three states it can come back in has a wrong move that fails
 * silently:
 *
 *  - `granted`  → remount now. Prompting would waste a click nobody owes us.
 *  - `prompt`   → hand it to the UI. Calling requestPermission here throws or
 *                 resolves `denied`, because boot has no user gesture to spend.
 *  - `denied`   → forget it, rather than offering a button that cannot work.
 *
 * The store is mocked rather than driven through IndexedDB: structured clone
 * strips a class instance's prototype, so a mock handle cannot survive a real
 * round trip with its permission methods intact. Real handles are platform
 * objects and do. The store's own behaviour is covered in `mount-store.test.ts`.
 */

const store: { current: StoredMount | null } = { current: null };

vi.mock('../src/mount-store', () => ({
  saveStoredMount: async (m: StoredMount) => {
    store.current = m;
  },
  loadStoredMount: async () => store.current,
  clearStoredMount: async () => {
    store.current = null;
  },
}));

class MockFileHandle {
  readonly kind = 'file';
  constructor(
    readonly name: string,
    public content = 'contents',
  ) {}
  async getFile() {
    const content = this.content;
    return { text: async () => content };
  }
}

class MockDirHandle {
  readonly kind = 'directory';
  readonly children = new Map<string, MockDirHandle | MockFileHandle>();
  /** What the browser currently says about readwrite access. */
  permission: PermissionState = 'granted';
  /** Makes query/request throw, as a deleted folder or ejected volume does. */
  broken = false;
  requestCount = 0;

  constructor(readonly name: string) {}

  async queryPermission(): Promise<PermissionState> {
    if (this.broken) throw new DOMException('gone', 'NotFoundError');
    return this.permission;
  }

  async requestPermission(): Promise<PermissionState> {
    this.requestCount++;
    if (this.broken) throw new DOMException('gone', 'NotFoundError');
    // A real prompt resolves to whatever the user chose.
    return this.permission === 'prompt' ? 'granted' : this.permission;
  }

  async getFileHandle(name: string, opts: { create?: boolean } = {}) {
    const existing = this.children.get(name);
    if (existing && existing.kind === 'file') return existing;
    if (!opts.create) throw new Error(`NotFoundError: ${name}`);
    const file = new MockFileHandle(name);
    this.children.set(name, file);
    return file;
  }

  async getDirectoryHandle(name: string, opts: { create?: boolean } = {}) {
    const existing = this.children.get(name);
    if (existing && existing.kind === 'directory') return existing;
    if (!opts.create) throw new Error(`NotFoundError: ${name}`);
    const dir = new MockDirHandle(name);
    this.children.set(name, dir);
    return dir;
  }

  async *entries() {
    for (const entry of [...this.children.entries()]) yield entry;
  }
}

type FsMount = typeof import('../src/fs-mount');

let root: MockDirHandle;

/** A fresh page: new module state, same stored handle. */
async function reload(): Promise<FsMount> {
  vi.resetModules();
  return import('../src/fs-mount');
}

/** Pick the folder, then reload the page. */
async function pickThenReload(): Promise<FsMount> {
  const first = await reload();
  await first.pickDirectory();
  return reload();
}

beforeEach(() => {
  store.current = null;
  root = new MockDirHandle('project');
  root.children.set('a.txt', new MockFileHandle('a.txt', 'contents'));
  (globalThis as { window?: unknown }).window = { showDirectoryPicker: async () => root };
});

afterEach(() => {
  store.current = null;
  (globalThis as { window?: unknown }).window = undefined;
});

describe('remembering the mount', () => {
  it('remembers the folder that was picked', async () => {
    const fs = await reload();
    await fs.pickDirectory();
    expect(store.current).toEqual({ handle: root, name: 'project' });
  });

  it('forgets it when the user unmounts', async () => {
    const fs = await reload();
    await fs.pickDirectory();
    fs.clearMount();
    await Promise.resolve();
    expect(store.current).toBeNull();
  });
});

describe('restoreMount', () => {
  it('reports nothing when no folder was ever picked', async () => {
    const fs = await reload();
    expect(await fs.restoreMount()).toEqual({ status: 'none' });
  });

  // Soft navigation / HMR: the grant is still on the document.
  it('remounts silently when the grant survived', async () => {
    const fs = await pickThenReload();
    root.permission = 'granted';

    expect(await fs.restoreMount()).toEqual({ status: 'restored', name: 'project' });
    expect(fs.hasMount()).toBe(true);
    expect(fs.getMountLabel()).toBe('project');
    expect(await fs.mountRead('a.txt')).toBe('contents');
    expect(root.requestCount).toBe(0);
  });

  // Full reload: the handle came back, the grant did not.
  it('asks the caller for a gesture when the grant lapsed', async () => {
    const fs = await pickThenReload();
    root.permission = 'prompt';

    expect(await fs.restoreMount()).toEqual({ status: 'needs-permission', name: 'project' });
    expect(fs.hasMount()).toBe(false);
    // The critical one: boot must never spend the prompt.
    expect(root.requestCount).toBe(0);
  });

  it('drops a handle the user denied rather than offering it again', async () => {
    const fs = await pickThenReload();
    root.permission = 'denied';

    expect(await fs.restoreMount()).toEqual({ status: 'none' });
    expect(store.current).toBeNull();
  });

  it('drops a handle whose folder is gone', async () => {
    const fs = await pickThenReload();
    root.broken = true;

    expect(await fs.restoreMount()).toEqual({ status: 'none' });
    expect(store.current).toBeNull();
  });
});

describe('reconnectMount', () => {
  it('adopts the folder once the user grants it', async () => {
    const fs = await pickThenReload();
    root.permission = 'prompt';

    expect(await fs.reconnectMount()).toBe('project');
    expect(fs.hasMount()).toBe(true);
    expect(root.requestCount).toBe(1);
    expect(await fs.mountRead('a.txt')).toBe('contents');
  });

  it('stays unmounted when the user refuses', async () => {
    const fs = await pickThenReload();
    root.permission = 'denied';

    expect(await fs.reconnectMount()).toBeNull();
    expect(fs.hasMount()).toBe(false);
  });

  it('returns null when there is nothing remembered', async () => {
    const fs = await reload();
    expect(await fs.reconnectMount()).toBeNull();
  });
});
