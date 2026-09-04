/**
 * Re-read one thing on an interval, while it is the thing being looked at.
 *
 * The terminal's version of chat-ui's `usePoll`, with one deliberate
 * difference. That hook skips ticks while `document.visibilityState` is
 * hidden, which is cheap and reliable in a browser. The terminal equivalent is
 * DECSET 1004 focus reporting, and `attention.ts` models it as tri-state on
 * purpose — plenty of terminals never answer, and `unknown` has to mean "you
 * might be watching". Gating on that would silently stop refreshing on every
 * terminal that does not report focus, and a panel showing numbers from ten
 * minutes ago with nothing saying so is worse than one extra request against a
 * harness that is usually on localhost.
 *
 * The real gate is `enabled`: only the visible section polls, and the overlay
 * is closed almost all of the time.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface Poll<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  refresh(): void;
}

export function usePoll<T>(
  fetcher: () => Promise<T>,
  { enabled = true, intervalMs = 3000 }: { enabled?: boolean; intervalMs?: number } = {},
): Poll<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // A long-lived interval holds whichever copy of the fetcher existed when it
  // was created; a ref costs nothing per render and cannot go stale.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  // A slow response must not overwrite a newer one. There is no
  // AbortController on these reads and they do not need one — only the answer
  // to the most recent question is wanted.
  const seq = useRef(0);

  const run = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const next = await fetcherRef.current();
      if (mine !== seq.current) return;
      setData(next);
      setError(null);
    } catch (err) {
      if (mine !== seq.current) return;
      // The last good data stays. An error and an empty result are different
      // states and must not be shown as the same one.
      setError(String((err as Error)?.message ?? err));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void run();
    const id = setInterval(() => void run(), intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs, run]);

  return { data, error, loading, refresh: run };
}
