import { MARK_CHEVRON, MARK_CURSOR, MARK_GRID, MARK_HEAD_PATH } from '@felix/design/mark';
import { cn } from '@felix/ui/lib/utils';
import type { ComponentProps } from 'react';

/**
 * The Felix mark in the page, from the same geometry as the favicon.
 *
 * The head is `currentColor` and the prompt is the page, so it is `primary`'s
 * inversion rather than a fixed colour: dark on a light page, light on a dark
 * one, with no theme branch. The cursor is always the prompt's ink. A coloured
 * cursor would repeat the header's run-state slot right beside it, and colour
 * here means state (DESIGN.md's State-Only Rule).
 *
 * Decorative: every place that draws it sits beside the wordmark, or inside a
 * button that carries its own name.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${MARK_GRID} ${MARK_GRID}`}
      className={cn('size-5 shrink-0', className)}
    >
      <path d={MARK_HEAD_PATH} fill="currentColor" />
      <path
        d={MARK_CHEVRON.d}
        fill="none"
        stroke="var(--background)"
        strokeWidth={MARK_CHEVRON.width}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect {...MARK_CURSOR} fill="var(--background)" />
    </svg>
  );
}

/**
 * The mark as the sidebar's toggle: the brand sits at the sidebar's edge, so the
 * thing that opens and closes it is the thing already there.
 *
 * The mark points the way a click will move the sidebar: closed, it faces the
 * way it was drawn, `>_`, out towards where the sidebar will open; open, it
 * turns round to face back over it. The turn is a flip about
 * its own vertical centre — the ears are symmetric, so only the face changes —
 * and it plays as the sidebar moves, so the two read as one motion. The tile
 * does not move, so nothing beside it does either.
 *
 * There is no second glyph swapped in on hover any more: the state is on the
 * mark at rest, on every device, and the name and `aria-pressed` the callers
 * pass carry it for a reader.
 */
export function BrandToggle({
  open,
  className,
  ...props
}: ComponentProps<'button'> & {
  /** Whether the sidebar is on screen — expanded inline, or the drawer open. */
  open: boolean;
}) {
  return (
    <button
      type="button"
      data-slot="brand-toggle"
      data-state={open ? 'open' : 'closed'}
      className={cn(
        'inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-foreground outline-none transition-colors',
        '[@media(hover:hover)]:hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
        className,
      )}
      {...props}
    >
      <BrandMark
        className={cn(
          'transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
          open && '-scale-x-100',
        )}
      />
    </button>
  );
}

/**
 * The wordmark. Caps via CSS, not in the string, so the accessible name and
 * anything copied out stay the proper noun.
 *
 * It is the document's one `h1` wherever it is the app's name on screen, and a
 * plain span where a second copy would be a second `h1` — the drawer, which
 * opens over a header that already holds one.
 */
export function Wordmark({ heading = true, className }: { heading?: boolean; className?: string }) {
  const Tag = heading ? 'h1' : 'span';
  return (
    <Tag
      data-slot="wordmark"
      className={cn('shrink-0 text-base font-semibold uppercase tracking-wider', className)}
    >
      Felix
    </Tag>
  );
}
