import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { forgetHarnessRead, reportHarnessRead } from '@/lib/harness-health';

/**
 * Poll an async fetcher on an interval while `enabled`. Returns the latest
 * data, an error, a loading flag, and a manual `refresh`. The interval is
 * cleared whenever `enabled` is false, so the Inspector only polls while open.
 *
 * Ticks are also skipped while the tab is hidden, and a fetch runs immediately on
 * return, so coming back to a backgrounded tab shows current data rather than
 * whatever was true when it was last looked at.
 *
 * Each poll is also a source for the shell's one harness-health line
 * (`lib/harness-health.ts`): a 429, a 503 or no answer is reported there and said
 * once, not by every page that polls; an answer or an unmount withdraws it.
 *
 * This is safe to do here because nothing depends on these panels while nobody is
 * looking. The unattended-run path deliberately does not use this hook: the
 * `/approvals` poll in `App.tsx` is a plain interval precisely so that it keeps
 * running for a hidden tab, which is the case it exists to serve.
 */
export function usePoll<T>(
  fetcher: () => Promise<T>,
  { enabled = true, intervalMs = 3000 }: { enabled?: boolean; intervalMs?: number } = {},
): {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  /**
   * When the last successful answer arrived, or `null` before one has. With
   * `error` set, `data` is that older answer — kept, so a page can go on showing
   * it and say how old it is rather than trading it for an error box.
   */
  lastOkAt: number | null;
  /**
   * Reads that have failed in a row, 0 after any answer. One failure is usually the
   * harness shedding a burst (a 429), and a page may say so in neutral before it
   * says anything in red — the attention line's rule (`use-pending-approvals.ts`).
   */
  failures: number;
  refresh: () => void;
} {
  const [data, setData] = useState<T>();
  // The error is kept **raw**, not stringified. `describeError` identifies an
  // unreachable harness by the `TypeError` that `fetch` rejects with, and
  // `String(err)` throws that signal away — leaving only a locale-adjacent regex
  // over "failed to fetch" to stand in for it. `ErrorNotice` says the same thing
  // in its own docblock; this hook was the caller that could not honour it.
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);
  const [failures, setFailures] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  // Every poll is a source for the shell's one harness-health line: a transient
  // failure is said there, once, rather than by each page that polls.
  const source = `poll:${useId()}`;
  const lastOkRef = useRef<number | null>(null);
  const activeRef = useRef(false);

  const run = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetcherRef.current());
      setError(null);
      lastOkRef.current = Date.now();
      setLastOkAt(lastOkRef.current);
      setFailures(0);
      forgetHarnessRead(source);
    } catch (err) {
      setError(err);
      setFailures((n) => n + 1);
      // Only while polling: a read that lands after the poll stopped would put
      // back a source nothing is left to clear.
      if (activeRef.current) {
        reportHarnessRead(source, err, { lastOkAt: lastOkRef.current, retry: () => void run() });
      }
    } finally {
      setLoading(false);
    }
  }, [source]);

  useEffect(() => {
    if (!enabled) return;
    const hidden = () => document.visibilityState === 'hidden';
    activeRef.current = true;

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
      // A poll that stopped cannot hold the shell's line up.
      activeRef.current = false;
      forgetHarnessRead(source);
    };
  }, [enabled, intervalMs, run, source]);

  return { data, error, loading, lastOkAt, failures, refresh: run };
}
