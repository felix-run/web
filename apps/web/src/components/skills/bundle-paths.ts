import { BUNDLE_DIRS } from '@felix/skill-format';

/**
 * Bundle paths as the editor and the file tree handle them.
 *
 * Which paths are *allowed* is `@felix/skill-format`'s (`isAllowedPath`, imported
 * from there directly), which mirrors the
 * harness's allowlist exactly: a looser copy here was how an editor offered a
 * save the harness then refused. What is local is presentation — which files
 * are text an operator can type into, and the tree they are drawn as.
 */

export type BundleDir = (typeof BUNDLE_DIRS)[number];

export const bundleDirs: readonly BundleDir[] = BUNDLE_DIRS;

const TEXT_EXTENSIONS = [
  '.md',
  '.txt',
  '.py',
  '.sh',
  '.js',
  '.ts',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.csv',
] as const;

/** SKILL.md is the bundle: it cannot be renamed or deleted. */
export function isProtectedPath(path: string): boolean {
  return path === 'SKILL.md';
}

export function isTextPath(path: string): boolean {
  const lower = path.toLowerCase();
  return TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** An arbitrary uploaded filename, as a valid bundle path segment. */
export function sanitizeAssetFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'asset';
}

/** Paths under a directory prefix — everything a folder delete removes. */
export function pathsUnder(files: Record<string, string>, dir: string): string[] {
  const prefix = `${dir}/`;
  return Object.keys(files).filter((key) => key.startsWith(prefix));
}

export interface TreeNode {
  name: string;
  path: string;
  children?: TreeNode[];
}

/**
 * A nested folder tree from flat slash-delimited paths. Leaves are files (no
 * `children`); `pendingDirs` materialises empty folders with nothing in them yet.
 */
export function buildPathTree(
  paths: string[],
  options: { pendingDirs?: string[]; compare?: (a: TreeNode, b: TreeNode) => number } = {},
): TreeNode[] {
  const { pendingDirs = [], compare } = options;
  const roots: TreeNode[] = [];
  const dirNodes = new Map<string, TreeNode>();

  const ensureDir = (dirPath: string): TreeNode => {
    const existing = dirNodes.get(dirPath);
    if (existing) return existing;
    const segments = dirPath.split('/');
    const node: TreeNode = {
      name: segments[segments.length - 1] ?? dirPath,
      path: dirPath,
      children: [],
    };
    dirNodes.set(dirPath, node);
    if (segments.length === 1) roots.push(node);
    else ensureDir(segments.slice(0, -1).join('/')).children?.push(node);
    return node;
  };

  const sorted = [...paths].sort();
  for (const path of sorted) {
    const segments = path.split('/');
    if (segments.length === 1) roots.push({ name: path, path });
    else {
      ensureDir(segments.slice(0, -1).join('/')).children?.push({
        name: segments[segments.length - 1] ?? path,
        path,
      });
    }
  }
  for (const dir of pendingDirs) {
    if (!dirNodes.has(dir) && !sorted.some((p) => p.startsWith(`${dir}/`))) ensureDir(dir);
  }

  const cmp = compare ?? ((a, b) => a.name.localeCompare(b.name));
  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort(cmp);
    for (const node of nodes) if (node.children) sortNodes(node.children);
  };
  sortNodes(roots);
  return roots;
}

/** The display tree: SKILL.md pinned first, then root files, then the bundle dirs. */
export function buildTree(files: Record<string, string>, pendingDirs: string[] = []): TreeNode[] {
  const rank = (node: TreeNode) => (node.path === 'SKILL.md' ? 0 : node.children ? 2 : 1);
  return buildPathTree(Object.keys(files), {
    pendingDirs,
    compare: (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name),
  });
}
