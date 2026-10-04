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
 */

export type LeaseMode = 'exclusive' | 'shared';

export interface LeaseApi {
  acquire(args: {
    threadId: string;
    holderId: string;
    mode: LeaseMode;
    token?: string;
  }): Promise<{ ok: boolean; token?: string; error?: string }>;
  release(args: { threadId: string; holderId: string; token: string }): Promise<void>;
}

export interface LeaseKeeper {
  /** Hold `threadId` for as long as the returned detach has not been called. */
  attach(threadId: string): () => void;
}

/** Renew at half the TTL the transport asks for, so one late renewal is not a lapse. */
export const LEASE_RENEW_MS = 150_000;

interface Hold {
  refs: number;
  /** What the acquire got: the token and the mode it was granted in, or nothing. */
  acquired: Promise<{ token: string; mode: LeaseMode } | null>;
  releaseTimer: ReturnType<typeof setTimeout> | null;
  renewTimer: ReturnType<typeof setInterval> | null;
}

export function createLeaseKeeper(api: LeaseApi, holderId: () => string): LeaseKeeper {
  const holds = new Map<string, Hold>();
  /** Releases on the wire, per thread, which the next acquire there waits behind. */
  const releasing = new Map<string, Promise<void>>();

  async function acquire(threadId: string): Promise<{ token: string; mode: LeaseMode } | null> {
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

  function startRenewing(threadId: string, hold: Hold) {
    void hold.acquired.then((got) => {
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

  function release(threadId: string, hold: Hold) {
    if (hold.renewTimer) clearInterval(hold.renewTimer);
    hold.renewTimer = null;
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
        const behind = releasing.get(threadId) ?? Promise.resolve();
        const created: Hold = {
          refs: 1,
          acquired: behind.then(() => acquire(threadId)),
          releaseTimer: null,
          renewTimer: null,
        };
        hold = created;
        holds.set(threadId, created);
        startRenewing(threadId, created);
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
  };
}
