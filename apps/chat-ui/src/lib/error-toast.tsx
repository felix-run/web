import { describeError } from '@felix/client';
import type { ReactNode } from 'react';
import { toast } from 'sonner';

/**
 * One place that owns how a failure is reported.
 *
 * Three things were wrong with doing this at each call site, and they compounded.
 *
 * **Two vocabularies.** Roughly half the sites ran the error through
 * `describeError` and half printed `String(err.message ?? err)`, so whether an
 * operator read "The harness failed while trying to continue this run. This is
 * usually transient, so it is worth retrying." or `TypeError: Failed to fetch`
 * depended on which control they happened to touch.
 *
 * **Four seconds.** Sonner's default duration is fine for "Saved" and far too
 * short for a two-line failure whose description is a raw string off the wire.
 * Errors persist now, and the close button is how they go away. They are the one
 * thing on this surface that should require an acknowledgement.
 *
 * **A promise with nothing behind it.** `describeError` tells the operator a 5xx
 * "is worth retrying" and the toast offered no way to do it. `retry` puts the
 * action next to the sentence that suggests it.
 *
 * `retry` is deliberately opt-in per call site rather than derived from the
 * error. Whether re-running is safe is a property of the *operation*, not of how
 * it failed: setting a thinking level again is free, and posting a steer again
 * can queue the same message twice when the first one landed and only the
 * response was lost.
 */
export interface ErrorToastOptions {
  /**
   * Run the same operation again. Only pass this when doing so is safe after a
   * partial success, i.e. when the operation is idempotent.
   */
  retry?: () => void;
}

/**
 * The raw error text, as a node that will not be eaten by swipe-to-dismiss.
 *
 * The detail is the part worth copying into a bug report, and selecting it means
 * dragging across the toast, which is exactly the gesture sonner reads as a
 * dismiss. Stopping the pointer here keeps the drag local to the text.
 */
function Detail({ children }: { children: string }): ReactNode {
  return (
    <span className="select-text" onPointerDown={(e) => e.stopPropagation()}>
      {children}
    </span>
  );
}

/** Report a failed call to the harness. `doing` completes "Could not …". */
export function toastError(err: unknown, doing: string, options: ErrorToastOptions = {}): void {
  const { message, detail } = describeError(err, doing);
  toast.error(message, {
    description: <Detail>{detail}</Detail>,
    duration: Number.POSITIVE_INFINITY,
    ...(options.retry ? { action: { label: 'Retry', onClick: options.retry } } : {}),
  });
}

/**
 * Report a failure that never reached the harness, so there is no error object
 * to describe: a browser API that refused, a guard in this client.
 */
export function toastProblem(
  message: string,
  options: ErrorToastOptions & { detail?: string } = {},
): void {
  toast.error(message, {
    duration: Number.POSITIVE_INFINITY,
    ...(options.detail ? { description: <Detail>{options.detail}</Detail> } : {}),
    ...(options.retry ? { action: { label: 'Retry', onClick: options.retry } } : {}),
  });
}
