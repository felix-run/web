import { SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@felix/ui/sidebar';
import { FileIcon, FolderIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileTree,
  FileTreeFile,
  FileTreeFolder,
  FileTreeIcon,
  FileTreeName,
} from '@/components/ai-elements/file-tree';
import { type FileRowAction, useFileRowMenu } from '@/components/workspace/file-row-menu';
import { ancestorsOf, buildTree, type TreeNode } from '@/lib/file-tree';
import { reconnectFolder, useMount } from '@/lib/mount-state';
import { FILES_KEY, usePaneState } from '@/lib/side-pane';
import { cn } from '@/lib/utils';
import { hasWorkspace, inBrowser, useWorkspaceTools } from '@/lib/workspace-tools';
import { useShell } from '@/shell-context';

/**
 * The workspace, as one sidebar row: what the agent works on, and the door to
 * the pane's Files tab, where its trees are.
 *
 * It was the whole section — mount controls, the thread's repository, the
 * harness's tree and the browser's — folded by default, because a mounted
 * repository's tree was taller than the region it shared with the harness's
 * pages, and the file it opened appeared on the far side of the screen. The
 * trees moved beside the files they open (`FilesView`); the row keeps the one
 * fact worth seeing from anywhere, which folder is mounted, and the one action
 * that cannot wait for a click through, Reconnect.
 *
 * Nothing for an agent with no file tools (`felix.workspace.tools: none`): a
 * workspace it cannot touch is a door to nothing.
 */
export function WorkspaceRow({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  /** A drawer closes once the operator has picked somewhere to go. */
  onNavigate: () => void;
}) {
  const { threadId, openInPane } = useShell();
  const tools = useWorkspaceTools();
  const mount = useMount();
  const pane = usePaneState(threadId);
  if (!hasWorkspace(tools) || !openInPane) return null;

  const browser = inBrowser(tools);
  const reconnect = browser && !mount.label ? mount.reconnect : null;
  const value = !browser ? 'on the harness' : (mount.label ?? (reconnect ? null : 'in-tab'));
  const active = pane.shown && pane.active === FILES_KEY;
  const open = () => {
    openInPane({ kind: 'files' });
    onNavigate();
  };

  return (
    <SidebarGroup data-slot="workspace-row" className="py-1">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={active}
            tooltip={reconnect ? `Workspace · reconnect ${reconnect}` : 'Workspace'}
            onClick={open}
            aria-describedby={collapsed ? undefined : 'workspace-value'}
            className={cn('relative text-muted-foreground', reconnect && !collapsed && 'pr-24')}
          >
            <FolderIcon aria-hidden />
            {/* Collapsed to an icon the name is the tooltip's and the reader's: a
                label that will not shrink showed its first letter past the icon. */}
            <span className={collapsed ? 'sr-only' : 'shrink-0'}>Workspace</span>
            {/* Mono for a folder name, because it is the filesystem's word; the
                in-tab and harness states are ours. */}
            {!collapsed && (
              <span
                id="workspace-value"
                className={cn(
                  'min-w-0 flex-1 truncate text-right text-xs',
                  browser && mount.label ? 'font-mono text-foreground' : 'text-muted-foreground',
                )}
                title={mount.label ?? undefined}
              >
                {value}
              </span>
            )}
            {collapsed && reconnect && (
              <>
                <span
                  aria-hidden
                  className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-muted-foreground"
                />
                <span className="sr-only">, {reconnect} needs reconnecting</span>
              </>
            )}
          </SidebarMenuButton>
          {/* A folder mounted last session waits on a grant only a click can ask
              for, and the click has to be this one: the permission prompt opens
              only inside the gesture. Beside the row, never inside it — a button
              in a button is two controls announced as one. */}
          {reconnect && !collapsed && (
            <button
              type="button"
              onClick={() => void reconnectFolder()}
              title={`Reconnect ${reconnect}`}
              className="absolute top-1/2 right-1 flex h-6 max-w-22 -translate-y-1/2 items-center rounded-md border border-border bg-background px-2 text-xs text-foreground hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
            >
              <span className="truncate">Reconnect</span>
              <span className="sr-only"> {reconnect}</span>
            </button>
          )}
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}

/**
 * The workspace's files as a tree rather than a flat column of paths.
 *
 * It opens onto the work: the folders holding a path this thread wrote or edited
 * start expanded, and those paths are drawn in the foreground while the rest stay
 * muted — the same distinction the instrument's *Changes* tab draws, carried into
 * the place an operator looks for a file. Everything else starts folded, so a
 * mounted repository is one row per top-level entry instead of two hundred paths.
 * A file opens in the side pane; a folder's name still folds it.
 */
export function WorkspaceFileTree({
  paths,
  changed,
  selected,
  onOpenFile,
  onFileAction,
  onFolderAction,
  label = 'Files',
}: {
  /** What a screen reader calls the tree, when there is more than one. */
  label?: string;
  /** A row's menu (right click, Shift+F10): Open, Rename…, Delete…. Absent, no menu. */
  onFileAction?: (path: string, action: FileRowAction) => void;
  /** A folder row's menu: Rename folder…, Delete folder…. Absent, folders have none. */
  onFolderAction?: (path: string, action: 'rename' | 'delete') => void;
  paths: readonly string[];
  changed: ReadonlySet<string>;
  selected: string | null;
  onOpenFile: (path: string) => void;
}) {
  const tree = useMemo(() => buildTree(paths), [paths]);
  const filePaths = useMemo(() => {
    const out = new Set<string>();
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) n.kind === 'folder' ? walk(n.children) : out.add(n.path);
    };
    walk(tree);
    return out;
  }, [tree]);
  // Seeded once, from the changes on screen when the tree first draws: after that
  // the folds are the operator's.
  const [expanded, setExpanded] = useState(() => ancestorsOf(changed));
  // …and opened onto each path written after that, once: a write is why the
  // operator is looking, and a fold they closed since stays closed.
  const seen = useRef(changed);
  useEffect(() => {
    const fresh = [...changed].filter((p) => !seen.current.has(p));
    seen.current = changed;
    if (!fresh.length) return;
    setExpanded((prev) => new Set([...prev, ...ancestorsOf(new Set(fresh))]));
  }, [changed]);
  const { rowProps, host } = useFileRowMenu((path, action, kind) => {
    if (kind === 'folder') {
      if (action !== 'open') onFolderAction?.(path, action);
    } else onFileAction?.(path, action);
  });
  const hasMenu = Boolean(onFileAction || onFolderAction);
  const render = (nodes: TreeNode[]) =>
    nodes.map((node) =>
      node.kind === 'folder' ? (
        <FileTreeFolder
          key={node.path}
          path={node.path}
          name={node.name}
          title={node.path}
          {...(onFolderAction ? rowProps(node.path, undefined, 'folder') : {})}
        >
          {render(node.children)}
        </FileTreeFolder>
      ) : (
        <FileTreeFile
          key={node.path}
          path={node.path}
          name={node.name}
          title={node.path}
          {...(onFileAction ? rowProps(node.path, () => onOpenFile(node.path)) : {})}
        >
          <span aria-hidden className="size-4 shrink-0" />
          <FileTreeIcon>
            <FileIcon aria-hidden className="size-3.5 text-muted-foreground" />
          </FileTreeIcon>
          <FileTreeName
            className={changed.has(node.path) ? 'text-foreground' : 'text-muted-foreground'}
          >
            {node.name}
            {changed.has(node.path) && <span className="sr-only">, changed on this thread</span>}
          </FileTreeName>
        </FileTreeFile>
      ),
    );
  const view = (
    <FileTree
      aria-label={label}
      expanded={expanded}
      onExpandedChange={setExpanded}
      {...(selected ? { selectedPath: selected } : {})}
      onSelect={(path) => {
        if (filePaths.has(path)) onOpenFile(path);
      }}
      className="rounded-none border-0 bg-transparent text-xs [&>div]:p-0"
    >
      {render(tree)}
    </FileTree>
  );
  return hasMenu ? host(view) : view;
}
