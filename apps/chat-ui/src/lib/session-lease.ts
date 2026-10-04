/**
 * The tab's session leases, one hold per thread however many times it mounts.
 *
 * The harness (`felix/session/lease.py`, `felix-run/felix#479`) keys a lease by
 * thread and keeps two kinds of hold on it, each with **its own token and its
 * own expiry**:
 *
 * - **the exclusive hold**, at most one: the client driving the thread. Another
 *   holder's `exclusive` acquire is `409 lease_held` while it lives.
 * - **observer holds**, any number: a `shared` acquire always succeeds, and says
 *   `held_by_other: true` when someone else is driving. An observer's token is
 *   its own, never the exclusive one, and renewing it extends only its own entry.
 *
 * Renewing either kind needs that hold's token — a holder id alone is
 * `lease_held` — and so does releasing one (`403 token_required` without it).
 * Observers never block an exclusive acquire and are never promoted: when the
 * driver leaves, a watcher that wants to drive takes the exclusive hold itself.
 * A lease lapses on its own after `ttl_seconds` (300 here) unless renewed.
 *
 * So this keeper, per thread:
 *
 * 1. tries `exclusive`, and on 409 falls back to `shared` — it **observes**;
 * 2. renews whichever hold it has every `LEASE_RENEW_MS`, with that hold's mode
 *    and token;
 * 3. while observing, first tries `exclusive` with no token on every renewal
 *    tick. A 200 means the driver has gone: the hold becomes exclusive with the
 *    new token and the old observer token is released. A 409 means keep
 *    watching, and the observer hold is renewed as usual;
 * 4. treats a refused exclusive renewal — or a driving request the server
 *    refused (`demote`) — as having lost the thread, and observes.
 *
 * Every hold owns its token. A release waits for its own acquire, and for any
 * renewal tick still on the wire, and sends whatever token the hold has by then
 * — or nothing at all when it has none. A detach is deferred one task so a
 * re-attach to the same thread (StrictMode's second mount) reuses the hold
 * instead of releasing and re-taking it, and a fresh acquire on a thread waits
 * for any release still in flight there, so the two cannot cross on the wire.
 *
 * None of that runs when the tab goes away: React does not unmount on close.
 * `releaseAllNow` is the page-exit path — see `releaseOnPageExit`.
 */

export type LeaseMode = 'exclusive' | 'shared';

export interface LeaseAcquireResult {
  ok: boolean;
  token?: string;
  error?: string;
  /** The harness's own word that someone else is driving the thread. */
  held_by_other?: boolean;
}

export interface LeaseApi {
  acquire(args: {
    threadId: string;
    holderId: string;
    mode: LeaseMode;
    token?: string;
  }): Promise<LeaseAcquireResult>;
  release(args: {
    threadId: string;
    holderId: string;
    token: string;
    keepalive?: boolean;
  }): Promise<void>;
}

/**
 * What this tab holds on a thread, as the shell renders it.
 *
 * `mode` is null while nothing is held — before the first acquire answers, on a
 * thread the tab is not attached to, or after a failed acquire. `heldByOther`
 * is the harness's `held_by_other`, and is true whenever this tab observes
 * because it could not drive.
 */
export interface LeaseState {
  mode: LeaseMode | null;
  heldByOther: boolean;
}

export interface LeaseKeeper {
  /** Hold `threadId` for as long as the returned detach has not been called. */
  attach(threadId: string): () => void;
  /**
   * What the tab holds on `threadId`. The same object for as long as it does not
   * change, so it can be a `useSyncExternalStore` snapshot.
   */
  state(threadId: string): LeaseState;
  /** Called after any thread's state changes. Returns an unsubscribe. */
  subscribe(listener: () => void): () => void;
  /**
   * The token to present as `X-Felix-Lease-Token` on a driving request for
   * `threadId`: the hold's own, exclusive or observer. An observer's is sent too,
   * so the harness — not this tab — is what refuses (`lease_read_only`).
   */
  token(threadId: string): string | undefined;
  /**
   * The harness refused a driving request on `threadId` (`lease_read_only` /
   * `lease_held`): this tab is not the driver, whatever it believed. Observe.
   */
  demote(threadId: string): void;
  /**
   * The page is going away: release, synchronously and fire-and-forget, every
   * hold whose acquire has come back with a token — exclusive and observer
   * alike, each with its own token — as `keepalive` requests so they outlive
   * the page. Acquires still on the wire are not waited for; there is no later
   * to wait in. Renewal stops. The holds still attached are remembered, for
   * `reacquire`.
   */
  releaseAllNow(): void;
  /**
   * The page came back from the back/forward cache after `releaseAllNow`: take
   * again every hold that is still attached, so the tab does not believe it
   * holds a lease it gave up.
   */
  reacquire(): void;
}

/** Renew at half the TTL the transport asks for, so one late renewal is not a lapse. */
export const LEASE_RENEW_MS = 150_000;

type Got = { token: string; mode: LeaseMode; heldByOther: boolean } | null;

interface Hold {
  refs: number;
  /** The first acquire, or the re-acquire after a restore: what a release waits behind. */
  acquired: Promise<Got>;
  /** What the hold has now. `undefined` while the first acquire is on the wire. */
  got: Got | undefined;
  /** A renewal tick on the wire, which a release also waits behind. */
  ticking: Promise<void> | null;
  /** Bumped by `releaseAllNow`: a tick or acquire from an older epoch is not this hold's. */
  epoch: number;
  releaseTimer: ReturnType<typeof setTimeout> | null;
  renewTimer: ReturnType<typeof setInterval> | null;
}

const NOTHING: LeaseState = Object.freeze({ mode: null, heldByOther: false });

export function createLeaseKeeper(
  api: LeaseApi,
  holderId: () => string,
  renewMs: number = LEASE_RENEW_MS,
): LeaseKeeper {
  const holds = new Map<string, Hold>();
  /** Releases on the wire, per thread, which the next acquire there waits behind. */
  const releasing = new Map<string, Promise<void>>();
  /** Set by `releaseAllNow` until `reacquire`: the attached holds hold nothing. */
  let suspended = false;
  const listeners = new Set<() => void>();
  /** Per thread, the snapshot `state` hands out until it changes. */
  const snapshots = new Map<string, LeaseState>();

  function publish(threadId: string) {
    const got = holds.get(threadId)?.got;
    const next: LeaseState = got ? { mode: got.mode, heldByOther: got.heldByOther } : NOTHING;
    const prev = snapshots.get(threadId) ?? NOTHING;
    if (prev.mode === next.mode && prev.heldByOther === next.heldByOther) return;
    if (next === NOTHING) snapshots.delete(threadId);
    else snapshots.set(threadId, Object.freeze(next));
    for (const listener of listeners) listener();
  }

  function setGot(threadId: string, hold: Hold, got: Got) {
    hold.got = got;
    if (holds.get(threadId) === hold) publish(threadId);
  }

  /** A fresh observer hold: the harness mints its token; nothing of ours goes with it. */
  async function observe(threadId: string): Promise<Got> {
    const shared = await api.acquire({ threadId, holderId: holderId(), mode: 'shared' });
    return shared.ok && shared.token
      ? { token: shared.token, mode: 'shared', heldByOther: shared.held_by_other ?? true }
      : null;
  }

  async function acquire(threadId: string): Promise<Got> {
    try {
      const exclusive = await api.acquire({ threadId, holderId: holderId(), mode: 'exclusive' });
      if (exclusive.ok && exclusive.token) {
        return { token: exclusive.token, mode: 'exclusive', heldByOther: false };
      }
      if (exclusive.ok) return null;
      // Another holder drives it: watch instead, with an observer token of our own.
      return await observe(threadId);
    } catch {
      // Leases are best-effort; a failed acquire holds nothing, so releases nothing.
      return null;
    }
  }

  /** Whether `hold` is still the live, attached hold for `threadId` in `epoch`. */
  const live = (threadId: string, hold: Hold, epoch: number) =>
    holds.get(threadId) === hold && hold.epoch === epoch && hold.refs > 0 && !suspended;

  /**
   * One renewal tick. Exclusive: renew with the token, and observe if refused.
   * Shared: try to take the thread first; renew the observer hold if that fails.
   */
  async function renew(threadId: string, hold: Hold, epoch: number) {
    const got = hold.got;
    const holder = holderId();
    if (!got) {
      // A takeover or a re-observe that failed left nothing held: start over.
      const again = await acquire(threadId);
      if (hold.epoch === epoch && hold.got === got) setGot(threadId, hold, again);
      return;
    }
    if (got.mode === 'exclusive') {
      const r = await api.acquire({
        threadId,
        holderId: holder,
        mode: 'exclusive',
        token: got.token,
      });
      if (r.ok || !live(threadId, hold, epoch) || hold.got !== got) return;
      // Someone else has it now — the hold lapsed while the tab slept, or was
      // never ours. Watch rather than fight.
      setGot(threadId, hold, { ...got, mode: 'shared', heldByOther: true });
      const watched = await observe(threadId);
      if (hold.epoch === epoch) setGot(threadId, hold, watched);
      return;
    }
    // Observing. The driver may have gone: observers never block an exclusive
    // acquire, and nobody is promoted, so taking over is this tab's own move.
    const takeover = await api.acquire({ threadId, holderId: holder, mode: 'exclusive' });
    if (takeover.ok && takeover.token) {
      if (hold.epoch !== epoch) {
        // The page let go while this was on the wire; do not leave a hold behind.
        void api
          .release({ threadId, holderId: holder, token: takeover.token, keepalive: true })
          .catch(() => {});
        return;
      }
      setGot(threadId, hold, { token: takeover.token, mode: 'exclusive', heldByOther: false });
      // The observer hold is a separate entry with its own token; drop it.
      await api.release({ threadId, holderId: holder, token: got.token }).catch(() => {});
      return;
    }
    const renewed = await api.acquire({
      threadId,
      holderId: holder,
      mode: 'shared',
      token: got.token,
    });
    if (hold.epoch !== epoch || hold.got !== got) return;
    if (renewed.ok && renewed.token) {
      const heldByOther = renewed.held_by_other ?? got.heldByOther;
      if (heldByOther !== got.heldByOther) setGot(threadId, hold, { ...got, heldByOther });
      return;
    }
    // The observer entry lapsed (a long sleep): take a fresh one.
    const again = await observe(threadId);
    if (hold.epoch === epoch) setGot(threadId, hold, again);
  }

  function startRenewing(threadId: string, hold: Hold) {
    if (hold.renewTimer) return;
    const epoch = hold.epoch;
    hold.renewTimer = setInterval(() => {
      if (hold.ticking) return;
      const tick = renew(threadId, hold, epoch)
        .catch(() => {})
        .finally(() => {
          if (hold.ticking === tick) hold.ticking = null;
        });
      hold.ticking = tick;
    }, renewMs);
  }

  /** Start `hold`'s acquire behind `behind`, and renew it once it holds anything. */
  function take(threadId: string, hold: Hold, behind: Promise<void>) {
    const epoch = hold.epoch;
    const acquired = behind.then(() => acquire(threadId));
    hold.acquired = acquired;
    hold.got = undefined;
    void acquired.then((got) => {
      // An acquire `releaseAllNow` gave up on is not this hold's any more.
      if (hold.acquired !== acquired || hold.epoch !== epoch) return;
      setGot(threadId, hold, got);
      if (got && live(threadId, hold, epoch)) startRenewing(threadId, hold);
    });
  }

  function stopRenewing(hold: Hold) {
    if (hold.renewTimer) clearInterval(hold.renewTimer);
    hold.renewTimer = null;
  }

  function release(threadId: string, hold: Hold) {
    stopRenewing(hold);
    holds.delete(threadId);
    publish(threadId);
    const ticking = hold.ticking ?? Promise.resolve();
    const done = Promise.all([hold.acquired, ticking])
      // Whatever the hold has *now*: a takeover tick may have swapped its token.
      .then(() => {
        const got = hold.got;
        hold.got = null;
        return got ? api.release({ threadId, holderId: holderId(), token: got.token }) : undefined;
      })
      .catch(() => {})
      .finally(() => {
        if (releasing.get(threadId) === done) releasing.delete(threadId);
      });
    releasing.set(threadId, done);
  }

  return {
    attach(threadId) {
      let hold = holds.get(threadId);
      if (hold) {
        hold.refs += 1;
        if (hold.releaseTimer) {
          clearTimeout(hold.releaseTimer);
          hold.releaseTimer = null;
        }
      } else {
        const created: Hold = {
          refs: 1,
          acquired: Promise.resolve(null),
          got: undefined,
          ticking: null,
          epoch: 0,
          releaseTimer: null,
          renewTimer: null,
        };
        hold = created;
        holds.set(threadId, created);
        take(threadId, created, releasing.get(threadId) ?? Promise.resolve());
      }
      const held = hold;
      let detached = false;
      return () => {
        if (detached) return;
        detached = true;
        held.refs -= 1;
        if (held.refs > 0) return;
        held.releaseTimer = setTimeout(() => {
          held.releaseTimer = null;
          if (held.refs === 0 && holds.get(threadId) === held) release(threadId, held);
        }, 0);
      };
    },

    state(threadId) {
      return snapshots.get(threadId) ?? NOTHING;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    token(threadId) {
      return holds.get(threadId)?.got?.token;
    },

    demote(threadId) {
      const hold = holds.get(threadId);
      const got = hold?.got;
      if (!hold || !got || got.mode !== 'exclusive') return;
      const epoch = hold.epoch;
      // Read-only on screen at once; the observer token follows.
      setGot(threadId, hold, { ...got, mode: 'shared', heldByOther: true });
      const watching = hold.got;
      void observe(threadId)
        .catch(() => null)
        .then((observed) => {
          if (hold.epoch === epoch && hold.got === watching) setGot(threadId, hold, observed);
        });
    },

    releaseAllNow() {
      const holder = holderId();
      for (const [threadId, hold] of holds) {
        stopRenewing(hold);
        if (hold.releaseTimer) clearTimeout(hold.releaseTimer);
        hold.releaseTimer = null;
        hold.epoch += 1;
        const got = hold.got;
        if (got) {
          // Observer holds too: each is an entry of its own on the lease, and
          // one left behind is listed as a watcher until its TTL.
          const done = api
            .release({ threadId, holderId: holder, token: got.token, keepalive: true })
            .catch(() => {})
            .finally(() => {
              if (releasing.get(threadId) === done) releasing.delete(threadId);
            });
          // A re-acquire after a back/forward restore waits behind this.
          releasing.set(threadId, done);
        }
        // Whatever an acquire or tick still on the wire returns, this hold holds nothing now.
        hold.acquired = Promise.resolve(null);
        hold.ticking = null;
        hold.got = null;
        publish(threadId);
        if (hold.refs === 0) holds.delete(threadId);
      }
      suspended = true;
    },

    reacquire() {
      if (!suspended) return;
      suspended = false;
      for (const [threadId, hold] of holds) {
        take(threadId, hold, releasing.get(threadId) ?? Promise.resolve());
      }
    },
  };
}

/**
 * Release the keeper's holds when the page goes away, once per tab.
 *
 * `pagehide` rather than `unload`: it fires on every way out — close, reload,
 * navigation, a back/forward-cache entry — and listening for it does not make
 * the page ineligible for that cache, which an `unload` listener does. When the
 * page went into the cache (`persisted`) it may come back, and a `pageshow`
 * with `persisted` set re-takes whatever is still attached. Merely hiding the
 * tab releases nothing: a background tab is still the one holding the thread.
 */
export function releaseOnPageExit(keeper: LeaseKeeper, page: Window = window): () => void {
  const onHide = () => keeper.releaseAllNow();
  const onShow = (event: PageTransitionEvent) => {
    if (event.persisted) keeper.reacquire();
  };
  page.addEventListener('pagehide', onHide);
  page.addEventListener('pageshow', onShow);
  return () => {
    page.removeEventListener('pagehide', onHide);
    page.removeEventListener('pageshow', onShow);
  };
}
