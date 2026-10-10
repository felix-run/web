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
  mountTree,
  mountWrite,
  pickDirectory,
  readExisting,
  readExistingBytes,
  reconnectMount,
  restoreMount,
  supportsDirectoryPicker,
} from '@felix/cowork-client';

const vfs = getVfs('felix.chat.vfs');

export async function executeClientTool(req: ClientToolRequest) {
  return exec(req, vfs);
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
