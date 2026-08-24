import type { PendingApproval } from '@felix/cowork-client';
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
  onDecide,
}: {
  pending: PendingApproval;
  queueLength: number;
  /** Performs the decision and advances the queue. Should throw on failure. */
  onDecide: (status: 'approved' | 'denied') => Promise<void>;
}) {
  return (
    <ApprovalDecision
      className="mx-auto mb-3 w-full max-w-2xl"
      toolName={pending.toolName}
      args={pending.args}
      // `before` is only meaningful for a write; anything else has no before/after.
      before={pending.toolName === 'write_file' ? (pending.before ?? null) : undefined}
      queueLength={queueLength}
      onDecide={onDecide}
    />
  );
}
