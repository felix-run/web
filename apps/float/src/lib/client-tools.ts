/**
 * Thin re-exports of @felix/cowork-client bound to float's VFS key.
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
  supportsDirectoryPicker,
} from '@felix/cowork-client';

const vfs = getVfs('felix.float.vfs');

export async function executeClientTool(req: ClientToolRequest) {
  return exec(req, vfs);
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
