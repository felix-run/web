/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The version log is the harness's (`GET /manifests/{name}/versions`). The page
 * said for months that no such route existed, and offered a number field plus
 * the versions this browser happened to have seen — so a rollback was an act of
 * recall, and a version saved from another tab was not on the list at all.
 */

afterEach(cleanup);
beforeEach(() => {
  vi.resetModules();
});

const pointer = { name: 'quick', version: 4, canary_version: 5, canary_weight: 10 };
const version = (n: number, over: Record<string, unknown> = {}) => ({
  name: 'quick',
  version: n,
  created_at: Date.now() - n * 60_000,
  created_by: 'ops',
  comment: `change ${n}`,
  ...over,
});

async function sheet(api: Record<string, unknown> = {}) {
  const mocks = {
    listTenantManifests: vi.fn().mockResolvedValue([pointer]),
    listManifestVersions: vi.fn().mockResolvedValue({
      items: [version(5), version(4), version(3)],
      next_before: 3,
    }),
    getResolvedManifest: vi.fn(),
    createManifestVersion: vi.fn(),
    activateManifestVersion: vi.fn().mockResolvedValue(pointer),
    setManifestCanary: vi.fn(),
    clearManifestCanary: vi.fn(),
    ...api,
  };
  vi.doMock('../src/api', () => mocks);
  const { ManifestsSheet } = await import('../src/components/manifests/manifests-sheet');
  render(<ManifestsSheet manifest="quick" />);
  await waitFor(() => expect(screen.getByRole('list', { name: 'Versions of quick' })).toBeTruthy());
  return mocks;
}

const rows = () =>
  screen.getAllByRole('listitem').filter((li) => li.dataset.slot === 'manifest-version');
const rowFor = (n: number) => {
  const li = rows().find((r) => r.textContent?.startsWith(`v${n}`));
  if (!li) throw new Error(`no row for v${n}`);
  return li;
};

describe('the version log', () => {
  it('lists the stored versions newest first, with what changed and who', async () => {
    await sheet();
    expect(rows().map((r) => r.textContent?.match(/^v\d+/)?.[0])).toEqual(['v5', 'v4', 'v3']);
    expect(rowFor(3).textContent).toContain('change 3');
    expect(rowFor(3).textContent).toContain('by ops');
  });

  it('marks the active version and the canary from the pointer, and offers no Activate on the active one', async () => {
    await sheet();
    expect(within(rowFor(4)).getByText('active')).toBeTruthy();
    expect(within(rowFor(4)).queryByRole('button', { name: 'Activate' })).toBeNull();
    expect(within(rowFor(5)).getByText('canary · 10%')).toBeTruthy();
  });

  it('activates a version from its row, after a confirmation, and re-reads the log', async () => {
    const { activateManifestVersion, listManifestVersions } = await sheet();
    const reads = listManifestVersions.mock.calls.length;
    fireEvent.click(within(rowFor(3)).getByRole('button', { name: 'Activate' }));
    expect(activateManifestVersion).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Activate v3' }));
    await waitFor(() => expect(activateManifestVersion).toHaveBeenCalledWith('quick', 3));
    await waitFor(() => expect(listManifestVersions.mock.calls.length).toBeGreaterThan(reads));
  });

  it('pages older versions with the cursor the harness gave', async () => {
    const listManifestVersions = vi
      .fn()
      .mockResolvedValueOnce({ items: [version(5), version(4), version(3)], next_before: 3 })
      .mockResolvedValueOnce({ items: [version(2), version(1)], next_before: null });
    await sheet({ listManifestVersions });
    fireEvent.click(screen.getByRole('button', { name: 'Show older versions' }));
    await waitFor(() => expect(rows()).toHaveLength(5));
    expect(listManifestVersions).toHaveBeenLastCalledWith('quick', { limit: 10, before: 3 });
    expect(screen.queryByRole('button', { name: 'Show older versions' })).toBeNull();
  });

  it('fills the canary field from a row, moving nothing until it is applied', async () => {
    const { setManifestCanary } = await sheet();
    fireEvent.click(within(rowFor(3)).getByRole('button', { name: 'Canary v3' }));
    expect((screen.getByLabelText('Version') as HTMLInputElement).value).toBe('3');
    expect(setManifestCanary).not.toHaveBeenCalled();
  });

  it('says a canary number past the newest version does not exist', async () => {
    await sheet();
    fireEvent.change(screen.getByLabelText('Version'), { target: { value: '9' } });
    expect(screen.getByText('There is no v9: the newest version of quick is v5.')).toBeTruthy();
  });
});
