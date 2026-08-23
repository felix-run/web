import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { clearStoredMount, loadStoredMount, saveStoredMount } from '../src/mount-store';

/**
 * The IndexedDB wrapper itself: open, put, get, delete, and degrade quietly.
 *
 * The payload here is a plain object standing in for a directory handle. A real
 * `FileSystemDirectoryHandle` is a platform object that survives structured
 * clone with its methods intact; a class instance does not, so a faithful mock
 * of one cannot be round-tripped through a real structured-clone implementation.
 * The behaviour that depends on those methods is covered in
 * `mount-restore.test.ts`, against the store seam rather than through it.
 */

const handle = { kind: 'directory', name: 'project' } as unknown as FileSystemDirectoryHandle;

afterEach(async () => {
  await clearStoredMount();
});

describe('mount store', () => {
  it('returns null before anything is stored', async () => {
    expect(await loadStoredMount()).toBeNull();
  });

  it('round-trips a mount', async () => {
    await saveStoredMount({ handle, name: 'project' });
    const found = await loadStoredMount();
    expect(found?.name).toBe('project');
    expect(found?.handle).toMatchObject({ kind: 'directory', name: 'project' });
  });

  it('keeps only the most recent mount', async () => {
    await saveStoredMount({ handle, name: 'first' });
    await saveStoredMount({ handle, name: 'second' });
    expect((await loadStoredMount())?.name).toBe('second');
  });

  it('forgets on clear', async () => {
    await saveStoredMount({ handle, name: 'project' });
    await clearStoredMount();
    expect(await loadStoredMount()).toBeNull();
  });

  // A record written by an older shape is indistinguishable from junk.
  it('ignores a stored record with no handle', async () => {
    await saveStoredMount({ name: 'project' } as unknown as {
      handle: FileSystemDirectoryHandle;
      name: string;
    });
    expect(await loadStoredMount()).toBeNull();
  });
});

describe('without IndexedDB', () => {
  it('degrades to a no-op rather than failing the mount', async () => {
    const real = globalThis.indexedDB;
    // @ts-expect-error simulating a private window / blocked site data
    globalThis.indexedDB = undefined;
    try {
      await expect(saveStoredMount({ handle, name: 'project' })).resolves.toBeUndefined();
      await expect(loadStoredMount()).resolves.toBeNull();
      await expect(clearStoredMount()).resolves.toBeUndefined();
    } finally {
      globalThis.indexedDB = real;
    }
  });
});
