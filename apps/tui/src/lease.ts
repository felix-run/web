/**
 * One client at a time on a thread, and said out loud when it is not.
 *
 * Two clients driving the same session is a real possibility here — it is the
 * point of running a terminal alongside the web app — so each takes an
 * exclusive lease and reports losing the race rather than fighting it.
 *
 * Every hold owns its token, and the release sends that token or nothing at
 * all. The harness requires one (`403 token_required` without it, since
 * `felix-run/felix#479`), so a release with only the holder id is a request
 * that can never succeed. The release waits for its own acquire, so an acquire
 * that lands after the thread changed still releases what it got rather than
 * leaving it held until the TTL. And a fresh acquire on a thread waits for any
 * release still on the wire there: the effect cleanup used to fire its release
 * without waiting, and a same-thread re-acquire — a remount, a quick switch
 * away and back — could land first and then be dropped by it.
 */

import type { FelixClient } from '@felix/client';
import { useEffect } from 'react';

type LeaseClient = Pick<FelixClient, 'acquireSessionLease' | 'releaseSessionLease'>;

/** Releases on the wire, per thread, which the next acquire there waits behind. */
const releasing = new Map<string, Promise<void>>();

export const BLOCKED_NOTICE = 'another client holds this thread — following read-only';

/**
 * Take `threadId` for `holder`, and return the release. Not a hook, so it can be
 * driven without a renderer; `useLease` is the hook around it.
 */
export function holdLease(
  client: LeaseClient,
  threadId: string,
  holder: string,
  onBlocked: (message: string) => void,
): () => Promise<void> {
  let released = false;
  const acquired: Promise<string | null> = (releasing.get(threadId) ?? Promise.resolve())
    .then(() => client.acquireSessionLease({ threadId, holderId: holder, mode: 'exclusive' }))
    .then(
      (lease) => {
        if (!lease.ok) {
          if (!released) onBlocked(BLOCKED_NOTICE);
          return null;
        }
        return lease.token ?? null;
      },
      () => null,
    );

  return () => {
    if (released) return releasing.get(threadId) ?? Promise.resolve();
    released = true;
    const done = acquired
      // Blocked, failed, or answered with no token: there is nothing of ours to drop.
      .then((token) =>
        token ? client.releaseSessionLease({ threadId, holderId: holder, token }) : undefined,
      )
      .catch(() => {})
      .finally(() => {
        if (releasing.get(threadId) === done) releasing.delete(threadId);
      });
    releasing.set(threadId, done);
    return done;
  };
}

export function useLease(
  client: FelixClient,
  threadId: string,
  onBlocked: (message: string) => void,
): void {
  useEffect(() => {
    const release = holdLease(client, threadId, `tui-${process.pid}`, onBlocked);
    return () => {
      void release();
    };
    // `onBlocked` is a setState, stable across renders; listing it would release
    // and retake the lease on every notice.
  }, [client, threadId]);
}
