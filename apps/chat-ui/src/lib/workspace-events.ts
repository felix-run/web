/**
 * Fired on `window` after the operator writes to the workspace from the side
 * pane, so the file tree re-reads. The tree otherwise re-reads when a run
 * settles, and an operator's save is not a run.
 *
 * Its own module rather than an export of `lib/cowork`, which tests replace
 * wholesale: a constant there is one more name every one of those mocks would
 * have to spell.
 */
export const WORKSPACE_WRITTEN = 'felix:workspace-written';
