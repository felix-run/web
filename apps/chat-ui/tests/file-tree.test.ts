import { describe, expect, it } from 'vitest';
import { ancestorsOf, buildTree } from '../src/lib/file-tree';

describe('buildTree', () => {
  it('nests paths into folders, folders first, each alphabetical', () => {
    const tree = buildTree(['src/b.ts', 'README.md', 'src/lib/a.ts', 'docs/x.md', 'a.txt']);
    expect(tree.map((n) => `${n.kind}:${n.name}`)).toEqual([
      'folder:docs',
      'folder:src',
      'file:a.txt',
      'file:README.md',
    ]);
    const src = tree.find((n) => n.name === 'src');
    expect(src?.kind === 'folder' && src.children.map((n) => n.path)).toEqual([
      'src/lib',
      'src/b.ts',
    ]);
  });

  it('opens every folder on the way to a changed path', () => {
    expect([...ancestorsOf(['src/lib/a.ts', 'top.md'])].sort()).toEqual(['src', 'src/lib']);
  });

  it("reads the stores' `d <path>` / `f <path>` entries, keeping an empty folder", () => {
    const tree = buildTree(['d notes', 'f notes/one.md', 'd empty', 'f README.md']);
    expect(tree.map((n) => `${n.kind}:${n.path}`)).toEqual([
      'folder:empty',
      'folder:notes',
      'file:README.md',
    ]);
    const notes = tree.find((n) => n.name === 'notes');
    expect(notes?.kind === 'folder' && notes.children.map((n) => n.name)).toEqual(['one.md']);
  });
});
