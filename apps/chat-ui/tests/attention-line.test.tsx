// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AttentionLine } from '../src/components/attention-line';

/**
 * The line that has to be true without being looked at.
 *
 * Three rules here are load-bearing and all three fail silently. It must render
 * when nothing is wrong, or it stops being a signal and becomes a surprise. Its
 * copy must say *across the harness*, because `/approvals` rows carry no
 * `thread_id` (felix-run/felix#232) and without the phrase the count reads as
 * "on the thread you are looking at". And it must keep polling while the tab is
 * hidden, which is the entire case it exists for — a durable run's approval
 * cannot reach a stream, so this poll is the only channel.
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

function mount(streaming = false, handled: string[] = []) {
  return render(
    <TooltipProvider>
      <AttentionLine streaming={streaming} handled={handled} />
    </TooltipProvider>,
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

  it('counts what is waiting, and says where — the phrase is the whole point', async () => {
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
});
