import { describe, expect, it } from 'vitest';
import { formatEpilogue } from '../src/epilogue';

/**
 * The screen is gone by the time this is printed, which is the whole point: the
 * thread id is the one thing that cannot be recovered from a terminal Ink has
 * just restored, and `--thread` is what takes it back.
 */

describe('formatEpilogue', () => {
  it('says nothing about a thread nothing was said in', () => {
    expect(formatEpilogue({ threadId: 'abc', turns: 0 })).toBeUndefined();
  });

  it('names the thread and how to rejoin it', () => {
    const text = formatEpilogue({ threadId: 'abc-123', title: 'Proxy worker', turns: 4 });
    expect(text).toContain('Proxy worker');
    expect(text).toContain('felix --thread abc-123');
  });

  it('still gives the id when the thread was never named', () => {
    const text = formatEpilogue({ threadId: 'abc-123', turns: 2 });
    expect(text).toContain('felix --thread abc-123');
  });
});
