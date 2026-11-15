/**
 * Flat workspace paths as a directory tree, for the workspace's file tree.
 *
 * Folders before files, each alphabetical, the way a file manager lists them. A
 * folder's `path` is its full prefix, which is what the tree keys expansion on.
 */
export interface TreeFolder {
  kind: 'folder';
  name: string;
  path: string;
  children: TreeNode[];
}
export interface TreeFile {
  kind: 'file';
  name: string;
  path: string;
}
export type TreeNode = TreeFolder | TreeFile;

/**
 * Entries as both workspace stores list them: `d <path>` for a folder, `f <path>`
 * for a file (`VirtualFs.tree`, `mountTree`). A bare path is read as a file. A
 * folder entry is kept even when empty, which a list of file paths alone loses.
 */
export function buildTree(entries: readonly string[]): TreeNode[] {
  const root: TreeFolder = { kind: 'folder', name: '', path: '', children: [] };
  for (const entry of entries) {
    const typed = /^([df]) (.+)$/.exec(entry);
    const isDir = typed?.[1] === 'd';
    const parts = (typed ? typed[2] : entry).split('/').filter(Boolean);
    let at = root;
    parts.forEach((name, i) => {
      const path = parts.slice(0, i + 1).join('/');
      if (i === parts.length - 1 && !isDir) {
        at.children.push({ kind: 'file', name, path });
        return;
      }
      let next = at.children.find((c): c is TreeFolder => c.kind === 'folder' && c.name === name);
      if (!next) {
        next = { kind: 'folder', name, path, children: [] };
        at.children.push(next);
      }
      at = next;
    });
  }
  const sort = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .map((n) => (n.kind === 'folder' ? { ...n, children: sort(n.children) } : n))
      .sort((a, b) =>
        a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'folder' ? -1 : 1,
      );
  return sort(root.children);
}

/** Every folder on the way to these paths, so the tree opens onto them. */
export function ancestorsOf(paths: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const p of paths) {
    const parts = p.split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i++) out.add(parts.slice(0, i).join('/'));
  }
  return out;
}
