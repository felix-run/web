/**
 * Optional Chromium File System Access mount.
 * When set, client tools prefer the real folder over the in-tab VFS.
 */

export type DirHandle = FileSystemDirectoryHandle;

let root: DirHandle | null = null;
let mountName = '';

export function supportsDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export function getMountLabel(): string | null {
  return root ? mountName || 'Mounted folder' : null;
}

export function clearMount(): void {
  root = null;
  mountName = '';
}

export async function pickDirectory(): Promise<string> {
  // @ts-expect-error File System Access API
  const handle = (await window.showDirectoryPicker({ mode: 'readwrite' })) as DirHandle;
  root = handle;
  mountName = handle.name || 'folder';
  return mountName;
}

async function resolve(
  path: string,
  opts: { create?: boolean } = {},
): Promise<{ parent: DirHandle; name: string; handle?: FileSystemHandle }> {
  if (!root) throw new Error('no folder mounted');
  const parts = path
    .replace(/\\/g, '/')
    .split('/')
    .filter((p) => p && p !== '.');
  if (parts.some((p) => p === '..')) throw new Error('path escapes mount');
  if (parts.length === 0) return { parent: root, name: '' };

  let dir = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    dir = await dir.getDirectoryHandle(part, { create: opts.create });
  }
  const name = parts[parts.length - 1]!;
  return { parent: dir, name };
}

export async function mountList(path = '.'): Promise<Array<{ path: string; type: 'file' | 'dir' }>> {
  if (!root) throw new Error('no folder mounted');
  let dir = root;
  const base = path === '.' || path === '' ? '' : path.replace(/^\.\//, '');
  if (base) {
    for (const part of base.split('/').filter(Boolean)) {
      if (part === '..') throw new Error('path escapes mount');
      dir = await dir.getDirectoryHandle(part);
    }
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
  const parts = path
    .replace(/\\/g, '/')
    .split('/')
    .filter((p) => p && p !== '.');
  if (!root || !parts.length) throw new Error('invalid path');
  let dir = root;
  for (const part of parts) {
    if (part === '..') throw new Error('path escapes mount');
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
