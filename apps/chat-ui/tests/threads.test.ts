import { beforeEach, describe, expect, it } from 'vitest';
import {
  eventsToTurns,
  indexThread,
  listThreads,
  loadTurns,
  migrateLegacy,
  removeThread,
  saveTurns,
  titleFromText,
} from '../src/lib/threads';
import type { SessionEvent } from '../src/types';

/**
 * The thread store is the only reason a conversation survives a reload for an
 * anonymous caller: `GET /chat/history/:id` rejects them, so this localStorage
 * mirror is the transcript. `eventsToTurns` is the rebuild path — it turns the
 * server's append-only event log back into the UI's turn list, and a mistake
 * there shows up as a mangled history rather than an error.
 */

beforeEach(() => {
  localStorage.clear();
});

const ev = (over: Partial<SessionEvent> & { seq: number }): SessionEvent =>
  ({ kind: 'message', ...over }) as SessionEvent;

describe('the thread index', () => {
  it('starts empty', () => {
    expect(listThreads()).toEqual([]);
  });

  it('keeps the most recently updated thread first', () => {
    indexThread({ id: 'older', title: 'Older', manifest: 'cowork', updatedAt: 1_000 });
    indexThread({ id: 'newer', title: 'Newer', manifest: 'cowork', updatedAt: 2_000 });
    expect(listThreads().map((t) => t.id)).toEqual(['newer', 'older']);
  });

  it('updates an existing entry rather than duplicating it', () => {
    indexThread({ id: 'a', title: 'First title', manifest: 'cowork', updatedAt: 1_000 });
    indexThread({ id: 'a', title: 'Renamed', manifest: 'cowork', updatedAt: 3_000 });
    const threads = listThreads();
    expect(threads).toHaveLength(1);
    expect(threads[0]?.title).toBe('Renamed');
  });

  it('round-trips a transcript', () => {
    const turns = [
      { id: '1', role: 'user' as const, content: 'hello' },
      { id: '2', role: 'assistant' as const, content: 'hi there' },
    ];
    saveTurns('t1', turns);
    expect(loadTurns('t1')).toEqual(turns);
  });

  it('returns an empty transcript for an unknown thread', () => {
    expect(loadTurns('never-existed')).toEqual([]);
  });

  it('survives corrupt stored data instead of throwing', () => {
    localStorage.setItem('felix.threads', '{{ not json');
    expect(listThreads()).toEqual([]);
  });

  it('forgets a thread and its transcript together', () => {
    indexThread({ id: 'doomed', title: 'Doomed', manifest: 'cowork', updatedAt: 1 });
    saveTurns('doomed', [{ id: '1', role: 'user', content: 'x' }]);
    removeThread('doomed');
    expect(listThreads()).toEqual([]);
    expect(loadTurns('doomed')).toEqual([]);
  });
});

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

describe('migrateLegacy', () => {
  it('does nothing when there is no legacy data', () => {
    expect(() => migrateLegacy(Date.now())).not.toThrow();
    expect(listThreads()).toEqual([]);
  });

  it('is safe to run twice', () => {
    const now = Date.now();
    migrateLegacy(now);
    const first = listThreads();
    migrateLegacy(now);
    expect(listThreads()).toEqual(first);
  });
});
