/** @vitest-environment happy-dom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A canary at 0% is a third state, and collapsing it into "absent" made the
 * panel contradict itself: the badge read "none in flight" while the button
 * beside it offered to clear the thing that was supposedly not there. Both
 * readings were defensible — one about traffic, one about what is set — so the
 * fix is to name the state rather than pick a winner.
 */

afterEach(cleanup);
beforeEach(() => {
  vi.resetModules();
});

const row = (over: Record<string, unknown> = {}) => ({
  name: 'quick',
  version: 4,
  canary_version: null,
  canary_weight: 0,
  ...over,
});

async function sheet(over: Record<string, unknown> = {}) {
  vi.doMock('../src/api', () => ({
    listTenantManifests: vi.fn().mockResolvedValue([row(over)]),
    getResolvedManifest: vi.fn().mockResolvedValue({ source: 'tenant', version: 4, manifest: {} }),
    createManifestVersion: vi.fn(),
    activateManifestVersion: vi.fn(),
    setManifestCanary: vi.fn(),
    clearManifestCanary: vi.fn(),
  }));
  const { ManifestsSheet } = await import('../src/components/manifests/manifests-sheet');
  render(<ManifestsSheet open onOpenChange={() => {}} manifest="quick" />);
  await waitFor(() => expect(screen.getByText('Canary')).toBeTruthy());
}

const clearButton = () =>
  screen.getByRole('button', { name: /Clear canary/i }) as HTMLButtonElement;

describe('the canary reports the state it is actually in', () => {
  it('says none is set, and offers nothing to clear', async () => {
    await sheet({ canary_version: null, canary_weight: 0 });
    expect(screen.getByText('none set')).toBeTruthy();
    expect(clearButton().disabled).toBe(true);
  });

  it('names a canary pinned at zero rather than calling it absent', async () => {
    // The contradiction: this used to read "none in flight" beside an enabled
    // Clear button, so the panel denied and offered the same thing at once.
    await sheet({ canary_version: 7, canary_weight: 0 });
    expect(screen.getByText(/v7 · no traffic/)).toBeTruthy();
    expect(screen.queryByText('none set')).toBeNull();
    expect(clearButton().disabled).toBe(false);
  });

  it('shows the weight when traffic is actually flowing', async () => {
    await sheet({ canary_version: 7, canary_weight: 25 });
    expect(screen.getByText(/v7 @ 25%/)).toBeTruthy();
    expect(clearButton().disabled).toBe(false);
  });
});
