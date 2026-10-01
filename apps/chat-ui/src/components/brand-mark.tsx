import { MARK_DOT, MARK_GLYPH_PATH, MARK_GRID, MARK_TILE } from '@felix/design/mark';
import { cn } from '@felix/ui/lib/utils';

/**
 * The Felix mark in the page, from the same geometry as the favicon.
 *
 * The tile is `currentColor` and the glyph is the page, so it is `primary`'s
 * inversion rather than a fixed colour: dark on a light page, light on a dark
 * one, with no theme branch. The dot is always the glyph's ink. A coloured dot
 * would repeat the header's run-state slot right beside it, and colour here
 * means state (DESIGN.md's State-Only Rule).
 *
 * Decorative: every place that draws it sits beside the wordmark, which is the
 * accessible name.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${MARK_GRID} ${MARK_GRID}`}
      className={cn('size-5 shrink-0', className)}
    >
      <rect
        width={MARK_TILE.size}
        height={MARK_TILE.size}
        rx={MARK_TILE.radius}
        fill="currentColor"
      />
      <path d={MARK_GLYPH_PATH} fill="var(--background)" />
      <circle cx={MARK_DOT.cx} cy={MARK_DOT.cy} r={MARK_DOT.r} fill="var(--background)" />
    </svg>
  );
}
