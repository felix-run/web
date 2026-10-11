/**
 * Chat-ui binding of @felix/cowork-client.
 */
import type { ClientToolRequest } from '@felix/client';
import {
  clearMount,
  collectTouchedPaths,
  executeClientTool as exec,
  getMountLabel,
  getVfs,
  hasMount,
  mountFilesUnder,
  mountRemoveDir,
  mountRenameDir,
  mountTree,
  mountWrite,
  pickDirectory,
  readExisting,
  readExistingBytes,
  reconnectMount,
  removeExisting,
  renameExisting,
  restoreMount,
  supportsDirectoryPicker,
} from '@felix/cowork-client';
import { WORKSPACE_WRITTEN } from '@/lib/workspace-events';

const vfs = getVfs('felix.chat.vfs');

/**
 * The browser's client tools. `openFile` is where `local_open` puts a workspace
 * file — the side pane of the thread the call is on, never a new window.
 */
export async function executeClientTool(req: ClientToolRequest, openFile: (path: string) => void) {
  return exec(req, vfs, { openFile });
}

export async function readWorkspaceFile(path: string): Promise<string | null> {
  return readExisting(path, vfs);
}

/**
 * The same file as `readWorkspaceFile`, undecoded — for the preview, which has
 * to see an image's bytes to know it is one.
 */
export async function readWorkspaceBytes(path: string): Promise<Uint8Array | null> {
  return readExistingBytes(path, vfs);
}

/**
 * The operator's own save from the side pane, into the same store the tools
 * read and write — the mounted folder first, the in-tab one otherwise — so the
 * next tool call, the approval diff and the preview all see it.
 */
export async function writeWorkspaceFile(path: string, content: string): Promise<void> {
  const cleaned = path.replace(/^\//, '');
  if (hasMount()) await mountWrite(cleaned, content);
  else vfs.write(cleaned, content);
  window.dispatchEvent(new Event(WORKSPACE_WRITTEN));
}

/** The operator's delete from the side pane, in the store the pane read the file from. */
export async function deleteWorkspaceFile(path: string): Promise<void> {
  await removeExisting(path, vfs);
  window.dispatchEvent(new Event(WORKSPACE_WRITTEN));
}

/** The operator's rename from the side pane: same store, never overwriting. */
export async function renameWorkspaceFile(from: string, to: string): Promise<void> {
  await renameExisting(from, to, vfs);
  window.dispatchEvent(new Event(WORKSPACE_WRITTEN));
}

/** The files under a folder in the store the tools run against, for the count a delete is confirmed on. */
export async function filesUnderWorkspaceFolder(path: string): Promise<string[]> {
  const cleaned = path.replace(/^\//, '').replace(/\/+$/, '');
  return hasMount() ? await mountFilesUnder(cleaned) : vfs.filesUnder(cleaned);
}

/** The operator's folder delete, at the count they were shown. */
export async function deleteWorkspaceFolder(path: string, expectedFiles: number): Promise<number> {
  const cleaned = path.replace(/^\//, '').replace(/\/+$/, '');
  const files = hasMount()
    ? await mountRemoveDir(cleaned, expectedFiles)
    : vfs.removeDir(cleaned, expectedFiles);
  window.dispatchEvent(new Event(WORKSPACE_WRITTEN));
  return files;
}

/** The operator's folder rename: same store, never over anything. */
export async function renameWorkspaceFolder(from: string, to: string): Promise<void> {
  const a = from.replace(/^\//, '').replace(/\/+$/, '');
  const b = to.replace(/^\//, '').replace(/\/+$/, '');
  if (hasMount()) await mountRenameDir(a, b);
  else vfs.renameDir(a, b);
  window.dispatchEvent(new Event(WORKSPACE_WRITTEN));
}

export {
  clearMount,
  collectTouchedPaths,
  getMountLabel,
  hasMount,
  mountTree,
  pickDirectory,
  reconnectMount,
  restoreMount,
  supportsDirectoryPicker,
  vfs,
};
