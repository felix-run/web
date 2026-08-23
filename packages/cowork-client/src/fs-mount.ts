/**
 * Optional Chromium File System Access mount.
 * When set, client tools prefer the real folder over the in-tab VFS.
 */

import { clearStoredMount, loadStoredMount, saveStoredMount } from './mount-store';

export type DirHandle = FileSystemDirectoryHandle;

let root: DirHandle | null = null;
let mountName = '';

/** `queryPermission`/`requestPermission` are not in the DOM lib yet. */
type PermissionCapableHandle = DirHandle & {
  queryPermission?: (opts: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (opts: { mode: 'readwrite' }) => Promise<PermissionState>;
};

/**
 * What a stored handle turned out to be worth on this page load.
 *
 * `needs-permission` is not a failure. It is the ordinary outcome of a full
 * reload, and the only thing that resolves it is a user gesture — so the caller
 * has to surface it and wait, rather than retry.
 */
export type MountRestore =
  | { status: 'none' }
  | { status: 'restored'; name: string }
  | { status: 'needs-permission'; name: string };

export function supportsDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export function getMountLabel(): string | null {
  return root ? mountName || 'Mounted folder' : null;
}

export function clearMount(): void {
  root = null;
  mountName = '';
  void clearStoredMount();
}

export async function pickDirectory(): Promise<string> {
  // @ts-expect-error File System Access API
  const handle = (await window.showDirectoryPicker({ mode: 'readwrite' })) as DirHandle;
  root = handle;
  mountName = handle.name || 'folder';
  await saveStoredMount({ handle, name: mountName });
  return mountName;
}

/**
 * Re-adopt the folder from a previous session, if the browser still allows it.
 *
 * Chromium's behaviour, and the reason this classifies instead of retrying:
 *
 * - Soft navigation / HMR — the grant usually survives on the document, so
 *   `queryPermission` answers `granted` and the mount comes back with no
 *   interaction at all.
 * - Full reload / cold tab / restart — the grant drops to `prompt`. Only
 *   `requestPermission` inside a user gesture can restore it, and there is no
 *   gesture during boot. Calling it here would throw, or worse, silently
 *   resolve `denied` and burn the chance.
 *
 * So a `needs-permission` result is handed back for the UI to turn into a
 * button, and `reconnectMount()` runs from that click.
 */
export async function restoreMount(): Promise<MountRestore> {
  const stored = await loadStoredMount();
  if (!stored) return { status: 'none' };

  const handle = stored.handle as PermissionCapableHandle;
  let state: PermissionState = 'prompt';
  try {
    state = (await handle.queryPermission?.({ mode: 'readwrite' })) ?? 'prompt';
  } catch {
    // A handle whose backing entry is gone (folder deleted, volume ejected)
    // throws here. Treat it as unusable and stop offering it.
    await clearStoredMount();
    return { status: 'none' };
  }

  if (state === 'denied') {
    await clearStoredMount();
    return { status: 'none' };
  }
  if (state === 'granted') {
    root = stored.handle;
    mountName = stored.name;
    return { status: 'restored', name: mountName };
  }
  return { status: 'needs-permission', name: stored.name };
}

/**
 * Ask for the folder back. **Must be called from a user gesture** — that is the
 * whole reason this is separate from `restoreMount()`.
 */
export async function reconnectMount(): Promise<string | null> {
  const stored = await loadStoredMount();
  if (!stored) return null;

  const handle = stored.handle as PermissionCapableHandle;
  let state: PermissionState;
  try {
    state = (await handle.requestPermission?.({ mode: 'readwrite' })) ?? 'denied';
  } catch {
    return null;
  }
  if (state !== 'granted') return null;

  root = stored.handle;
  mountName = stored.name;
  return mountName;
}

/**
 * Split a caller-supplied path into contained segments.
 *
 * Every path that reaches a real directory handle goes through here. The mount
 * is a real folder on the user's disk and these paths arrive in tool calls that
 * a prompt-injected model chooses, so containment is a security property.
 * Backslashes are folded to `/` first, otherwise `..\..\x` walks straight past
 * a check that only compares whole segments to `..`.
 */
function splitContainedPath(path: string): string[] {
  const parts = path
    .replace(/\\/g, '/')
    .split('/')
    .filter((p) => p && p !== '.');
  if (parts.some((p) => p === '..')) throw new Error('path escapes mount');
  return parts;
}

async function resolve(
  path: string,
  opts: { create?: boolean } = {},
): Promise<{ parent: DirHandle; name: string }> {
  if (!root) throw new Error('no folder mounted');
  const parts = splitContainedPath(path);
  if (parts.length === 0) return { parent: root, name: '' };

  let dir = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    dir = await dir.getDirectoryHandle(part, { create: opts.create });
  }
  const name = parts[parts.length - 1]!;
  return { parent: dir, name };
}

export async function mountList(
  path = '.',
): Promise<Array<{ path: string; type: 'file' | 'dir' }>> {
  if (!root) throw new Error('no folder mounted');
  let dir = root;
  const parts = splitContainedPath(path);
  const base = parts.join('/');
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part);
  }
  const out: Array<{ path: string; type: 'file' | 'dir' }> = [];
  for await (const [name, handle] of dir.entries()) {
    const rel = base ? `${base}/${name}` : name;
    out.push({ path: rel, type: handle.kind === 'directory' ? 'dir' : 'file' });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export async function mountRead(path: string): Promise<string> {
  const { parent, name } = await resolve(path);
  if (!name) throw new Error('not a file');
  const fileHandle = await parent.getFileHandle(name);
  const file = await fileHandle.getFile();
  return file.text();
}

export async function mountWrite(path: string, content: string, append = false): Promise<void> {
  const { parent, name } = await resolve(path, { create: true });
  if (!name) throw new Error('not a file');
  const fileHandle = await parent.getFileHandle(name, { create: true });
  let next = content;
  if (append) {
    try {
      const existing = await (await fileHandle.getFile()).text();
      next = existing + content;
    } catch {
      // new file
    }
  }
  const writable = await fileHandle.createWritable();
  await writable.write(next);
  await writable.close();
}

export async function mountMkdir(path: string): Promise<void> {
  const parts = splitContainedPath(path);
  if (!root || !parts.length) throw new Error('invalid path');
  let dir = root;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
}

export async function mountTree(limit = 200): Promise<string[]> {
  if (!root) return [];
  const out: string[] = [];

  async function walk(dir: DirHandle, prefix: string): Promise<void> {
    for await (const [name, handle] of dir.entries()) {
      if (out.length >= limit) return;
      const rel = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === 'directory') {
        out.push(`d ${rel}`);
        await walk(handle as DirHandle, rel);
      } else {
        out.push(`f ${rel}`);
      }
    }
  }

  await walk(root, '');
  return out;
}

export function hasMount(): boolean {
  return root !== null;
}

/** Best-effort read of an existing file from mount or VFS for approval diffs. */
export async function readExisting(
  path: string,
  vfs: { read: (p: string) => string },
): Promise<string | null> {
  const cleaned = path.replace(/^\//, '');
  try {
    if (hasMount()) return await mountRead(cleaned);
    return vfs.read(cleaned);
  } catch {
    return null;
  }
}
