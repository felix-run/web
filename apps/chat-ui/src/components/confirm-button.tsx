import { Button } from '@felix/ui/button';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * A button that arms before it fires, for actions that cannot be taken back.
 *
 * The manifest and jobs sheets delete scheduled jobs and re-point which manifest
 * version serves live traffic, and did it on a single click with no confirmation
 * and no undo. Activating is driven by a free-text version field, so the realistic
 * accident is not a mis-click but a **typo**: meaning to activate v3 and typing v13.
 *
 * That is why `question` echoes the *resolved* consequence rather than asking a
 * generic "are you sure?". Reading "v13 will serve all traffic for quick" back to
 * the operator is what catches the typo; a modal that asks whether they meant to
 * press the button they just pressed does not.
 *
 * Inline rather than a dialog, deliberately. These live inside a Sheet, which is
 * already a focus-trapping modal layer, and the evidence an operator needs (the
 * version list, the job row) is on screen behind it. Stacking a second modal over
 * a sheet to restate what is visible underneath adds focus-management risk and no
 * information.
 */
export function ConfirmButton({
  children,
  question,
  confirmLabel,
  onConfirm,
  disabled,
  destructive,
  size = 'sm',
  variant = 'default',
  className,
}: {
  /** Resting label. */
  children: ReactNode;
  /** What will happen, in concrete terms, with the values already resolved. */
  question: string;
  /** Verb + object, e.g. "Activate v13". */
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  disabled?: boolean;
  /** Colours the confirm step as a loss rather than a change. */
  destructive?: boolean;
  size?: 'sm' | 'default';
  variant?: 'default' | 'outline' | 'ghost';
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  // A ref, not state: React batches, so a burst of clicks in one tick would all
  // read the same pre-update value and every one would fire. Measured on the
  // approval buttons, where ten clicks produced ten POSTs.
  const inFlight = useRef(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Move focus onto the confirm step so a keyboard operator continues in place
  // instead of hunting for where the control went.
  useEffect(() => {
    if (armed) confirmRef.current?.focus();
  }, [armed]);

  // Escape should cancel the confirmation, not the sheet behind it — the innermost
  // dismissible thing goes first.
  //
  // This has to be a capture listener on `window` rather than an `onKeyDown` on the
  // group. Radix's dismissable layer listens for Escape on `document` in the capture
  // phase, which runs before the event ever reaches React's handlers, so calling
  // `stopPropagation` from a React `onKeyDown` is too late: measured, it closed the
  // whole sheet and left the armed action behind. Capture on `window` is the one
  // position that runs earlier than `document`.
  useEffect(() => {
    if (!armed) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      setArmed(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [armed]);

  if (!armed) {
    return (
      <Button
        size={size}
        variant={variant}
        className={className}
        disabled={disabled}
        onClick={() => setArmed(true)}
      >
        {children}
      </Button>
    );
  }

  return (
    <span
      role="group"
      aria-label={confirmLabel}
      className={cn('flex min-w-0 flex-wrap items-center gap-1.5', className)}
    >
      <span
        className={cn(
          'min-w-0 flex-1 text-xs leading-snug',
          destructive ? 'text-state-failed' : 'text-muted-foreground',
        )}
      >
        {question}
      </span>
      <Button
        ref={confirmRef}
        size={size}
        variant={destructive ? 'destructive' : 'default'}
        className="h-7 shrink-0"
        disabled={disabled}
        onClick={async () => {
          if (inFlight.current) return;
          inFlight.current = true;
          try {
            await onConfirm();
            setArmed(false);
          } finally {
            inFlight.current = false;
          }
        }}
      >
        {confirmLabel}
      </Button>
      <Button
        size={size}
        variant="outline"
        className="h-7 shrink-0"
        onClick={() => setArmed(false)}
      >
        Cancel
      </Button>
    </span>
  );
}
