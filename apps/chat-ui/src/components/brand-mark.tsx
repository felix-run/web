import { MARK_CHEVRON, MARK_CURSOR, MARK_GRID, MARK_HEAD_PATH } from '@felix/design/mark';
import { cn } from '@felix/ui/lib/utils';
import { PanelLeftCloseIcon, PanelLeftOpenIcon } from 'lucide-react';
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
 * At rest it is the mark. Where a pointer can hover, hovering it — or focusing it
 * from the keyboard, on any device — swaps in the panel glyph for what a click
 * will do, so the control declares itself before it is used. On touch it stays
 * the mark; the drawer it opens is the answer to "what does this do".
 *
 * The swap is a cross-fade in place, both glyphs stacked in one 20px cell, so
 * nothing beside it moves.
 */
export function BrandToggle({
  open,
  className,
  ...props
}: ComponentProps<'button'> & {
  /** Whether the sidebar is on screen — expanded inline, or the drawer open. */
  open: boolean;
}) {
  const Panel = open ? PanelLeftCloseIcon : PanelLeftOpenIcon;
  const swap =
    '[@media(hover:hover)]:group-hover/brand:opacity-0 group-focus-visible/brand:opacity-0';
  const reveal =
    '[@media(hover:hover)]:group-hover/brand:opacity-100 group-focus-visible/brand:opacity-100';
  return (
    <button
      type="button"
      data-slot="brand-toggle"
      className={cn(
        'group/brand relative inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-foreground outline-none transition-colors',
        '[@media(hover:hover)]:hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
        className,
      )}
      {...props}
    >
      <BrandMark
        className={cn(
          'transition-opacity duration-150 ease-out motion-reduce:transition-none',
          swap,
        )}
      />
      <Panel
        aria-hidden
        className={cn(
          'absolute size-4 text-muted-foreground opacity-0 transition-opacity duration-150 ease-out motion-reduce:transition-none',
          'group-hover/brand:text-foreground group-focus-visible/brand:text-foreground',
          reveal,
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
