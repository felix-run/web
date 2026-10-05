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
 * TTL. The terminal says so and stops renewing that token.
 *
 * Not driving — blocked from the start, or the thread taken — it **watches**,
 * as the web app does: it takes an observer hold (`mode: 'shared'`, which always
 * succeeds) with a token of its own, and sends that as `X-Felix-Lease-Token`. A
 * write carrying it is `409 lease_read_only`. Without one, a terminal refused at
 * startup held nothing at all, so its writes went out with no header: under
 * `FELIX_LEASE_ENFORCE=strict` a confusing `409 lease_held`, and under the default
 * advisory mode a second driver on a held thread that nobody refused. If the
 * observer hold cannot be had, a thread taken mid-session still sends the token
 * it lost, which is `lease_held`, never nothing.
 *
 * Each tick while watching asks for the exclusive hold again, with no token: the
 * harness never promotes anyone, so taking the thread back once the other client
 * lets go is this client's move. Taken, the observer hold is released with its
 * own token; refused, it is renewed with it. At most two requests per tick, never
 * a tight loop. On exit or a switch both holds go, each with its own token.
 */

import type { FelixClient } from '@felix/client';
import { type RefObject, useEffect } from 'react';

type LeaseClient = Pick<FelixClient, 'acquireSessionLease' | 'releaseSessionLease'>;

/** Releases on the wire, per thread, which the next acquire there waits behind. */
const releasing = new Map<string, Promise<void>>();

export const BLOCKED_NOTICE = 'another client holds this thread — following read-only';
/** The composer's answer to a send while watching: the message goes back in the field. */
export const WATCHING_NOTICE =
  'another client is driving this thread — watching read-only, your message is back in the composer';
export const TAKEN_NOTICE =
  'another client took over this thread — sends are refused until it lets go';
export const DRIVING_NOTICE = 'this terminal drives the thread again';

/** What the harness defaults to, and what this client asks for. */
export const LEASE_TTL_SECONDS = 300;

export interface LeaseHold {
  readonly threadId: string;
  /**
   * The token for `X-Felix-Lease-Token`: the exclusive hold's while driving; the
   * observer hold's while watching, so the harness refuses the write as
   * `lease_read_only`; and, when no observer hold could be had, the last
   * exclusive one after the thread was taken. `undefined` only before the first
   * acquire answers, or when the harness answered none at all.
   */
  token(): string | undefined;
  /** Whether this client holds the thread exclusively, as far as it knows. */
  driving(): boolean;
  /**
   * Whether this client is watching another drive the thread. False while the
   * first acquire is still on the wire: not driving is not yet the same as
   * refused.
   */
  watching(): boolean;
  /** Resolves once the first acquire has answered — and, refused, the observer hold too. */
  settled(): Promise<void>;
  /**
   * The harness refused a write (`lease_held` / `lease_read_only`): this client
   * does not drive the thread, whatever it believed. Stop renewing and say so.
   */
  lost(): void;
  /** Stop renewing and release whatever is held. Idempotent. */
  release(): Promise<void>;
}

/**
 * Every release still on the wire, settled — or `timeoutMs` passed, whichever is
 * first. For the way out: `process.exit` does not wait for a request, and an
 * unmount that fires a release and then exits sent nothing at all, which left a
 * quit terminal's hold — driving or watching — listed until its TTL.
 */
export function settleReleases(timeoutMs = 1500): Promise<void> {
  const pending = Promise.all([...releasing.values()]).then(() => {});
  return Promise.race([pending, new Promise<void>((r) => setTimeout(r, timeoutMs).unref?.())]);
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
  opts: {
    ttlSeconds?: number;
    /** Called whenever `watching()` changes, so a view can go read-only. */
    onWatching?: (watching: boolean) => void;
  } = {},
): LeaseHold {
  const ttlSeconds = opts.ttlSeconds ?? LEASE_TTL_SECONDS;
  const renewMs = (ttlSeconds * 1000) / 2;
  let released = false;
  let token: string | null = null;
  /** The observer hold's own token, while watching. Never the exclusive one. */
  let observer: string | null = null;
  let driving = false;
  let watching = false;
  const setWatching = (next: boolean) => {
    if (next === watching) return;
    watching = next;
    opts.onWatching?.(next);
  };
  /** Whether the notice line says this client is not driving, so taking over says so too. */
  let toldNotDriving = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let ticking: Promise<void> | null = null;

  const acquire = (withToken?: string | null, mode: 'exclusive' | 'shared' = 'exclusive') =>
    client.acquireSessionLease({
      threadId,
      holderId: holder,
      mode,
      ttlSeconds,
      ...(withToken ? { token: withToken } : {}),
    });

  /**
   * Take an observer hold, or renew the one held. A `shared` acquire always
   * succeeds with a token of its own; one refused — a renewal of an entry that
   * lapsed while the machine slept — is answered by taking a fresh one.
   */
  async function observe() {
    if (observer) {
      const renewed = await acquire(observer, 'shared').catch(() => null);
      // A request that never arrived is not a lapse: renew again next tick.
      if (!renewed) return;
      if (renewed.ok && renewed.token) {
        observer = renewed.token;
        return;
      }
      observer = null;
    }
    const r = await acquire(null, 'shared').catch(() => null);
    if (r?.ok && r.token) observer = r.token;
  }

  /** Run `work` as this hold's one request in flight, which a release waits behind. */
  function inFlight(work: () => Promise<void>) {
    if (released || ticking) return;
    const t = work()
      .catch(() => {})
      .finally(() => {
        if (ticking === t) ticking = null;
      });
    ticking = t;
  }

  const loseThread = (message: string) => {
    driving = false;
    toldNotDriving = true;
    setWatching(true);
    if (!released) notify(message);
  };

  /** One tick: renew while driving; otherwise try to take the thread, and keep watching. */
  async function tick() {
    if (driving && token) {
      const held = token;
      const r = await acquire(held).catch(() => null);
      // A request that never arrived is not a refusal: try again next tick.
      if (!r || released || !driving || token !== held) return;
      if (!r.ok) {
        loseThread(TAKEN_NOTICE);
        await observe();
      } else if (r.token) token = r.token;
      return;
    }
    const r = await acquire().catch(() => null);
    if (r?.ok && r.token) {
      // Taken back. Even after a release: the release waits for this tick, and
      // drops whatever it got — the observer hold included.
      token = r.token;
      driving = true;
      setWatching(false);
      const watched = observer;
      observer = null;
      // A separate entry on the lease with its own token: one left behind is
      // listed as a watcher until its TTL.
      if (watched) {
        await client
          .releaseSessionLease({ threadId, holderId: holder, token: watched })
          .catch(() => {});
      }
      if (toldNotDriving && !released) notify(DRIVING_NOTICE);
      toldNotDriving = false;
      return;
    }
    // Still someone else's, or the request never arrived: keep the observer hold.
    if (r) await observe();
  }

  function startRenewing() {
    if (released || timer) return;
    timer = setInterval(() => inFlight(tick), renewMs);
  }

  const acquired: Promise<void> = (releasing.get(threadId) ?? Promise.resolve())
    .then(() => acquire())
    .then(
      async (lease) => {
        // Refused is the harness's `{ ok: false }` (its 409), not an answer that
        // merely lacks a token: that holds nothing, as a failed request does.
        if (lease.ok === false) {
          toldNotDriving = true;
          setWatching(true);
          if (!released) notify(BLOCKED_NOTICE);
          // Refused at startup this client held nothing, and its writes went out
          // with no header. Watch, with a token of its own for the harness to refuse.
          await observe();
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
    token: () => (driving ? token : (observer ?? token)) ?? undefined,
    driving: () => driving,
    watching: () => watching,
    settled: () => acquired,
    lost() {
      if (!driving) return;
      loseThread(TAKEN_NOTICE);
      inFlight(observe);
    },
    release() {
      if (released) return releasing.get(threadId) ?? Promise.resolve();
      released = true;
      if (timer) clearInterval(timer);
      timer = null;
      const done: Promise<void> = Promise.all([acquired, ticking ?? Promise.resolve()])
        // Only what is ours: the exclusive hold while driving — not one taken from
        // us — and the observer hold while watching, each with its own token.
        .then(() =>
          Promise.all([
            driving && token
              ? client.releaseSessionLease({ threadId, holderId: holder, token })
              : undefined,
            observer
              ? client.releaseSessionLease({ threadId, holderId: holder, token: observer })
              : undefined,
          ]).then(() => {}),
        )
        .catch(() => {})
        .finally(() => {
          driving = false;
          observer = null;
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
  onWatching: (watching: boolean) => void = () => {},
): void {
  useEffect(() => {
    const hold = holdLease(client, threadId, `tui-${process.pid}`, notify, { onWatching });
    current.current = hold;
    return () => {
      if (current.current === hold) current.current = null;
      // A thread switch starts watching nothing until its own acquire says so.
      onWatching(false);
      void hold.release();
    };
    // `notify` and `onWatching` are setStates, stable across renders, and `current`
    // a ref; listing any would release and retake the lease on every notice.
  }, [client, threadId]);
}
