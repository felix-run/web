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
 *
 * A hold lapses on its own after its TTL, so it is renewed at half of it, with
 * its token: the harness renews an exclusive hold for whoever proves it with
 * the token and refuses everyone else (`felix/session/lease.py`). The terminal
 * acquired once and never renewed, so five minutes in a watching web tab took
 * the thread over while the terminal was still open on it.
 *
 * A renewal the harness refuses means another client has the thread — the hold
 * lapsed while the machine slept, or the network dropped for longer than the
 * TTL. The terminal says so and stops renewing that token. It keeps it, though,
 * for `X-Felix-Lease-Token`: a write carrying it is `409 lease_held` while the
 * other client drives, rather than a second driver nobody refused.
 *
 * Not driving — blocked from the start, or the thread taken — each tick asks
 * for the exclusive hold again, with no token, as the web app does from its
 * watching state: the harness never promotes anyone, so taking the thread back
 * once the other client lets go is this client's move. One request per tick,
 * never a tight loop.
 */

import type { FelixClient } from '@felix/client';
import { type RefObject, useEffect } from 'react';

type LeaseClient = Pick<FelixClient, 'acquireSessionLease' | 'releaseSessionLease'>;

/** Releases on the wire, per thread, which the next acquire there waits behind. */
const releasing = new Map<string, Promise<void>>();

export const BLOCKED_NOTICE = 'another client holds this thread — following read-only';
export const TAKEN_NOTICE =
  'another client took over this thread — sends are refused until it lets go';
export const DRIVING_NOTICE = 'this terminal drives the thread again';

/** What the harness defaults to, and what this client asks for. */
export const LEASE_TTL_SECONDS = 300;

export interface LeaseHold {
  readonly threadId: string;
  /**
   * The token for `X-Felix-Lease-Token`: the exclusive hold's while driving, and
   * the last one held after the thread was taken, so the harness refuses the
   * write. `undefined` when this client never held the thread.
   */
  token(): string | undefined;
  /** Whether this client holds the thread exclusively, as far as it knows. */
  driving(): boolean;
  /**
   * The harness refused a write (`lease_held` / `lease_read_only`): this client
   * does not drive the thread, whatever it believed. Stop renewing and say so.
   */
  lost(): void;
  /** Stop renewing and release whatever is held. Idempotent. */
  release(): Promise<void>;
}

/**
 * Take `threadId` for `holder` and keep it, renewing at half the TTL. Not a hook,
 * so it can be driven without a renderer; `useLease` is the hook around it.
 *
 * The renewal interval is half the TTL *asked for*: the harness grants exactly
 * that and its acquire answer carries no TTL of its own to read.
 */
export function holdLease(
  client: LeaseClient,
  threadId: string,
  holder: string,
  notify: (message: string) => void,
  opts: { ttlSeconds?: number } = {},
): LeaseHold {
  const ttlSeconds = opts.ttlSeconds ?? LEASE_TTL_SECONDS;
  const renewMs = (ttlSeconds * 1000) / 2;
  let released = false;
  let token: string | null = null;
  let driving = false;
  /** Whether the notice line says this client is not driving, so taking over says so too. */
  let toldNotDriving = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let ticking: Promise<void> | null = null;

  const acquire = (withToken?: string | null) =>
    client.acquireSessionLease({
      threadId,
      holderId: holder,
      mode: 'exclusive',
      ttlSeconds,
      ...(withToken ? { token: withToken } : {}),
    });

  const loseThread = (message: string) => {
    driving = false;
    toldNotDriving = true;
    if (!released) notify(message);
  };

  /** One tick: renew while driving; otherwise try to take the thread. */
  async function tick() {
    if (driving && token) {
      const held = token;
      const r = await acquire(held).catch(() => null);
      // A request that never arrived is not a refusal: try again next tick.
      if (!r || released || !driving || token !== held) return;
      if (!r.ok) loseThread(TAKEN_NOTICE);
      else if (r.token) token = r.token;
      return;
    }
    const r = await acquire().catch(() => null);
    if (!r?.ok || !r.token) return;
    // Taken back. Even after a release: the release waits for this tick, and
    // drops whatever it got.
    token = r.token;
    driving = true;
    if (toldNotDriving && !released) notify(DRIVING_NOTICE);
    toldNotDriving = false;
  }

  function startRenewing() {
    if (released || timer) return;
    timer = setInterval(() => {
      if (released || ticking) return;
      const t = tick()
        .catch(() => {})
        .finally(() => {
          if (ticking === t) ticking = null;
        });
      ticking = t;
    }, renewMs);
  }

  const acquired: Promise<void> = (releasing.get(threadId) ?? Promise.resolve())
    .then(() => acquire())
    .then(
      (lease) => {
        if (!lease.ok) {
          if (!released) {
            toldNotDriving = true;
            notify(BLOCKED_NOTICE);
          }
        } else if (lease.token) {
          token = lease.token;
          driving = true;
        }
      },
      () => {},
    )
    .finally(startRenewing);

  return {
    threadId,
    token: () => token ?? undefined,
    driving: () => driving,
    lost() {
      if (driving) loseThread(TAKEN_NOTICE);
    },
    release() {
      if (released) return releasing.get(threadId) ?? Promise.resolve();
      released = true;
      if (timer) clearInterval(timer);
      timer = null;
      const done = Promise.all([acquired, ticking ?? Promise.resolve()])
        // Blocked, failed, taken, or answered with no token: nothing of ours to drop.
        .then(() =>
          driving && token
            ? client.releaseSessionLease({ threadId, holderId: holder, token })
            : undefined,
        )
        .catch(() => {})
        .finally(() => {
          driving = false;
          if (releasing.get(threadId) === done) releasing.delete(threadId);
        });
      releasing.set(threadId, done);
      return done;
    },
  };
}

/**
 * Hold the open thread's lease, and keep `current` pointing at the hold so the
 * client's `leaseToken` / `onLeaseRefused` hooks — built once, before any hold
 * exists — reach whichever one is live.
 */
export function useLease(
  client: FelixClient,
  threadId: string,
  notify: (message: string) => void,
  current: RefObject<LeaseHold | null>,
): void {
  useEffect(() => {
    const hold = holdLease(client, threadId, `tui-${process.pid}`, notify);
    current.current = hold;
    return () => {
      if (current.current === hold) current.current = null;
      void hold.release();
    };
    // `notify` is a setState, stable across renders, and `current` a ref; listing
    // either would release and retake the lease on every notice.
  }, [client, threadId]);
}
