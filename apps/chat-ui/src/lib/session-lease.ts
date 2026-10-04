/**
 * The tab's session leases, one hold per thread however many times it mounts.
 *
 * The harness (`felix/session/lease.py`) keys a lease by thread and answers:
 *
 * - **acquire** by the holder that already has it renews it and returns the same
 *   token; by any other holder it 409s while the hold is exclusive (`lease_held`).
 * - **release** with a token that is not the live one 403s (`token_mismatch`);
 *   with *no* token, the holder id alone is enough to drop the lease — whichever
 *   hold it is, including one taken a moment later.
 * - a lease lapses on its own after `ttl_seconds` (300 here) unless renewed.
 *
 * The shell used to acquire in an effect and release in its cleanup through one
 * shared token ref. A cleanup that ran before the acquire resolved — StrictMode's
 * double mount, or a thread change faster than a round trip — released with no
 * token, or with the token of a different acquire, and the late acquire then
 * wrote its token over the next thread's. That is the 403 on release, a hold left
 * behind until the TTL, and a re-attach that found it held.
 *
 * Here every hold owns its token. A release waits for its own acquire and sends
 * what that acquire returned — or nothing at all when it got nothing, because a
 * token-less release would drop whatever this holder has. A detach is deferred
 * one task so a re-attach to the same thread (StrictMode's second mount) reuses
 * the hold instead of releasing and re-taking it, and a fresh acquire on a thread
 * waits for any release still in flight there, so the two cannot cross on the wire.
 *
 * None of that runs when the tab goes away: React does not unmount on close, so
 * a closed tab's exclusive hold sat until the TTL and a new tab on the thread
 * got 409 and fell back to observing for up to five minutes. `releaseAllNow`
 * is the page-exit path — see `releaseOnPageExit` for the listeners.
 */

export type LeaseMode = 'exclusive' | 'shared';

export interface LeaseApi {
  acquire(args: {
    threadId: string;
    holderId: string;
    mode: LeaseMode;
    token?: string;
  }): Promise<{ ok: boolean; token?: string; error?: string }>;
  release(args: {
    threadId: string;
    holderId: string;
    token: string;
    keepalive?: boolean;
  }): Promise<void>;
}

export interface LeaseKeeper {
  /** Hold `threadId` for as long as the returned detach has not been called. */
  attach(threadId: string): () => void;
  /**
   * The page is going away: release, synchronously and fire-and-forget, every
   * exclusive hold whose acquire has come back with a token, as `keepalive`
   * requests so they outlive the page. Acquires still on the wire are not
   * waited for — there is no later to wait in — and observer holds are left
   * alone, since an observer blocks nobody. Renewal stops. The holds still
   * attached are remembered, for `reacquire`.
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

type Got = { token: string; mode: LeaseMode } | null;

interface Hold {
  refs: number;
  /** What the acquire got: the token and the mode it was granted in, or nothing. */
  acquired: Promise<Got>;
  /** `acquired`'s value once it has resolved — the page-exit path cannot wait for it. */
  got: Got | undefined;
  releaseTimer: ReturnType<typeof setTimeout> | null;
  renewTimer: ReturnType<typeof setInterval> | null;
}

export function createLeaseKeeper(api: LeaseApi, holderId: () => string): LeaseKeeper {
  const holds = new Map<string, Hold>();
  /** Releases on the wire, per thread, which the next acquire there waits behind. */
  const releasing = new Map<string, Promise<void>>();
  /** Set by `releaseAllNow` until `reacquire`: the attached holds hold nothing. */
  let suspended = false;

  async function acquire(threadId: string): Promise<Got> {
    const holder = holderId();
    try {
      const exclusive = await api.acquire({ threadId, holderId: holder, mode: 'exclusive' });
      if (exclusive.ok && exclusive.token) return { token: exclusive.token, mode: 'exclusive' };
      if (exclusive.ok) return null;
      // Another holder has it exclusively: observe instead. The token that comes
      // back is the lease's own, which is what releasing an observer checks.
      const shared = await api.acquire({ threadId, holderId: holder, mode: 'shared' });
      return shared.ok && shared.token ? { token: shared.token, mode: 'shared' } : null;
    } catch {
      // Leases are best-effort; a failed acquire holds nothing, so releases nothing.
      return null;
    }
  }

  /** Start `hold`'s acquire behind `behind`, and renew it once it is exclusive. */
  function take(threadId: string, hold: Hold, behind: Promise<void>) {
    const acquired = behind.then(() => acquire(threadId));
    hold.acquired = acquired;
    hold.got = undefined;
    void acquired.then((got) => {
      // An acquire `releaseAllNow` gave up on is not this hold's any more.
      if (hold.acquired !== acquired) return;
      hold.got = got;
      // Only an exclusive hold is renewed. An observer's acquire extends the whole
      // lease, so renewing one would keep a closed tab's exclusive hold alive.
      if (!got || got.mode !== 'exclusive' || holds.get(threadId) !== hold || hold.refs === 0) {
        return;
      }
      hold.renewTimer = setInterval(() => {
        void api
          .acquire({ threadId, holderId: holderId(), mode: 'exclusive', token: got.token })
          .then((r) => {
            if (!r.ok && hold.renewTimer) {
              clearInterval(hold.renewTimer);
              hold.renewTimer = null;
            }
          })
          .catch(() => {});
      }, LEASE_RENEW_MS);
    });
  }

  function stopRenewing(hold: Hold) {
    if (hold.renewTimer) clearInterval(hold.renewTimer);
    hold.renewTimer = null;
  }

  function release(threadId: string, hold: Hold) {
    stopRenewing(hold);
    holds.delete(threadId);
    const done = hold.acquired
      .then((got) =>
        got ? api.release({ threadId, holderId: holderId(), token: got.token }) : undefined,
      )
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

    releaseAllNow() {
      const holder = holderId();
      for (const [threadId, hold] of holds) {
        stopRenewing(hold);
        if (hold.releaseTimer) clearTimeout(hold.releaseTimer);
        hold.releaseTimer = null;
        const got = hold.got;
        if (got?.mode === 'exclusive') {
          const done = api
            .release({ threadId, holderId: holder, token: got.token, keepalive: true })
            .catch(() => {})
            .finally(() => {
              if (releasing.get(threadId) === done) releasing.delete(threadId);
            });
          // A re-acquire after a back/forward restore waits behind this.
          releasing.set(threadId, done);
        }
        // Whatever an acquire still on the wire returns, this hold holds nothing now.
        hold.acquired = Promise.resolve(null);
        hold.got = null;
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
