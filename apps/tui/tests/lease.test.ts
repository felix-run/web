import { describe, expect, it } from 'bun:test';
import { BLOCKED_NOTICE, holdLease } from '../src/lease';

/**
 * The terminal's lease against the harness's rules since `felix-run/felix#479`:
 * a release needs the hold's own token (`403 token_required` without one), so a
 * terminal that lost the race has nothing it may release — and the release it
 * used to send, holder id alone, is one the harness refuses outright.
 */

type Acquire = { ok: boolean; token?: string; error?: string };

function fakeClient() {
  const acquires: Array<{ args: Record<string, unknown>; resolve: (r: Acquire) => void }> = [];
  const releases: Array<Record<string, unknown>> = [];
  let releaseLanded: (() => void) | null = null;
  let holdReleases = false;
  const client = {
    acquireSessionLease: (args: Record<string, unknown>) =>
      new Promise<Acquire>((resolve) => acquires.push({ args, resolve })),
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
    const release = holdLease(fake.client, 'thread-a', 'tui-1', (m) => notices.push(m));
    await tick();
    fake.acquires[0]?.resolve({ ok: false, error: 'lease_held' });
    await tick();
    expect(notices).toEqual([BLOCKED_NOTICE]);

    await release();
    expect(fake.releases).toEqual([]);
  });

  it('releases with the token its own acquire returned, even when that lands after the cleanup', async () => {
    const fake = fakeClient();
    const release = holdLease(fake.client, 'thread-a', 'tui-1', () => {});
    const done = release();
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

    void first();
    holdLease(fake.client, 'thread-a', 'tui-1', () => {});
    await tick();
    // Released, and the next acquire waits behind it rather than racing it.
    expect(fake.releases).toHaveLength(1);
    expect(fake.acquires).toHaveLength(1);

    fake.landRelease();
    await tick();
    await tick();
    expect(fake.acquires).toHaveLength(2);
    expect(fake.acquires[1]?.args).toMatchObject({ threadId: 'thread-a', mode: 'exclusive' });
  });
});
