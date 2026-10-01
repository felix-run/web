/**
 * The Felix mark — one geometry, every rendering of it.
 *
 * An F drawn as a stem and a top arm, with the middle arm replaced by a dot:
 * the same state dot every run readout, chip and approval in chat-ui draws. The
 * dot is where the mark carries state. At rest it is the glyph's own ink and the
 * mark reads as a plain F; in a tab whose run is working or waiting on a person
 * it takes that state's hue, so the tab strip says what the title says.
 *
 * Drawn on a 32-unit grid with every straight edge on an even unit, so at 16px —
 * the size a tab actually shows — each edge lands on a whole pixel instead of
 * smearing across two. The dot is 8 units: 4px at 16, the smallest that still
 * reads as a dot rather than a speck once the browser downsamples it.
 *
 * Colour is not decoration here (DESIGN.md's State-Only Rule): the tile and
 * glyph are neutral ink, and the only hue the mark ever shows is a state's.
 * Everything that draws the mark — the static favicons, the runtime favicon in
 * `apps/chat-ui/src/lib/presence.ts`, the in-page lockups — builds from these
 * numbers, so none of them can drift from the others.
 */
import { NEUTRAL, STATE_DARK } from './tokens';

export const MARK_GRID = 32;

/** The rounded square the glyph sits on. */
export const MARK_TILE = { size: MARK_GRID, radius: 7 } as const;

/**
 * Stem and top arm, as one path: x 10–24, y 6–26, a 4-unit stroke (2px at 16).
 * A 6-unit stroke was tried first and read as a corner bracket rather than a
 * letter: the dot sank into the pocket the two heavy bars made. The glyph's box
 * sits one unit right of centre on purpose — an F's weight is all in its stem,
 * so a box centred on the tile looks shifted left.
 */
export const MARK_GLYPH_PATH = 'M10 6h14v4H14v16h-4z';

/**
 * The dot that stands where the middle arm would be: on the tile's vertical
 * centre, 2 units clear of both the stem and the top arm, its right edge flush
 * with the arm's.
 */
export const MARK_DOT = { cx: 20, cy: 16, r: 4 } as const;

/** The three states `presence.ts` tracks. `idle` draws the dot in glyph ink. */
export type MarkState = 'idle' | 'working' | 'blocked';

/**
 * The tile is always the dark ink, in either colour scheme. A tab strip is
 * browser chrome rather than our page, so the mark cannot follow our theme
 * there; a dark tile is what keeps the two state hues vivid — `STATE_DARK` is
 * the ramp tuned to read on near-black — and a white glyph on it holds its
 * shape against a dark strip as well as a light one.
 */
export const MARK_INK = { tile: NEUTRAL[950], glyph: NEUTRAL[50] } as const;

export const MARK_DOT_FILL: Record<MarkState, string> = {
  idle: MARK_INK.glyph,
  working: STATE_DARK.running,
  blocked: STATE_DARK.blocked,
};

export interface MarkSvgOptions {
  state?: MarkState;
  /**
   * Extra room around the glyph, in grid units, with the tile filling the whole
   * canvas square. A maskable icon is cropped to a circle by the platform, so
   * its glyph must sit inside the central 80%; `0` is the tab favicon.
   */
  inset?: number;
  /** Square corners — for canvases the platform rounds itself (iOS, maskable). */
  square?: boolean;
  /**
   * Light tile, dark glyph — the mark on a dark *page*, where the page is ours
   * and the tile follows `primary`'s inversion. Idle only: the state hues are
   * tuned for the dark tile, and an in-page mark never carries state anyway
   * (chat-ui's header has its own run-state slot beside the wordmark).
   */
  inverted?: boolean;
  /** Accessible name; omit for a decorative rendering. */
  title?: string;
}

/** The mark as a standalone SVG document. */
export function markSvg({
  state = 'idle',
  inset = 0,
  square = false,
  inverted = false,
  title,
}: MarkSvgOptions = {}): string {
  const tile = inverted ? MARK_INK.glyph : MARK_INK.tile;
  const glyph = inverted ? MARK_INK.tile : MARK_INK.glyph;
  const dot = inverted ? glyph : MARK_DOT_FILL[state];
  const box = MARK_GRID + inset * 2;
  const rx = square ? 0 : (MARK_TILE.radius * box) / MARK_GRID;
  const label = title
    ? ` role="img" aria-label="${title}"><title>${title}</title>`
    : ' aria-hidden="true">';
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-inset} ${-inset} ${box} ${box}"${label}`,
    `<rect x="${-inset}" y="${-inset}" width="${box}" height="${box}" rx="${rx}" fill="${tile}"/>`,
    `<path d="${MARK_GLYPH_PATH}" fill="${glyph}"/>`,
    `<circle cx="${MARK_DOT.cx}" cy="${MARK_DOT.cy}" r="${MARK_DOT.r}" fill="${dot}"/>`,
    '</svg>',
  ].join('');
}

/** `markSvg` as a `data:` URL, for a `<link rel="icon">` swapped at runtime. */
export function markDataUrl(options?: MarkSvgOptions): string {
  return `data:image/svg+xml,${encodeURIComponent(markSvg(options))}`;
}
