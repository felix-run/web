/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Manifests and Eval load by hand, not through a poll, and they already kept the
 * last list in state on a failed reload. What they did not do was *say* so: a
 * failed reload was the same full box as a failed activation, the header count
 * claimed to be current, and a failed activation offered a "Try again" that only
 * reloaded the list. These pin the rule every polled page already follows.
 */

afterEach(cleanup);
beforeEach(() => {
  vi.resetModules();
});

const RATE_LIMITED = new Error('manifests : 429 {"error":"rate_limited"}');

describe('Manifests', () => {
  const row = { name: 'quick', version: 4, canary_version: 5, canary_weight: 10 };

  it('keeps the last list under one line when a reload fails, and ages the count', async () => {
    const listTenantManifests = vi
      .fn()
      .mockResolvedValueOnce([row])
      .mockRejectedValue(RATE_LIMITED);
    vi.doMock('../src/api', () => ({
      listTenantManifests,
      getResolvedManifest: vi.fn(),
      createManifestVersion: vi.fn(),
      activateManifestVersion: vi.fn(),
      setManifestCanary: vi.fn(),
      clearManifestCanary: vi.fn().mockResolvedValue(undefined),
    }));
    const { ManifestsSheet } = await import('../src/components/manifests/manifests-sheet');
    render(<ManifestsSheet manifest="quick" />);
    await waitFor(() => expect(screen.getByText('Canary')).toBeTruthy());

    // Clearing the canary succeeds; the reload after it is what fails.
    fireEvent.click(screen.getByRole('button', { name: 'Clear canary' }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/Showing what it said/),
    );
    // The list it last had is still on screen, and the header says how old it is.
    expect(screen.getByRole('button', { name: /quick/, pressed: true })).toBeTruthy();
    expect(document.querySelector('header')?.textContent).toMatch(/as of /);
  });

  it('offers no one-click retry for a failed write', async () => {
    vi.doMock('../src/api', () => ({
      listTenantManifests: vi.fn().mockResolvedValue([row]),
      getResolvedManifest: vi.fn(),
      createManifestVersion: vi.fn(),
      activateManifestVersion: vi.fn(),
      setManifestCanary: vi.fn(),
      clearManifestCanary: vi.fn().mockRejectedValue(new Error('manifests : 500')),
    }));
    const { ManifestsSheet } = await import('../src/components/manifests/manifests-sheet');
    render(<ManifestsSheet manifest="quick" />);
    await waitFor(() => expect(screen.getByText('Canary')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Clear canary' }));
    await waitFor(() => expect(screen.getByText(/clear the canary on quick/i)).toBeTruthy());
    // "Try again" here used to reload the list, not repeat the clear.
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});

describe('Eval', () => {
  const DATASET = { name: 'golden', description: '' };

  async function sheet(api: Record<string, unknown>) {
    vi.doMock('../src/api', () => ({
      listEvalDatasets: vi.fn().mockResolvedValue([DATASET]),
      listEvalItems: vi.fn().mockResolvedValue([]),
      listEvalRuns: vi.fn().mockResolvedValue([]),
      putEvalDataset: vi.fn(),
      addEvalItem: vi.fn(),
      runEvalDataset: vi.fn(),
      compareEvalRuns: vi.fn(),
      ...api,
    }));
    const { EvalSheet } = await import('../src/components/eval/eval-sheet');
    render(<EvalSheet manifest="quick" />);
  }

  it('reads a dataset once, not once per keystroke elsewhere on the page', async () => {
    // The panel's read depended on an inline callback, so every re-render of the
    // page — typing a new dataset's name — fetched the items and runs again.
    const listEvalItems = vi.fn().mockResolvedValue([]);
    await sheet({ listEvalItems });
    await waitFor(() => expect(listEvalItems).toHaveBeenCalled());
    const reads = listEvalItems.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'New dataset', expanded: false }));
    const name = screen.getByLabelText('Name');
    for (const v of ['a', 'ab', 'abc', 'abcd']) fireEvent.change(name, { target: { value: v } });

    expect(listEvalItems.mock.calls.length).toBe(reads);
  });

  it('draws no empty sections under a dataset nobody could read', async () => {
    await sheet({
      listEvalItems: vi.fn().mockRejectedValue(RATE_LIMITED),
      listEvalRuns: vi.fn().mockResolvedValue([]),
    });
    // A 429 is described as a rate limit, so wait on the box's own retry.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy());
    expect(screen.queryByText(/Add an item before running/i)).toBeNull();
    expect(screen.queryByText('Not run yet.')).toBeNull();
  });

  it('keeps the datasets it last had when the list fails to reload', async () => {
    const listEvalDatasets = vi
      .fn()
      .mockResolvedValueOnce([DATASET])
      .mockRejectedValue(new Error('eval : 429'));
    await sheet({ listEvalDatasets, putEvalDataset: vi.fn().mockResolvedValue(undefined) });
    await waitFor(() => expect(screen.getByRole('button', { name: 'golden' })).toBeTruthy());

    // Creating a dataset succeeds; the list reload after it is what fails.
    fireEvent.click(screen.getByRole('button', { name: 'New dataset', expanded: false }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'next' } });
    fireEvent.click(screen.getByRole('button', { name: /Create/ }));

    await waitFor(() =>
      expect(
        screen.getAllByRole('alert').some((a) => /Showing what it said/.test(a.textContent ?? '')),
      ).toBe(true),
    );
    expect(screen.getByRole('button', { name: 'golden' })).toBeTruthy();
  });
});
