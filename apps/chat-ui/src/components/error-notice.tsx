import { describeError } from '@felix/client';
import { CircleAlertIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The one way this app reports a failed request in place.
 *
 * The inspector has rendered failures like this for a while: `describeError` for the
 * sentence, the raw text kept underneath for the status code, `role="alert"` so a
 * screen reader hears it, and `CircleAlertIcon` rather than a text glyph. The four
 * sheets did none of it — between them they had fourteen sites rendering
 * `String((err as Error)?.message ?? err)` straight to the operator, with a literal
 * "⚠" and no live region, so a failure was invisible to assistive technology and
 * unreadable to everyone else.
 *
 * Note there is no `sr-only` status line: `role="alert"` is already a live region,
 * and duplicating the text makes a screen reader read the failure twice.
 */
export function ErrorNotice({
  error,
  doing,
  action,
  className,
}: {
  /**
   * Whatever was caught. Prefer passing the original error rather than a string —
   * `describeError` detects an offline harness from the `TypeError` that `fetch`
   * rejects with, and stringifying first throws that signal away.
   */
  error: unknown;
  /** Verb phrase completing "Could not …", e.g. `"list scheduled jobs"`. */
  doing: string;
  /** Optional control, typically a retry. Without one a failure is a dead end. */
  action?: ReactNode;
  className?: string;
}) {
  const described = describeError(error, doing);
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col gap-2 rounded-lg border border-state-failed/30 bg-state-failed/10 px-2.5 py-2 text-xs text-state-failed',
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
        <div className="min-w-0">
          <p className="break-words">{described.message}</p>
          {/* The mono face separates the raw status from the sentence; dimming it
              further would put it under the contrast floor. */}
          <p className="mt-0.5 font-mono break-words">{described.detail}</p>
        </div>
      </div>
      {action}
    </div>
  );
}
