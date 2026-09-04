/** @vitest-environment happy-dom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Two defects in one panel, both of the kind that reads as a style choice.
 *
 * The first is an accessibility failure with a plain mechanism: a `title` fires
 * on hover, and **disabled elements do not emit mouse events** — so an
 * explanation attached to a button that is disabled in exactly the state the
 * explanation describes could never be read by anyone. The second is a colour
 * inversion: a clean run drew the primary fill and a failing one drew muted
 * grey, so the outcome worth noticing was the quieter of the two.
 */

afterEach(cleanup);
beforeEach(() => {
  vi.resetModules();
});

const DATASET = { name: 'golden', description: '' };

async function sheet(over: { items?: unknown[]; runs?: unknown[] } = {}) {
  vi.doMock('../src/api', () => ({
    listEvalDatasets: vi.fn().mockResolvedValue([DATASET]),
    getEvalDataset: vi.fn().mockResolvedValue({ ...DATASET, items: over.items ?? [] }),
    listEvalItems: vi.fn().mockResolvedValue(over.items ?? []),
    listEvalRuns: vi.fn().mockResolvedValue(over.runs ?? []),
    putEvalDataset: vi.fn(),
    addEvalItem: vi.fn(),
    runEvalDataset: vi.fn(),
    getEvalRun: vi.fn(),
    compareEvalRuns: vi.fn(),
    listTenantManifests: vi.fn().mockResolvedValue([]),
  }));
  const { EvalSheet } = await import('../src/components/eval/eval-sheet');
  render(<EvalSheet open onOpenChange={() => {}} manifest="quick" />);
}

describe('an empty dataset says how to proceed', () => {
  it('puts the reason in the page, not in a tooltip nobody can fire', async () => {
    await sheet({ items: [] });
    await waitFor(() => expect(screen.getByText(/Add an item before running/i)).toBeTruthy());
    // The button is unavailable, which is right — and is why the tooltip that
    // used to carry this sentence could never have been read.
    const run = screen.getByRole('button', { name: /Run vs quick/i }) as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    expect(run.getAttribute('title')).toBeNull();
  });

  it('drops the explanation once it no longer applies', async () => {
    await sheet({ items: [{ item_id: 'i1', user_input: 'hi', rubric: {} }] });
    await waitFor(() => {
      const run = screen.getByRole('button', { name: /Run vs quick/i }) as HTMLButtonElement;
      expect(run.disabled).toBe(false);
    });
    expect(screen.queryByText(/Add an item before running/i)).toBeNull();
  });
});

describe('a failing run is not the quieter thing', () => {
  const run = (over: Record<string, unknown>) => ({
    run_id: 'r1',
    dataset_name: 'golden',
    candidate_manifest: 'quick',
    status: 'completed',
    pass_count: 3,
    fail_count: 0,
    scores: [],
    ...over,
  });

  it('carries the failed state colour when something failed', async () => {
    await sheet({ runs: [run({ pass_count: 1, fail_count: 2 })] });
    const badge = await waitFor(() => screen.getByText(/1\/3 pass/));
    // The *fill*, not the word: the base Badge class carries
    // `aria-invalid:border-destructive` whatever the variant, so matching
    // /destructive/ alone would pass for both and prove nothing.
    expect(badge.className).toMatch(/\bbg-destructive\b/);
  });

  it('does not shout about a clean one', async () => {
    await sheet({ runs: [run({ pass_count: 3, fail_count: 0 })] });
    const badge = await waitFor(() => screen.getByText(/3\/3 pass/));
    expect(badge.className).not.toMatch(/\bbg-destructive\b/);
    // Still legible as a pass, via the state palette rather than a loud fill.
    expect(badge.className).toMatch(/text-state-done/);
  });
});
