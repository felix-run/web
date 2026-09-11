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
});
