import { approvalRuleLabel, type PendingApproval } from '@felix/client';
import { ApprovalDecision } from '@/components/approval/approval-decision';
import { ariaShortcut, isMacPlatform } from '@/lib/shortcuts';

/**
 * The transcript's interrupt for a gated tool call.
 *
 * Presentation lives in `ApprovalDecision`, shared with the Inspector's Approvals
 * section, so the same decision does not look like two different features
 * depending on where it is noticed. This adapts the client-tool shape and lets
 * the caller own what happens to the queue afterwards.
 */
export function ApprovalBanner({
  pending,
  queueLength,
  runAborted,
  onDecide,
}: {
  pending: PendingApproval;
  queueLength: number;
  /** The run was stopped; the approval outlives it but deciding will not resume it. */
  runAborted?: boolean;
  /** Performs the decision and advances the queue. Should throw on failure. */
  onDecide: (status: 'approved' | 'denied', editedArgs?: Record<string, unknown>) => Promise<void>;
}) {
  return (
    // The inset matches the composer and the transcript column so the card's visible
    // edge lines up with theirs; without it the interrupt sits 25px proud of the thing
    // it interrupts.
    <div className="mx-auto mb-3 w-full max-w-3xl px-4 md:px-6">
      {/*
        Where the keyboard layer's "what is waiting" binding lands: on the card,
        not on Approve. Focus on a button is one habitual Enter from pressing it,
        and approving grants every identical call until the deadline — so the
        shortcut brings the decision into reach and leaves the deciding to a Tab
        and a deliberate key. `tabIndex={-1}` keeps the card out of the tab order.
      */}
      <div
        tabIndex={-1}
        role="group"
        aria-label={`Approval waiting: ${pending.toolName}`}
        aria-keyshortcuts={ariaShortcut('focus-approval', isMacPlatform())}
        data-approval-focus="banner"
        className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <ApprovalDecision
          toolName={pending.toolName}
          args={pending.args}
          // `before` is only meaningful for a write; anything else has no before/after.
          before={pending.toolName === 'write_file' ? (pending.before ?? null) : undefined}
          // The rule that gated the call, in the slot already built for a quiet
          // subtitle beside the tool name.
          // A screening gate's id is `command:<reason>`, so the id is trimmed to the
          // half that says where the gate came from and `reason` says the rest;
          // without that the card printed the same sentence twice.
          context={approvalRuleLabel(pending.ruleId, pending.reason)}
          // Frame-only, so this is present for an approval a frame announced and
          // absent for one the poll found; the rule id in `context` carries it then.
          reason={pending.reason}
          expiresAt={pending.expiresAt}
          queueLength={queueLength}
          runAborted={runAborted}
          onDecide={onDecide}
        />
      </div>
    </div>
  );
}
