import { summarizeToolArgs, type PendingApproval } from '@felix/cowork-client';
import { Button } from '@felix/ui/button';

export function ApprovalBanner({
  pending,
  queueLength,
  deciding,
  onDecide,
}: {
  pending: PendingApproval;
  queueLength: number;
  deciding: boolean;
  onDecide: (status: 'approved' | 'denied') => void;
}) {
  const writeDiff =
    pending.toolName === 'write_file'
      ? {
          before: pending.before ?? '',
          next: typeof pending.args.content === 'string' ? pending.args.content : '',
          isNew: pending.before == null,
        }
      : null;

  return (
    <div className="mx-auto mb-3 w-full max-w-2xl rounded-xl border border-primary/40 bg-accent/40 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Approval required{queueLength > 1 ? ` · ${queueLength} queued` : ''}
          </p>
          <h2 className="mt-1 text-sm font-semibold">{pending.toolName}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {summarizeToolArgs(pending.toolName, pending.args)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" disabled={deciding} onClick={() => onDecide('approved')}>
            {deciding ? '…' : 'Approve'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={deciding}
            onClick={() => onDecide('denied')}
          >
            Deny
          </Button>
        </div>
      </div>
      {writeDiff ? (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              {writeDiff.isNew ? 'Before (new file)' : 'Before'}
            </p>
            <pre className="max-h-36 overflow-auto rounded-lg border border-border/50 bg-background p-2 font-mono text-[11px] text-muted-foreground">
              {writeDiff.isNew ? '(empty)' : writeDiff.before.slice(0, 6000)}
            </pre>
          </div>
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">After</p>
            <pre className="max-h-36 overflow-auto rounded-lg border border-border/50 bg-background p-2 font-mono text-[11px] text-muted-foreground">
              {writeDiff.next.slice(0, 6000)}
            </pre>
          </div>
        </div>
      ) : (
        <pre className="mt-3 max-h-28 overflow-auto rounded-lg border border-border/50 bg-background p-2 font-mono text-[11px] text-muted-foreground">
          {JSON.stringify(pending.args, null, 2)}
        </pre>
      )}
    </div>
  );
}
