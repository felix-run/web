/**
 * The gate's card — the right rail of <AuthLayout /> — and the quiet text action the cards use
 * for a secondary step. One shell, so the three cards (GitHub, Google, and the one that says
 * there is no way in) cannot drift apart in spacing or heading.
 *
 * Flat, with the 22px corner (`2xl`) the system gives what is read or decided on: pills for
 * what you press, and this card holds nothing but pills. It once borrowed the
 * composer's shadow, which made it a second floating surface in an app whose system reserves
 * lift for the composer alone. With no photo — and below `lg` no panel at all — the hairline
 * is what gives the card an edge at every width.
 */

import { Button } from '@felix/ui/button';
import { cn } from '@felix/ui/lib/utils';
import type { ComponentProps, ReactNode } from 'react';

/** The controls a card draws — a field, buttons, links — in document order. */
const FIRST_CONTROL = 'input:not([disabled]):not([type=hidden]), button:not([disabled]), a[href]';

/**
 * Focus what `root` marks `data-autofocus`, else its first control. Shared with the device
 * flow's own transitions. Two queries, because one comma list matches in document order.
 */
export function focusFirst(root: HTMLElement | null): void {
  const target =
    root?.querySelector<HTMLElement>('[data-autofocus]') ??
    root?.querySelector<HTMLElement>(FIRST_CONTROL);
  target?.focus();
}

export function AuthCard({
  description,
  children,
  footer,
}: {
  description?: ReactNode;
  children: ReactNode;
  /** A secondary action, under a hairline. */
  footer?: ReactNode;
}) {
  return (
    // `text-pretty` on every paragraph the card holds: at a 384px measure nearly each one —
    // descriptions, refusals, footnotes — otherwise ended on a single orphaned word.
    <div className="w-full max-w-sm space-y-6 rounded-2xl border border-border bg-card p-6 [&_p]:text-pretty">
      <div className="space-y-1.5">
        {/* A headline — 16px, the top of the ramp. Only the wordmark is set in caps, and via
            CSS, so the heading's accessible name stays "Felix chat". */}
        <h1 className="text-base font-semibold">
          <span className="uppercase tracking-wider">Felix</span> chat
        </h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
      {footer && <div className="border-t border-border/60 pt-4">{footer}</div>}
    </div>
  );
}

/**
 * A secondary action set as text — Cancel, Check again. A real `Button`, so
 * it carries the system's focus ring and a 32px target, grown to 40px on a coarse pointer.
 */
export function QuietAction({ className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      variant="link"
      size="sm"
      className={cn(
        'h-8 px-0 font-normal text-muted-foreground hover:text-foreground coarse:h-10',
        className,
      )}
      {...props}
    />
  );
}
