import { type ReactNode, type TransitionEvent, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * How long an inline rail takes to open or close. Matches the drawers' timing in
 * `routes/workbench.tsx`, so a zone moves at one speed whether it is a rail or an
 * overlay at the current width.
 */
export const RAIL_MS = 200;

/**
 * An inline rail that opens and closes by animating its width.
 *
 * The rails used to mount and unmount on the toggle, so the transcript jumped
 * sideways by 18–30rem in one frame. This animates the rail's grid track between
 * `0fr` and `1fr` — which interpolates to the child's own width, whatever it is —
 * so the column beside it reflows with it instead of snapping.
 *
 * Opening animates from `@starting-style` (Tailwind's `starting:`), so the rail
 * mounts already moving. Closing keeps it mounted until the transition ends, and
 * `inert` for that time so a closing rail cannot take focus or clicks. The
 * timeout is the fallback for when no `transitionend` fires: under reduced
 * motion, where the transition is off, and in a test environment.
 *
 * The child keeps its own fixed width throughout; the track clips it rather than
 * squeezing it, so nothing inside rewraps mid-animation.
 */
export function RailPresence({
  open,
  side,
  children,
}: {
  open: boolean;
  side: 'left' | 'right';
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(open);
  // Mount in the same render as the open, not in an effect after it: an effect
  // would paint one frame of the closed layout first.
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (open) return;
    const id = window.setTimeout(() => setMounted(false), RAIL_MS + 50);
    return () => window.clearTimeout(id);
  }, [open]);

  if (!mounted) return null;

  const onTransitionEnd = (e: TransitionEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && !open) setMounted(false);
  };

  return (
    <div
      data-state={open ? 'open' : 'closed'}
      data-rail={side}
      inert={!open}
      onTransitionEnd={onTransitionEnd}
      className={cn(
        'grid shrink-0 transition-[grid-template-columns,opacity] duration-200 ease-out motion-reduce:transition-none',
        open
          ? 'grid-cols-[1fr] opacity-100 starting:grid-cols-[0fr] starting:opacity-0'
          : 'grid-cols-[0fr] opacity-0',
        // A right-hand rail clips from its inner edge, so it reads as sliding out
        // to the right rather than being wiped from the left.
        side === 'right' && 'justify-items-end',
      )}
    >
      <div className="flex min-h-0 min-w-0 overflow-hidden">{children}</div>
    </div>
  );
}
