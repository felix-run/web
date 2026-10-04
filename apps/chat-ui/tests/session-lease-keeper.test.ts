import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLeaseKeeper,
  LEASE_RENEW_MS,
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
    resolve: (r: { ok: boolean; token?: string; error?: string }) => void;
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

  it('does not renew a shared hold, which would keep another tab’s lease alive', async () => {
    const { fake, pending } = api();
    const keeper = createLeaseKeeper(fake, () => 'tab-2');
    keeper.attach('t1');
    await flush();
    pending[0]?.resolve({ ok: false, error: 'lease_held' });
    await flush();
    pending[1]?.resolve({ ok: true, token: 'theirs' });
    await flush();
    await vi.advanceTimersByTimeAsync(LEASE_RENEW_MS * 2);
    expect(pending).toHaveLength(2);
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

    it('sends nothing for an acquire still on the wire, or for an observer hold', async () => {
      const { fake, pending, releases } = api();
      const keeper = createLeaseKeeper(fake, () => 'tab-2');
      keeper.attach('observed');
      keeper.attach('in-flight');
      await flush();
      pending[0]?.resolve({ ok: false, error: 'lease_held' });
      await flush();
      const observerAcquire = pending.find((p) => p.args.mode === 'shared');
      observerAcquire?.resolve({ ok: true, token: 'theirs' });
      await flush();

      keeper.releaseAllNow();
      expect(releases).toEqual([]);

      // The late acquire lands after the page let go: still nothing, and no renewal.
      pending.find((p) => p.args.threadId === 'in-flight')?.resolve({ ok: true, token: 'late' });
      await flush();
      await vi.advanceTimersByTimeAsync(LEASE_RENEW_MS * 2);
      expect(releases).toEqual([]);
      expect(pending).toHaveLength(3);
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
