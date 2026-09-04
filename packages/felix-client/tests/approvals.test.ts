import { describe, expect, it } from 'vitest';
import {
  type ApprovalRequest,
  DEFAULT_APPROVAL_TTL_MS,
  formatArgsForEditing,
  formatCountdown,
  msUntilDecision,
  parseEditedArgs,
  syncApprovals,
} from '../src/approvals';

/**
 * Not answering an approval is answering it.
 *
 * The harness calls `wait_for_decision` with the rule's `ttl_seconds` — or five
 * minutes when the rule sets none — and on timeout returns `denied` with the
 * note `timeout`. The tool is refused and the run moves on, while a client that
 * models no deadline goes on offering `y`/`n` for a decision already made.
 *
 * The same number is the grant's lifetime: approving authorizes every
 * byte-identical call to that tool until it passes, not the one call in front
 * of you.
 */

const row = (over: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
  id: 'ap-1',
  tenant_id: 't',
  manifest_id: 'm',
  tool_name: 'write_file',
  call_signature: 'sig',
  args: { path: 'a.ts' },
  principal_subj: '',
  status: 'pending',
  created_at: 1_000_000,
  decided_at: null,
  decided_by: '',
  decision_note: '',
  edited_args: null,
  rule_id: 'fs-write',
  ttl_seconds: null,
  expires_at: null,
  consumed_at: null,
  ...over,
});

const sync = (items: ApprovalRequest[], seen = new Set<string>()) =>
  syncApprovals({ listPending: async () => items, seen });

describe('the deadline', () => {
  it('is the row’s when the rule set one', async () => {
    const { added } = await sync([row({ ttl_seconds: 60, expires_at: 1_060_000 })]);
    expect(added[0]?.expiresAt).toBe(1_060_000);
  });

  /**
   * `expires_at` is null in exactly the case where the harness still stops
   * waiting — after its own default. Reporting "no deadline" there would repeat
   * the row rather than describe the behaviour.
   */
  it('is derived from the harness default when the rule set none', async () => {
    const { added } = await sync([row()]);
    expect(added[0]?.expiresAt).toBe(1_000_000 + DEFAULT_APPROVAL_TTL_MS);
  });

  it('carries the rule that gated the call', async () => {
    const { added } = await sync([row()]);
    expect(added[0]?.ruleId).toBe('fs-write');
  });

  it('leaves the rule off when the harness names none', async () => {
    const { added } = await sync([row({ rule_id: '' })]);
    expect(added[0]?.ruleId).toBeUndefined();
  });
});

/**
 * The frame announces an approval and says why it fired; only the row knows
 * when the harness gives up. So the poll has to report deadlines for
 * *everything* pending, not just what it is adding — otherwise an approval that
 * arrived by frame is already `seen`, gets skipped, and never learns its own.
 * That is the case a watched client hits on every gated call.
 */
describe('backfilling an approval that arrived as a frame', () => {
  it('reports a deadline for a row it is not adding', async () => {
    const seen = new Set(['ap-1']);
    const { added, deadlines } = await sync([row({ expires_at: 1_060_000 })], seen);
    expect(added).toEqual([]);
    expect(deadlines.get('ap-1')).toBe(1_060_000);
  });

  it('reports deadlines for new and known rows alike', async () => {
    const seen = new Set(['ap-1']);
    const { added, deadlines } = await sync(
      [row({ expires_at: 1_060_000 }), row({ id: 'ap-2', expires_at: 1_070_000 })],
      seen,
    );
    expect(added.map((a) => a.approvalId)).toEqual(['ap-2']);
    expect([...deadlines.keys()].sort()).toEqual(['ap-1', 'ap-2']);
  });

  /** An unreachable endpoint must not look like "everything expired". */
  it('reports nothing at all when the poll fails', async () => {
    const { added, deadlines } = await syncApprovals({
      listPending: async () => {
        throw new Error('offline');
      },
      seen: new Set(),
    });
    expect(added).toEqual([]);
    expect(deadlines.size).toBe(0);
  });
});

describe('msUntilDecision', () => {
  it('is null while no deadline is known', () => {
    expect(msUntilDecision({ expiresAt: null })).toBeNull();
    expect(msUntilDecision({})).toBeNull();
  });

  it('counts down', () => {
    expect(msUntilDecision({ expiresAt: 10_000 }, 4_000)).toBe(6_000);
  });

  /** Zero rather than negative, so "expired" is a value and not a sign. */
  it('floors at zero once it has lapsed', () => {
    expect(msUntilDecision({ expiresAt: 10_000 }, 99_000)).toBe(0);
  });
});

describe('formatCountdown', () => {
  it('uses seconds under the minute', () => {
    expect(formatCountdown(38_000)).toBe('38s');
    expect(formatCountdown(1_000)).toBe('1s');
  });

  it('uses minutes and seconds above it', () => {
    expect(formatCountdown(252_000)).toBe('4:12');
    expect(formatCountdown(300_000)).toBe('5:00');
  });

  /** Rounds up, so a live countdown never shows `0s` while time remains. */
  it('never reaches zero early', () => {
    expect(formatCountdown(1)).toBe('1s');
  });

  /** And rounding up crosses the minute cleanly rather than showing `60s`. */
  it('rolls 59.999 seconds over to a minute', () => {
    expect(formatCountdown(59_999)).toBe('1:00');
    expect(formatCountdown(59_000)).toBe('59s');
  });
});

/**
 * Approving a modified call — the harness's third answer, which no client
 * offered. A write to the wrong path could only be denied, which throws away a
 * correct intention over a wrong detail.
 *
 * The refusals below are the point of the function. The harness spreads
 * `edited_args` over the call, so a value that is not an object arrives as a
 * tool call with **no arguments at all** — a silent success that runs the wrong
 * thing, from an edit that looked accepted.
 */
describe('parseEditedArgs', () => {
  const original = { path: 'a.ts', content: 'x' };

  it('takes an edited object', () => {
    const edit = parseEditedArgs('{"path":"b.ts","content":"x"}', original);
    expect(edit).toEqual({ status: 'edited', args: { path: 'b.ts', content: 'x' } });
  });

  /**
   * Reported separately rather than as an edit equal to the original: approving
   * with `edited_args` installs a substitution, and installing one for a call
   * nobody modified is a surprise.
   */
  it('reports an untouched payload as unchanged', () => {
    expect(parseEditedArgs(JSON.stringify(original), original)).toEqual({ status: 'unchanged' });
  });

  it('does not mistake reformatting or key order for an edit', () => {
    expect(parseEditedArgs('{\n  "content": "x",\n  "path": "a.ts"\n}\n', original)).toEqual({
      status: 'unchanged',
    });
  });

  it('refuses malformed JSON rather than guessing', () => {
    const edit = parseEditedArgs('{"path": ', original);
    expect(edit.status).toBe('invalid');
  });

  /** The three shapes that parse cleanly and would run the wrong call. */
  it.each([
    ['an array', '["a.ts"]'],
    ['a string', '"a.ts"'],
    ['null', 'null'],
  ])('refuses %s, which would arrive as a call with no arguments', (_label, text) => {
    const edit = parseEditedArgs(text, original);
    expect(edit.status).toBe('invalid');
    if (edit.status === 'invalid') expect(edit.error).toContain('JSON object');
  });

  it('round-trips through the editing format', () => {
    expect(parseEditedArgs(formatArgsForEditing(original), original)).toEqual({
      status: 'unchanged',
    });
  });

  it('accepts an emptied object, which is a real thing to want', () => {
    expect(parseEditedArgs('{}', original)).toEqual({ status: 'edited', args: {} });
  });
});
