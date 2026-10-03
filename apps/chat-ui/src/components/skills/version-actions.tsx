import { Button } from '@felix/ui/button';
import { Textarea } from '@felix/ui/textarea';
import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { DECISION_BUTTON } from '@/components/approval/approval-decision';
import { ConfirmButton } from '@/components/confirm-button';
import { cn } from '@/lib/utils';
import { useVersionActions } from './queries';
import { isForbidden, RefusalNotice } from './refusal';

/**
 * The three decisions a version takes — publish, roll back, reject — as one
 * control set, shared by the Versions tab, the review queue and the chat card,
 * so a decision reads the same wherever it is made.
 *
 * Each arms before it fires (`ConfirmButton`) and its question names the
 * resolved consequence: *which* version goes live and which it replaces. That
 * is what catches deciding the wrong row. Publish and Reject are the same
 * weight, as Approve and Deny are on an approval card: nothing but the words
 * tells them apart.
 *
 * Reject needs a note — the harness requires one, and it is what the agent
 * that drafted the version will be told — so it opens a field first rather
 * than arming on a blank.
 */
export function VersionDecision({
  name,
  version,
  liveVersion,
  canPublish = true,
  canReject = true,
  onDecided,
  onForbidden,
  verb = 'Publish',
  className,
}: {
  name: string;
  version: string;
  liveVersion: string | null;
  canPublish?: boolean;
  canReject?: boolean;
  onDecided?: (what: 'published' | 'rejected') => void;
  /** A 403: the key lacks `skills:write`. The host can drop the buttons for good. */
  onForbidden?: () => void;
  /** The publish button's verb — `Approve` on the chat card, where it answers a proposal. */
  verb?: string;
  className?: string;
}) {
  const { publish, reject } = useVersionActions();
  const failure = publish.error ?? reject.error;
  useEffect(() => {
    if (failure && isForbidden(failure)) onForbidden?.();
  }, [failure, onForbidden]);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const noteId = useId();
  const busy = publish.isPending || reject.isPending;
  const replaces = liveVersion
    ? `replacing live ${liveVersion} for every ref that pins no version`
    : 'as its first live version';

  return (
    <div className={cn('space-y-2', className)}>
      {!rejecting ? (
        <div className="flex flex-wrap gap-2">
          {canPublish && (
            <ConfirmButton
              variant="outline"
              className={DECISION_BUTTON}
              disabled={busy}
              question={`${name} ${version} goes live, ${replaces}.`}
              confirmLabel={`${verb} ${version}`}
              onConfirm={async () => {
                try {
                  await publish.mutateAsync({ name, version });
                  toast.success(`Published ${name} ${version}.`);
                  onDecided?.('published');
                } catch {
                  // Drawn below from the mutation's own error.
                }
              }}
            >
              {verb} {version}
            </ConfirmButton>
          )}
          {canReject && (
            <Button
              size="sm"
              variant="outline"
              className={DECISION_BUTTON}
              disabled={busy}
              onClick={() => {
                publish.reset();
                setRejecting(true);
              }}
            >
              Reject…
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <label htmlFor={noteId} className="block text-xs font-medium text-muted-foreground">
            Why reject {version}? The note is kept on the version and the drafting agent sees it.
          </label>
          <Textarea
            id={noteId}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            className="min-h-16 text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <ConfirmButton
              variant="outline"
              destructive
              disabled={busy || note.trim() === ''}
              question={`${name} ${version} is archived unpublished, with this note.`}
              confirmLabel={`Reject ${version}`}
              onConfirm={async () => {
                try {
                  await reject.mutateAsync({ name, version, note: note.trim() });
                  toast.success(`Rejected ${name} ${version}.`);
                  setRejecting(false);
                  setNote('');
                  onDecided?.('rejected');
                } catch {
                  // Drawn below.
                }
              }}
            >
              Reject {version}
            </ConfirmButton>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                reject.reset();
                setRejecting(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      {publish.error ? <RefusalNotice error={publish.error} doing={`publish ${version}`} /> : null}
      {reject.error ? <RefusalNotice error={reject.error} doing={`reject ${version}`} /> : null}
    </div>
  );
}

/** Roll a once-live version back into place, through the same gate as a publish. */
export function RollbackButton({
  name,
  version,
  liveVersion,
}: {
  name: string;
  version: string;
  liveVersion: string | null;
}) {
  const { rollback } = useVersionActions();
  return (
    <div className="space-y-2">
      <ConfirmButton
        size="xs"
        variant="outline"
        disabled={rollback.isPending}
        question={`${version} goes live again${liveVersion ? `, replacing ${liveVersion}` : ''}.`}
        confirmLabel={`Roll back to ${version}`}
        onConfirm={async () => {
          try {
            await rollback.mutateAsync({ name, version });
            toast.success(`${name} ${version} is live again.`);
          } catch {
            // Drawn below.
          }
        }}
      >
        Roll back to this
      </ConfirmButton>
      {rollback.error ? (
        <RefusalNotice error={rollback.error} doing={`roll back to ${version}`} />
      ) : null}
    </div>
  );
}
