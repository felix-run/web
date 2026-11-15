/** @vitest-environment happy-dom */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRails } from '../src/hooks/use-rails';

/**
 * Where each zone starts on a profile that has never chosen.
 *
 * The workspace is the subject, so it starts open wherever it fits inline. The
 * instrument starts open only where all three zones fit at their own widths —
 * from 1600px — because at 1280 it fits by squeezing the transcript to its
 * floor. A stored choice always wins over either default.
 */

function width(px: number) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? Number.POSITIVE_INFINITY);
    return {
      matches: px >= min,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    };
  });
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('rail defaults', () => {
  it('opens the instrument on a fresh profile only where all three zones fit', () => {
    width(1440);
    expect(renderHook(() => useRails()).result.current.inspectorOpen).toBe(false);
    width(1680);
    const wide = renderHook(() => useRails()).result.current;
    expect(wide.inspectorOpen).toBe(true);
    expect(wide.historyOpen).toBe(true);
  });

  /**
   * An empty thread has no run, no changes and no plans, so the instrument would
   * open onto three empty states. It waits for a turn — unless someone chose.
   */
  it('keeps the instrument closed over an empty thread until it has a turn', () => {
    width(1920);
    const { result, rerender } = renderHook(({ emptyThread }) => useRails({ emptyThread }), {
      initialProps: { emptyThread: true },
    });
    expect(result.current.inspectorOpen).toBe(false);
    rerender({ emptyThread: false });
    expect(result.current.inspectorOpen).toBe(true);
    // The default is never written down.
    expect(localStorage.getItem('felix.inspectorOpen')).toBeNull();
  });

  it('lets a stored open outrank the empty-thread default, and toggles what is shown', () => {
    localStorage.setItem('felix.inspectorOpen', '1');
    width(1920);
    expect(renderHook(() => useRails({ emptyThread: true })).result.current.inspectorOpen).toBe(
      true,
    );
    localStorage.clear();
    // Unchosen and empty: shown closed, so a toggle opens it rather than writing
    // "closed" over a rail that was never on screen.
    const { result } = renderHook(() => useRails({ emptyThread: true }));
    act(() => result.current.setInspectorOpen((open) => !open));
    expect(result.current.inspectorOpen).toBe(true);
    expect(localStorage.getItem('felix.inspectorOpen')).toBe('1');
  });

  it('lets a stored choice outrank the default', () => {
    localStorage.setItem('felix.inspectorOpen', '0');
    width(1920);
    expect(renderHook(() => useRails()).result.current.inspectorOpen).toBe(false);
  });
});
