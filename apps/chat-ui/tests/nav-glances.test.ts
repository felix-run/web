import { describe, expect, it } from 'vitest';
import { glanceOf } from '../src/routes/harness';

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
      'the ledger',
    );
    expect(g).toMatchObject({ text: '3 failed', age: '2m', tone: 'failed' });
    expect(g?.title).toMatch(/as of 2m ago — the latest check failed/);
  });

  it('shows a current count with no age', () => {
    const g = glanceOf({ data: [1], error: null, lastOkAt: ago(1000) }, 1, 'failing', 'jobs');
    expect(g).toEqual({ text: '1 failing', title: '1 failing', tone: 'failed' });
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
