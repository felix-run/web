/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  askAgainText,
  askableDenials,
  decidedHere,
  denialSubject,
  deniedCalls,
  matchDenials,
  rememberDecidedHere,
  waitLength,
} from '../src/lib/denials';
import type { ApprovalRequest, ToolCall, Turn } from '../src/types';

/**
 * Who denied a call, and when, is on the approval row, not on the tool result.
 * These pin how a card is matched to its row — by the call id the row names, else by
 * order and only while the order is certain — and that "you" is never said without this browser having
 * made the decision.
 */

const denied = (tool: string, note = 'denied'): ToolCall => ({
  name: tool,
  done: true,
  output: `[approval ${note}] tool=${tool} rule=r`,
});
const ok = (tool: string): ToolCall => ({ name: tool, done: true, output: '{"ok":true}' });
const turn = (role: Turn['role'], tools: ToolCall[] = []): Turn =>
  ({ id: Math.random().toString(36), role, content: '', tools }) as Turn;
const row = (over: Partial<ApprovalRequest>): ApprovalRequest =>
  ({
    id: 'r',
    tenant_id: 'default',
    manifest_id: 'quick',
    tool_name: 'write_file',
    call_signature: 'x',
    args: {},
    principal_subj: 'local-dev',
    status: 'denied',
    created_at: 1,
    decided_at: 2,
    decided_by: 'local-dev',
    decision_note: '',
    edited_args: null,
    rule_id: 'r',
    ttl_seconds: null,
    expires_at: null,
    consumed_at: null,
    thread_id: 'th',
    ...over,
  }) as ApprovalRequest;

beforeEach(() => localStorage.clear());

describe('matchDenials', () => {
  it('pairs the n-th denied card with the n-th denied row for its tool, oldest first', () => {
    const a = denied('write_file');
    const b = denied('write_file');
    const turns = [turn('assistant', [a, ok('read_file')]), turn('assistant', [b])];
    const rows = [
      row({ id: 'second', created_at: 20, decided_at: 21 }),
      row({ id: 'first', created_at: 10, decided_at: 11 }),
      row({ id: 'elsewhere', created_at: 5, thread_id: 'other' }),
    ];
    const m = matchDenials(deniedCalls(turns), rows, 'th', () => false);
    expect(m.get(a)?.id).toBe('first');
    expect(m.get(b)?.id).toBe('second');
    expect(m.get(b)?.ttlSeconds).toBe(300);
  });

  it('matches nothing for a tool whose counts disagree, rather than guess', () => {
    const a = denied('write_file');
    const m = matchDenials(
      deniedCalls([turn('assistant', [a])]),
      [row({ id: '1', created_at: 1 }), row({ id: '2', created_at: 2 })],
      'th',
    );
    expect(m.size).toBe(0);
  });

  it('knows a decision this browser made', () => {
    rememberDecidedHere('mine');
    expect(decidedHere('mine')).toBe(true);
    expect(decidedHere('theirs')).toBe(false);
    const a = denied('write_file');
    const m = matchDenials(deniedCalls([turn('assistant', [a])]), [row({ id: 'mine' })], 'th');
    expect(m.get(a)?.here).toBe(true);
  });
});

/**
 * Since 0.15 the row names the call it blocked (`tool_call_id`), so a card that carries its
 * `callId` is matched exactly — even where the order rule would refuse, or would pair it with
 * the wrong row.
 */
describe('matchDenials by call id', () => {
  const withId = (tool: string, callId: string): ToolCall => ({ ...denied(tool), callId });

  it('matches a card to the row that names its call, whatever the order says', () => {
    const a = withId('write_file', 'call-a');
    const b = withId('write_file', 'call-b');
    // Created in the opposite order to the cards: by order, each would get the other's row.
    const rows = [
      row({ id: 'rb', tool_call_id: 'call-b', created_at: 1, decided_by: 'ops' }),
      row({ id: 'ra', tool_call_id: 'call-a', created_at: 2, decided_by: 'blake' }),
    ];
    const out = matchDenials([a, b], rows, 'th', () => false);
    expect(out.get(a)?.id).toBe('ra');
    expect(out.get(b)?.id).toBe('rb');
  });

  it('matches by id where the counts disagree, which the order rule refuses', () => {
    const a = withId('write_file', 'call-a');
    // A second row for the tool, on a branch since abandoned: two rows, one card.
    const rows = [
      row({ id: 'old', tool_call_id: 'call-x', created_at: 1 }),
      row({ id: 'ra', tool_call_id: 'call-a', created_at: 2 }),
    ];
    expect(matchDenials([a], rows, 'th', () => false).get(a)?.id).toBe('ra');
  });

  it('falls back to order for what is left, only where the remaining counts agree', () => {
    const a = withId('write_file', 'call-a');
    const legacy = denied('write_file'); // rebuilt with no id
    const rows = [
      row({ id: 'ra', tool_call_id: 'call-a', created_at: 2 }),
      row({ id: 'r-old', created_at: 1 }), // an older harness's row, no call id
    ];
    const out = matchDenials([legacy, a], rows, 'th', () => false);
    expect(out.get(a)?.id).toBe('ra');
    expect(out.get(legacy)?.id).toBe('r-old');
  });

  it('never matches a row to a card of another tool, even on the same call id', () => {
    const a = withId('delete_file', 'call-a');
    const rows = [row({ id: 'ra', tool_name: 'write_file', tool_call_id: 'call-a' })];
    expect(matchDenials([a], rows, 'th', () => false).get(a)).toBeUndefined();
  });
});

describe('denialSubject', () => {
  const issue = (note: string) => ({ kind: 'denied' as const, label: 'denied', message: '', note });
  const rec = (over = {}) => ({
    id: 'r',
    decidedBy: 'local-dev',
    decidedAt: 1,
    ttlSeconds: 300,
    here: false,
    ...over,
  });

  it('never says "you" without this browser having decided', () => {
    expect(denialSubject(issue('denied'), rec({ here: true })).lead).toBe('Denied by you');
    expect(denialSubject(issue('denied'), rec())).toMatchObject({
      lead: 'Denied by',
      who: 'local-dev',
    });
    expect(denialSubject(issue('denied'), null)).toMatchObject({ lead: 'Denied', who: null });
  });

  it('says the harness denied a call nobody answered, with how long it waited', () => {
    expect(denialSubject(issue('timeout'), rec({ decidedBy: 'felix' }))).toMatchObject({
      lead: 'Timed out after 5 min',
      who: null,
      tail: 'The harness denied it.',
    });
    expect(denialSubject(issue('timeout'), null).lead).toBe('Timed out');
    expect(waitLength(90)).toBe('2 min');
    expect(waitLength(30)).toBe('30 s');
    expect(waitLength(5400)).toBe('1 h 30 min');
  });
});

describe('askableDenials and askAgainText', () => {
  it('offers only the newest reply\x27s denials, after the last thing sent', () => {
    const old = denied('write_file');
    const fresh = denied('write_file');
    const turns = [
      turn('assistant', [old]),
      turn('user'),
      turn('assistant', [ok('read_file')]),
      turn('assistant', [fresh]),
    ];
    const askable = askableDenials(turns);
    expect(askable.has(fresh)).toBe(true);
    expect(askable.has(old)).toBe(false);
  });

  it('asks the agent to try again, and does not claim to replay the call', () => {
    expect(askAgainText('client · local_write')).toBe(
      "Please try the local_write call again; I'll approve it.",
    );
  });
});
