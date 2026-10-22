import { toast } from 'sonner';
import { closePaneItem, paneKey, paneState } from '@/lib/side-pane';
import { useOptionalShellPick } from '@/shell-context';
import { useLibraryId, useLibraryReadOnly } from './queries';

/**
 * Opens a skill's editor in the side pane, beside the conversation — the one place a skill is
 * edited. From `/harness` that goes back to the thread the tab is on, as every pane item does.
 *
 * Null where there is nothing to open into: no shell (a test's partial one), or someone else's
 * library, which can only be read. Callers leave their Edit control out then.
 *
 * `from` starts the edit at that version rather than the newest — an AI rewrite from feedback.
 * It never replaces an unsaved edit already open for the skill: that one comes to the front and
 * the operator is told, because silently dropping it is the one outcome nobody asked for.
 */
export function useOpenSkillEditor(): ((name: string, opts?: { from?: string }) => void) | null {
  const shell = useOptionalShellPick('threadId', 'openInPane');
  const library = useLibraryId();
  const readOnly = useLibraryReadOnly();
  const open = shell?.openInPane;
  if (!shell || !open || readOnly) return null;
  return (name, opts = {}) => {
    const item = { kind: 'skill' as const, name, ...(library ? { library } : {}) };
    if (opts.from) {
      const key = paneKey(item);
      const held = paneState(shell.threadId).items.find((i) => i.key === key);
      if (held?.kind === 'skill' && held.edit?.files) {
        toast.error(`Save or discard your edits to ${name} first.`);
        open(item);
        return;
      }
      if (held) closePaneItem(shell.threadId, key);
      open({ ...item, edit: { loadedFrom: opts.from, parent: opts.from } });
      return;
    }
    open(item);
  };
}
