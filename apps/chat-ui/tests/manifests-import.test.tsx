/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Import is the heaviest write on the Manifests page, and it took a name typed
 * from memory: a typo was a failed request at best and, one letter off a real
 * name, an import of the wrong manifest. It offers what can be imported — the
 * bundled manifests this tenant does not manage yet — and keeps typing as the
 * way to name one the harness resolves but does not list.
 */

afterEach(cleanup);
beforeEach(() => {
  vi.resetModules();
});

async function open(
  bundled: string[],
  managed: string[] = [],
  providerModels?: Map<string, string | undefined>,
) {
  vi.doMock('../src/api', () => ({
    listTenantManifests: vi
      .fn()
      .mockResolvedValue(managed.map((name) => ({ name, version: 1, canary_version: null }))),
    getResolvedManifest: vi.fn(),
    createManifestVersion: vi.fn(),
    activateManifestVersion: vi.fn(),
    setManifestCanary: vi.fn(),
    clearManifestCanary: vi.fn(),
  }));
  const { ManifestsSheet } = await import('../src/components/manifests/manifests-sheet');
  render(<ManifestsSheet manifest="quick" bundled={bundled} providerModels={providerModels} />);
  await waitFor(() => expect(document.querySelector('header')?.textContent).toMatch(/tenant/));
  fireEvent.click(screen.getByRole('button', { name: 'Import', expanded: false }));
}

describe('importing a manifest', () => {
  it('lists the bundled manifests the tenant does not manage yet, and nothing else', async () => {
    await open(['quick', 'cowork', 'governed'], ['cowork']);
    const user = userEvent.setup({ delay: null });
    const trigger = screen.getByRole('combobox', { name: 'Manifest' });
    await waitFor(async () => {
      trigger.focus();
      await user.keyboard('{Enter}');
      expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'quick',
      'governed',
      'Another name…',
    ]);
  });

  it('asks about the one picked, by name', async () => {
    await open(['quick', 'governed']);
    const user = userEvent.setup({ delay: null });
    const trigger = screen.getByRole('combobox', { name: 'Manifest' });
    await waitFor(async () => {
      trigger.focus();
      await user.keyboard('{Enter}');
      expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
    });
    await user.click(screen.getByRole('option', { name: 'governed' }));
    // Nothing is chosen until someone chooses — the page used to open one
    // confirmation away from importing a prefilled name.
    await user.click(screen.getByRole('button', { name: 'Import as version' }));
    expect(await screen.findByText(/governed becomes tenant-managed/)).toBeTruthy();
  });

  it('still takes a typed name, for a manifest the harness resolves but does not list', async () => {
    await open(['quick']);
    const user = userEvent.setup({ delay: null });
    const trigger = screen.getByRole('combobox', { name: 'Manifest' });
    await waitFor(async () => {
      trigger.focus();
      await user.keyboard('{Enter}');
      expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
    });
    await user.click(screen.getByRole('option', { name: 'Another name…' }));
    const field = screen.getByRole('textbox', { name: 'Manifest' });
    fireEvent.change(field, { target: { value: 'from-the-store' } });
    expect(screen.getByRole('button', { name: 'Back to the list' })).toBeTruthy();
  });

  it('falls back to typing, and says why, when every bundled manifest is already managed', async () => {
    await open(['quick'], ['quick']);
    expect(screen.queryByRole('combobox', { name: 'Manifest' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Manifest' })).toBeTruthy();
    expect(
      screen.getByText(/Every manifest the harness ships is already tenant-managed/),
    ).toBeTruthy();
  });

  it('says what each would run on, and keeps the trigger to the name', async () => {
    // The provider model is what tells `cowork` from `cowork-fast`; `/v1/models`
    // sends none when the model is the name, and then there is no second line.
    await open(
      ['cowork', 'claude-opus-4'],
      [],
      new Map([
        ['cowork', 'claude-sonnet-4-5'],
        ['claude-opus-4', undefined],
      ]),
    );
    const user = userEvent.setup({ delay: null });
    const trigger = screen.getByRole('combobox', { name: 'Manifest' });
    await waitFor(async () => {
      trigger.focus();
      await user.keyboard('{Enter}');
      expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
    });
    const [cowork, opus] = screen.getAllByRole('option');
    expect(cowork?.textContent).toBe('coworkclaude-sonnet-4-5');
    expect(opus?.textContent).toBe('claude-opus-4');
    await user.click(screen.getByRole('option', { name: /cowork/ }));
    expect(trigger.textContent).toBe('cowork');
  });
});
