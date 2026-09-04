/**
 * One client at a time on a thread, and said out loud when it is not.
 *
 * Two clients driving the same session is a real possibility here — it is the
 * point of running a terminal alongside the web app — so each takes an
 * exclusive lease and reports losing the race rather than fighting it.
 *
 * The token is local to the effect rather than a ref on the component. It is
 * only ever read by the cleanup that releases the lease it belongs to, and a ref
 * shared across thread switches is a token from one thread reachable while
 * releasing another. Nothing did that, but nothing stopped it either.
 */

import type { FelixClient } from '@felix/client';
import { useEffect } from 'react';

export function useLease(
  client: FelixClient,
  threadId: string,
  onBlocked: (message: string) => void,
): void {
  useEffect(() => {
    const holder = `tui-${process.pid}`;
    let token: string | null = null;
    let cancelled = false;

    void (async () => {
      const lease = await client
        .acquireSessionLease({ threadId, holderId: holder, mode: 'exclusive' })
        .catch(() => ({ ok: false, error: 'lease unavailable' }));
      if (cancelled) return;
      if (!lease.ok) onBlocked('another client holds this thread — following read-only');
      else token = 'token' in lease ? (lease.token ?? null) : null;
    })();

    return () => {
      cancelled = true;
      void client.releaseSessionLease({
        threadId,
        holderId: holder,
        ...(token ? { token } : {}),
      });
    };
    // `onBlocked` is a setState, stable across renders; listing it would release
    // and retake the lease on every notice.
  }, [client, threadId]);
}
