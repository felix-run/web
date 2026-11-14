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
/** A row is a file or a folder; a folder has no Open. */
export type RowKind = 'file' | 'folder';

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
export function useFileRowMenu(
  onAction: (path: string, action: FileRowAction, kind: RowKind) => void,
) {
  const box = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{
    path: string;
    kind: RowKind;
    top: number;
    left: number;
  } | null>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  const openAt = useCallback(
    (path: string, kind: RowKind, x: number, y: number, from: HTMLElement) => {
      const rect = box.current?.getBoundingClientRect();
      if (!rect) return;
      returnTo.current = from;
      setMenu({ path, kind, left: x - rect.left, top: y - rect.top });
    },
    [],
  );

  /**
   * A folder's row wraps its children's rows, so their events reach it too: only
   * an event from this row itself — not from a file inside it — is this row's.
   */
  const ownEvent = (e: { target: EventTarget; currentTarget: HTMLElement }) =>
    (e.target as Element).closest?.('[role="treeitem"]') === e.currentTarget;

  /** Props for one file row. */
  const rowProps = useCallback(
    (path: string, onEnter?: () => void, kind: RowKind = 'file') => ({
      onContextMenu: (e: MouseEvent<HTMLElement>) => {
        if (!ownEvent(e)) return;
        e.preventDefault();
        openAt(path, kind, e.clientX, e.clientY, e.currentTarget);
      },
      onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
        if (!ownEvent(e)) return;
        if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          // A folder's own row is its first child; the subtree below is not "under the row".
          const head =
            kind === 'folder'
              ? (e.currentTarget.firstElementChild ?? e.currentTarget)
              : e.currentTarget;
          const h = head.getBoundingClientRect();
          openAt(path, kind, r.left + 24, h.bottom, e.currentTarget);
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
              {menu.kind === 'file' && (
                <DropdownMenuItem onSelect={() => onAction(menu.path, 'open', menu.kind)}>
                  <FileTextIcon aria-hidden /> Open
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => onAction(menu.path, 'rename', menu.kind)}>
                <PencilLineIcon aria-hidden />{' '}
                {menu.kind === 'folder' ? 'Rename folder…' : 'Rename…'}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => onAction(menu.path, 'delete', menu.kind)}
              >
                <Trash2Icon aria-hidden /> {menu.kind === 'folder' ? 'Delete folder…' : 'Delete…'}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  return { rowProps, host };
}
