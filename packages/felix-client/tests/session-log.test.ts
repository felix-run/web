import type { SessionEvent, SessionSnapshot } from '@felix/protocol';
import { describe, expect, it } from 'vitest';
import {
  eventsToTurns,
  mergeSessions,
  snapshotToEvents,
  type ThreadMeta,
  threadSuffix,
  titleFromText,
} from '../src/session-log';

/**
 * Turning the harness's append-only event log back into a transcript, and
 * folding its thread list into a client's own.
 *
 * Both are pure, and both fail quietly: a mistake in `eventsToTurns` shows up as
 * a mangled history rather than an error, and a mistake in `mergeSessions` as a
 * duplicated sidebar row or a silently dropped conversation.
 */

const ev = (over: Partial<SessionEvent> & { seq: number }): SessionEvent =>
  ({ kind: 'message', ...over }) as SessionEvent;

describe('titleFromText', () => {
  it('uses the text when it is short', () => {
    expect(titleFromText('Short question')).toBe('Short question');
  });

  it('truncates a long first message', () => {
    const title = titleFromText('x'.repeat(200));
    expect(title.length).toBeLessThan(200);
  });

  it('falls back for empty or whitespace-only text', () => {
    expect(titleFromText('   ')).toBeTruthy();
    expect(titleFromText('')).toBeTruthy();
  });

  it('collapses newlines into a single line', () => {
    expect(titleFromText('first line\nsecond line')).not.toContain('\n');
  });
});

describe('eventsToTurns — rebuilding a transcript from the server log', () => {
  /**
   * A rebuilt turn has to say when its calls happened, not just that they did.
   * The harness attaches a message's `tool_calls` to the message that decided on
   * them, so they run *after* its prose — rendering them above it was backwards,
   * and it was the reload path's version of the bug `interleaveTurn` fixes live.
   */
  it("dates a message's own calls to the end of its prose", () => {
    const [turn] = eventsToTurns([
      ev({
        seq: 1,
        role: 'assistant',
        content: 'let me check',
        tool_calls: [{ id: 'a', name: 'read_file', args: {} }],
      }),
    ]);
    expect(turn?.tools?.[0]).toMatchObject({ name: 'read_file', at: 'let me check'.length });
  });

  it('keeps a tool-only step ahead of the prose it is carried into', () => {
    // No content on the calling step, so its cards stamp 0 and stay above the
    // answer they were held for, while that answer's own call lands below it.
    const [turn] = eventsToTurns([
      ev({
        seq: 1,
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'a', name: 'first', args: {} }],
      }),
      ev({ seq: 2, kind: 'tool_result', role: 'tool', tool_call_id: 'a', content: 'done' }),
      ev({
        seq: 3,
        role: 'assistant',
        content: 'found it',
        tool_calls: [{ id: 'b', name: 'second', args: {} }],
      }),
    ]);
    expect(turn?.tools?.map((t) => [t.name, t.at])).toEqual([
      ['first', 0],
      ['second', 'found it'.length],
    ]);
  });

  it('pairs user and assistant messages in order', () => {
    const turns = eventsToTurns([
      ev({ seq: 1, role: 'user', content: 'question' }),
      ev({ seq: 2, role: 'assistant', content: 'answer' }),
    ]);
    expect(turns.map((t) => [t.role, t.content])).toEqual([
      ['user', 'question'],
      ['assistant', 'answer'],
    ]);
  });

  it('sorts by seq rather than trusting array order', () => {
    const turns = eventsToTurns([
      ev({ seq: 2, role: 'assistant', content: 'second' }),
      ev({ seq: 1, role: 'user', content: 'first' }),
    ]);
    expect(turns.map((t) => t.content)).toEqual(['first', 'second']);
  });

  it('drops system messages, which the UI never renders', () => {
    const turns = eventsToTurns([
      ev({ seq: 1, role: 'system', content: 'you are a helpful assistant' }),
      ev({ seq: 2, role: 'user', content: 'hi' }),
    ]);
    expect(turns.every((t) => t.role !== ('system' as unknown))).toBe(true);
    expect(turns.map((t) => t.content)).toEqual(['hi']);
  });

  it('ignores an empty log', () => {
    expect(eventsToTurns([])).toEqual([]);
  });

  it('carries the server event id so a turn can be rewound to', () => {
    const turns = eventsToTurns([ev({ seq: 1, id: 'evt-abc', role: 'user', content: 'hi' })]);
    expect(turns[0]?.eventId).toBe('evt-abc');
  });
});

describe('snapshotToEvents — trimming to the active branch', () => {
  /**
   * `GET /chat/sessions/{id}` returns every event on the session and reports the
   * active branch separately as `leafId`. Rendering the raw list makes a rewind
   * invisible: verified against a live harness, moving the leaf to the first of
   * four events left all four on screen, so the action looked like a no-op while
   * still changing where the next turn continues from.
   */
  const snapshot = (leafId: string | null | undefined): SessionSnapshot =>
    ({
      leafId,
      transcript: [
        { id: 'e1', seq: 1, kind: 'message', role: 'user', content: 'one' },
        { id: 'e2', seq: 2, kind: 'message', role: 'assistant', content: 'two' },
        { id: 'e3', seq: 3, kind: 'message', role: 'user', content: 'three' },
      ],
    }) as unknown as SessionSnapshot;

  it('drops everything after the leaf', () => {
    const events = snapshotToEvents(snapshot('e1'));
    expect(events.map((e) => e.id)).toEqual(['e1']);
  });

  it('keeps the whole transcript when the leaf is the newest event', () => {
    const events = snapshotToEvents(snapshot('e3'));
    expect(events.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
  });

  it('keeps everything when the harness reports no leaf', () => {
    expect(snapshotToEvents(snapshot(null)).map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
    expect(snapshotToEvents(snapshot(undefined)).map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
  });

  it('keeps everything when the leaf is not in the transcript', () => {
    // Better a transcript that is too long than one silently emptied.
    expect(snapshotToEvents(snapshot('gone')).map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
  });
});

/**
 * The server/local merge.
 *
 * Neither side is a superset: the harness owns which threads exist and what
 * they are *named*, while localStorage is the only record of which manifest a
 * thread used and the only copy of a transcript for a thread that never reached
 * a harness. Getting this wrong is quiet in both directions — a duplicated row
 * for every thread, or a sidebar that silently drops conversations.
 */
describe('threadSuffix', () => {
  it('strips the tenant prefix the harness scopes ids with', () => {
    expect(threadSuffix('default:abc-123')).toBe('abc-123');
  });

  it('leaves a bare id alone', () => {
    expect(threadSuffix('abc-123')).toBe('abc-123');
  });

  it('splits on the last colon, since a suffix can never contain one', () => {
    // The harness rejects a suffix containing ':' outright, so any earlier colon
    // belongs to the tenant id.
    expect(threadSuffix('acme:eu:abc-123')).toBe('abc-123');
  });
});

describe('mergeSessions', () => {
  const local = (over: Partial<ThreadMeta> = {}): ThreadMeta => ({
    id: 't1',
    title: 'Local title',
    manifest: 'cowork',
    updatedAt: 100,
    ...over,
  });

  it('keeps the local manifest, which the harness does not track', () => {
    const out = mergeSessions([local()], [{ id: 't1', name: null, updatedAt: 200 }]);
    expect(out).toHaveLength(1);
    expect(out[0]?.manifest).toBe('cowork');
    expect(out[0]?.onServer).toBe(true);
  });

  it('lets a server name override the locally derived title', () => {
    const out = mergeSessions([local()], [{ id: 't1', name: 'Quarterly review', updatedAt: 200 }]);
    expect(out[0]?.title).toBe('Quarterly review');
    expect(out[0]?.named).toBe(true);
  });

  it('keeps the derived title when the thread has no server name', () => {
    const out = mergeSessions([local()], [{ id: 't1', name: null, updatedAt: 200 }]);
    expect(out[0]?.title).toBe('Local title');
    expect(out[0]?.named).toBe(false);
  });

  it('treats a whitespace-only server name as unnamed', () => {
    const out = mergeSessions([local()], [{ id: 't1', name: '   ', updatedAt: 200 }]);
    expect(out[0]?.title).toBe('Local title');
    expect(out[0]?.named).toBe(false);
  });

  it('surfaces a thread that exists only on the server', () => {
    const out = mergeSessions([], [{ id: 'remote', name: 'From another device', updatedAt: 5 }]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'remote', title: 'From another device', onServer: true });
    // No local record, so no manifest is known until it is opened.
    expect(out[0]?.manifest).toBe('');
  });

  // Dropping this row would destroy the only copy of its transcript.
  it('keeps a local-only thread and marks it as such', () => {
    const out = mergeSessions([local({ id: 'offline' })], []);
    expect(out).toHaveLength(1);
    expect(out[0]?.onServer).toBe(false);
  });

  it('does not duplicate a thread present on both sides', () => {
    const out = mergeSessions(
      [local({ id: 'same' })],
      [{ id: 'same', name: null, updatedAt: 300 }],
    );
    expect(out).toHaveLength(1);
  });

  it('sorts newest first across both sources', () => {
    const out = mergeSessions(
      [local({ id: 'old', updatedAt: 1 }), local({ id: 'localnew', updatedAt: 500 })],
      [{ id: 'mid', name: null, updatedAt: 100 }],
    );
    expect(out.map((t) => t.id)).toEqual(['localnew', 'mid', 'old']);
  });

  it('prefers the server timestamp, which reflects other clients', () => {
    const out = mergeSessions(
      [local({ updatedAt: 100 })],
      [{ id: 't1', name: null, updatedAt: 900 }],
    );
    expect(out[0]?.updatedAt).toBe(900);
  });
});
