/**
 * Human-in-the-loop approvals — the row, the summary line, and the poll that
 * finds the ones no frame announced.
 *
 * A gated tool blocks the run until somebody decides, and per
 * `.claude/rules/protocol-parity.md` §3 the state reaches a client two ways: as
 * an `approval_required` frame, and as a row in `GET /approvals`. Wiring only
 * the frame looks correct in a watched client and hangs forever in an unwatched
 * one, which is why the poll lives here — beside the engine, in reach of every
 * client — rather than in one app's component tree.
 */

/**
 * One row from GET /approvals.
 *
 * Guarded by `pnpm check-payload-shapes` against
 * `felix/approvals/store.py:_approval_dict`; a required field the harness does
 * not send fails CI.
 */
export interface ApprovalRequest {
  id: string;
  tenant_id: string;
  manifest_id: string;
  tool_name: string;
  call_signature: string;
  args: Record<string, unknown>;
  /**
   * The wire spells this `principal_subj`, the same abbreviation an audit row
   * uses. Declared as `principal_subject` it read `undefined` on every approval
   * the harness has ever returned — invisible only because nothing rendered it
   * yet.
   */
  principal_subj: string;
  status: 'pending' | 'approved' | 'denied';
  created_at: number;
  decided_at: number | null;
  decided_by: string;
  decision_note: string;
  edited_args: Record<string, unknown> | null;
}

/** Approval state a client holds while the decision is outstanding. */
export interface PendingApproval {
  approvalId: string;
  toolName: string;
  args: Record<string, unknown>;
  ruleId?: string;
  /** Existing file text for write_file diffs (null = new file / unreadable). */
  before?: string | null;
}

/**
 * A one-line description of what a gated call would do.
 *
 * The known client tools get a sentence; anything else falls back to pretty
 * JSON, which is not a summary — callers that need one line collapse it.
 */
export function summarizeToolArgs(toolName: string, args: Record<string, unknown>): string {
  if (toolName === 'write_file') {
    const path = typeof args.path === 'string' ? args.path : '?';
    const len = typeof args.content === 'string' ? args.content.length : 0;
    return `Write ${path} (${len} chars)${args.append ? ' append' : ''}`;
  }
  if (toolName === 'local_shell') {
    return `Shell: ${typeof args.command === 'string' ? args.command : JSON.stringify(args)}`;
  }
  if (toolName === 'local_open') {
    return `Open: ${typeof args.target === 'string' ? args.target : JSON.stringify(args)}`;
  }
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

export interface ApprovalSyncOptions {
  /** `GET /approvals?status=pending`. */
  listPending: () => Promise<ApprovalRequest[]>;
  /** Ids already on screen, however they got there. Mutated as new ones adopt. */
  seen: Set<string>;
  /** The pre-edit file text for a `write_file` diff, where a client can read one. */
  readForDiff?: (path: string) => Promise<string | null>;
}

/**
 * Adopt any approval the harness is holding that a client has not already seen.
 *
 * Merging, never replacing: the `approval_required` frame may have queued the
 * same one already, and a decision in flight must not be resurrected. Ids stay
 * remembered for the life of the client, so an approval that has been answered
 * cannot come back if the server briefly still lists it as pending.
 *
 * Returns only the newly adopted entries — an empty array is the common case,
 * and means the caller has nothing to re-render.
 */
export async function syncApprovals(opts: ApprovalSyncOptions): Promise<PendingApproval[]> {
  let items: ApprovalRequest[];
  try {
    items = await opts.listPending();
  } catch {
    return []; // endpoint unavailable; the frame path may still deliver
  }
  const fresh = items.filter((item) => !opts.seen.has(item.id));
  if (!fresh.length) return [];

  const entries: PendingApproval[] = [];
  for (const item of fresh) {
    opts.seen.add(item.id);
    const args = item.args ?? {};
    let before: string | null = null;
    if (item.tool_name === 'write_file' && typeof args.path === 'string' && opts.readForDiff) {
      before = await opts.readForDiff(args.path);
    }
    entries.push({ approvalId: item.id, toolName: item.tool_name, args, before });
  }
  return entries;
}
