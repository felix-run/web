import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Poll an async fetcher on an interval while `enabled`. Returns the latest
 * data, an error, a loading flag, and a manual `refresh`. The interval is
 * cleared whenever `enabled` is false, so the Inspector only polls while open.
 *
 * Ticks are also skipped while the tab is hidden, and a fetch runs immediately on
 * return, so coming back to a backgrounded tab shows current data rather than
 * whatever was true when it was last looked at.
 *
 * This is safe to do here because nothing depends on these panels while nobody is
 * looking. The unattended-run path deliberately does not use this hook: the
 * `/approvals` poll in `App.tsx` is a plain interval precisely so that it keeps
 * running for a hidden tab, which is the case it exists to serve.
 */
export function usePoll<T>(
  fetcher: () => Promise<T>,
  { enabled = true, intervalMs = 3000 }: { enabled?: boolean; intervalMs?: number } = {},
): { data: T | undefined; error: unknown; loading: boolean; refresh: () => void } {
  const [data, setData] = useState<T>();
  // The error is kept **raw**, not stringified. `describeError` identifies an
  // unreachable harness by the `TypeError` that `fetch` rejects with, and
  // `String(err)` throws that signal away — leaving only a locale-adjacent regex
  // over "failed to fetch" to stand in for it. `ErrorNotice` says the same thing
  // in its own docblock; this hook was the caller that could not honour it.
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetcherRef.current());
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const hidden = () => document.visibilityState === 'hidden';

    void run();
    const id = setInterval(() => {
      if (!hidden()) void run();
    }, intervalMs);

    // Fetch on the way back rather than waiting out the remainder of the interval.
    const onVisible = () => {
      if (!hidden()) void run();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, intervalMs, run]);

  return { data, error, loading, refresh: run };
}
