/** @vitest-environment happy-dom */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RAIL_MS, RailPresence } from '../src/components/rail-presence';

/**
 * The inline rails animate open and closed instead of popping. What is pinned is
 * the part that can break without anyone seeing it: a closing rail stays mounted
 * for its transition but is `inert`, so it cannot take focus or a click on its way
 * out, and it does leave — a rail that never unmounted would keep polling.
 */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function rail(open: boolean) {
  return (
    <RailPresence open={open} side="left">
      <button type="button">inside</button>
    </RailPresence>
  );
}

describe('RailPresence', () => {
  it('renders nothing while closed from the start', () => {
    render(rail(false));
    expect(screen.queryByRole('button', { name: 'inside' })).toBeNull();
  });

  it('opens in the same render, interactive', () => {
    const { rerender } = render(rail(false));
    rerender(rail(true));
    const wrapper = screen.getByText('inside').closest('[data-rail]')!;
    expect(wrapper.getAttribute('data-state')).toBe('open');
    expect(wrapper.hasAttribute('inert')).toBe(false);
  });

  it('stays mounted but inert while closing, then unmounts', () => {
    vi.useFakeTimers();
    const { rerender } = render(rail(true));
    rerender(rail(false));
    const wrapper = screen.getByText('inside').closest('[data-rail]')!;
    expect(wrapper.getAttribute('data-state')).toBe('closed');
    expect(wrapper.hasAttribute('inert')).toBe(true);
    act(() => vi.advanceTimersByTime(RAIL_MS + 50));
    expect(screen.queryByText('inside')).toBeNull();
  });

  it('reopening mid-close keeps the same rail rather than remounting it', () => {
    vi.useFakeTimers();
    const { rerender } = render(rail(true));
    const first = screen.getByText('inside');
    rerender(rail(false));
    rerender(rail(true));
    act(() => vi.advanceTimersByTime(RAIL_MS + 50));
    expect(screen.getByText('inside')).toBe(first);
  });
});
