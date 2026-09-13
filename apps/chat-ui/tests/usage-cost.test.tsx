/** @vitest-environment happy-dom */

import type { UsageSummary } from '@felix/client';
import { describe, expect, it } from 'vitest';
import { summarizeWindow, usd, windowDays } from '../src/components/harness/ledger';

/**
 * What a usage total is allowed to claim.
 *
 * `cost_usd` arrived on the wire long before anything modelled it. Summing it is
 * the obvious thing to do and the obvious thing is wrong twice over. It was wrong
 * about *scope* — the client summed whichever page of rows it had fetched and
 * labelled the result the total — and it is wrong on its own terms: a model
 * with no entry in the pricing catalog is **metered but unpriced** — its tokens
 * count against the token caps while its spend records as zero, and the harness
 * counts that as `felix_model_unpriced`. A total that quietly includes those
 * rows is an underestimate presented as a total, which is the one number an
 * operator would act on.
 */

const DAY = 86_400_000;

const summary = (
  items: Partial<UsageSummary['items'][number]>[],
  over: Partial<UsageSummary> = {},
): UsageSummary => {
  const full = items.map((i) => ({
    manifest_id: 'm',
    model_id: 'x',
    day: '2026-09-12',
    calls: 1,
    tokens_input: 0,
    tokens_output: 0,
    cache_creation: 0,
    cache_read: 0,
    cost_usd: 0,
    ...i,
  }));
  return {
    since_ms: 0,
    until_ms: 30 * DAY,
    items: full,
    totals: {
      calls: full.reduce((n, i) => n + i.calls, 0),
      tokens_input: full.reduce((n, i) => n + i.tokens_input, 0),
      tokens_output: full.reduce((n, i) => n + i.tokens_output, 0),
      cache_creation: 0,
      cache_read: 0,
      cost_usd: full.reduce((n, i) => n + i.cost_usd, 0),
    },
    ...over,
  };
};

describe('summarizeWindow', () => {
  it('counts every turn in an unpriced bucket, not the bucket', () => {
    // The bucket is the unit the harness groups by, so one unpriced bucket can
    // stand for many turns. Counting buckets would under-report the gap by
    // exactly the amount that makes it worth reporting.
    const t = summarizeWindow(
      summary([
        { calls: 7, tokens_input: 900, tokens_output: 40 },
        { calls: 2, tokens_input: 900, tokens_output: 40, cost_usd: 0.0031 },
      ]),
    );
    expect(t.cost).toBeCloseTo(0.0031);
    expect(t.unpriced).toBe(7);
    expect(t.calls).toBe(9);
  });

  it('does not count an empty bucket as unpriced', () => {
    // No tokens and no cost is not a pricing gap, it is a bucket that did nothing.
    expect(summarizeWindow(summary([{ tokens_input: 0, tokens_output: 0 }])).unpriced).toBe(0);
  });

  /**
   * The totals come from the harness, not from the items. It groups and sums
   * server-side over the whole window; the items are what it chose to return,
   * and adding them up here would reintroduce exactly the bug this replaced —
   * a total that describes a page.
   */
  it('reports the harness totals rather than re-adding the items', () => {
    const t = summarizeWindow(
      summary([{ tokens_input: 10, tokens_output: 1 }], {
        totals: {
          calls: 5_000,
          tokens_input: 9_000_000,
          tokens_output: 120_000,
          cache_creation: 0,
          cache_read: 0,
          cost_usd: 41.5,
        },
      }),
    );
    expect(t.in).toBe(9_000_000);
    expect(t.calls).toBe(5_000);
    expect(t.cost).toBe(41.5);
  });
});

describe('windowDays', () => {
  it('reports the window the harness answered for, not the one that was asked', () => {
    expect(windowDays(summary([], { since_ms: 0, until_ms: 7 * DAY }))).toBe(7);
  });

  it('never reports zero days for a short window', () => {
    // A label reading "last 0 days" is worse than a slightly generous one.
    expect(windowDays(summary([], { since_ms: 0, until_ms: 1000 }))).toBe(1);
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
