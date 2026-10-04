import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLeaseKeeper,
  LEASE_RENEW_MS,
  type LeaseAcquireResult,
  type LeaseApi,
  releaseOnPageExit,
} from '../src/lib/session-lease';

/**
 * The keeper on its own, with the acquire's resolution in the test's hand —
 * the orderings `tests/session-lease.test.tsx` provokes through the app, made
 * exact here, plus renewal, which no mount lasts long enough to see.
 */

type Acquire = Parameters<LeaseApi['acquire']>[0];

function api() {
  const pending: Array<{
    args: Acquire;
    resolve: (r: LeaseAcquireResult) => void;
  }> = [];
  const releases: Array<Parameters<LeaseApi['release']>[0]> = [];
  const fake: LeaseApi = {
    acquire: (args) => new Promise((resolve) => pending.push({ args, resolve })),
    release: async (args) => {
      releases.push(args);
    },
  };
  return { fake, pending, releases };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createLeaseKeeper', () => {
  it('releases a late acquire with the token it got, never without one', async () => {
    const { fake, pending, releases } = api();
    const keeper = createLeaseKeeper(fake, () => 'tab-1');
    const detach = keeper.attach('t1');
    await flush();
    detach();
    await flush();
    expect(releases).toEqual([]);

    pending[0]?.resolve({ ok: true, token: 'late' });
    await flush();
    expect(releases).toEqual([{ threadId: 't1', holderId: 'tab-1', token: 'late' }]);
  });

  it('releases nothing when the acquire got nothing', async () => {
    const { fake, pending, releases } = api();
    const keeper = createLeaseKeeper(fake, () => 'tab-1');
    keeper.attach('t1')();
    await flush();
    pending[0]?.resolve({ ok: false, error: 'lease_held' });
    await flush();
    pending[1]?.resolve({ ok: false, error: 'lease_held' });
    await flush();
    expect(pending.map((p) => p.args.mode)).toEqual(['exclusive', 'shared']);
    expect(releases).toEqual([]);
  });

  it('reuses the hold when the same thread re-attaches before the release', async () => {
    const { fake, pending, releases } = api();
    const keeper = createLeaseKeeper(fake, () => 'tab-1');
    keeper.attach('t1')();
    const again = keeper.attach('t1');
    await flush();
    pending[0]?.resolve({ ok: true, token: 'one' });
    await flush();
    expect(pending).toHaveLength(1);
    expect(releases).toEqual([]);
    again();
    await flush();
    expect(releases).toEqual([{ threadId: 't1', holderId: 'tab-1', token: 'one' }]);
  });

  it('renews an exclusive hold before the TTL, and stops once released', async () => {
    const { fake, pending } = api();
    const keeper = createLeaseKeeper(fake, () => 'tab-1');
    const detach = keeper.attach('t1');
    await flush();
    pending[0]?.resolve({ ok: true, token: 'tok' });
    await flush();
    await vi.advanceTimersByTimeAsync(LEASE_RENEW_MS);
    expect(pending[1]?.args).toEqual({
      threadId: 't1',
      holderId: 'tab-1',
      mode: 'exclusive',
      token: 'tok',
    });
    pending[1]?.resolve({ ok: true, token: 'tok' });
    detach();
    await flush();
    await vi.advanceTimersByTimeAsync(LEASE_RENEW_MS * 2);
    expect(pending).toHaveLength(2);
  });

  describe('observing', () => {
    /** Attach as a second tab on a thread another one drives: 409, then an observer token. */
    async function observing(holder = 'tab-2') {
      const harness = api();
      const keeper = createLeaseKeeper(harness.fake, () => holder);
      const detach = keeper.attach('t1');
      await flush();
      harness.pending[0]?.resolve({ ok: false, error: 'lease_held' });
      await flush();
      harness.pending[1]?.resolve({ ok: true, token: 'mine', held_by_other: true });
      await flush();
      return { ...harness, keeper, detach };
    }

    it('observes with a token of its own, and says someone else drives', async () => {
      const { keeper, pending } = await observing();
      expect(pending[1]?.args).toEqual({ threadId: 't1', holderId: 'tab-2', mode: 'shared' });
      expect(keeper.state('t1')).toEqual({ mode: 'shared', heldByOther: true });
      expect(keeper.token('t1')).toBe('mine');
    });

    it('renews the observer hold in shared mode with its own token, every interval', async () => {
      const { pending } = await observing();
      await vi.advanceTimersByTimeAsync(LEASE_RENEW_MS);
      pending[2]?.resolve({ ok: false, error: 'lease_held' });
      await flush();
      expect(pending[3]?.args).toEqual({
        threadId: 't1',
        holderId: 'tab-2',
        mode: 'shared',
        token: 'mine',
      });
      pending[3]?.resolve({ ok: true, token: 'mine', held_by_other: true });
      await flush();

      await vi.advanceTimersByTimeAsync(LEASE_RENEW_MS);
      pending[4]?.resolve({ ok: false, error: 'lease_held' });
      await flush();
      expect(pending[5]?.args).toMatchObject({ mode: 'shared', token: 'mine' });
    });

    it('tries to take the thread on every tick first — exclusive, with no token', async () => {
      const { pending } = await observing();
      await vi.advanceTimersByTimeAsync(LEASE_RENEW_MS);
      expect(pending[2]?.args).toEqual({ threadId: 't1', holderId: 'tab-2', mode: 'exclusive' });
    });

    it('keeps observing when the takeover is refused', async () => {
      const { keeper, pending, releases } = await observing();
      await vi.advanceTimersByTimeAsync(LEASE_RENEW_MS);
      pending[2]?.resolve({ ok: false, error: 'lease_held' });
      await flush();
      pending[3]?.resolve({ ok: true, token: 'mine', held_by_other: true });
      await flush();
      expect(keeper.state('t1')).toEqual({ mode: 'shared', heldByOther: true });
      expect(keeper.token('t1')).toBe('mine');
      expect(releases).toEqual([]);
    });

    it('takes over once the driver has gone, and releases the observer token', async () => {
      const { keeper, pending, releases } = await observing();
      const seen: Array<ReturnType<typeof keeper.state>> = [];
      keeper.subscribe(() => seen.push(keeper.state('t1')));

      await vi.advanceTimersByTimeAsync(LEASE_RENEW_MS);
      pending[2]?.resolve({ ok: true, token: 'drive' });
      await flush();

      expect(keeper.state('t1')).toEqual({ mode: 'exclusive', heldByOther: false });
      expect(seen).toEqual([{ mode: 'exclusive', heldByOther: false }]);
      expect(keeper.token('t1')).toBe('drive');
      expect(releases).toEqual([{ threadId: 't1', holderId: 'tab-2', token: 'mine' }]);
      // No observer renewal after the takeover…
      expect(pending).toHaveLength(3);
      // …and from now on it renews as the driver, with the new token.
      await vi.advanceTimersByTimeAsync(LEASE_RENEW_MS);
      expect(pending[3]?.args).toEqual({
        threadId: 't1',
        holderId: 'tab-2',
        mode: 'exclusive',
        token: 'drive',
      });
    });

    it('releases the token a takeover got, when the thread is let go mid-takeover', async () => {
      const { pending, releases, detach } = await observing();
      await vi.advanceTimersByTimeAsync(LEASE_RENEW_MS);
      detach();
      await flush();
      pending[2]?.resolve({ ok: true, token: 'drive' });
      await flush();
      await flush();
      expect(releases.map((r) => r.token).sort()).toEqual(['drive', 'mine']);
    });
  });

  it('observes when an exclusive renewal is refused — the thread is someone else’s now', async () => {
    const { fake, pending } = api();
    const keeper = createLeaseKeeper(fake, () => 'tab-1');
    keeper.attach('t1');
    await flush();
    pending[0]?.resolve({ ok: true, token: 'tok' });
    await flush();
    await vi.advanceTimersByTimeAsync(LEASE_RENEW_MS);
    pending[1]?.resolve({ ok: false, error: 'lease_held' });
    await flush();
    expect(keeper.state('t1')).toEqual({ mode: 'shared', heldByOther: true });
    expect(pending[2]?.args).toEqual({ threadId: 't1', holderId: 'tab-1', mode: 'shared' });
    pending[2]?.resolve({ ok: true, token: 'watch', held_by_other: true });
    await flush();
    expect(keeper.token('t1')).toBe('watch');
  });

  it('demotes to observing when the harness refuses a driving request', async () => {
    const { fake, pending } = api();
    const keeper = createLeaseKeeper(fake, () => 'tab-1');
    keeper.attach('t1');
    await flush();
    pending[0]?.resolve({ ok: true, token: 'tok' });
    await flush();

    keeper.demote('t1');
    // Read-only on screen before the observer acquire has even answered.
    expect(keeper.state('t1')).toEqual({ mode: 'shared', heldByOther: true });
    expect(pending[1]?.args).toEqual({ threadId: 't1', holderId: 'tab-1', mode: 'shared' });
    pending[1]?.resolve({ ok: true, token: 'watch', held_by_other: true });
    await flush();
    expect(keeper.token('t1')).toBe('watch');
  });

  it('hands out one state object per change, for useSyncExternalStore', async () => {
    const { fake, pending } = api();
    const keeper = createLeaseKeeper(fake, () => 'tab-1');
    const before = keeper.state('t1');
    keeper.attach('t1');
    await flush();
    expect(keeper.state('t1')).toBe(before);
    pending[0]?.resolve({ ok: true, token: 'tok' });
    await flush();
    const driving = keeper.state('t1');
    expect(driving).toEqual({ mode: 'exclusive', heldByOther: false });
    expect(keeper.state('t1')).toBe(driving);
  });

  describe('releaseAllNow', () => {
    it('releases each exclusive hold its acquire answered, with its token, as keepalive', async () => {
      const { fake, pending, releases } = api();
      const keeper = createLeaseKeeper(fake, () => 'tab-1');
      keeper.attach('t1');
      keeper.attach('t2');
      await flush();
      pending[0]?.resolve({ ok: true, token: 'one' });
      pending[1]?.resolve({ ok: true, token: 'two' });
      await flush();

      keeper.releaseAllNow();
      // Synchronous: the page may be gone by the next task.
      expect(releases).toEqual([
        { threadId: 't1', holderId: 'tab-1', token: 'one', keepalive: true },
        { threadId: 't2', holderId: 'tab-1', token: 'two', keepalive: true },
      ]);
    });

    it('releases observer holds too, each with its own token', async () => {
      const { fake, pending, releases } = api();
      const keeper = createLeaseKeeper(fake, () => 'tab-2');
      keeper.attach('driven');
      keeper.attach('observed');
      await flush();
      pending[0]?.resolve({ ok: true, token: 'drive' });
      pending[1]?.resolve({ ok: false, error: 'lease_held' });
      await flush();
      pending
        .find((p) => p.args.mode === 'shared')
        ?.resolve({
          ok: true,
          token: 'watch',
          held_by_other: true,
        });
      await flush();

      keeper.releaseAllNow();
      expect(releases).toEqual([
        { threadId: 'driven', holderId: 'tab-2', token: 'drive', keepalive: true },
        { threadId: 'observed', holderId: 'tab-2', token: 'watch', keepalive: true },
      ]);
      expect(keeper.state('observed')).toEqual({ mode: null, heldByOther: false });
    });

    it('sends nothing for an acquire still on the wire', async () => {
      const { fake, pending, releases } = api();
      const keeper = createLeaseKeeper(fake, () => 'tab-2');
      keeper.attach('in-flight');
      await flush();

      keeper.releaseAllNow();
      expect(releases).toEqual([]);

      // The late acquire lands after the page let go: still nothing, and no renewal.
      pending.find((p) => p.args.threadId === 'in-flight')?.resolve({ ok: true, token: 'late' });
      await flush();
      await vi.advanceTimersByTimeAsync(LEASE_RENEW_MS * 2);
      expect(releases).toEqual([]);
      expect(pending).toHaveLength(1);
    });

    it('stops renewing', async () => {
      const { fake, pending } = api();
      const keeper = createLeaseKeeper(fake, () => 'tab-1');
      keeper.attach('t1');
      await flush();
      pending[0]?.resolve({ ok: true, token: 'tok' });
      await flush();

      keeper.releaseAllNow();
      await vi.advanceTimersByTimeAsync(LEASE_RENEW_MS * 2);
      expect(pending).toHaveLength(1);
    });

    it('releases nothing twice when the shell detaches afterwards', async () => {
      const { fake, pending, releases } = api();
      const keeper = createLeaseKeeper(fake, () => 'tab-1');
      const detach = keeper.attach('t1');
      await flush();
      pending[0]?.resolve({ ok: true, token: 'tok' });
      await flush();

      keeper.releaseAllNow();
      detach();
      await flush();
      expect(releases).toHaveLength(1);
    });
  });

  describe('reacquire', () => {
    it('takes the still-attached holds again, behind the release, and renews them', async () => {
      const { fake, pending, releases } = api();
      let releaseLanded: () => void = () => {};
      fake.release = (args) => {
        releases.push(args);
        return new Promise((r) => {
          releaseLanded = r;
        });
      };
      const keeper = createLeaseKeeper(fake, () => 'tab-1');
      keeper.attach('t1');
      await flush();
      pending[0]?.resolve({ ok: true, token: 'tok' });
      await flush();

      keeper.releaseAllNow();
      keeper.reacquire();
      await flush();
      // Not before the release has landed, or the release would drop it.
      expect(pending).toHaveLength(1);
      releaseLanded();
      await flush();
      expect(pending[1]?.args).toEqual({ threadId: 't1', holderId: 'tab-1', mode: 'exclusive' });

      pending[1]?.resolve({ ok: true, token: 'again' });
      await flush();
      await vi.advanceTimersByTimeAsync(LEASE_RENEW_MS);
      expect(pending[2]?.args).toMatchObject({ mode: 'exclusive', token: 'again' });
    });

    it('does nothing unless the holds were released', async () => {
      const { fake, pending } = api();
      const keeper = createLeaseKeeper(fake, () => 'tab-1');
      keeper.attach('t1');
      await flush();
      keeper.reacquire();
      await flush();
      expect(pending).toHaveLength(1);
    });
  });

  describe('releaseOnPageExit', () => {
    it('releases on pagehide and re-takes on a pageshow from the back/forward cache', async () => {
      const { fake, pending, releases } = api();
      const keeper = createLeaseKeeper(fake, () => 'tab-1');
      const page = new EventTarget() as Window;
      const unbind = releaseOnPageExit(keeper, page);
      keeper.attach('t1');
      await flush();
      pending[0]?.resolve({ ok: true, token: 'tok' });
      await flush();

      page.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }));
      expect(releases).toEqual([
        { threadId: 't1', holderId: 'tab-1', token: 'tok', keepalive: true },
      ]);
      // Only a restore from the cache re-takes; a pageshow that is a load is not one.
      page.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }));
      await flush();
      expect(pending).toHaveLength(1);
      page.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
      await flush();
      expect(pending[1]?.args).toEqual({ threadId: 't1', holderId: 'tab-1', mode: 'exclusive' });

      unbind();
      page.dispatchEvent(new Event('pagehide'));
      expect(releases).toHaveLength(1);
    });
  });
});
