/**
 * The manifest the workspace surface is built around.
 *
 * Shared by the shell (which falls back to it when stored state names a
 * manifest this harness does not serve) and the workbench (which shows the
 * workspace strip and its own placeholder only for it), so it lives here rather
 * than in either.
 */
export const DEFAULT_MANIFEST = 'cowork';
