import type { FelixClient } from './transport';

/** Which call a write approval's "before" is read for. */
export interface DiffCall {
  tool: string;
  threadId: string;
}

/**
 * A `readForDiff` that reads the file the write will actually replace.
 *
 * Two workspaces can hold a file under the same path: the client's own — what a
 * `local_*` tool writes, in the browser or the terminal's cwd — and the thread's
 * workspace on the harness, what `write_file` writes. Reading the client's copy
 * for a harness write drew an approval diff against a file the write does not
 * touch: seen live on :8080, where a `write_file` creating `notes/plan.md` on a
 * fresh thread was shown as replacing six lines left over in the browser.
 *
 * Unreadable — missing, binary, over the harness's read cap, or a harness
 * without the route — is null, which every client draws as "no current text"
 * rather than as the file's contents.
 */
export function routedDiffReader(
  client: Pick<FelixClient, 'workspaceRead'>,
  local: (path: string) => Promise<string | null>,
) {
  return async (path: string, call?: DiffCall): Promise<string | null> => {
    if (!call || call.tool.startsWith('local_') || !call.threadId) return local(path);
    try {
      const file = await client.workspaceRead({ threadId: call.threadId, path });
      return new TextDecoder('utf-8', { fatal: true }).decode(file.bytes);
    } catch {
      return null;
    }
  };
}
