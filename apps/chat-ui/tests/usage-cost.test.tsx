/** @vitest-environment happy-dom */

import type { UsageSummary } from '@felix/client';
import { describe, expect, it } from 'vitest';
import {
  byModel,
  summarizeWindow,
  usageHeader,
  usd,
  windowDays,
} from '../src/components/harness/ledger';

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

describe('byModel', () => {
  const item = (over: Record<string, unknown>) => ({
    manifest_id: 'cowork',
    model_id: 'claude-sonnet-4',
    day: '2026-09-01',
    calls: 1,
    tokens_input: 100,
    tokens_output: 10,
    cache_creation: 0,
    cache_read: 0,
    cost_usd: 0.5,
    ...over,
  });

  it('folds days into one row per agent and model, most expensive first', () => {
    const rows = byModel({
      since_ms: 0,
      until_ms: 86_400_000,
      totals: {} as never,
      items: [
        item({ day: '2026-09-01' }),
        item({ day: '2026-09-02', cost_usd: 1 }),
        item({ manifest_id: 'quick', model_id: 'haiku', cost_usd: 3 }),
      ],
    } as never);
    expect(rows.map((r) => `${r.manifest_id}/${r.model_id}`)).toEqual([
      'quick/haiku',
      'cowork/claude-sonnet-4',
    ]);
    expect(rows[1]).toMatchObject({ calls: 2, tokens: 220, cost: 1.5, unpriced: false });
  });

  it('calls a bucket with tokens and no price unpriced, not free', () => {
    const [row] = byModel({
      since_ms: 0,
      until_ms: 1,
      totals: {} as never,
      items: [item({ cost_usd: 0 })],
    } as never);
    expect(row?.unpriced).toBe(true);
  });
});

describe('usageHeader', () => {
  it('leads with what it cost, then how much, then over what', () => {
    expect(usageHeader({ in: 24_470_680, out: 196_558, cost: 79.5, unpriced: 0 }, 30)).toBe(
      '$79.50 · 24.7M tokens · last 30 days',
    );
  });

  it('marks a floor as a floor when any turn was unpriced', () => {
    expect(usageHeader({ in: 1000, out: 0, cost: 2, unpriced: 3 }, 7)).toMatch(/^≥ \$2\.00 · /);
  });
});
