import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@felix/ui/dropdown-menu';
import { FileTextIcon, PencilLineIcon, Trash2Icon } from 'lucide-react';
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useRef,
  useState,
} from 'react';

export type FileRowAction = 'open' | 'rename' | 'delete';

/**
 * A file tree's row menu: Open, Rename…, Delete…, on a right click, or on
 * Shift+F10 or the context-menu key from a focused row — the thread list's
 * keys, so the sidebar has one way to reach a row's actions.
 *
 * One menu per tree, not one per row: a tree can hold thousands of files, and
 * a trigger inside a `treeitem` would be a second control announced as one. The
 * menu opens at the pointer, or under the row for the keyboard, from a zero-size
 * anchor the tree's own box positions.
 *
 * Rename and Delete do not act here: they open the file in the side pane with
 * its strip already open, so a tree delete is guarded exactly as a pane delete
 * is — by the hash the file was read at, and held while it has an unsaved edit.
 */
export function useFileRowMenu(onAction: (path: string, action: FileRowAction) => void) {
  const box = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ path: string; top: number; left: number } | null>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  const openAt = useCallback((path: string, x: number, y: number, from: HTMLElement) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    returnTo.current = from;
    setMenu({ path, left: x - rect.left, top: y - rect.top });
  }, []);

  /** Props for one file row. */
  const rowProps = useCallback(
    (path: string, onEnter?: () => void) => ({
      onContextMenu: (e: MouseEvent<HTMLElement>) => {
        e.preventDefault();
        openAt(path, e.clientX, e.clientY, e.currentTarget);
      },
      onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
        if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          openAt(path, r.left + 24, r.bottom, e.currentTarget);
        } else if ((e.key === 'Enter' || e.key === ' ') && onEnter) {
          // The row's own Enter, which these props replace.
          e.preventDefault();
          onEnter();
        }
      },
      'aria-keyshortcuts': 'Shift+F10',
    }),
    [openAt],
  );

  const host = (tree: ReactNode) => (
    <div ref={box} className="relative">
      {tree}
      <DropdownMenu open={menu !== null} onOpenChange={(open) => !open && setMenu(null)}>
        <DropdownMenuTrigger asChild>
          <span
            aria-hidden
            className="pointer-events-none absolute size-0"
            style={{ top: menu?.top ?? 0, left: menu?.left ?? 0 }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-48"
          aria-label={menu ? `Actions for ${menu.path}` : undefined}
          onCloseAutoFocus={(e) => {
            // Back to the row it was opened from, not to an anchor nobody can see.
            e.preventDefault();
            returnTo.current?.focus();
          }}
        >
          {menu && (
            <>
              <DropdownMenuItem onSelect={() => onAction(menu.path, 'open')}>
                <FileTextIcon aria-hidden /> Open
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAction(menu.path, 'rename')}>
                <PencilLineIcon aria-hidden /> Rename…
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => onAction(menu.path, 'delete')}
              >
                <Trash2Icon aria-hidden /> Delete…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  return { rowProps, host };
}
