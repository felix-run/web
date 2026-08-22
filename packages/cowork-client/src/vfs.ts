/**
 * In-tab virtual filesystem. Persists to localStorage under a caller-chosen key.
 */

export type VfsNode =
  | { type: 'file'; content: string; updatedAt: number }
  | { type: 'dir'; updatedAt: number };

type VfsMap = Record<string, VfsNode>;

function normalize(path: string): string {
  const parts = path
    .replace(/\\/g, '/')
    .split('/')
    .filter((p) => p && p !== '.');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '..') {
      if (out.length === 0) throw new Error('path escapes vfs root');
      out.pop();
    } else {
      out.push(part);
    }
  }
  return out.join('/');
}

export class VirtualFs {
  private map: VfsMap;
  private readonly storageKey: string;

  constructor(storageKey: string) {
    this.storageKey = storageKey;
    this.map = this.load();
    if (!this.map['']) this.map[''] = { type: 'dir', updatedAt: Date.now() };
  }

  private load(): VfsMap {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return { '': { type: 'dir', updatedAt: Date.now() } };
      return JSON.parse(raw) as VfsMap;
    } catch {
      return { '': { type: 'dir', updatedAt: Date.now() } };
    }
  }

  private save(): void {
    localStorage.setItem(this.storageKey, JSON.stringify(this.map));
  }

  list(path = '.'): Array<{ path: string; type: 'file' | 'dir' }> {
    const dir = path === '.' || path === '' ? '' : normalize(path);
    const prefix = dir ? `${dir}/` : '';
    const entries: Array<{ path: string; type: 'file' | 'dir' }> = [];
    const seen = new Set<string>();
    for (const key of Object.keys(this.map)) {
      if (key === dir) continue;
      if (dir && !key.startsWith(prefix)) continue;
      if (!dir && key.includes('/')) {
        const top = key.split('/')[0]!;
        if (seen.has(top)) continue;
        seen.add(top);
        const node = this.map[top];
        entries.push({ path: top, type: node?.type === 'dir' ? 'dir' : 'file' });
        continue;
      }
      const rest = dir ? key.slice(prefix.length) : key;
      if (!rest || rest.includes('/')) continue;
      const node = this.map[key];
      if (!node) continue;
      entries.push({ path: key, type: node.type });
    }
    return entries.sort((a, b) => a.path.localeCompare(b.path));
  }

  read(path: string): string {
    const key = normalize(path);
    const node = this.map[key];
    if (!node || node.type !== 'file') throw new Error(`not a file: ${path}`);
    return node.content;
  }

  write(path: string, content: string, append = false): void {
    const key = normalize(path);
    const parts = key.split('/');
    for (let i = 0; i < parts.length - 1; i++) {
      const dir = parts.slice(0, i + 1).join('/');
      const existing = this.map[dir];
      if (existing && existing.type === 'file') throw new Error(`not a directory: ${dir}`);
      if (!existing) this.map[dir] = { type: 'dir', updatedAt: Date.now() };
    }
    const prev = this.map[key];
    const next = append && prev?.type === 'file' ? `${prev.content}${content}` : content;
    this.map[key] = { type: 'file', content: next, updatedAt: Date.now() };
    this.save();
  }

  mkdir(path: string): void {
    const key = normalize(path);
    if (this.map[key]?.type === 'file') throw new Error(`file exists: ${path}`);
    this.map[key] = { type: 'dir', updatedAt: Date.now() };
    this.save();
  }

  tree(limit = 200): string[] {
    return Object.keys(this.map)
      .filter((k) => k !== '')
      .sort()
      .slice(0, limit)
      .map((k) => `${this.map[k]?.type === 'dir' ? 'd' : 'f'} ${k}`);
  }

  reset(): void {
    this.map = { '': { type: 'dir', updatedAt: Date.now() } };
    this.save();
  }
}

const instances = new Map<string, VirtualFs>();

/** Shared VFS instance for a storage key (one per tab origin + key). */
export function getVfs(storageKey: string): VirtualFs {
  let vfs = instances.get(storageKey);
  if (!vfs) {
    vfs = new VirtualFs(storageKey);
    instances.set(storageKey, vfs);
  }
  return vfs;
}
