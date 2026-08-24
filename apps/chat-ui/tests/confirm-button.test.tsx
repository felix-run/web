/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmButton } from '../src/components/confirm-button';

/**
 * `ConfirmButton` stands in front of the operations that cannot be undone: deleting
 * a scheduled job, and re-pointing which manifest version serves live traffic. The
 * behaviours pinned here are the ones that are invisible when they break — the
 * action still appears to work, it just fires when it should not have.
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ConfirmButton', () => {
  it('does not fire until the confirmation is taken', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmButton
        question="v13 will serve all traffic."
        confirmLabel="Activate v13"
        onConfirm={onConfirm}
      >
        Activate
      </ConfirmButton>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
    expect(onConfirm).not.toHaveBeenCalled();

    // The armed step echoes the resolved consequence, which is what catches a typo
    // in the version field rather than a mis-click.
    expect(screen.getByText('v13 will serve all traffic.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Activate v13' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('cancels without firing, and returns to the resting label', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmButton question="Delete nightly?" confirmLabel="Delete job" onConfirm={onConfirm}>
        Delete
      </ConfirmButton>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
  });

  it('fires once for a burst of clicks in a single tick', async () => {
    // The guard is a ref rather than state on purpose. React batches, so a burst of
    // clicks in one tick all read the same pre-update value; measured on the approval
    // buttons, a state guard let ten clicks produce ten POSTs.
    let release!: () => void;
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((res) => {
          release = res;
        }),
    );
    render(
      <ConfirmButton question="Delete nightly?" confirmLabel="Delete job" onConfirm={onConfirm}>
        Delete
      </ConfirmButton>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const confirm = screen.getByRole('button', { name: 'Delete job' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy());
  });

  it('cancels on Escape before the surrounding sheet can see it', () => {
    // Radix's dismissable layer listens on `document` in the capture phase, so a
    // React onKeyDown runs too late to stop it and Escape closed the whole sheet
    // with the action still armed. The listener has to capture on `window`, which
    // is the one position that runs earlier than `document`.
    const onConfirm = vi.fn();
    const sheetSawEscape = vi.fn();
    document.addEventListener('keydown', sheetSawEscape, true);

    render(
      <ConfirmButton question="Delete nightly?" confirmLabel="Delete job" onConfirm={onConfirm}>
        Delete
      </ConfirmButton>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Delete job' }), { key: 'Escape' });

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
    expect(sheetSawEscape).not.toHaveBeenCalled();

    document.removeEventListener('keydown', sheetSawEscape, true);
  });

  it('stops listening for Escape once disarmed', () => {
    const stray = vi.fn();
    document.addEventListener('keydown', stray, true);

    render(
      <ConfirmButton question="Delete nightly?" confirmLabel="Delete job" onConfirm={vi.fn()}>
        Delete
      </ConfirmButton>,
    );
    // Never armed, so Escape belongs to whatever is behind it.
    fireEvent.keyDown(screen.getByRole('button', { name: 'Delete' }), { key: 'Escape' });
    expect(stray).toHaveBeenCalled();

    document.removeEventListener('keydown', stray, true);
  });
});
