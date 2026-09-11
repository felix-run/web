/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import { summarizeUsage, usd } from '../src/components/inspector/inspector';

/**
 * What a usage total is allowed to claim.
 *
 * `cost_usd` arrived on the wire long before anything modelled it. Summing it is
 * the obvious thing to do and the obvious thing is wrong on its own: a model
 * with no entry in the pricing catalog is **metered but unpriced** — its tokens
 * count against the token caps while its spend records as zero, and the harness
 * counts that as `felix_model_unpriced`. A total that quietly includes those
 * rows is an underestimate presented as a total, which is the one number an
 * operator would act on.
 */

describe('summarizeUsage', () => {
  it('counts a turn with tokens and no cost as unpriced', () => {
    const t = summarizeUsage([
      { tokens_input: 900, tokens_output: 40 },
      { tokens_input: 900, tokens_output: 40, cost_usd: 0.0031 },
    ] as never);
    expect(t.cost).toBeCloseTo(0.0031);
    expect(t.unpriced).toBe(1);
  });

  it('does not count an empty turn as unpriced', () => {
    // No tokens and no cost is not a pricing gap, it is a turn that did nothing.
    const t = summarizeUsage([{ tokens_input: 0, tokens_output: 0 }] as never);
    expect(t.unpriced).toBe(0);
  });
});

describe('usd', () => {
  it('does not round a real cost away', () => {
    // Two decimals shows `$0.00` for every ordinary turn and a running total
    // that never moves.
    expect(usd(0.000_04)).toBe('$0.00004');
    expect(usd(0.42)).toBe('$0.4200');
    expect(usd(12.5)).toBe('$12.50');
  });

  it('says plain zero rather than a string of decimals', () => {
    expect(usd(0)).toBe('$0');
  });
});
