import { afterEach, describe, expect, it, vi } from 'bun:test';
import { BLOCKED_NOTICE, DRIVING_NOTICE, holdLease, TAKEN_NOTICE } from '../src/lease';

/**
 * The terminal's lease against the harness's rules since `felix-run/felix#479`:
 * a release needs the hold's own token (`403 token_required` without one), so a
 * terminal that lost the race has nothing it may release — and the release it
 * used to send, holder id alone, is one the harness refuses outright.
 */

type Acquire = { ok: boolean; token?: string; error?: string };

function fakeClient() {
  const acquires: Array<{
    args: Record<string, unknown>;
    resolve: (r: Acquire) => void;
    reject: (err: unknown) => void;
  }> = [];
  const releases: Array<Record<string, unknown>> = [];
  let releaseLanded: (() => void) | null = null;
  let holdReleases = false;
  const client = {
    acquireSessionLease: (args: Record<string, unknown>) =>
      new Promise<Acquire>((resolve, reject) => acquires.push({ args, resolve, reject })),
    releaseSessionLease: (args: Record<string, unknown>) => {
      releases.push(args);
      if (!holdReleases) return Promise.resolve();
      return new Promise<void>((r) => {
        releaseLanded = r;
      });
    },
  };
  return {
    // The two methods holdLease uses; the full client's types are not the subject here.
    client: client as unknown as Parameters<typeof holdLease>[0],
    acquires,
    releases,
    holdReleases: () => {
      holdReleases = true;
    },
    landRelease: () => releaseLanded?.(),
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('holdLease', () => {
  it('sends no release at all when blocked — never a token-less one', async () => {
    const fake = fakeClient();
    const notices: string[] = [];
    const hold = holdLease(fake.client, 'thread-a', 'tui-1', (m) => notices.push(m));
    await tick();
    fake.acquires[0]?.resolve({ ok: false, error: 'lease_held' });
    await tick();
    expect(notices).toEqual([BLOCKED_NOTICE]);

    await hold.release();
    expect(fake.releases).toEqual([]);
  });

  it('releases with the token its own acquire returned, even when that lands after the cleanup', async () => {
    const fake = fakeClient();
    const hold = holdLease(fake.client, 'thread-a', 'tui-1', () => {});
    const done = hold.release();
    await tick();
    expect(fake.releases).toEqual([]);

    fake.acquires[0]?.resolve({ ok: true, token: 'tok-late' });
    await done;
    expect(fake.releases).toEqual([{ threadId: 'thread-a', holderId: 'tui-1', token: 'tok-late' }]);
  });

  it('holds a same-thread re-acquire until the previous release has landed', async () => {
    const fake = fakeClient();
    fake.holdReleases();
    const first = holdLease(fake.client, 'thread-a', 'tui-1', () => {});
    await tick();
    fake.acquires[0]?.resolve({ ok: true, token: 'tok-1' });
    await tick();

    void first.release();
    const second = holdLease(fake.client, 'thread-a', 'tui-1', () => {});
    await tick();
    // Released, and the next acquire waits behind it rather than racing it.
    expect(fake.releases).toHaveLength(1);
    expect(fake.acquires).toHaveLength(1);

    fake.landRelease();
    await tick();
    await tick();
    expect(fake.acquires).toHaveLength(2);
    expect(fake.acquires[1]?.args).toMatchObject({ threadId: 'thread-a', mode: 'exclusive' });
    void second.release();
    fake.acquires[1]?.resolve({ ok: false });
  });
});

/**
 * Renewal, on fake timers: a hold lapses after its TTL unless renewed with its
 * token, and a watching web tab then takes the thread from a terminal that is
 * still open on it. Promises still settle on the microtask queue, so `flush`
 * drains it; `advanceTimersByTimeAsync` is not in Bun's shim.
 */
describe('holdLease renewal', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };

  /** A hold on `thread`, its first acquire answered with `tok-1`. */
  async function driving(thread: string, opts: { ttlSeconds?: number } = {}) {
    vi.useFakeTimers();
    const fake = fakeClient();
    const notices: string[] = [];
    const hold = holdLease(fake.client, thread, 'tui-1', (m) => notices.push(m), opts);
    await flush();
    fake.acquires[0]?.resolve({ ok: true, token: 'tok-1' });
    await flush();
    return { fake, notices, hold };
  }

  it('renews at half the TTL, exclusive, with the hold’s token', async () => {
    const { fake, hold } = await driving('thread-r');
    vi.advanceTimersByTime(149_999);
    await flush();
    expect(fake.acquires).toHaveLength(1);

    vi.advanceTimersByTime(1);
    await flush();
    expect(fake.acquires).toHaveLength(2);
    expect(fake.acquires[1]?.args).toEqual({
      threadId: 'thread-r',
      holderId: 'tui-1',
      mode: 'exclusive',
      ttlSeconds: 300,
      token: 'tok-1',
    });
    fake.acquires[1]?.resolve({ ok: true, token: 'tok-1' });
    await flush();

    vi.advanceTimersByTime(150_000);
    await flush();
    expect(fake.acquires[2]?.args).toMatchObject({ mode: 'exclusive', token: 'tok-1' });
    expect(hold.driving()).toBe(true);
    fake.acquires[2]?.resolve({ ok: true, token: 'tok-1' });
    await flush();
    await hold.release();
  });

  it('renews at half of a shorter TTL it asked for', async () => {
    const { fake, hold } = await driving('thread-s', { ttlSeconds: 10 });
    expect(fake.acquires[0]?.args).toMatchObject({ ttlSeconds: 10 });
    vi.advanceTimersByTime(5_000);
    await flush();
    expect(fake.acquires[1]?.args).toMatchObject({ ttlSeconds: 10, token: 'tok-1' });
    fake.acquires[1]?.resolve({ ok: true, token: 'tok-1' });
    await flush();
    await hold.release();
  });

  it('stops on release: the token is released and nothing renews after', async () => {
    const { fake, hold } = await driving('thread-x');
    expect(vi.getTimerCount()).toBe(1);
    await hold.release();
    expect(fake.releases).toEqual([{ threadId: 'thread-x', holderId: 'tui-1', token: 'tok-1' }]);
    // Cleared, not merely idle: an interval left running is a leak per thread visited.
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(10 * 150_000);
    await flush();
    expect(fake.acquires).toHaveLength(1);
  });

  it('fires no renewal after a release that beat its own acquire', async () => {
    vi.useFakeTimers();
    const fake = fakeClient();
    const hold = holdLease(fake.client, 'thread-y', 'tui-1', () => {});
    const done = hold.release();
    await flush();
    fake.acquires[0]?.resolve({ ok: true, token: 'tok-late' });
    await done;
    expect(fake.releases).toEqual([{ threadId: 'thread-y', holderId: 'tui-1', token: 'tok-late' }]);

    vi.advanceTimersByTime(10 * 150_000);
    await flush();
    expect(fake.acquires).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a refused renewal stops renewing that token, says so, and keeps it for the header', async () => {
    const { fake, notices, hold } = await driving('thread-z');
    vi.advanceTimersByTime(150_000);
    await flush();
    fake.acquires[1]?.resolve({ ok: false, error: 'lease_held' });
    await flush();

    expect(notices).toEqual([TAKEN_NOTICE]);
    expect(hold.driving()).toBe(false);
    // Still sent as `X-Felix-Lease-Token`, so the harness refuses this client's
    // writes while the other one drives.
    expect(hold.token()).toBe('tok-1');

    // The next tick asks to take the thread back, with no token: never a renewal.
    vi.advanceTimersByTime(150_000);
    await flush();
    expect(fake.acquires).toHaveLength(3);
    expect(fake.acquires[2]?.args).not.toHaveProperty('token');
    fake.acquires[2]?.resolve({ ok: false, error: 'lease_held' });
    await flush();
    expect(notices).toEqual([TAKEN_NOTICE]);

    // The other client lets go: the thread is taken back, and the line says so.
    vi.advanceTimersByTime(150_000);
    await flush();
    fake.acquires[3]?.resolve({ ok: true, token: 'tok-2' });
    await flush();
    expect(hold.driving()).toBe(true);
    expect(hold.token()).toBe('tok-2');
    expect(notices).toEqual([TAKEN_NOTICE, DRIVING_NOTICE]);
    // And it renews the new token from here.
    vi.advanceTimersByTime(150_000);
    await flush();
    expect(fake.acquires[4]?.args).toMatchObject({ token: 'tok-2' });
    fake.acquires[4]?.resolve({ ok: true, token: 'tok-2' });
    await flush();

    await hold.release();
    expect(fake.releases).toEqual([{ threadId: 'thread-z', holderId: 'tui-1', token: 'tok-2' }]);
  });

  it('a renewal that never arrived is not a refusal', async () => {
    const { fake, notices, hold } = await driving('thread-n');
    vi.advanceTimersByTime(150_000);
    await flush();
    // The fake's acquire never rejects on its own; stand in for a dropped request.
    fake.acquires[1]?.reject(new TypeError('fetch failed'));
    await flush();
    expect(notices).toEqual([]);
    expect(hold.driving()).toBe(true);
    vi.advanceTimersByTime(150_000);
    await flush();
    expect(fake.acquires[2]?.args).toMatchObject({ token: 'tok-1' });
    fake.acquires[2]?.resolve({ ok: true, token: 'tok-1' });
    await flush();
    await hold.release();
  });

  it('a write the harness refused flips it the same way, and it does not release a taken hold', async () => {
    const { fake, notices, hold } = await driving('thread-w');
    hold.lost();
    expect(notices).toEqual([TAKEN_NOTICE]);
    expect(hold.driving()).toBe(false);
    vi.advanceTimersByTime(150_000);
    await flush();
    expect(fake.acquires[1]?.args).not.toHaveProperty('token');
    fake.acquires[1]?.resolve({ ok: false, error: 'lease_held' });
    await flush();
    await hold.release();
    // The token is someone else's hold now, or nobody's: releasing it is not ours to do.
    expect(fake.releases).toEqual([]);
  });

  it('a blocked terminal takes the thread once it is free', async () => {
    vi.useFakeTimers();
    const fake = fakeClient();
    const notices: string[] = [];
    const hold = holdLease(fake.client, 'thread-b', 'tui-1', (m) => notices.push(m));
    await flush();
    fake.acquires[0]?.resolve({ ok: false, error: 'lease_held' });
    await flush();
    expect(hold.token()).toBeUndefined();

    vi.advanceTimersByTime(150_000);
    await flush();
    fake.acquires[1]?.resolve({ ok: true, token: 'tok-b' });
    await flush();
    expect(notices).toEqual([BLOCKED_NOTICE, DRIVING_NOTICE]);
    expect(hold.token()).toBe('tok-b');
    await hold.release();
    expect(fake.releases).toEqual([{ threadId: 'thread-b', holderId: 'tui-1', token: 'tok-b' }]);
  });
});
