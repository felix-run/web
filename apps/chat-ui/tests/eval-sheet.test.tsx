/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

/**
 * A run was collecting its own instrumentation and rendering none of it.
 *
 * `started_at`/`finished_at` on the run and `duration_ms`, `tokens_input`,
 * `tokens_output`, `tool_call_count` on every score — all present, all dropped,
 * so two runs of the same dataset against the same manifest stacked with nothing
 * to tell them apart. And the judge's `reasoning`, which *is* the output of an
 * eval, was reachable only as a `title` on hover over a response already cut at
 * 80 characters.
 */
describe('a run says what it cost', () => {
  const started = Date.parse('2026-09-11T10:00:00Z');
  const run = (over: Record<string, unknown> = {}) => ({
    run_id: 'r1',
    dataset_name: 'golden',
    candidate_manifest: 'quick',
    status: 'completed',
    started_at: started,
    finished_at: started + 4200,
    pass_count: 1,
    fail_count: 0,
    scores: [],
    ...over,
  });

  it('shows how long it took and what it burned', async () => {
    await sheet({
      runs: [
        run({
          scores: [
            {
              item_id: 'i1',
              score: 1,
              verdict: 'pass',
              reasoning: 'answers 42',
              response: '42',
              tokens_input: 900,
              tokens_output: 20,
              tool_call_count: 2,
            },
          ],
        }),
      ],
    });
    await waitFor(() => expect(screen.getByText(/4\.2s/)).toBeTruthy());
    expect(screen.getByText(/900 in \/ 20 out/)).toBeTruthy();
    expect(screen.getByText(/2 tool calls/)).toBeTruthy();
  });

  it('says a run is still going rather than implying it took no time', async () => {
    // `finished_at` is null while in flight, and `null - started` is a number
    // that renders as a duration — the wrong one.
    await sheet({ runs: [run({ finished_at: null, status: 'in_progress' })] });
    await waitFor(() => expect(screen.getByText(/still running/)).toBeTruthy());
  });

  it('claims no token count when the harness reported none', async () => {
    // The per-item numbers are optional on the wire. A row of zeroes would read
    // as a free run rather than an unreported one.
    await sheet({
      runs: [
        run({
          scores: [{ item_id: 'i1', score: 1, verdict: 'pass', reasoning: 'r', response: 'x' }],
        }),
      ],
    });
    await waitFor(() => expect(screen.getByText(/4\.2s/)).toBeTruthy());
    expect(screen.queryByText(/ in \/ /)).toBeNull();
  });

  it('survives a run with no start time rather than taking the sheet down', async () => {
    // `new Date(undefined).toISOString()` throws a RangeError, and thrown from a
    // render it unmounts the whole panel — so the one run missing a timestamp
    // would hide every run that had one.
    await sheet({ runs: [run({ started_at: undefined, finished_at: undefined })] });
    await waitFor(() => expect(screen.getByText(/1\/1 pass/)).toBeTruthy());
    expect(screen.getByText(/start time unreported/)).toBeTruthy();
  });

  it('expands the judge reasoning instead of hiding it in a tooltip', async () => {
    const reasoning =
      'The response gave the product rather than the sum, which the criteria ask for.';
    await sheet({
      runs: [
        run({
          pass_count: 0,
          fail_count: 1,
          scores: [
            { item_id: 'i1', score: 0, verdict: 'fail', reasoning, response: 'x'.repeat(200) },
          ],
        }),
      ],
    });
    const trigger = await waitFor(() => screen.getByRole('button', { name: /fail/i }));
    // Hidden until asked for — a twenty-item run is a list to scan first.
    expect(screen.queryByText(reasoning)).toBeNull();
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByText(reasoning)).toBeTruthy());
  });

  it('keeps the whole response in the DOM rather than slicing it', async () => {
    // It used to be cut with `.slice(0, 80)`, with no ellipsis and no way to
    // expand — so find-in-page and a screen reader got 80 characters too.
    const response = `start ${'y'.repeat(200)} end`;
    await sheet({
      runs: [
        run({ scores: [{ item_id: 'i1', score: 1, verdict: 'pass', reasoning: 'r', response }] }),
      ],
    });
    await waitFor(() => expect(screen.getByText(response)).toBeTruthy());
  });
});
