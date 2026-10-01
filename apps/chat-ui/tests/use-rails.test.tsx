/** @vitest-environment happy-dom */
import { renderHook } from '@testing-library/react';
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

  it('lets a stored choice outrank the default', () => {
    localStorage.setItem('felix.inspectorOpen', '0');
    width(1920);
    expect(renderHook(() => useRails()).result.current.inspectorOpen).toBe(false);
  });
});
