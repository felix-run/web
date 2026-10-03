import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLeaseKeeper, LEASE_RENEW_MS, type LeaseApi } from '../src/lib/session-lease';

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
});
