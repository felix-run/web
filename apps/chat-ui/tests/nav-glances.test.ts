import { describe, expect, it } from 'vitest';
import { errorCodeOf, eventHelp, recentFailures } from '../src/components/harness/activity';
import { draftGlance, glanceOf } from '../src/routes/harness';

/**
 * The rail's glances. Absence is the rail's all-clear, so every way a read can
 * fail has to draw *something*, and a count kept from an earlier read has to
 * look kept. Unit-tested because the cases need a good read followed by a
 * failed one, thirty seconds apart.
 */

const ago = (ms: number) => Date.now() - ms;
const RATE_LIMITED = new Error('jobs : 429');

describe('glanceOf', () => {
  it('draws nothing when a good read found none — the all-clear', () => {
    expect(glanceOf({ data: [], error: null, lastOkAt: ago(1000) }, 0, 'failing', 'jobs')).toBe(
      undefined,
    );
  });

  it('says unchecked when the first read failed', () => {
    const g = glanceOf(
      { data: undefined, error: RATE_LIMITED, lastOkAt: null },
      0,
      'failing',
      'jobs',
    );
    expect(g).toMatchObject({ text: 'unchecked', tone: 'unknown', title: "Couldn't check jobs" });
  });

  it('says unchecked — not the all-clear — when a read fails after a good one found none', () => {
    // The hole: this returned nothing, drawing "all clear" over a failed read.
    const g = glanceOf(
      { data: [], error: RATE_LIMITED, lastOkAt: ago(120_000) },
      0,
      'failing',
      'jobs',
    );
    expect(g?.text).toBe('unchecked');
    expect(g?.title).toMatch(/^Couldn't check jobs; last answered 2m ago with none$/);
  });

  it('keeps a count after a failed read, and shows its age on screen', () => {
    const g = glanceOf(
      { data: [1, 2, 3], error: RATE_LIMITED, lastOkAt: ago(120_000) },
      3,
      'failed',
      'activity',
    );
    expect(g).toMatchObject({ text: '3 failed', age: '2m', tone: 'failed' });
    expect(g?.title).toMatch(/as of 2m ago — the latest check failed/);
  });

  it('shows a current count with no age', () => {
    const g = glanceOf({ data: [1], error: null, lastOkAt: ago(1000) }, 1, 'failing', 'jobs');
    expect(g).toEqual({ text: '1 failing', title: '1 failing', tone: 'failed' });
  });

  it('names the window a bounded count covers, beside it and in its title', () => {
    const g = glanceOf(
      { data: [1], error: null, lastOkAt: ago(1000) },
      1,
      'failed',
      'activity',
      '24h',
    );
    expect(g).toEqual({
      text: '1 failed',
      span: '24h',
      title: '1 failed in the last 24h',
      tone: 'failed',
    });
  });

  it('reads "just now", not "now ago", for an answer seconds old', () => {
    const g = glanceOf(
      { data: [], error: RATE_LIMITED, lastOkAt: ago(1000) },
      0,
      'failing',
      'jobs',
    );
    expect(g?.title).toMatch(/last answered just now/);
  });
});

/**
 * The Activity page's glance is bounded by time. Counted over the page's last sixty
 * events instead, one failure on a quiet tenant kept the rail red for weeks.
 */
describe('recentFailures', () => {
  const now = Date.UTC(2026, 8, 27, 12);
  const hours = (h: number) => (now - h * 3_600_000) / 1000; // the harness sends seconds

  it('counts failures and denials inside the last 24 hours only', () => {
    const events = [
      { status: 'error', ts: hours(1) },
      { status: 'denied', ts: hours(23) },
      { status: 'ok', ts: hours(2) },
      { status: 'error', ts: hours(25) },
    ];
    expect(recentFailures(events, now)).toBe(2);
  });

  it('clears once the last failure ages out, with nothing newer', () => {
    expect(recentFailures([{ status: 'error', ts: hours(24.1) }], now)).toBe(0);
  });

  /**
   * One declined write put `Activity · 2 failed` in red on the rail: the
   * approval's `policy_deny`, and the reply the harness marks `error` after it.
   * Neither is a failure.
   */
  it('does not count an approval denial, or the reply after it, as a failure', () => {
    const thread = { thread_id: 'default:t' };
    const denial = [
      {
        event_type: 'policy_deny',
        status: 'denied',
        ts: hours(1),
        payload: { ...thread, tool: 'write_file', control: 'approvals' },
      },
      // An older harness: no `denied_calls`, so the turn around it decides.
      { event_type: 'final_response', status: 'error', ts: hours(1), payload: { ...thread } },
    ];
    expect(recentFailures(denial, now)).toBe(0);
    // A newer one says so itself.
    expect(
      recentFailures(
        [
          {
            event_type: 'final_response',
            status: 'error',
            ts: hours(1),
            payload: { denied_calls: 1 },
          },
        ],
        now,
      ),
    ).toBe(0);
    // A policy rule's refusal is still counted, as before.
    expect(
      recentFailures(
        [
          {
            event_type: 'policy_deny',
            status: 'denied',
            ts: hours(1),
            payload: { control: 'policy' },
          },
        ],
        now,
      ),
    ).toBe(1);
  });
});

/**
 * A failed call's detail used to read "The agent called a tool." — the same line
 * as a call that worked. The audit row records which call failed and not why.
 */
describe('eventHelp', () => {
  it('says where the reason lives when the harness recorded no error code', () => {
    expect(eventHelp({ event_type: 'tool_call', status: 'error', payload: {} })).toMatch(
      /keeps which call failed, not why/,
    );
    expect(eventHelp({ event_type: 'tool_call', status: 'ok', payload: {} })).toBe(
      'The agent called a tool.',
    );
  });

  it('says which kind of failure it was when the harness recorded the code', () => {
    const help = eventHelp({
      event_type: 'tool_call',
      status: 'error',
      payload: { error_code: 'permission_denied' },
    });
    expect(help).toMatch(/refused for lack of permission/);
    expect(help).toMatch(/full message is on the call's card/);
  });

  it('shows a code it does not know as the harness spelled it', () => {
    expect(
      eventHelp({ event_type: 'tool_call', status: 'error', payload: { error_code: 'quota' } }),
    ).toMatch(/failed with `quota`/);
  });

  /**
   * The harness writes `final_response` as `error` when any call in the turn
   * failed or was refused, and the agent usually replied anyway. The red row
   * used to open to "the agent produced its reply" — a success sentence under a
   * Failed status.
   */
  it('does not explain a failed turn as a successful reply', () => {
    const replied = eventHelp({
      event_type: 'final_response',
      status: 'error',
      payload: { chars: 31 },
    });
    expect(replied).not.toMatch(/produced its reply/);
    expect(replied).toMatch(/stopped on an error/);
    expect(replied).toMatch(/replied after it/);
    expect(
      eventHelp({ event_type: 'final_response', status: 'error', payload: { chars: 0 } }),
    ).toMatch(/produced no reply/);
    expect(eventHelp({ event_type: 'final_response', status: 'ok', payload: {} })).toBe(
      'The turn ended; the agent produced its reply.',
    );
  });
});

describe('errorCodeOf', () => {
  it('reads a non-empty string and nothing else', () => {
    expect(errorCodeOf({ payload: { error_code: 'timeout' } })).toBe('timeout');
    expect(errorCodeOf({ payload: { error_code: '' } })).toBeUndefined();
    expect(errorCodeOf({ payload: { error_code: 3 } })).toBeUndefined();
    expect(errorCodeOf({ payload: {} })).toBeUndefined();
  });
});

describe('draftGlance', () => {
  it('draws nothing when no draft is waiting', () => {
    expect(draftGlance({ data: [], error: null, lastOkAt: ago(1000) })).toBe(undefined);
  });

  it('counts waiting drafts in amber, and names them in full for a reader', () => {
    expect(draftGlance({ data: [1], error: null, lastOkAt: ago(1000) })).toMatchObject({
      text: '1 waiting',
      title: '1 skill draft waiting for review',
      tone: 'blocked',
    });
  });

  it('says 100+ when the read came back full', () => {
    const g = draftGlance({ data: Array(100).fill(0), error: null, lastOkAt: ago(1000) });
    expect(g?.text).toBe('100+ waiting');
  });

  it('keeps a count after a failed read, in amber with its age', () => {
    const g = draftGlance({ data: [1, 2], error: RATE_LIMITED, lastOkAt: ago(120_000) });
    expect(g).toMatchObject({ text: '2 waiting', age: '2m', tone: 'blocked' });
    expect(g?.title).toBe(
      '2 skill drafts waiting for review, as of 2m ago — the latest check failed',
    );
  });

  it('says unchecked rather than the all-clear when the first read failed', () => {
    expect(draftGlance({ data: undefined, error: RATE_LIMITED, lastOkAt: null })?.tone).toBe(
      'unknown',
    );
  });
});
