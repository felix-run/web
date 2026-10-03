import { REQUEST_BODY_LIMIT_BYTES, type SkillBump } from '@felix/client';
import { bumpSemver } from '@felix/skill-format';
import { Button } from '@felix/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@felix/ui/dialog';
import { Textarea } from '@felix/ui/textarea';
import { useId, useState } from 'react';
import { cn } from '@/lib/utils';
import { formatBytes } from './asset-preview';

export interface SaveChoice {
  reason: string;
  bump: SkillBump;
  publish: boolean;
}

/**
 * What a save needs a person to say: why, how big a change, and whether to
 * publish it at once. A new version is permanent — versions are never deleted —
 * so it gets a dialog rather than a silent write on Cmd/Ctrl+S.
 *
 * The version it will be is spelled out from the parent and the bump, because
 * that number is how everyone downstream will refer to this change. The body
 * size is shown against the harness's 1 MiB request cap when it gets close,
 * since base64 assets reach it well before the bundle's own cap.
 *
 * "Publish now" is a request, not a promise: the publish gate still decides,
 * and when it refuses, the version is saved as a draft and the page says why.
 */
export function SaveDialog({
  open,
  onOpenChange,
  parent,
  bodyBytes,
  busy,
  onSave,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The version this edits; the save is refused if a newer one exists. Null for a new skill. */
  parent: string | null;
  bodyBytes: number;
  busy: boolean;
  onSave: (choice: SaveChoice) => void;
  error?: React.ReactNode;
}) {
  const [reason, setReason] = useState('');
  const [bump, setBump] = useState<SkillBump>('patch');
  const [publish, setPublish] = useState(false);
  const reasonId = useId();
  const publishId = useId();
  const over = bodyBytes > REQUEST_BODY_LIMIT_BYTES;
  const near = bodyBytes > REQUEST_BODY_LIMIT_BYTES * 0.8;
  const next = parent ? bumpSemver(parent, bump) : '0.1.0';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onKeyDown={(e) => {
          // Cmd/Ctrl+S inside the dialog is the save it is asking about.
          if (e.key.toLowerCase() === 's' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (!busy && !over) onSave({ reason, bump, publish });
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            Save <span className="font-mono">{next}</span>
          </DialogTitle>
          <DialogDescription>
            {parent ? (
              <>
                A new version edited from <span className="font-mono">{parent}</span>. Versions are
                kept; this does not replace {parent}.
              </>
            ) : (
              'The first version of a new skill.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {parent && (
            <fieldset className="space-y-1.5">
              <legend className="text-xs font-medium text-muted-foreground">Version</legend>
              <div role="radiogroup" className="flex flex-wrap gap-2">
                {(['patch', 'minor', 'major'] as const).map((b) => (
                  <label
                    key={b}
                    className={cn(
                      'flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs',
                      bump === b ? 'border-ring bg-accent' : 'border-border/60',
                    )}
                  >
                    <input
                      type="radio"
                      name="skill-bump"
                      value={b}
                      checked={bump === b}
                      onChange={() => setBump(b)}
                    />
                    {b} <span className="font-mono">{bumpSemver(parent, b)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <div className="space-y-1.5">
            <label htmlFor={reasonId} className="block text-xs font-medium text-muted-foreground">
              Reason (kept on the version)
            </label>
            <Textarea
              id={reasonId}
              value={reason}
              maxLength={2000}
              onChange={(e) => setReason(e.target.value)}
              placeholder="What changed, and why"
              className="min-h-16 text-sm"
            />
          </div>

          <label htmlFor={publishId} className="flex items-start gap-2 text-sm">
            <input
              id={publishId}
              type="checkbox"
              className="mt-0.5"
              checked={publish}
              onChange={(e) => setPublish(e.target.checked)}
            />
            <span>
              Publish now
              <span className="block text-xs text-muted-foreground">
                Goes live if the publish gate passes it. If not, it is saved as a draft and the page
                says why.
              </span>
            </span>
          </label>

          {near && (
            <p
              className={cn('text-xs', over ? 'text-state-failed' : 'text-state-blocked')}
              role={over ? 'alert' : undefined}
            >
              This save is {formatBytes(bodyBytes)} as sent; the harness refuses requests over{' '}
              {formatBytes(REQUEST_BODY_LIMIT_BYTES)}.
              {over && ' Remove or shrink a large file to save.'}
            </p>
          )}
          {error}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button disabled={busy || over} onClick={() => onSave({ reason, bump, publish })}>
            {busy ? 'Saving…' : `Save ${next}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
