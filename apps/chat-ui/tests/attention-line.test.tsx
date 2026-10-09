// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AttentionLine } from '../src/components/attention-line';
import { DECIDED_GRACE_MS, usePendingApprovals } from '../src/hooks/use-pending-approvals';

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
function Line({
  streaming,
  handled,
  bannerOnScreen = true,
}: {
  streaming: boolean;
  handled: string[];
  bannerOnScreen?: boolean;
}) {
  const approvals = usePendingApprovals();
  return (
    <AttentionLine
      approvals={approvals}
      streaming={streaming}
      handled={handled}
      bannerOnScreen={bannerOnScreen}
      threadId="here"
      threads={THREADS}
    />
  );
}

function QuestionLine({ bannerOnScreen = true }: { bannerOnScreen?: boolean }) {
  const approvals = usePendingApprovals();
  return (
    <AttentionLine
      approvals={approvals}
      streaming
      handled={[]}
      bannerOnScreen={bannerOnScreen}
      threadId="here"
      threads={THREADS}
      question="Deploy to staging or production?"
    />
  );
}

/** A run kept going on another thread is asking; nothing on this one is. */
function ElsewhereQuestionLine() {
  const approvals = usePendingApprovals();
  return (
    <AttentionLine
      approvals={approvals}
      streaming={false}
      handled={[]}
      bannerOnScreen
      threadId="here"
      threads={THREADS}
      elsewhereQuestions={[{ threadId: 'elsewhere', prompt: 'Which region?' }]}
    />
  );
}

const mountQuestion = (bannerOnScreen = true) =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <QuestionLine bannerOnScreen={bannerOnScreen} />
      </TooltipProvider>
    </MemoryRouter>,
  );

function ReasonLine() {
  const approvals = usePendingApprovals();
  return (
    <AttentionLine
      approvals={approvals}
      streaming={false}
      handled={[]}
      bannerOnScreen
      threadId="here"
      threads={THREADS}
      reasons={{ a1: 'Confirm writes to the workspace' }}
    />
  );
}

function mount(streaming = false, handled: string[] = [], bannerOnScreen = true) {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <Line streaming={streaming} handled={handled} bannerOnScreen={bannerOnScreen} />
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
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toMatch(/no approvals or questions waiting/i),
    );
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

  it('opens the queue itself when a call on this thread starts waiting', async () => {
    vi.useFakeTimers();
    let rows: unknown[] = [];
    const fn = vi.fn(async () => new Response(JSON.stringify({ requests: rows }), { status: 200 }));
    vi.stubGlobal('fetch', fn);
    mount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();

    rows = [approval({ thread_id: 'here' })];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11_000);
    });

    // The card the banner uses, not a smaller one: approving grants every
    // identical call until the deadline, and that sentence has to be on screen
    // wherever the decision is made.
    // A direct read, not `waitFor`: fake timers are installed, and waitFor polls
    // on real ones — it would sit out its own timeout without ever re-checking.
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeNull();
  });

  /**
   * Opening for any new row meant a fresh thread opened onto another thread's
   * write — a card the height of the composer between the operator and the work
   * they came to start. The summary still says it, and Review is one key away.
   */
  it('does not open itself for a call on another thread', async () => {
    vi.useFakeTimers();
    let rows: unknown[] = [];
    const fn = vi.fn(async () => new Response(JSON.stringify({ requests: rows }), { status: 200 }));
    vi.stubGlobal('fetch', fn);
    mount();
    await act(async () => {
      await Promise.resolve();
    });

    rows = [
      approval({ thread_id: 'elsewhere', tool_name: 'local_shell', args: { command: 'ls' } }),
    ];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11_000);
    });

    expect(screen.getByRole('status').textContent).toContain('1 call is waiting on you');
    const review = screen.getByRole('button', { name: 'Review' });
    expect(review.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
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
    stub([approval({ thread_id: 'elsewhere', tool_name: 'local_shell', args: { command: 'ls' } })]);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Review' }));
    // The row first, then its card on request: one line per waiting call.
    const row = screen.getByRole('group', { name: 'Approval waiting: local_shell' });
    expect(within(row).getByText('· Overnight batch')).toBeTruthy();
    await userEvent.click(within(row).getByRole('button', { name: 'Review' }));
    const link = within(row).getByRole('link', { name: 'Overnight batch' });
    expect(link.getAttribute('href')).toBe('/t/elsewhere');
    expect(within(row).getByRole('button', { name: /approve/i })).toBeTruthy();
  });

  /**
   * A `/approvals` row carries no `before`, so a write from another thread could
   * only be shown here without what it replaces. The banner on its own thread
   * has that, because the approval reached it by frame. So the line routes.
   */
  it("routes another thread's write to that thread instead of deciding it here", async () => {
    stub([approval({ thread_id: 'elsewhere' })]);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Review' }));
    const row = screen.getByRole('group', { name: 'Approval waiting: write_file' });
    const open = within(row).getByRole('link', { name: /Open thread to review/ });
    expect(open.getAttribute('href')).toBe('/t/elsewhere');
    expect(within(row).queryByRole('button', { name: /approve/i })).toBeNull();
    expect(within(row).getByText(/decided on its own thread/)).toBeTruthy();
  });

  /**
   * Off the workbench the banner is not on screen, so a call it owns would be a
   * count with no verb. It gets a row that routes back to its thread instead —
   * not a card, because the banner's card is the stronger of the two.
   */
  it('routes a banner-owned call back to its thread when the banner is not on screen', async () => {
    stub([approval({ id: 'a1', thread_id: 'here' })]);
    mount(false, ['a1'], false);
    // On this thread, so the queue opens itself.
    const row = await screen.findByRole('group', { name: 'Approval waiting: write_file' });
    const open = within(row).getByRole('link', { name: /Open thread to review/ });
    expect(open.getAttribute('href')).toBe('/t/here');
    expect(within(row).queryByRole('button', { name: /approve/i })).toBeNull();
  });

  it('says what the countdown counts down to', async () => {
    stub([approval({ thread_id: 'elsewhere' })]);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Review' }));
    expect(screen.getByRole('timer').textContent).toMatch(/^Auto-denies in \d+:\d{2}$/);
  });

  it('keeps an unattributed write decidable, since it has nowhere to route to', async () => {
    stub([approval({ thread_id: '' })]);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Review' }));
    expect(await screen.findByRole('button', { name: 'Approve write_file' })).toBeTruthy();
  });

  /**
   * One call, one vocabulary. The banner names the gating rule beside the tool
   * and never offers to edit a whole file body; this card used to name the
   * manifest and offer Edit for the same write, because it had no `before`.
   */
  it('names the rule and offers no argument editing for a write, as the banner does', async () => {
    stub([approval({ thread_id: '' })]);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Review' }));
    const card = await screen.findByRole('group', { name: 'Approval waiting: write_file' });
    expect(within(card).getByText('workspace-write')).toBeTruthy();
    expect(within(card).queryByText('cowork')).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Edit arguments' })).toBeNull();
  });

  it('shows one clock per call: the row while collapsed, the card once open', async () => {
    stub([approval({ thread_id: 'elsewhere', tool_name: 'local_shell', args: { command: 'ls' } })]);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Review' }));
    const row = screen.getByRole('group', { name: 'Approval waiting: local_shell' });
    expect(within(row).getAllByRole('timer')).toHaveLength(1);
    await userEvent.click(within(row).getByRole('button', { name: 'Review' }));
    expect(within(row).getAllByRole('timer')).toHaveLength(1);
  });

  /**
   * An agent's question (`ask_user`) blocks the run as an approval does, but the
   * `/approvals` poll never sees it. The line said "Working. Nothing waiting on
   * you." under a header that said `blocked`, on a live harness, while the run
   * waited on an answer.
   */
  it('says a question is waiting, and never "nothing waiting", while one is open', async () => {
    stub([]);
    mountQuestion();
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        'A question is waiting on you on this thread',
      ),
    );
    expect(document.querySelector('[data-attention-dot]')?.className).toContain('bg-state-blocked');
    // The banner above the composer owns the answer; the line only says so.
    expect(screen.queryByRole('link', { name: 'Answer it' })).toBeNull();
  });

  it('counts approvals and the question together', async () => {
    stub([approval({ thread_id: 'here' })]);
    mountQuestion();
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toMatch(
        /1 call is waiting on you on this thread · and a question on this thread/,
      ),
    );
  });

  it('routes back to the thread from a page where the question banner is not drawn', async () => {
    stub([]);
    mountQuestion(false);
    const link = await screen.findByRole('link', { name: 'Answer it' });
    expect(link.getAttribute('href')).toBe('/t/here');
  });

  /**
   * A run left going on another thread can ask too. Its engine is not the one on
   * screen and `/approvals` never lists a question, so the line is the only
   * place in the page that can say so — and it must not say "on this thread".
   */
  it('says a question on another thread is waiting, and links to that thread', async () => {
    stub([]);
    render(
      <MemoryRouter>
        <TooltipProvider>
          <ElsewhereQuestionLine />
        </TooltipProvider>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        'A question is waiting on you on another thread',
      ),
    );
    expect(document.querySelector('[data-attention-dot]')?.className).toContain('bg-state-blocked');
    const link = screen.getByRole('link', { name: 'Answer it' });
    expect(link.getAttribute('href')).toBe('/t/elsewhere');
    expect(link.getAttribute('title')).toBe('Answer the question on Overnight batch');
  });

  it('says an approval here and a question elsewhere apart, not both as here', async () => {
    stub([approval({ thread_id: 'here' })]);
    render(
      <MemoryRouter>
        <TooltipProvider>
          <ElsewhereQuestionLine />
        </TooltipProvider>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        '1 call is waiting on you on this thread · and a question on another thread',
      ),
    );
  });

  it("carries the rule's reason to the card when this tab saw it by frame", async () => {
    stub([approval({ thread_id: 'here' })]);
    render(
      <MemoryRouter>
        <TooltipProvider>
          <ReasonLine />
        </TooltipProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Confirm writes to the workspace')).toBeTruthy();
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
    stub([
      approval({ id: 'a1' }),
      approval({ id: 'a2', thread_id: 'here', tool_name: 'local_shell', args: { command: 'ls' } }),
    ]);
    mount(false, ['a1']);

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('2 calls are waiting'),
    );
    // One card, for the one the banner is not showing.
    expect(await screen.findByRole('button', { name: 'Approve local_shell' })).toBeTruthy();
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
/**
 * The banner lets go of an approval the moment it is decided — `shiftApproval`
 * drops it from `bannerOwned` — but the line's list is up to a poll old. So for
 * as long as that list still carried the row, the line treated it as unowned,
 * opened itself on the transition, and offered Approve on a call the harness had
 * already answered. `markDecided` is what the banner calls first.
 */
function DecidedFromBanner() {
  const approvals = usePendingApprovals();
  const [handled, setHandled] = useState(['a1']);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          approvals.markDecided('a1');
          setHandled([]);
        }}
      >
        decide in banner
      </button>
      <button type="button" onClick={() => approvals.refresh()}>
        poll now
      </button>
      <AttentionLine
        approvals={approvals}
        streaming={false}
        handled={handled}
        bannerOnScreen
        threadId="here"
        threads={THREADS}
      />
    </>
  );
}

function mountDecided() {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <DecidedFromBanner />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe('an approval this tab just decided', () => {
  it('is not re-offered while the poll still lists it', async () => {
    // The harness has not caught up: every poll still returns the row.
    stub([approval({ id: 'a1', thread_id: 'here' })]);
    mountDecided();
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('1 call is waiting on you'),
    );

    await act(async () => screen.getByRole('button', { name: 'decide in banner' }).click());
    expect(screen.getByRole('status').textContent).toBe('No approvals or questions waiting.');
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();

    // A tick that still carries it must not put it back.
    await act(async () => screen.getByRole('button', { name: 'poll now' }).click());
    await act(async () => {});
    expect(screen.getByRole('status').textContent).toBe('No approvals or questions waiting.');
    expect(screen.queryByRole('button', { name: /review/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
  });

  it('is offered again if the harness still holds it after the grace', async () => {
    stub([approval({ id: 'a1', thread_id: 'here' })]);
    mountDecided();
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('1 call is waiting on you'),
    );
    await act(async () => screen.getByRole('button', { name: 'decide in banner' }).click());

    const later = Date.now() + DECIDED_GRACE_MS + 1;
    vi.spyOn(Date, 'now').mockReturnValue(later);
    await act(async () => screen.getByRole('button', { name: 'poll now' }).click());
    // Once offered, the card brings its own status (the deadline); the line's
    // sentence is the first.
    await waitFor(() =>
      expect(screen.getAllByRole('status')[0]?.textContent).toContain('1 call is waiting on you'),
    );
    expect(await screen.findByRole('button', { name: /approve/i })).toBeTruthy();
  });

  it('stops being suppressed once the harness drops it, so a reused id is offered', async () => {
    const spy = stub([approval({ id: 'a1', thread_id: 'here' })]);
    mountDecided();
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('1 call is waiting on you'),
    );
    await act(async () => screen.getByRole('button', { name: 'decide in banner' }).click());

    // The harness settles it...
    spy.mockImplementation(
      async () => new Response(JSON.stringify({ requests: [] }), { status: 200 }),
    );
    await act(async () => screen.getByRole('button', { name: 'poll now' }).click());
    await act(async () => {});
    // ...and then holds a row under the same id again (one pending row is shared
    // by every byte-identical call). That is a new request, and it is offered.
    spy.mockImplementation(
      async () =>
        new Response(JSON.stringify({ requests: [approval({ id: 'a1', thread_id: 'here' })] }), {
          status: 200,
        }),
    );
    await act(async () => screen.getByRole('button', { name: 'poll now' }).click());
    expect(await screen.findByRole('button', { name: /approve/i })).toBeTruthy();
  });
});

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
    expect(status()).not.toMatch(/no approvals or questions waiting/i);
    await settle();
    expect(status()).not.toMatch(/no approvals or questions waiting/i);
    // A 429 is the harness answering, so it is named as a rate limit, not an outage.
    expect(status()).toMatch(/approvals rate-limited/i);
    expect(screen.getByText('no answer yet')).toBeTruthy();
  });

  it("says it can't reach approvals when the failure is not a rate limit", async () => {
    vi.useFakeTimers();
    switchable({ status: 503 });
    mount();
    await settle();
    expect(status()).toMatch(/can't reach approvals/i);
    expect(status()).not.toMatch(/rate-limited/i);
  });

  it('says how old its answer is once a good poll is followed by a failed one', async () => {
    vi.useFakeTimers();
    const answer = switchable({ status: 200, rows: [] });
    mount();
    await settle();
    expect(status()).toMatch(/no approvals or questions waiting/i);

    answer({ status: 429 });
    await tick();
    expect(status()).not.toMatch(/no approvals or questions waiting/i);
    await tick();
    expect(status()).toMatch(/approvals rate-limited/i);
    expect(screen.getByText(/^last answered /)).toBeTruthy();
  });

  /**
   * One failed tick after an answer is a burst being shed, and the next tick
   * nearly always answers. Red on it was a false alarm every time; the line says
   * it is rechecking — never the all-clear — and turns red on a second failure.
   */
  it('rechecks, in neutral, on a single failure after an answer', async () => {
    vi.useFakeTimers();
    const answer = switchable({ status: 200, rows: [] });
    const { container } = mount();
    await settle();

    answer({ status: 429 });
    await tick();
    expect(status()).toMatch(/rechecking approvals/i);
    expect(status()).not.toMatch(/no approvals or questions waiting/i);
    const dot = () => container.querySelector('[data-attention-dot]')?.className ?? '';
    expect(dot()).not.toMatch(/state-failed/);
    expect(screen.queryByText(/^last answered /)).toBeNull();

    answer({ status: 200, rows: [] });
    await tick();
    expect(status()).toMatch(/no approvals or questions waiting/i);

    // The count resets on an answer: one more failure is a recheck again, not red.
    answer({ status: 429 });
    await tick();
    expect(status()).toMatch(/rechecking approvals/i);
    await tick();
    expect(dot()).toMatch(/state-failed/);
  });

  it('keeps the last known count, in the past tense, when the poll starts failing', async () => {
    vi.useFakeTimers();
    const answer = switchable({ status: 200, rows: [approval(), approval({ id: 'a2' })] });
    mount();
    await settle();
    expect(status()).toContain('2 calls are waiting on you across the harness');

    answer({ status: 503 });
    await tick();
    expect(status()).toContain('2 calls were waiting on you across the harness · rechecking');
    await tick();
    expect(status()).toContain("Can't reach approvals");
    expect(status()).toContain('2 calls were waiting on you across the harness');
  });

  it('restores the all-clear when the poll recovers', async () => {
    vi.useFakeTimers();
    const answer = switchable({ status: 429 });
    mount();
    await settle();
    expect(status()).toMatch(/approvals rate-limited/i);

    answer({ status: 200, rows: [] });
    await tick();
    expect(status()).toMatch(/no approvals or questions waiting/i);
    expect(screen.queryByText(/last answered|no answer yet/)).toBeNull();
  });

  /** Idle is not on the ramp: green claims a finished state this line has no evidence of. */
  it('rests on a neutral dot, not the done hue', async () => {
    stub([]);
    const { container } = mount();
    await waitFor(() => expect(status()).toMatch(/no approvals or questions waiting/i));
    const dot = container.querySelector('[data-attention-dot]');
    expect(dot?.className).not.toMatch(/state-done/);
    expect(dot?.className).toContain('bg-muted-foreground/50');
  });
});
