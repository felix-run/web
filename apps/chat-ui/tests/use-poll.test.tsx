/** @vitest-environment happy-dom */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePoll } from '../src/hooks/usePoll';

/**
 * Every Inspector tab polls through this hook. The behavior that matters is
 * that it stops: the interval must be torn down when the panel closes and when
 * the component unmounts, or a closed Inspector keeps hitting the harness for
 * the life of the tab.
 */

function Probe<T>(props: { fetcher: () => Promise<T>; enabled?: boolean; intervalMs?: number }) {
  const { data, error, loading } = usePoll(props.fetcher, {
    enabled: props.enabled,
    intervalMs: props.intervalMs ?? 1000,
  });
  return (
    <div>
      <span data-testid="data">{JSON.stringify(data ?? null)}</span>
      <span data-testid="error">{error ?? ''}</span>
      <span data-testid="loading">{String(loading)}</span>
    </div>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Let queued promise callbacks run while timers are faked. */
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('usePoll', () => {
  it('fetches once on mount', async () => {
    const fetcher = vi.fn(async () => 'first');
    const { getByTestId } = render(<Probe fetcher={fetcher} />);
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(getByTestId('data').textContent).toBe('"first"');
  });

  it('polls again on the interval', async () => {
    const fetcher = vi.fn(async () => 'x');
    render(<Probe fetcher={fetcher} intervalMs={1000} />);
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('does not poll at all while disabled', async () => {
    const fetcher = vi.fn(async () => 'x');
    render(<Probe fetcher={fetcher} enabled={false} />);
    await flush();
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('stops polling after unmount', async () => {
    const fetcher = vi.fn(async () => 'x');
    const { unmount } = render(<Probe fetcher={fetcher} intervalMs={1000} />);
    await flush();
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('surfaces an error and keeps polling', async () => {
    const fetcher = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue('recovered');
    const { getByTestId } = render(<Probe fetcher={fetcher} intervalMs={1000} />);
    await flush();
    expect(getByTestId('error').textContent).toContain('boom');

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await flush();
    expect(getByTestId('data').textContent).toBe('"recovered"');
    expect(getByTestId('error').textContent).toBe('');
  });

  it('clears loading even when the fetcher rejects', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('nope');
    });
    const { getByTestId } = render(<Probe fetcher={fetcher} />);
    await flush();
    expect(getByTestId('loading').textContent).toBe('false');
  });
  /**
   * A backgrounded tab has nobody reading the Inspector, so it should stop asking
   * the harness. The unattended-run path is a separate plain interval in App.tsx
   * and is deliberately not covered by this behaviour.
   */
  it('skips ticks while the tab is hidden and refetches on return', async () => {
    let visibility: DocumentVisibilityState = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);

    const fetcher = vi.fn<() => Promise<string>>().mockResolvedValue('ok');
    render(<Probe fetcher={fetcher} intervalMs={1000} />);
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Two intervals elapse while hidden: neither should reach the harness.
    visibility = 'hidden';
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Coming back fetches immediately rather than waiting out the interval.
    visibility = 'visible';
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);

    // And the interval resumes normally.
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
