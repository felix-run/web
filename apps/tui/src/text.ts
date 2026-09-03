/**
 * One line, cut to fit.
 *
 * This existed three times over — `oneLine` in `app.tsx` at sixty columns,
 * `oneLine` in `transcript.tsx` at sixty-eight, and `truncate` in `rails.tsx`
 * at twenty-two — with the same two bugs available in each copy: an off-by-one
 * on where the ellipsis goes, and forgetting that a tool argument or a search
 * hit can arrive with newlines in it and turn a one-line notice into a
 * paragraph that shoves the composer down the screen.
 *
 * The width stays a required argument, because the differing widths were never
 * the duplication: a rail row, a tool card and a status notice genuinely have
 * different room, and a default here would make one of them wrong quietly.
 */

/** Collapse every run of whitespace, including newlines, to a single space. */
const WHITESPACE = /\s+/g;

/**
 * `text` as a single line no wider than `width`, ellipsised if it had to be cut.
 *
 * The ellipsis is one column, so a cut string is `width - 1` characters plus it
 * — a cut that produced `width + 1` columns would wrap, which is the one
 * outcome this exists to prevent.
 */
export function oneLine(text: string, width: number): string {
  const flat = text.replace(WHITESPACE, ' ').trim();
  if (width <= 0) return '';
  if (flat.length <= width) return flat;
  if (width === 1) return '…';
  return `${flat.slice(0, width - 1)}…`;
}
