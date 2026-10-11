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

/**
 * A mounted file's bytes, undecoded. `mountRead` goes through `File.text()`,
 * which turns an image into a page of replacement characters; a preview that
 * wants to know what a file *is* has to see what is actually in it.
 */
export async function mountReadBytes(path: string): Promise<Uint8Array> {
  const { parent, name } = await resolve(path);
  if (!name) throw new Error('not a file');
  const fileHandle = await parent.getFileHandle(name);
  const file = await fileHandle.getFile();
  return new Uint8Array(await file.arrayBuffer());
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

/**
 * Folders the walk leaves out entirely: repository internals and installed
 * dependencies, either of which can outnumber the project itself by orders of
 * magnitude. Every other dotfile and dot-folder is listed.
 */
const SKIPPED = new Set(['.git', 'node_modules']);

/**
 * Every entry under the mount, hidden ones included, up to `limit`.
 *
 * Breadth-first, so a cap cuts the deepest entries rather than whole top-level
 * folders: depth-first, one `.git` spent two hundred entries on its objects and
 * the rest of the repository never appeared.
 */
export async function mountTree(limit = 200): Promise<string[]> {
  if (!root) return [];
  const out: string[] = [];
  const queue: [DirHandle, string][] = [[root, '']];

  for (let next = queue.shift(); next; next = queue.shift()) {
    const [dir, prefix] = next;
    for await (const [name, handle] of dir.entries()) {
      if (out.length >= limit) return out;
      if (SKIPPED.has(name)) continue;
      const rel = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === 'directory') {
        out.push(`d ${rel}`);
        queue.push([handle as DirHandle, rel]);
      } else {
        out.push(`f ${rel}`);
      }
    }
  }
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

/**
 * `readExisting`, as bytes: the same precedence (mount first, then the in-tab
 * store) and the same null for a file that is not there, so a preview drawn
 * from bytes and an approval diff drawn from text never disagree about which
 * file they mean. The in-tab store only ever held strings, so its bytes are
 * that string encoded.
 */
export async function readExistingBytes(
  path: string,
  vfs: { read: (p: string) => string },
): Promise<Uint8Array | null> {
  const cleaned = path.replace(/^\//, '');
  try {
    if (hasMount()) return await mountReadBytes(cleaned);
    return new TextEncoder().encode(vfs.read(cleaned));
  } catch {
    return null;
  }
}

/** A delete or rename refused because the destination already holds something. */
export class TargetExistsError extends Error {
  constructor(readonly path: string) {
    super(`target exists: ${path}`);
    this.name = 'TargetExistsError';
  }
}

/** Delete one file in the mounted folder. A directory is refused. */
export async function mountRemove(path: string): Promise<void> {
  const { parent, name } = await resolve(path);
  if (!name) throw new Error('not a file');
  // Asked for as a file first, so a folder of the same name is refused rather
  // than removed: `removeEntry` takes either.
  await parent.getFileHandle(name);
  await parent.removeEntry(name);
}

/**
 * Move one file within the mounted folder: written to the destination, then
 * removed from the source. Not atomic — there is no move every browser offers
 * — so it is ordered to fail safe: the destination is checked to be free and
 * written in full before anything is removed, and a failure after the write
 * leaves two copies, never none.
 */
export async function mountRename(from: string, to: string): Promise<void> {
  const src = await resolve(from);
  if (!src.name) throw new Error('not a file');
  const handle = await src.parent.getFileHandle(src.name);
  const bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer());
  const dst = await resolve(to, { create: true });
  if (!dst.name) throw new Error('no destination');
  const taken = await dst.parent
    .getFileHandle(dst.name)
    .then(() => true)
    .catch(() =>
      dst.parent
        .getDirectoryHandle(dst.name)
        .then(() => true)
        .catch(() => false),
    );
  if (taken) throw new TargetExistsError(to);
  const out = await dst.parent.getFileHandle(dst.name, { create: true });
  const writable = await out.createWritable();
  await writable.write(bytes);
  await writable.close();
  await src.parent.removeEntry(src.name);
}

/**
 * Delete a file from whichever store the tools run against — the mounted
 * folder first, the in-tab store otherwise — the same precedence as
 * `readExisting`, so the pane deletes the file it showed.
 */
export async function removeExisting(
  path: string,
  vfs: { remove: (p: string) => void },
): Promise<void> {
  const cleaned = path.replace(/^\//, '');
  if (hasMount()) await mountRemove(cleaned);
  else vfs.remove(cleaned);
}

/** `removeExisting`'s rename: same store, never overwriting. */
export async function renameExisting(
  from: string,
  to: string,
  vfs: { rename: (a: string, b: string) => void },
): Promise<void> {
  const a = from.replace(/^\//, '');
  const b = to.replace(/^\//, '');
  if (hasMount()) await mountRename(a, b);
  else vfs.rename(a, b);
}

/** Folders and files a mount folder delete or rename will touch, at most. */
export const MAX_FOLDER_ENTRIES = 2_000;

async function walkFiles(dir: DirHandle, base: string, out: string[], seen: { n: number }) {
  for await (const [name, handle] of dir.entries()) {
    if (++seen.n > MAX_FOLDER_ENTRIES) throw new TooManyEntriesError(seen.n);
    const rel = `${base}/${name}`;
    if (handle.kind === 'directory') await walkFiles(handle as DirHandle, rel, out, seen);
    else out.push(rel);
  }
}

/** A folder over the cap: refused before anything is touched. */
export class TooManyEntriesError extends Error {
  constructor(readonly count: number) {
    super(`over ${MAX_FOLDER_ENTRIES} entries`);
    this.name = 'TooManyEntriesError';
  }
}

/** The files under a mounted folder, recursively, for the count a delete is confirmed on. */
export async function mountFilesUnder(path: string): Promise<string[]> {
  const { parent, name } = await resolve(path);
  if (!name) throw new Error('the folder itself cannot be the root');
  const dir = await parent.getDirectoryHandle(name);
  const out: string[] = [];
  await walkFiles(dir, path.replace(/\/+$/, ''), out, { n: 0 });
  return out.sort();
}

/**
 * Delete a mounted folder and everything in it, after counting it again: a
 * count other than the one the operator confirmed refuses, deleting nothing.
 * The File System Access API does not follow links, so nothing outside the
 * mount is reachable from inside it.
 */
export async function mountRemoveDir(path: string, expectedFiles?: number): Promise<number> {
  const files = (await mountFilesUnder(path)).length;
  if (expectedFiles !== undefined && files !== expectedFiles) {
    throw Object.assign(new Error(`${path} now holds ${files} files`), {
      name: 'FolderChangedError',
      count: files,
    });
  }
  const { parent, name } = await resolve(path);
  await parent.getDirectoryHandle(name);
  await parent.removeEntry(name, { recursive: true });
  return files;
}

/**
 * Move a mounted folder: copied in full to the destination, then removed from
 * the source. Not atomic — no move works on every browser — and ordered so a
 * failure leaves two copies, never none. Never over anything, never into itself.
 */
export async function mountRenameDir(from: string, to: string): Promise<void> {
  const src = splitContainedPath(from).join('/');
  const dst = splitContainedPath(to).join('/');
  if (!src) throw new Error('the workspace root cannot be renamed');
  if (!dst) throw new Error('no destination');
  if (dst === src || dst.startsWith(`${src}/`)) throw new Error('a folder cannot move into itself');
  const files = await mountFilesUnder(src);
  const target = await resolve(dst, { create: true });
  const taken = await target.parent
    .getFileHandle(target.name)
    .then(() => true)
    .catch(() =>
      target.parent
        .getDirectoryHandle(target.name)
        .then(() => true)
        .catch(() => false),
    );
  if (taken) throw new TargetExistsError(to);
  await mountMkdir(dst);
  for (const file of files) {
    await mountWriteBytes(`${dst}${file.slice(src.length)}`, await mountReadBytes(file));
  }
  const origin = await resolve(src);
  await origin.parent.removeEntry(origin.name, { recursive: true });
}

async function mountWriteBytes(path: string, bytes: Uint8Array): Promise<void> {
  const { parent, name } = await resolve(path, { create: true });
  if (!name) throw new Error('not a file');
  const handle = await parent.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(bytes as BufferSource);
  await writable.close();
}
