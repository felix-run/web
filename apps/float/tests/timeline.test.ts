import { describe, expect, it } from 'vitest';
import { settleRunningTools } from '@/lib/timeline';
import type { TimelineItem } from '@/types';

const row = (over: Partial<TimelineItem>): TimelineItem => ({
  id: 'x',
  kind: 'tool',
  title: 'write_file',
  status: 'running',
  ...over,
});

describe('settleRunningTools', () => {
  it('closes a tool row that never reported', () => {
    const [out] = settleRunningTools([row({ id: 'a' })]);
    expect(out).toMatchObject({ status: 'error', body: 'no result reported' });
  });

  it('keeps whatever the row already showed', () => {
    const [out] = settleRunningTools([row({ id: 'a', body: '{"path":"x.md"}' })]);
    expect(out).toMatchObject({ status: 'error', body: '{"path":"x.md"}' });
  });

  it('leaves rows that already settled alone', () => {
    const before = [
      row({ id: 'a', status: 'done', body: 'ok' }),
      row({ id: 'b', status: 'error', body: 'boom' }),
    ];
    expect(settleRunningTools(before)).toEqual(before);
  });

  it('touches only tool rows', () => {
    const out = settleRunningTools([
      row({ id: 'u', kind: 'user', status: 'pending', title: 'Steer' }),
      row({ id: 'a', kind: 'approval', status: 'pending', title: 'Needs approval' }),
      row({ id: 't' }),
    ]);
    expect(out.map((i) => i.status)).toEqual(['pending', 'pending', 'error']);
  });

  // Called on every run teardown, so a no-op must not force a render.
  it('returns the same array when there is nothing to settle', () => {
    const before = [row({ id: 'a', status: 'done' })];
    expect(settleRunningTools(before)).toBe(before);
  });

  it('settles every straggler, not just the first', () => {
    const out = settleRunningTools([row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })]);
    expect(out.every((i) => i.status === 'error')).toBe(true);
  });

  it('handles an empty timeline', () => {
    expect(settleRunningTools([])).toEqual([]);
  });
});
