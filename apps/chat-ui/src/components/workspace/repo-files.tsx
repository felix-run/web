/**
 * The files in this thread's checkout, as a tree (`GET …/workspace/repo/files`).
 *
 * It opens onto the work, the way the workspace's own tree does: folders holding a file git
 * reports as changed start expanded, a changed file is drawn in the foreground with its status,
 * and everything else is muted and folded. The status is git's, read on the harness — modified,
 * added, deleted, untracked, conflicted — so it covers what the agent's shell did as well as its
 * workspace tools, which *Changes on this thread* (built from tool arguments) cannot.
 *
 * Nothing here opens a file: the harness lists a checkout but serves none of its contents, so a
 * file is not a tab stop (the tree makes one only when selecting does something).
 */

import { FileIcon, LinkIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ThreadRepoFile, ThreadRepoFiles } from '@/api';
import {
  FileTree,
  FileTreeFile,
  FileTreeFolder,
  FileTreeIcon,
  FileTreeName,
} from '@/components/ai-elements/file-tree';
import { ancestorsOf, buildTree, type TreeNode } from '@/lib/file-tree';
import { cn } from '@/lib/utils';

/** git's status as one letter beside the name, and in words for a screen reader. */
const MARK: Record<Exclude<ThreadRepoFile['status'], 'clean'>, { letter: string; word: string }> = {
  modified: { letter: 'M', word: 'modified' },
  added: { letter: 'A', word: 'added' },
  deleted: { letter: 'D', word: 'deleted' },
  untracked: { letter: 'U', word: 'untracked' },
  conflicted: { letter: 'C', word: 'conflicted' },
};

export function RepoFileTree({ listing }: { listing: ThreadRepoFiles }) {
  const byPath = useMemo(() => new Map(listing.files.map((f) => [f.path, f])), [listing]);
  const tree = useMemo(() => buildTree(listing.files.map((f) => `f ${f.path}`)), [listing]);
  const changed = useMemo(
    () => listing.files.filter((f) => f.status !== 'clean').map((f) => f.path),
    [listing],
  );
  // Seeded once, from the changes in the first listing: after that the folds are the operator's.
  const [expanded, setExpanded] = useState(() => ancestorsOf(changed));

  if (listing.files.length === 0) {
    return <p className="text-xs text-muted-foreground">The repository has no files.</p>;
  }

  const render = (nodes: TreeNode[]) =>
    nodes.map((node) => {
      if (node.kind === 'folder') {
        return (
          <FileTreeFolder key={node.path} path={node.path} name={node.name} title={node.path}>
            {render(node.children)}
          </FileTreeFolder>
        );
      }
      const file = byPath.get(node.path);
      const mark = file && file.status !== 'clean' ? MARK[file.status] : null;
      const Icon = file?.kind === 'symlink' ? LinkIcon : FileIcon;
      return (
        <FileTreeFile
          key={node.path}
          path={node.path}
          name={node.name}
          title={node.path}
          className="cursor-default"
        >
          <span aria-hidden className="size-4 shrink-0" />
          <FileTreeIcon>
            <Icon aria-hidden className="size-3.5 text-muted-foreground" />
          </FileTreeIcon>
          <FileTreeName
            className={cn(
              'min-w-0 flex-1',
              mark ? 'text-foreground' : 'text-muted-foreground',
              file?.status === 'deleted' && 'line-through',
            )}
          >
            {node.name}
            {file?.kind === 'symlink' && <span className="sr-only">, symbolic link</span>}
            {mark && <span className="sr-only">, {mark.word}</span>}
          </FileTreeName>
          {mark && (
            <span
              aria-hidden
              title={mark.word}
              className="ml-auto shrink-0 pl-2 font-mono text-[0.6875rem] text-muted-foreground"
            >
              {mark.letter}
            </span>
          )}
        </FileTreeFile>
      );
    });

  return (
    <>
      <FileTree
        aria-label="Repository files"
        expanded={expanded}
        onExpandedChange={setExpanded}
        className="max-h-64 overflow-y-auto rounded-none border-0 bg-transparent text-xs [&>div]:p-0"
      >
        {render(tree)}
      </FileTree>
      {listing.truncated && (
        <p className="mt-1 text-xs text-muted-foreground">
          Showing the first {listing.files.length.toLocaleString()} files; the repository has more.
        </p>
      )}
    </>
  );
}
