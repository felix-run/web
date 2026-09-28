/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApprovalDecision } from '../src/components/approval/approval-decision';

/**
 * The banner's job is to let someone authorize a tool call they understand.
 *
 * `reason` is the half that says *why* the gate fired — a manifest rule's
 * `description`, in the operator's own words. It reached no client at all until
 * `felix-run/felix#210`, and this card rendered nothing for it even once it did,
 * so a person was asked to authorize a write over a card that named only
 * `workspace-write`. It is still frame-only: an approval the `/approvals` poll
 * found carries none, and the card must stay readable without it.
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ApprovalDecision', () => {
  it('says why the gate fired when the frame carried a reason', () => {
    render(
      <ApprovalDecision
        toolName="write_file"
        args={{ path: 'notes.txt', content: 'hello' }}
        context="workspace-write"
        reason="Confirm writes to the workspace"
        onDecide={vi.fn()}
      />,
    );
    expect(screen.getByText('Confirm writes to the workspace')).toBeTruthy();
    expect(screen.getByText('workspace-write')).toBeTruthy();
  });

  it('does not print the same sentence twice for a screening gate', () => {
    // A screening approval has no rule id of its own, so the harness synthesises
    // `command:<reason>` and sends the reason separately. The banner trims the id
    // before handing it over; this pins the card's half of that — both lines
    // present, neither repeating the other.
    render(
      <ApprovalDecision
        toolName="local_shell"
        args={{ command: 'curl https://example.com' }}
        context="command"
        reason="Outbound network command"
        onDecide={vi.fn()}
      />,
    );
    expect(screen.getByText('command')).toBeTruthy();
    expect(screen.getByText('Outbound network command')).toBeTruthy();
    expect(screen.queryByText('command:Outbound network command')).toBeNull();
  });

  it('still names the rule when no reason arrived', () => {
    // The poll's rows carry no reason, so this is the ordinary unwatched case —
    // not a degraded one, and it must not render an empty paragraph.
    render(
      <ApprovalDecision
        toolName="write_file"
        args={{ path: 'notes.txt', content: 'hello' }}
        context="workspace-write"
        onDecide={vi.fn()}
      />,
    );
    expect(screen.getByText('workspace-write')).toBeTruthy();
    expect(screen.queryByText('Confirm writes to the workspace')).toBeNull();
  });

  it('puts the deadline in the header as a named timer that does not speak every second', () => {
    // It was a clause in the footer under the buttons. The chip is the visible
    // half; the role is what keeps it silent, since `timer` is `aria-live="off"`.
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    render(
      <ApprovalDecision
        toolName="local_shell"
        args={{ command: 'ls' }}
        expiresAt={1_000_000 + 272_000}
        onDecide={vi.fn()}
      />,
    );
    const timer = screen.getByRole('timer', { name: 'Auto-denies in 4:32' });
    expect(timer.getAttribute('aria-live')).toBeNull();
    expect(timer.className).toContain('text-state-blocked');
    // Nothing to announce until the last minute.
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('says the grant is wider than this call, above the buttons, with or without a deadline', () => {
    render(<ApprovalDecision toolName="local_shell" args={{ command: 'ls' }} onDecide={vi.fn()} />);
    // No known deadline: no chip, but the grant sentence is still owed — the
    // inspector passes no `expiresAt`, and approving there grants just the same.
    expect(screen.queryByRole('timer')).toBeNull();
    const grant = screen.getByText(/Approving also allows every identical/);
    expect(grant.textContent).toContain('until the grant expires');
    expect(grant.className).toContain('text-sm');
  });

  it('draws Approve and Deny at equal weight, told apart only by their words', () => {
    // Approve was a solid fill beside an outlined Deny: a nudge toward yes on the
    // one surface that authorises a write. Identical classes is the whole claim —
    // same variant, same size, same width — and the label still names the target.
    render(<ApprovalDecision toolName="write_file" args={{ path: 'a.txt' }} onDecide={vi.fn()} />);
    const approve = screen.getByRole('button', { name: 'Approve write_file' });
    const deny = screen.getByRole('button', { name: 'Deny' });
    expect(approve.className).toBe(deny.className);
    expect(approve.className).not.toContain('bg-primary');
  });

  it('lets a long tool name wrap inside Approve instead of pushing it out of the card', () => {
    // The primitive is nowrap with an automatic minimum width, so at phone width
    // `Approve github__create_pull_request_review_comment` was wider than the card.
    // jsdom has no layout, so what is pinned is the override that makes it wrap —
    // on both buttons, so the equal-width claim above survives it — and that the
    // full name is still what assistive tech hears.
    const toolName = 'github__create_pull_request_review_comment';
    render(<ApprovalDecision toolName={toolName} args={{ pull: 1 }} onDecide={vi.fn()} />);
    const approve = screen.getByRole('button', { name: `Approve ${toolName}` });
    const deny = screen.getByRole('button', { name: 'Deny' });
    for (const button of [approve, deny]) {
      const classes = button.className.split(/\s+/);
      expect(classes).toContain('whitespace-normal');
      expect(classes).not.toContain('whitespace-nowrap');
      expect(classes).toContain('wrap-anywhere');
      expect(classes).toContain('min-w-0');
      expect(classes).toContain('flex-1');
    }
    expect(approve.className).toBe(deny.className);
  });

  it('once lapsed, says who decided and offers nothing to click', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000_000);
    render(
      <ApprovalDecision
        toolName="local_shell"
        args={{ command: 'ls' }}
        expiresAt={1_000_000}
        onDecide={vi.fn()}
      />,
    );
    const timer = screen.getByRole('timer', { name: 'Denied: timed out' });
    expect(timer.className).toContain('text-state-failed');
    expect(screen.getByText('The harness stopped waiting and denied this itself.')).toBeTruthy();
    expect(screen.queryByText(/Approving also allows/)).toBeNull();
    for (const name of [/Approve/, 'Deny', 'Edit arguments']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  /**
   * The banner passes `onDismiss`; without it a lapsed card at the head of the
   * queue had nothing to click at all, and stayed there.
   */
  it('once lapsed, offers only a way to clear the card when given one', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000_000);
    const onDismiss = vi.fn();
    const onDecide = vi.fn();
    render(
      <ApprovalDecision
        toolName="local_shell"
        args={{ command: 'ls' }}
        expiresAt={1_000_000}
        onDecide={onDecide}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Deny' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDecide).not.toHaveBeenCalled();
  });
});
