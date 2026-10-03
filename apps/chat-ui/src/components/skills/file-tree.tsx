import { Button } from '@felix/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@felix/ui/dropdown-menu';
import { Input } from '@felix/ui/input';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FileIcon,
  FileTextIcon,
  FolderIcon,
  ImageIcon,
  MoreHorizontalIcon,
  PlusIcon,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  buildTree,
  bundleDirs,
  isAllowedPath,
  isBinaryAssetPath,
  isProtectedPath,
  isTextPath,
  type TreeNode,
} from './bundle-paths';

/**
 * A skill bundle as a tree: SKILL.md first, then the root files, then the four
 * bundle directories the harness allows.
 *
 * Read-only for a stored version (the Files tab, a version's browser) and
 * editable in the editor, where the menus create, rename and delete against
 * the same allowlist the harness applies. A name the harness would refuse is
 * refused here, at the input, with the reason — not on save, three steps later.
 *
 * Every row is one Tab stop: a folder is its name, which toggles it, and a file
 * is its name, which opens it. The row's menu is a second stop only where there
 * is something to do.
 */
export function FileTree({
  files,
  pendingDirs = [],
  activePath,
  readOnly,
  onSelect,
  onCreateFile,
  onCreateDir,
  onRename,
  onDelete,
  onRequestUpload,
  footer,
}: {
  files: Record<string, string>;
  pendingDirs?: string[];
  activePath: string;
  readOnly?: boolean;
  onSelect: (path: string) => void;
  onCreateFile?: (path: string) => boolean;
  onCreateDir?: (path: string) => void;
  onRename?: (from: string, to: string) => boolean;
  onDelete?: (path: string) => void;
  /** Opens the editor's asset picker. */
  onRequestUpload?: () => void;
  footer?: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<
    { kind: 'create'; parent: string } | { kind: 'rename'; path: string } | null
  >(null);
  const [inputValue, setInputValue] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);

  const tree = buildTree(files, pendingDirs);

  const toggleDir = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const startCreate = (parent: string) => {
    setPending({ kind: 'create', parent });
    setInputValue('');
    setInputError(null);
  };

  const startRename = (path: string) => {
    setPending({ kind: 'rename', path });
    setInputValue(path.split('/').pop() ?? path);
    setInputError(null);
  };

  const commitInput = () => {
    if (!pending) return;
    const name = inputValue.trim();
    if (!name) {
      setPending(null);
      return;
    }
    if (pending.kind === 'create') {
      const path = pending.parent ? `${pending.parent}/${name}` : name;
      if (!isTextPath(path)) {
        setInputError('Use a text extension (.md, .py, .sh, .js, .ts, .json, …)');
        return;
      }
      if (!isAllowedPath(path)) {
        setInputError(
          "Not a name the harness accepts: letters, digits, '.', '_' and '-' only, under scripts/, references/, assets/ or evals/",
        );
        return;
      }
      if (!onCreateFile?.(path)) {
        setInputError('That file already exists');
        return;
      }
    } else {
      const dir = pending.path.split('/').slice(0, -1).join('/');
      const to = dir ? `${dir}/${name}` : name;
      const isDir = files[pending.path] === undefined;
      // A rename keeps what the file is: base64 under a `.md` name would be
      // saved as text, and text under a `.png` name refused as bad base64.
      if (!isDir && isBinaryAssetPath(pending.path) !== isBinaryAssetPath(to)) {
        setInputError('Keep the kind of file: an image stays an image, text stays text');
        return;
      }
      if (!isDir && !isBinaryAssetPath(to) && !isTextPath(to)) {
        setInputError('Use a text extension (.md, .py, .sh, .js, .ts, .json, …)');
        return;
      }
      if (to !== pending.path && !onRename?.(pending.path, to)) {
        setInputError('Not a name the harness accepts, or one already taken');
        return;
      }
    }
    setPending(null);
    setInputError(null);
  };

  const inputRow = (
    <div className="px-2 py-1">
      <Input
        // Focused after the menu's focus guard lets go: plain `autoFocus` fires
        // while the closing menu still holds focus, and is swallowed.
        ref={(el) => {
          if (el) requestAnimationFrame(() => el.focus());
        }}
        value={inputValue}
        onChange={(event) => {
          setInputValue(event.target.value);
          setInputError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commitInput();
          if (event.key === 'Escape') setPending(null);
        }}
        className="h-7 font-mono text-xs"
        aria-label={pending?.kind === 'rename' ? 'New name' : 'New file name'}
        aria-invalid={inputError ? true : undefined}
      />
      {inputError && <p className="mt-1 text-xs text-state-failed">{inputError}</p>}
    </div>
  );

  const renderNode = (node: TreeNode, depth: number): ReactNode => {
    const isDir = node.children !== undefined;
    const isCollapsed = collapsed.has(node.path);
    const renaming = pending?.kind === 'rename' && pending.path === node.path;
    const canMutate = !readOnly && !isProtectedPath(node.path);
    const active = node.path === activePath && !isDir;

    return (
      <div key={node.path}>
        <div
          className={cn('group flex items-center gap-1 rounded-md pr-1', active && 'bg-accent')}
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
        >
          {isDir ? (
            <button
              type="button"
              onClick={() => toggleDir(node.path)}
              aria-expanded={!isCollapsed}
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm py-1 text-left font-mono text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {isCollapsed ? (
                <ChevronRightIcon className="size-3 shrink-0" aria-hidden />
              ) : (
                <ChevronDownIcon className="size-3 shrink-0" aria-hidden />
              )}
              <FolderIcon className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{node.name}/</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onSelect(node.path)}
              aria-current={active ? 'true' : undefined}
              className={cn(
                'flex min-w-0 flex-1 items-center gap-1.5 rounded-sm py-1 text-left font-mono text-xs hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                active ? 'font-medium text-foreground' : 'text-muted-foreground',
              )}
            >
              {node.path === 'SKILL.md' ? (
                <FileTextIcon className="size-3.5 shrink-0" aria-hidden />
              ) : isBinaryAssetPath(node.path) ? (
                <ImageIcon className="size-3.5 shrink-0" aria-hidden />
              ) : (
                <FileIcon className="size-3.5 shrink-0" aria-hidden />
              )}
              <span className="truncate">{node.name}</span>
            </button>
          )}
          {!readOnly && (isDir || canMutate) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-6 shrink-0 p-0 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100"
                  aria-label={`Actions for ${node.path}`}
                >
                  <MoreHorizontalIcon className="size-3.5" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              {/* Focus stays on the inline input the item opens, not the trigger. */}
              <DropdownMenuContent align="start" onCloseAutoFocus={(e) => e.preventDefault()}>
                {isDir && (
                  <DropdownMenuItem onSelect={() => startCreate(node.path)}>
                    New file
                  </DropdownMenuItem>
                )}
                {canMutate && (
                  <>
                    <DropdownMenuItem onSelect={() => startRename(node.path)}>
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onSelect={() => onDelete?.(node.path)}>
                      Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {renaming && inputRow}
        {isDir && !isCollapsed && (
          <div>
            {node.children?.map((child) => renderNode(child, depth + 1))}
            {pending?.kind === 'create' && pending.parent === node.path && inputRow}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="text-sm">
      <div className="flex min-h-8 items-center justify-between border-b border-border/60 px-2 py-1">
        <span className="text-xs font-medium text-muted-foreground">Files</span>
        {!readOnly && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="size-6 p-0" aria-label="Add a file">
                <PlusIcon className="size-3.5" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onCloseAutoFocus={(e) => e.preventDefault()}>
              {bundleDirs.map((dir) => (
                <DropdownMenuItem
                  key={dir}
                  onSelect={() => {
                    // The folder first, so the inline input has a row to render
                    // under while the folder is still empty.
                    onCreateDir?.(dir);
                    startCreate(dir);
                  }}
                >
                  New file in <span className="font-mono">{dir}/</span>
                </DropdownMenuItem>
              ))}
              {files['plugin.json'] === undefined && (
                <DropdownMenuItem onSelect={() => onCreateFile?.('plugin.json')}>
                  Add <span className="font-mono">plugin.json</span>
                </DropdownMenuItem>
              )}
              {onRequestUpload && (
                <DropdownMenuItem onSelect={onRequestUpload}>
                  Upload an image or PDF to <span className="font-mono">assets/</span>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="py-1">
        {tree.map((node) => renderNode(node, 0))}
        {pending?.kind === 'create' && pending.parent === '' && inputRow}
      </div>
      {footer}
    </div>
  );
}
