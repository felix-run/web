import { useCallback } from 'react';
import { type EditNotice, useOptionalShellPick } from '@/shell-context';

/**
 * Whether this harness answered that it has no way to tell the agent about an
 * edit (a 404 from `POST /chat/workspace/edited`, older than felix-run/felix#577).
 * Remembered for the page, so the save bar stops promising what it cannot do.
 */
let routeMissing = false;

/** For tests: forget that a harness lacked the route. */
export function resetEditNotice() {
  routeMissing = false;
}

/**
 * Save, then tell the agent. Null where there is no shell to tell it through (a
 * test's partial shell), in which case a save is only a save.
 */
export function useTellAgent() {
  const tell = useOptionalShellPick('tellAgentEdited')?.tellAgentEdited;
  return useCallback(
    async (edit: {
      path: string;
      op?: 'write' | 'delete' | 'rename';
      bytes?: number;
      toPath?: string;
    }) => {
      if (!tell) return null;
      const notice = await tell(edit);
      if (notice === 'unsupported') routeMissing = true;
      return notice;
    },
    [tell],
  );
}

/** Whether saving here tells the agent, as far as this page knows. */
export function useTellsAgent(): boolean {
  return Boolean(useOptionalShellPick('tellAgentEdited')?.tellAgentEdited) && !routeMissing;
}

/** What the save bar says once a save has landed. */
export function savedLine(notice: EditNotice | null): string {
  return outcomeLine('Saved.', notice);
}

/**
 * What landed, then what came of telling the agent: `Deleted notes/a.md. The
 * agent reads this before its next step.` The lead is one sentence ending in a
 * full stop; the rest is the same for a save, a delete and a rename.
 */
export function outcomeLine(lead: string, notice: EditNotice | null): string {
  switch (notice) {
    case 'queued':
      return `${lead} The agent reads this before its next step.`;
    case 'recorded':
      return `${lead} The agent was told, and reads it on its next turn.`;
    case 'watching':
      return `${lead} The agent wasn't told: another tab is driving this thread.`;
    case 'unsupported':
      return `${lead} This harness can't tell the agent about edits, so it wasn't told.`;
    case 'failed':
      return `${lead.replace(/\.$/, ',')} but telling the agent failed. Mention the change in your next message.`;
    default:
      return lead;
  }
}

/** The UTF-8 size the harness puts in its note, which is the file's size on disk. */
export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}
