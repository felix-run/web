import { describe, expect, it } from 'vitest';
import { HINT_LIMIT, hintsByRow } from '@/lib/mentions';

/**
 * A message may only be disambiguated by work the agent had already done when
 * it wrote the message. Letting a later tool call reach back would resolve
 * "see foo.md" to a file that did not exist at the time — plausible, wrong, and
 * invisible.
 */
describe('hintsByRow', () => {
  it('gives the first row nothing', () => {
    expect(hintsByRow([{ paths: ['a/one.ts'] }])).toEqual([[]]);
  });

  it('offers a path only to rows after it', () => {
    expect(hintsByRow([{}, { paths: ['a/one.ts'] }, {}])).toEqual([[], [], ['a/one.ts']]);
  });

  it('accumulates in order', () => {
    expect(hintsByRow([{ paths: ['a.ts'] }, { paths: ['b.ts'] }, { paths: ['c.ts'] }, {}])).toEqual(
      [[], ['a.ts'], ['a.ts', 'b.ts'], ['a.ts', 'b.ts', 'c.ts']],
    );
  });

  it('handles rows with no paths at all', () => {
    expect(hintsByRow([{}, {}, {}])).toEqual([[], [], []]);
  });

  it('returns one entry per row', () => {
    const rows = Array.from({ length: 25 }, () => ({ paths: ['x/y.ts'] }));
    expect(hintsByRow(rows)).toHaveLength(25);
  });

  it('keeps the most recent paths when the transcript runs long', () => {
    const rows = Array.from({ length: HINT_LIMIT + 50 }, (_, i) => ({ paths: [`d${i}/f${i}.ts`] }));
    const last = hintsByRow(rows).at(-1) ?? [];
    expect(last).toHaveLength(HINT_LIMIT);
    // The oldest are the ones dropped.
    expect(last).not.toContain('d0/f0.ts');
    expect(last).toContain(`d${HINT_LIMIT + 48}/f${HINT_LIMIT + 48}.ts`);
  });

  // Each entry is handed to a different component; sharing one growing array
  // would give every row the final state.
  it("does not let a later row mutate an earlier row's hints", () => {
    const out = hintsByRow([{ paths: ['a.ts'] }, { paths: ['b.ts'] }, {}]);
    expect(out[1]).toEqual(['a.ts']);
    expect(out[2]).toEqual(['a.ts', 'b.ts']);
  });
});
