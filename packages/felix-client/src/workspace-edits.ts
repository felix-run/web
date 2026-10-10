import type { WorkspaceEdit } from './turns';

const OPS = new Set(['write', 'delete', 'rename']);

/**
 * A workspace edit read off either place it arrives: a `workspace_note` frame's
 * data (`to_path`), or a custom log entry's metadata (`type: "workspace_edit"`).
 * Anything else — another custom entry, a malformed row — is null, so a note
 * the harness wrote for some other reason is never drawn as an edit.
 */
export function workspaceEditOf(raw: unknown, { requireType = false } = {}): WorkspaceEdit | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (requireType && o.type !== 'workspace_edit') return null;
  if (typeof o.path !== 'string' || !o.path) return null;
  const op = typeof o.op === 'string' && OPS.has(o.op) ? (o.op as WorkspaceEdit['op']) : 'write';
  const edit: WorkspaceEdit = { path: o.path, op };
  if (typeof o.bytes === 'number' && Number.isFinite(o.bytes)) edit.bytes = o.bytes;
  if (op === 'rename' && typeof o.to_path === 'string' && o.to_path) edit.toPath = o.to_path;
  return edit;
}

/**
 * What a client says the agent was told, in the operator's terms. The harness
 * writes its own wording into the log for the model; this is the line a person
 * reads under the conversation, where "the operator" is "you".
 */
export function describeWorkspaceEdit(edit: WorkspaceEdit): string {
  if (edit.op === 'delete') return `You deleted ${edit.path} from the workspace.`;
  if (edit.op === 'rename') return `You renamed ${edit.path} to ${edit.toPath ?? '…'}.`;
  return `You edited ${edit.path} in the workspace.`;
}
