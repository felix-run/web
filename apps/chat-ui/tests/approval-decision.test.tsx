/** @vitest-environment happy-dom */
import { cleanup, render, screen } from '@testing-library/react';
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
});
