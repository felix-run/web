/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  forgetPendingApprovalsRead,
  readPendingApprovals,
} from '../src/lib/pending-approvals-read';

/** A `/approvals` the test answers by hand, counting the requests. */
function stubApprovals() {
  const answers: Array<() => void> = [];
  const fetch = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        answers.push(() => resolve(Response.json({ requests: [] })));
      }),
  );
  vi.stubGlobal('fetch', fetch);
  return {
    fetch,
    answerAll: () => {
      for (const answer of answers.splice(0)) answer();
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('readPendingApprovals', () => {
  it('asks once for every reader that asks while a read is in flight', async () => {
    // Three live engines' ticks and the attention line's poll, all at once.
    const net = stubApprovals();
    const reads = [1, 2, 3, 4].map(() => readPendingApprovals());
    expect(net.fetch).toHaveBeenCalledTimes(1);
    net.answerAll();
    await Promise.all(reads);
  });

  it('asks again once the answer is in: a later reader wants the list as it is now', async () => {
    const net = stubApprovals();
    const first = readPendingApprovals();
    net.answerAll();
    await first;
    const second = readPendingApprovals();
    expect(net.fetch).toHaveBeenCalledTimes(2);
    net.answerAll();
    await second;
  });

  it('does not hand a read from before a decision to a reader after it', async () => {
    const net = stubApprovals();
    const before = readPendingApprovals();
    forgetPendingApprovalsRead();
    const after = readPendingApprovals();
    expect(after).not.toBe(before);
    expect(net.fetch).toHaveBeenCalledTimes(2);
    net.answerAll();
    await Promise.all([before, after]);
  });
});
