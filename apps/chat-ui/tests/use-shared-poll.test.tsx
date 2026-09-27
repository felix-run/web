/** @vitest-environment happy-dom */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSharedPolls, useSharedPoll } from '../src/hooks/useSharedPoll';

/**
 * The rail's glances and the pages they summarise read the same routes; this is
 * what makes them one request instead of two. Pinned because nothing on screen
 * would show a regression — two polls look exactly like one, until the harness
 * starts answering 429.
 */

function Reader({
  fetcher,
  intervalMs,
  onData,
}: {
  fetcher: () => Promise<number>;
  intervalMs: number;
  onData?: (n: number | undefined) => void;
}) {
  const { data } = useSharedPoll('k', fetcher, { intervalMs });
  onData?.(data);
  return <span>{data ?? '-'}</span>;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  resetSharedPolls();
  vi.useRealTimers();
});

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });

describe('useSharedPoll', () => {
  it('sends one request for two subscribers to one key, and gives both the answer', async () => {
    const fetcher = vi.fn().mockResolvedValue(7);
    const seen: Array<number | undefined> = [];
    render(
      <>
        <Reader fetcher={fetcher} intervalMs={30_000} />
        <Reader fetcher={fetcher} intervalMs={4_000} onData={(d) => seen.push(d)} />
      </>,
    );
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(seen.at(-1)).toBe(7);
  });

  it('runs at the fastest interval any subscriber asked for', async () => {
    const fetcher = vi.fn().mockResolvedValue(1);
    render(
      <>
        <Reader fetcher={fetcher} intervalMs={30_000} />
        <Reader fetcher={fetcher} intervalMs={4_000} />
      </>,
    );
    await flush();
    fetcher.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_100);
    });
    // Three ticks at 4s, not zero at 30s, and not six from two timers.
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('slows back down when the fast subscriber leaves, and stops with the last', async () => {
    const fetcher = vi.fn().mockResolvedValue(1);
    const { rerender, unmount } = render(
      <>
        <Reader fetcher={fetcher} intervalMs={30_000} />
        <Reader fetcher={fetcher} intervalMs={4_000} />
      </>,
    );
    await flush();
    rerender(<Reader fetcher={fetcher} intervalMs={30_000} />);
    fetcher.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_100);
    });
    expect(fetcher).not.toHaveBeenCalled();

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
