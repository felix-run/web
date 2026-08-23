/**
 * Thin re-exports of @felix/cowork-client bound to float's VFS key.
 */
import {
  type ClientToolOptions,
  type ClientToolRequest,
  clearMount,
  executeClientTool as exec,
  getMountLabel,
  getVfs,
  hasMount,
  mountTree,
  openWorkspaceFile as openFile,
  pickDirectory,
  supportsDirectoryPicker,
} from '@felix/cowork-client';

const vfs = getVfs('felix.float.vfs');

export async function executeClientTool(req: ClientToolRequest, opts?: ClientToolOptions) {
  return exec(req, vfs, opts);
}

/** Open a workspace file in a new tab, bound to float's VFS. */
export async function openWorkspaceFile(path: string) {
  return openFile(path, vfs);
}

export {
  clearMount,
  getMountLabel,
  hasMount,
  mountTree,
  pickDirectory,
  supportsDirectoryPicker,
  vfs,
};
