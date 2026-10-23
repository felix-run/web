/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Which build a score belongs to, and an address for one run.
 *
 * A run pinned to a stored version (`manifest_version`) is the harness's way to try a version
 * before activating it, and the only record of which build a score belongs to once the active
 * pointer moves; nothing here could send it or show it. And a run had no address, so a result
 * could not be handed to anyone — `GET /eval/runs/{id}` was served and never called.
 */

afterEach(cleanup);
beforeEach(() => {
  vi.resetModules();
  Element.prototype.scrollIntoView = vi.fn();
});

const DATASETS = [
  { name: 'golden', description: '' },
  { name: 'refunds', description: '' },
];
const ITEM = { item_id: 'i1', user_input: 'hi', rubric: {} };
const run = (over: Record<string, unknown>) => ({
  id: 'r1',
  dataset_name: 'golden',
  candidate_manifest: 'quick',
  started_at: Date.parse('2026-10-20T10:00:00Z'),
  finished_at: Date.parse('2026-10-20T10:01:00Z'),
  status: 'completed',
  pass_count: 1,
  fail_count: 0,
  scores: [],
  ...over,
});

async function sheet(opts: { at?: string; runs?: unknown[]; linked?: unknown } = {}) {
  const mocks = {
    listEvalDatasets: vi.fn().mockResolvedValue(DATASETS),
    getEvalDataset: vi.fn(),
    listEvalItems: vi.fn().mockResolvedValue([ITEM]),
    listEvalRuns: vi.fn().mockResolvedValue(opts.runs ?? []),
    putEvalDataset: vi.fn(),
    addEvalItem: vi.fn(),
    runEvalDataset: vi.fn().mockResolvedValue({ run_id: 'r9' }),
    getEvalRun: vi.fn().mockResolvedValue(opts.linked),
    compareEvalRuns: vi.fn(),
    listTenantManifests: vi.fn().mockResolvedValue([]),
  };
  vi.doMock('../src/api', () => mocks);
  const { EvalSheet } = await import('../src/components/eval/eval-sheet');
  render(
    <MemoryRouter initialEntries={[opts.at ?? '/harness/eval']}>
      <EvalSheet manifest="quick" />
    </MemoryRouter>,
  );
  return mocks;
}

/**
 * The Run button, once it can be pressed: it is disabled until the dataset's items arrive, so a
 * click made as soon as the version field appears can land on a disabled button and send nothing —
 * which is how this suite flaked on a slow CI runner.
 */
async function runButton(name: string | RegExp): Promise<HTMLButtonElement> {
  return waitFor(() => {
    const button = screen.getByRole('button', { name }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    return button;
  });
}

describe('a run pinned to a version', () => {
  it('runs a stored version when one is named, and says so on the button', async () => {
    const { runEvalDataset } = await sheet();
    const field = await screen.findByLabelText('Version of quick to run');
    fireEvent.change(field, { target: { value: '3' } });
    fireEvent.click(await runButton('Run vs quick v3'));
    await waitFor(() => expect(runEvalDataset).toHaveBeenCalledWith('golden', 'quick', false, 3));
  });

  it('runs the active version when the field is blank, and refuses a number that is not one', async () => {
    const { runEvalDataset } = await sheet();
    const field = await screen.findByLabelText('Version of quick to run');
    // Loaded first, so the disabled button below is refusing the number, not waiting on items.
    await runButton('Run vs quick');
    fireEvent.change(field, { target: { value: '1.5' } });
    expect(
      (screen.getByRole('button', { name: /^Run vs quick/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.change(field, { target: { value: '' } });
    fireEvent.click(await runButton('Run vs quick'));
    await waitFor(() =>
      expect(runEvalDataset).toHaveBeenCalledWith('golden', 'quick', false, undefined),
    );
  });

  it('says which version a run scored, and nothing for one that ran the active', async () => {
    await sheet({
      runs: [run({ id: 'a', manifest_version: 4 }), run({ id: 'b', manifest_version: null })],
    });
    const rows = await waitFor(() => {
      const r = document.querySelectorAll('[data-slot="eval-run"]');
      expect(r).toHaveLength(2);
      return r;
    });
    expect(rows[0]?.textContent).toContain('quick v4');
    expect(rows[1]?.textContent).not.toMatch(/quick v\d/);
  });
});

describe('a run’s address', () => {
  it('links each run to itself', async () => {
    await sheet({ runs: [run({ id: 'r1' })] });
    const row = await waitFor(() => {
      const el = document.querySelector('[data-slot="eval-run"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(within(row).getByRole('link', { name: /2026/ }).getAttribute('href')).toContain(
      '?run=r1',
    );
  });

  it('opens a linked run on its own dataset, even one older than the list reads', async () => {
    const old = run({ id: 'old', dataset_name: 'refunds', pass_count: 0, fail_count: 2 });
    const { getEvalRun, listEvalRuns } = await sheet({
      at: '/harness/eval?run=old',
      runs: [run({ id: 'newer', dataset_name: 'refunds' })],
      linked: old,
    });
    expect(getEvalRun).toHaveBeenCalledWith('old');
    await waitFor(() => expect(listEvalRuns).toHaveBeenCalledWith('refunds'));
    const current = await waitFor(() => {
      const el = document.querySelector('[data-slot="eval-run"][aria-current="true"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(current.textContent).toContain('0/2 pass');
    expect(screen.getByRole('button', { name: 'refunds', pressed: true })).toBeTruthy();
  });
});
