import type { PendingApproval } from '@felix/client';
import { ApprovalDecision } from '@/components/approval/approval-decision';

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
  onDecide: (status: 'approved' | 'denied') => Promise<void>;
}) {
  return (
    // The inset matches the composer and the transcript column so the card's visible
    // edge lines up with theirs; without it the interrupt sits 25px proud of the thing
    // it interrupts.
    <div className="mx-auto mb-3 w-full max-w-3xl px-4 md:px-6">
      <ApprovalDecision
        toolName={pending.toolName}
        args={pending.args}
        // `before` is only meaningful for a write; anything else has no before/after.
        before={pending.toolName === 'write_file' ? (pending.before ?? null) : undefined}
        queueLength={queueLength}
        runAborted={runAborted}
        onDecide={onDecide}
      />
    </div>
  );
}
