/**
 * The files in this thread's checkout, as a tree (`GET …/workspace/repo/files`).
 *
 * It opens onto the work, the way the workspace's own tree does: folders holding a file git
 * reports as changed start expanded, a changed file is drawn in the foreground with its status,
 * and everything else is muted and folded. The status is git's, read on the harness — modified,
 * added, deleted, untracked, conflicted — so it covers what the agent's shell did as well as its
 * workspace tools, which the instrument's *Changes* tab (built from tool arguments) cannot.
 *
 * A file opens in the side pane, read from and saved back to the checkout through the harness's
 * workspace routes (`/chat/workspace/*`, felix-run/felix#578), which resolve a thread with a
 * checkout to the checkout. A deleted file has nothing to open.
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
import { type FileRowAction, useFileRowMenu } from './file-row-menu';

/** git's status as one letter beside the name, and in words for a screen reader. */
const MARK: Record<Exclude<ThreadRepoFile['status'], 'clean'>, { letter: string; word: string }> = {
  modified: { letter: 'M', word: 'modified' },
  added: { letter: 'A', word: 'added' },
  deleted: { letter: 'D', word: 'deleted' },
  untracked: { letter: 'U', word: 'untracked' },
  conflicted: { letter: 'C', word: 'conflicted' },
};

export function RepoFileTree({
  listing,
  onOpenFile,
  onFileAction,
  onFolderAction,
}: {
  listing: ThreadRepoFiles;
  /** Open a file in the side pane; absent, the tree only lists. */
  onOpenFile?: (path: string) => void;
  /** A row's menu (right click, Shift+F10), for a file that is there to act on. */
  onFileAction?: (path: string, action: FileRowAction) => void;
  /** A folder row's menu: Rename folder…, Delete folder…. */
  onFolderAction?: (path: string, action: 'rename' | 'delete') => void;
}) {
  const { rowProps, host } = useFileRowMenu((path, action, kind) => {
    if (kind === 'folder') {
      if (action !== 'open') onFolderAction?.(path, action);
    } else onFileAction?.(path, action);
  });
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
          <FileTreeFolder
            key={node.path}
            path={node.path}
            name={node.name}
            title={node.path}
            {...(onFolderAction ? rowProps(node.path, undefined, 'folder') : {})}
          >
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
          className={onOpenFile && file?.status !== 'deleted' ? undefined : 'cursor-default'}
          {...(onFileAction &&
          onOpenFile &&
          file &&
          file.status !== 'deleted' &&
          file.kind !== 'symlink'
            ? rowProps(node.path, () => onOpenFile(node.path))
            : {})}
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
              className="ml-auto shrink-0 pl-2 font-mono text-xs text-muted-foreground"
            >
              {mark.letter}
            </span>
          )}
        </FileTreeFile>
      );
    });

  const view = (
    <FileTree
      aria-label="Repository files"
      expanded={expanded}
      onExpandedChange={setExpanded}
      {...(onOpenFile
        ? {
            onSelect: (path: string) => {
              const file = byPath.get(path);
              if (file && file.status !== 'deleted' && file.kind !== 'symlink') onOpenFile(path);
            },
          }
        : {})}
      className="rounded-none border-0 bg-transparent text-xs [&>div]:p-0"
    >
      {render(tree)}
    </FileTree>
  );

  return (
    <>
      {onFileAction || onFolderAction ? host(view) : view}
      {listing.truncated && (
        <p className="mt-1 text-xs text-muted-foreground">
          Showing the first {listing.files.length.toLocaleString()} files; the repository has more.
        </p>
      )}
    </>
  );
}
