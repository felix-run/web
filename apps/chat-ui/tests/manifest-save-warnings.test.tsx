/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A manifest the harness stores but warns about (`felix-run/felix#591`) — an
 * approval rule gating `write_file` while `delete_file` is bound ungated. The
 * version is live either way, because refusing it would turn an upgrade into
 * an outage; so the one place the operator is told is where the save was made.
 */

const WARNING =
  'approval rule `workspace-write` gates write_file, but delete_file is bound with no approval rule, so the agent can delete or move files without asking when it must ask to write them; add delete_file to rule `workspace-write`';

afterEach(cleanup);
beforeEach(() => {
  vi.resetModules();
});

async function sheet(warnings: string[] | undefined, activeAfter = 4) {
  const createManifestVersion = vi.fn().mockResolvedValue({
    name: 'ops',
    version: 5,
    manifest: {},
    comment: 'edited in chat-ui',
    ...(warnings ? { warnings } : {}),
  });
  vi.doMock('../src/api', () => ({
    listTenantManifests: vi
      .fn()
      .mockResolvedValueOnce([{ name: 'ops', version: 4, canary_version: null, canary_weight: 0 }])
      .mockResolvedValue([
        { name: 'ops', version: activeAfter, canary_version: null, canary_weight: 0 },
      ]),
    getResolvedManifest: vi.fn().mockResolvedValue({
      source: 'tenant_postgres',
      version: 4,
      manifest: { metadata: { name: 'ops' } },
    }),
    createManifestVersion,
    activateManifestVersion: vi.fn(),
    setManifestCanary: vi.fn(),
    clearManifestCanary: vi.fn(),
  }));
  const { ManifestsSheet } = await import('../src/components/manifests/manifests-sheet');
  render(<ManifestsSheet manifest="quick" />);
  await waitFor(() => expect(screen.getByText('Canary')).toBeTruthy());
  const user = userEvent.setup({ delay: null });
  await user.click(screen.getByRole('button', { name: /Edit current/ }));
  const editor = await waitFor(() => {
    const el = document.getElementById('manifest-editor');
    if (!el) throw new Error('no editor yet');
    return el;
  });
  fireEvent.change(editor, { target: { value: '{"metadata":{"name":"ops"}}' } });
  await user.click(screen.getByRole('button', { name: 'Save new version' }));
  await waitFor(() => expect(createManifestVersion).toHaveBeenCalled());
  return { user };
}

describe("a saved manifest's warnings", () => {
  it('are shown where the save was made, saying the version is live', async () => {
    const { user } = await sheet([WARNING]);
    const note = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-slot="manifest-warnings"]');
      if (!el) throw new Error('no note yet');
      return el;
    });
    // A save appends without activating: v4 is still the one serving.
    expect(note.textContent).toContain('v5 is saved, with a warning. It is not active');
    expect(note.textContent).not.toContain('saved and active');
    expect(note.textContent).toContain('add delete_file to rule `workspace-write`');
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(document.querySelector('[data-slot="manifest-warnings"]')).toBeNull();
  });

  it('say the version is live only when it is the one serving', async () => {
    await sheet([WARNING], 5);
    const note = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-slot="manifest-warnings"]');
      if (!el?.textContent?.includes('active,')) throw new Error('not yet');
      return el;
    });
    expect(note.textContent).toContain('v5 is saved and active, with a warning');
  });

  it('say nothing for a clean save, or from a harness that sends none', async () => {
    await sheet([]);
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector('[data-slot="manifest-warnings"]')).toBeNull();
    cleanup();
    vi.resetModules();
    await sheet(undefined);
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector('[data-slot="manifest-warnings"]')).toBeNull();
  });
});
