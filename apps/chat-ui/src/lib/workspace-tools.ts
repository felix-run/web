import type { ManifestWorkspace } from '@felix/client';
import { useOptionalShellPick } from '@/shell-context';

export type WorkspaceTools = ManifestWorkspace['tools'];

/**
 * Where the thread's agent's file tools work (`felix.workspace.tools` on
 * `/v1/models`): the browser's folder (`client`), the harness's (`server`), both,
 * or neither. The agent is the one the thread last ran under, else the one the
 * next message will go to.
 *
 * `undefined` when nothing says — a harness older than the key, the catalog not
 * read yet, or no shell (a test's partial one). That is not `none`: the browser's
 * folder is what such a client always offered, so it still offers it.
 */
export function useWorkspaceTools(): WorkspaceTools | undefined {
  const shell = useOptionalShellPick('threadId', 'threads', 'manifest', 'manifestEntries');
  if (!shell) return undefined;
  const { threadId, threads, manifest, manifestEntries } = shell;
  const agent = threads?.find((t) => t.id === threadId)?.manifest?.trim() || manifest;
  return manifestEntries?.find((m) => m.id === agent)?.workspace?.tools;
}

/** The agent works on files somewhere, so there is a workspace to show. */
export const hasWorkspace = (tools: WorkspaceTools | undefined) => tools !== 'none';
/** The browser's folder (the mount or the in-tab store) is where its tools work. */
export const inBrowser = (tools: WorkspaceTools | undefined) =>
  tools === undefined || tools === 'client' || tools === 'both';
/** The harness's workspace is. */
export const onHarness = (tools: WorkspaceTools | undefined) =>
  tools === 'server' || tools === 'both';
