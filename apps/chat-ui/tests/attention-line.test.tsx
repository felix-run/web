// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AttentionLine } from '../src/components/attention-line';
import { usePendingApprovals } from '../src/hooks/use-pending-approvals';

/**
 * The line that has to be true without being looked at.
 *
 * Four rules here are load-bearing and all four fail silently. It must render
 * when nothing is wrong, or it stops being a signal and becomes a surprise. Its
 * copy must say *across the harness* unless every row is provably this thread,
 * because a row with no `thread_id` is not evidence of being here and without
 * the phrase the count reads as "on the thread you are looking at". It must keep
 * polling while the tab is hidden, which is the entire case it exists for — a
 * durable run's approval cannot reach a stream, so this poll is the only
 * channel. And it must never say "nothing waiting" when it could not ask.
 */

const approval = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  tenant_id: 't',
  manifest_id: 'cowork',
  tool_name: 'write_file',
  call_signature: 'sig',
  args: { path: 'notes.md' },
  principal_subj: 'dev',
  status: 'pending',
  created_at: Date.now(),
  decided_at: null,
  decided_by: '',
  decision_note: '',
  edited_args: null,
  rule_id: 'workspace-write',
  ttl_seconds: 600,
  expires_at: Date.now() + 600_000,
  consumed_at: null,
  ...over,
});

function stub(rows: unknown[]) {
  const fn = vi.fn(
    async (_input: unknown) => new Response(JSON.stringify({ requests: rows }), { status: 200 }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

const approvalCalls = (spy: ReturnType<typeof stub>) =>
  spy.mock.calls.filter((c) => String(c[0]).includes('/approvals')).length;

const THREADS = [
  { id: 'here', title: 'The thread on screen', manifest: 'cowork', updatedAt: Date.now() },
  { id: 'elsewhere', title: 'Overnight batch', manifest: 'cowork', updatedAt: Date.now() },
];

/**
 * The line with the shell's real poll behind it. The hook moved up to the shell
 * so the thread list could read the same rows, and these tests still drive the
 * real one — the hidden-tab rule is the hook's, and a stubbed hook would pass it
 * vacuously.
 */
function Line({ streaming, handled }: { streaming: boolean; handled: string[] }) {
  const approvals = usePendingApprovals();
  return (
    <AttentionLine
      approvals={approvals}
      streaming={streaming}
      handled={handled}
      threadId="here"
      threads={THREADS}
    />
  );
}

function mount(streaming = false, handled: string[] = []) {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <Line streaming={streaming} handled={handled} />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the attention line', () => {
  it('says so when nothing is waiting, rather than disappearing', async () => {
    stub([]);
    mount();
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/nothing waiting/i));
    // No Review control: there is nothing to review, and an affordance that
    // opens an empty queue is worse than none.
    expect(screen.queryByRole('button', { name: /review/i })).toBeNull();
  });

  it('says "across the harness" when nothing can be attributed', async () => {
    // No `thread_id` at all — a harness older than felix@f679310, which is the
    // state every row was in when this phrase was written.
    stub([approval(), approval({ id: 'a2' })]);
    mount();
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain(
        '2 calls are waiting on you across the harness',
      ),
    );
  });

  it('reads singular for one', async () => {
    stub([approval()]);
    mount();
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('1 call is waiting on you'),
    );
  });

  /**
   * The rule a tidy-up breaks.
   *
   * `usePoll` skips ticks while the tab is hidden, which is correct for every
   * reference panel and exactly wrong here. Switching this line to it would look
   * like a simplification, pass every other test, and quietly stop reporting the
   * one case the line was built for.
   */
  it('keeps polling while the tab is hidden', async () => {
    vi.useFakeTimers();
    const spy = stub([]);
    mount();
    await act(async () => {
      await Promise.resolve();
    });
    const atMount = approvalCalls(spy);
    expect(atMount).toBeGreaterThan(0);

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });

    expect(approvalCalls(spy)).toBeGreaterThan(atMount);
  });

  it('opens the queue itself when something starts waiting', async () => {
    vi.useFakeTimers();
    let rows: unknown[] = [];
    const fn = vi.fn(async () => new Response(JSON.stringify({ requests: rows }), { status: 200 }));
    vi.stubGlobal('fetch', fn);
    mount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();

    rows = [approval()];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11_000);
    });

    // The card the banner and the inspector use, not a smaller one: approving
    // grants every identical call until the deadline, and that sentence has to
    // be on screen wherever the decision is made.
    // A direct read, not `waitFor`: fake timers are installed, and waitFor polls
    // on real ones — it would sit out its own timeout without ever re-checking.
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeNull();
  });

  /**
   * Counted, but not offered twice.
   *
   * An approval that reached the transcript banner came by frame, so the banner
   * can show the write's before/after diff; a `/approvals` row carries no
   * `before` and this line cannot build one. Re-offering it here would be a
   * second Approve button for the same call, with strictly less to go on. The
   * count still includes it, because the number has to be the honest total.
   */
  it('counts an approval the banner already owns, but does not re-offer it', async () => {
    stub([approval({ id: 'a1' })]);
    mount(false, ['a1']);

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('1 call is waiting on you'),
    );
    expect(screen.queryByRole('button', { name: /review/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
  });

  /**
   * The phrase narrows only when it can be proven.
   *
   * `thread_id` arrived with `felix-run/felix@f679310`, answering the constraint
   * this line was built under. It is the originating thread, not an owner — one
   * pending row is shared by every byte-identical call — so it is good enough to
   * point someone at a conversation and not good enough to claim exclusivity.
   */
  it('narrows to "on this thread" only when every row is provably here', async () => {
    stub([approval({ thread_id: 'here' }), approval({ id: 'a2', thread_id: 'here' })]);
    mount();
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain(
        '2 calls are waiting on you on this thread',
      ),
    );
  });

  it('keeps the tenant-wide phrase when one row is somewhere else', async () => {
    stub([approval({ thread_id: 'here' }), approval({ id: 'a2', thread_id: 'elsewhere' })]);
    mount();
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('across the harness'),
    );
  });

  it('keeps it when one row carries no thread, which is not evidence of being here', async () => {
    stub([approval({ thread_id: 'here' }), approval({ id: 'a2', thread_id: '' })]);
    mount();
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('across the harness'),
    );
  });

  /**
   * The payoff the brief predicted: threads have addresses since #156, so an
   * approval blocking another conversation is a link rather than an id.
   */
  it('names and links the thread an approval is blocking, when it is not this one', async () => {
    stub([approval({ thread_id: 'elsewhere' })]);
    mount();
    const link = await screen.findByRole('link', { name: 'Overnight batch' });
    expect(link.getAttribute('href')).toBe('/t/elsewhere');
  });

  it('does not label a row that is already on the thread in front of you', async () => {
    stub([approval({ thread_id: 'here' })]);
    mount();
    await waitFor(() => expect(screen.getByRole('button', { name: /approve/i })).toBeTruthy());
    expect(screen.queryByText(/Blocking/)).toBeNull();
  });

  /**
   * The queue is everything the banner is not drawing, not everything it knows.
   *
   * `ApprovalBanner` renders one approval and reports the rest as a count, so a
   * `handled` list covering the whole engine queue left every approval after the
   * first reachable nowhere — not in the banner, which draws one, and not here,
   * which suppressed them all. The count was right and the queue was a lie.
   */
  it('still offers an approval the banner is not the one drawing', async () => {
    stub([approval({ id: 'a1' }), approval({ id: 'a2', thread_id: 'elsewhere' })]);
    mount(false, ['a1']);

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('2 calls are waiting'),
    );
    // One card, for the one the banner is not showing — named by its thread.
    expect(await screen.findByRole('link', { name: 'Overnight batch' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /approve/i })).toHaveLength(1);
  });
});

/**
 * The all-clear is a claim about the harness, and a line that cannot ask has no
 * business making it. Observed live: the harness answered `/approvals` with 429
 * for minutes and this line said "Nothing waiting on you." with a green dot the
 * whole time, because the poll's failures were swallowed and the list it kept
 * was the empty one it started with.
 */
describe('when the line cannot see', () => {
  /** A fetch double whose `/approvals` answer can be switched mid-test. */
  function switchable(initial: { status: number; rows?: unknown[] }) {
    let answer = initial;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        answer.status === 200
          ? new Response(JSON.stringify({ requests: answer.rows ?? [] }), { status: 200 })
          : new Response(JSON.stringify({ detail: 'rate limited' }), { status: answer.status }),
      ),
    );
    return (next: typeof initial) => {
      answer = next;
    };
  }

  const tick = () =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(11_000);
    });
  const settle = () =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  // The line's own sentence: an open queue's approval cards carry live regions too.
  const status = () => screen.getAllByRole('status')[0]?.textContent ?? '';

  it('never renders the all-clear on a failed poll, including the first', async () => {
    vi.useFakeTimers();
    switchable({ status: 429 });
    mount();
    // Before any answer: checking, not clear.
    expect(status()).not.toMatch(/nothing waiting/i);
    await settle();
    expect(status()).not.toMatch(/nothing waiting/i);
    expect(status()).toMatch(/can't reach approvals/i);
    expect(screen.getByText('not checked yet')).toBeTruthy();
  });

  it('says how old its answer is once a good poll is followed by a failed one', async () => {
    vi.useFakeTimers();
    const answer = switchable({ status: 200, rows: [] });
    mount();
    await settle();
    expect(status()).toMatch(/nothing waiting/i);

    answer({ status: 429 });
    await tick();
    expect(status()).not.toMatch(/nothing waiting/i);
    expect(screen.getByText(/^last checked /)).toBeTruthy();
  });

  it('keeps the last known count, in the past tense, when the poll starts failing', async () => {
    vi.useFakeTimers();
    const answer = switchable({ status: 200, rows: [approval(), approval({ id: 'a2' })] });
    mount();
    await settle();
    expect(status()).toContain('2 calls are waiting on you across the harness');

    answer({ status: 503 });
    await tick();
    expect(status()).toContain("Can't reach approvals");
    expect(status()).toContain('2 calls were waiting on you across the harness');
  });

  it('restores the all-clear when the poll recovers', async () => {
    vi.useFakeTimers();
    const answer = switchable({ status: 429 });
    mount();
    await settle();
    expect(status()).toMatch(/can't reach approvals/i);

    answer({ status: 200, rows: [] });
    await tick();
    expect(status()).toMatch(/nothing waiting/i);
    expect(screen.queryByText(/last checked|not checked yet/)).toBeNull();
  });

  /** Idle is not on the ramp: green claims a finished state this line has no evidence of. */
  it('rests on a neutral dot, not the done hue', async () => {
    stub([]);
    const { container } = mount();
    await waitFor(() => expect(status()).toMatch(/nothing waiting/i));
    const dot = container.querySelector('[data-attention-dot]');
    expect(dot?.className).not.toMatch(/state-done/);
    expect(dot?.className).toContain('bg-muted-foreground/50');
  });
});
