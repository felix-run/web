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
  render(<EvalSheet manifest="quick" />);
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
 * The score rows, against the shape `felix.eval.runner` actually writes.
 *
 * Every fixture here used to carry `verdict`, `reasoning`, `response` and
 * per-item token counts. The runner writes none of them: a score is
 * `{item_id, pass, score, rule, answer, mock, reason?, tool_calls, tool_errors}`,
 * or `{item_id, pass: false, error}` for an item that never reached the scorer.
 * So the component rendered an empty verdict on every row and the tests, built
 * on the same invented shape, passed. These are built on the harness's shape,
 * which is the only reason they can fail for the right reason.
 */
describe('a run says what it did', () => {
  const started = Date.parse('2026-09-11T10:00:00Z');
  const run = (over: Record<string, unknown> = {}) => ({
    id: 'r1',
    dataset_name: 'golden',
    candidate_manifest: 'quick',
    status: 'completed',
    started_at: started,
    finished_at: started + 4200,
    pass_count: 1,
    fail_count: 0,
    error_count: 0,
    scores: [],
    ...over,
  });
  const score = (over: Record<string, unknown> = {}) => ({
    item_id: 'i1',
    pass: true,
    score: 1,
    rule: 'contains',
    answer: '42',
    mock: false,
    tool_calls: 0,
    tool_errors: 0,
    ...over,
  });

  it('shows how long it took and what the run did', async () => {
    await sheet({
      runs: [run({ scores: [score({ tool_calls: 2, tool_errors: 1 })] })],
    });
    await waitFor(() => expect(screen.getByText(/4\.2s/)).toBeTruthy());
    expect(screen.getByText(/2 tool calls/)).toBeTruthy();
    expect(screen.getByText(/1 tool error/)).toBeTruthy();
  });

  it('says a run is still going rather than implying it took no time', async () => {
    // `finished_at` is null while in flight, and `null - started` is a number
    // that renders as a duration — the wrong one.
    await sheet({ runs: [run({ finished_at: null, status: 'in_progress' })] });
    await waitFor(() => expect(screen.getByText(/still running/)).toBeTruthy());
  });

  it('counts the items that never reached the scorer, apart from the ones it rejected', async () => {
    // `error_count` is a subset of `fail_count`: a malformed dataset and a
    // rejected answer both fail, and only this number tells them apart.
    await sheet({ runs: [run({ pass_count: 1, fail_count: 3, error_count: 2 })] });
    await waitFor(() => expect(screen.getByText(/1\/4 pass/)).toBeTruthy());
    expect(screen.getByText(/2 errored/)).toBeTruthy();
  });

  it('survives a run with no start time rather than taking the sheet down', async () => {
    // `new Date(undefined).toISOString()` throws a RangeError, and thrown from a
    // render it unmounts the whole panel — so the one run missing a timestamp
    // would hide every run that had one.
    await sheet({ runs: [run({ started_at: undefined, finished_at: undefined })] });
    await waitFor(() => expect(screen.getByText(/1\/1 pass/)).toBeTruthy());
    expect(screen.getByText(/start time unreported/)).toBeTruthy();
  });

  it('reads the verdict off `pass` and names the rule that decided it', async () => {
    await sheet({
      runs: [
        run({
          pass_count: 0,
          fail_count: 1,
          scores: [score({ pass: false, score: 0, rule: 'tools_called', answer: 'done' })],
        }),
      ],
    });
    const trigger = await waitFor(() => screen.getByRole('button', { name: /fail/i }));
    expect(trigger.textContent).toMatch(/tools_called/);
    fireEvent.click(trigger);
    await waitFor(() =>
      expect(screen.getByText(/A tool the rubric requires was never called/)).toBeTruthy(),
    );
  });

  it('flags a rubric that could never reject as the dataset problem it is', async () => {
    await sheet({
      runs: [
        run({
          pass_count: 0,
          fail_count: 1,
          scores: [score({ pass: false, score: 0, rule: 'invalid_rubric', answer: 'anything' })],
        }),
      ],
    });
    const rule = await waitFor(() => screen.getByText('invalid_rubric'));
    // Blocked, not failed: the run did nothing wrong, and the fix is to the item.
    expect(rule.className).toMatch(/text-state-blocked/);
  });

  it('expands the judge reason instead of hiding it in a tooltip', async () => {
    const reason = 'The response gave the product rather than the sum, which the criteria ask for.';
    await sheet({
      runs: [
        run({
          pass_count: 0,
          fail_count: 1,
          scores: [
            score({ pass: false, score: 0.2, rule: 'llm_judge', reason, answer: 'x'.repeat(200) }),
          ],
        }),
      ],
    });
    const trigger = await waitFor(() => screen.getByRole('button', { name: /fail/i }));
    // Hidden until asked for — a twenty-item run is a list to scan first. The
    // collapsed row carries it truncated, so the assertion is on the heading
    // that only the expanded state draws.
    expect(screen.queryByText(/Why the judge said fail/)).toBeNull();
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByText(/Why the judge said fail/)).toBeTruthy());
    expect(screen.getAllByText(reason).length).toBeGreaterThan(0);
  });

  it('draws an item that errored as its own state, with the error', async () => {
    await sheet({
      runs: [
        run({
          pass_count: 0,
          fail_count: 1,
          error_count: 1,
          scores: [{ item_id: 'i1', pass: false, error: 'rubric is not an object' }],
        }),
      ],
    });
    const trigger = await waitFor(() => screen.getByRole('button', { name: /error/i }));
    // The row carries the message truncated; the expanded state draws it under
    // its own heading, which is what proves it opened.
    expect(screen.queryByText('Error')).toBeNull();
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByText('Error')).toBeTruthy());
    expect(screen.getAllByText(/rubric is not an object/).length).toBeGreaterThan(1);
  });
});

/**
 * The rubric, read the way the scorer reads it.
 *
 * `describeRubric` is the one function that labels a stored item and previews a
 * new one, so the two cannot disagree; these pin its reading of the precedence
 * `_score_answer` uses, and the empty case, which is the one that gates nothing.
 */
describe('a rubric is described as the scorer will read it', () => {
  it('lists trajectory rules first, then the one answer rule that will apply', async () => {
    const { describeRubric } = await import('../src/components/eval/eval-sheet');
    expect(
      describeRubric({ contains: 'x', expect: '42', tools_called: ['read_file'], max_errors: 0 }),
    ).toEqual(['must call read_file', 'at most 0 tool errors', 'answer equals “42”']);
  });

  it('says a judge is selected only for the keys that select one', async () => {
    const { describeRubric } = await import('../src/components/eval/eval-sheet');
    // `criteria` alone tunes a judge nothing has switched on.
    expect(describeRubric({ criteria: 'helpful' })).toEqual([]);
    expect(describeRubric({ judge_criteria: 'helpful' })).toEqual(['judged on “helpful”']);
  });

  it('warns on the item when nothing in it can reject an answer', async () => {
    await sheet({ items: [{ item_id: 'i1', user_input: 'hi', rubric: { criteria: 'nice' } }] });
    await waitFor(() => expect(screen.getByText(/any non-empty answer passes/)).toBeTruthy());
  });
});

describe('the add form writes the keys the scorer reads', () => {
  it('sends `contains` and a trajectory rule, and nothing it did not fill in', async () => {
    const addEvalItem = vi.fn().mockResolvedValue({ name: 'golden', warnings: [] });
    vi.doMock('../src/api', () => ({
      listEvalDatasets: vi.fn().mockResolvedValue([DATASET]),
      getEvalDataset: vi.fn().mockResolvedValue({ ...DATASET, items: [] }),
      listEvalItems: vi.fn().mockResolvedValue([]),
      listEvalRuns: vi.fn().mockResolvedValue([]),
      putEvalDataset: vi.fn(),
      addEvalItem,
      runEvalDataset: vi.fn(),
      getEvalRun: vi.fn(),
      compareEvalRuns: vi.fn(),
      listTenantManifests: vi.fn().mockResolvedValue([]),
    }));
    const { EvalSheet } = await import('../src/components/eval/eval-sheet');
    render(<EvalSheet manifest="quick" />);

    const input = await waitFor(() => screen.getByLabelText(/User input/));
    fireEvent.change(input, { target: { value: 'What is 7 × 6?' } });
    fireEvent.change(screen.getByLabelText(/^Contains/), { target: { value: '42' } });
    fireEvent.change(screen.getByLabelText(/Must not call/), { target: { value: 'shell, rm' } });
    // The reading the item will get, before it is stored.
    expect(
      screen.getByText(/Will score: must not call shell, rm · answer contains “42”/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));

    await waitFor(() => expect(addEvalItem).toHaveBeenCalledTimes(1));
    expect(addEvalItem).toHaveBeenCalledWith('golden', {
      user_input: 'What is 7 × 6?',
      rubric: { contains: '42', tools_not_called: ['shell', 'rm'] },
    });
  });
});

/**
 * The picker is a control, and a control that grows without limit eventually
 * hides the thing it controls.
 *
 * Both pickers wrapped with no height, so twenty datasets pushed the panel they
 * select *for* off the bottom of the sheet. Asserted on the classes rather than
 * on a rendered height, because happy-dom lays nothing out — which is the same
 * technique the roadmap names for the narrow-viewport check it cannot run.
 */
describe('the dataset picker cannot push the panel off the sheet', () => {
  it('caps its height and scrolls instead of growing', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ name: `set-${i}`, description: '' }));
    vi.doMock('../src/api', () => ({
      listEvalDatasets: vi.fn().mockResolvedValue(many),
      getEvalDataset: vi.fn().mockResolvedValue({ ...many[0], items: [] }),
      listEvalItems: vi.fn().mockResolvedValue([]),
      listEvalRuns: vi.fn().mockResolvedValue([]),
      putEvalDataset: vi.fn(),
      addEvalItem: vi.fn(),
      runEvalDataset: vi.fn(),
      getEvalRun: vi.fn(),
      compareEvalRuns: vi.fn(),
      listTenantManifests: vi.fn().mockResolvedValue([]),
    }));
    const { EvalSheet } = await import('../src/components/eval/eval-sheet');
    render(<EvalSheet manifest="quick" />);

    const first = await waitFor(() => screen.getByRole('button', { name: 'set-0' }));
    const picker = first.parentElement;
    expect(picker?.className).toMatch(/\bmax-h-\d+\b/);
    expect(picker?.className).toMatch(/\boverflow-y-auto\b/);
  });
});
