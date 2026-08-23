/**
 * Chat-ui binding of @felix/cowork-client.
 */
import {
  type ClientToolRequest,
  clearMount,
  executeClientTool as exec,
  getMountLabel,
  getVfs,
  hasMount,
  mountTree,
  pickDirectory,
  readExisting,
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

export {
  clearMount,
  getMountLabel,
  hasMount,
  mountTree,
  pickDirectory,
  reconnectMount,
  restoreMount,
  supportsDirectoryPicker,
  vfs,
};
