import { beforeEach, describe, expect, it } from 'vitest';
import {
  indexThread,
  listThreads,
  loadTurns,
  matchExcerpt,
  migrateLegacy,
  removeThread,
  saveTurns,
} from '../src/lib/threads';

/**
 * The thread store is the only reason a conversation survives a reload for an
 * anonymous caller: `GET /chat/history/:id` rejects them, so this localStorage
 * mirror is the transcript. The reconstruction it feeds — the server event log
 * to turns — is `@felix/client`'s, and tested there.
 */

beforeEach(() => {
  localStorage.clear();
});

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

describe('matchExcerpt', () => {
  it('keeps the words around the match, on one line, and says where it cut', () => {
    const body = `${'x '.repeat(80)}update the\n\n  README   before the tag ${'y '.repeat(80)}`;
    const out = matchExcerpt(body, 'readme');
    expect(out).toContain('README before the tag');
    expect(out.startsWith('…')).toBe(true);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/\s{2}|\n/);
  });

  it("reads JSON's escapes back rather than showing them", () => {
    expect(matchExcerpt('{"a": "one\\nREADME \\u2014 \\"two\\""}', 'readme')).toBe(
      '{"a": "one README — "two""}',
    );
  });

  it('returns short content whole and falls back to the head when the term is not verbatim', () => {
    expect(matchExcerpt('short one', 'x')).toBe('short one');
    expect(matchExcerpt('a'.repeat(100), 'zzz').startsWith('aaa')).toBe(true);
  });
});
