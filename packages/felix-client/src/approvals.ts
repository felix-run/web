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
  /**
   * The rule that gated the call. Not optional: the wire always sends the key,
   * and an empty string is the harness saying it has no rule to name.
   */
  rule_id: string;
  /**
   * How long the harness waits for a decision — and, if the answer is yes, how
   * long the resulting grant stays reusable. One number, both jobs. `null`
   * means the harness's own default of five minutes.
   */
  ttl_seconds: number | null;
  /** Epoch ms. `null` when the rule set no TTL. */
  expires_at: number | null;
  /** Epoch ms a one-shot grant was spent, or `null`. */
  consumed_at: number | null;
}

/**
 * Approval state a client holds while the decision is outstanding.
 *
 * **Not answering is an answer.** The harness calls `wait_for_decision` with
 * the rule's `ttl_seconds`, or five minutes when it has none, and on timeout
 * returns `denied` with the note `timeout`: the tool is refused and the run
 * moves on. A banner still offering `y`/`n` after that is asking about a
 * decision already made without the operator.
 *
 * **And approving is not approving one call.** It issues a grant that
 * authorizes every byte-identical call to that tool — matched on a hash of the
 * arguments, scoped to the manifest — until the same deadline passes. A prompt
 * that says only `y approve · n deny` states neither half of that.
 */
export interface PendingApproval {
  approvalId: string;
  toolName: string;
  args: Record<string, unknown>;
  /** The rule that gated this, when the harness named one. */
  ruleId?: string;
  /** Why it fired. Frame-only — the `/approvals` row carries no reason. */
  reason?: string;
  /**
   * Epoch ms after which the harness stops waiting and denies.
   *
   * Absent on an approval known only from its frame: the frame carries no
   * deadline, and the `/approvals` poll is what fills it in. That is a second
   * reason the poll earns its place in a *watched* client, beyond finding the
   * approvals no frame announced.
   */
  expiresAt?: number | null;
  /** Existing file text for write_file diffs (null = new file / unreadable). */
  before?: string | null;
}

/**
 * What the harness waits when a rule sets no `ttl_seconds`.
 *
 * Derived rather than copied from the row, because `expires_at` is null in
 * exactly that case and the harness still stops waiting — after its own
 * default. Reporting "no deadline" there would repeat the row instead of
 * describing the behaviour.
 */
export const DEFAULT_APPROVAL_TTL_MS = 300_000;

/**
 * Milliseconds left to decide, or `null` when no deadline is known.
 *
 * Never negative — a lapsed approval reads as zero, so callers ask
 * `=== 0` for "expired" rather than testing a sign.
 */
export function msUntilDecision(
  pending: Pick<PendingApproval, 'expiresAt'>,
  now = Date.now(),
): number | null {
  if (pending.expiresAt == null) return null;
  return Math.max(0, pending.expiresAt - now);
}

/**
 * A deadline as a person reads one: `4:12`, and `38s` under the minute.
 *
 * Seconds throughout would be a three-digit number for most of a five-minute
 * window; minutes alone would sit on `1m` while the thing actually expired.
 */
export function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
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
/**
 * What one poll learned.
 *
 * Two things, not one, because a frame and a row carry different halves. The
 * frame announces an approval and says why it fired; only the row knows when
 * the harness stops waiting. So the poll reports deadlines for **every**
 * pending approval, not just the ones it is adding — otherwise an approval that
 * arrived by frame is `seen`, skipped, and never learns its own.
 */
export interface ApprovalSync {
  /** Approvals no client had yet. */
  added: PendingApproval[];
  /** Deadline by approval id, epoch ms, for everything still pending. */
  deadlines: Map<string, number>;
}

/** When the harness gives up on this row, whether or not its rule set a TTL. */
function deadlineOf(item: ApprovalRequest): number {
  return item.expires_at ?? item.created_at + DEFAULT_APPROVAL_TTL_MS;
}

export async function syncApprovals(opts: ApprovalSyncOptions): Promise<ApprovalSync> {
  let items: ApprovalRequest[];
  try {
    items = await opts.listPending();
  } catch {
    // Endpoint unavailable; the frame path may still deliver.
    return { added: [], deadlines: new Map() };
  }
  const deadlines = new Map(items.map((item) => [item.id, deadlineOf(item)]));
  const fresh = items.filter((item) => !opts.seen.has(item.id));
  if (!fresh.length) return { added: [], deadlines };

  const entries: PendingApproval[] = [];
  for (const item of fresh) {
    opts.seen.add(item.id);
    const args = item.args ?? {};
    let before: string | null = null;
    if (item.tool_name === 'write_file' && typeof args.path === 'string' && opts.readForDiff) {
      before = await opts.readForDiff(args.path);
    }
    entries.push({
      approvalId: item.id,
      toolName: item.tool_name,
      args,
      before,
      ...(item.rule_id ? { ruleId: item.rule_id } : {}),
      expiresAt: deadlineOf(item),
    });
  }
  return { added: entries, deadlines };
}

/**
 * Approving a *modified* call — the third answer between yes and no.
 *
 * The harness has accepted it all along (`edited_args` on the decision, applied
 * in `manifests/builder.py`) and no client offered it, so a write to the wrong
 * path could only be denied: throwing away a correct intention over a wrong
 * detail, and making the model guess again.
 *
 * **An edit is not a correction to the call in front of you.** The grant is
 * matched on a hash of the *original* arguments, and the reuse path applies
 * `edited_args` too — so an edited approval is a substitution standing for
 * every identical call until the grant expires. Anything that renders this owes
 * the operator that sentence.
 */
export type ArgEdit =
  | { status: 'unchanged' }
  | { status: 'edited'; args: Record<string, unknown> }
  | { status: 'invalid'; error: string };

/** The arguments as something a person can edit. */
export function formatArgsForEditing(args: Record<string, unknown>): string {
  return `${JSON.stringify(args, null, 2)}\n`;
}

/**
 * Read edited arguments back, or say why they cannot be used.
 *
 * Refuses anything that is not a JSON **object**. The harness spreads the value
 * over the call's arguments, so a bare array or string would pass a naive parse
 * and arrive as a tool call with no arguments at all — a silent success that
 * runs the wrong thing.
 *
 * `unchanged` is its own answer rather than an edit equal to the original,
 * because approving with `edited_args` installs a substitution, and installing
 * one for an unmodified call is a surprise nobody asked for.
 */
export function parseEditedArgs(text: string, original: Record<string, unknown>): ArgEdit {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { status: 'invalid', error: err instanceof Error ? err.message : 'not valid JSON' };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { status: 'invalid', error: 'arguments must be a JSON object' };
  }
  const args = parsed as Record<string, unknown>;
  // Key order is not a change, so both sides go through the same serializer
  // with sorted keys rather than being compared as written.
  const same =
    JSON.stringify(args, Object.keys(args).sort()) ===
    JSON.stringify(original, Object.keys(original).sort());
  return same ? { status: 'unchanged' } : { status: 'edited', args };
}
