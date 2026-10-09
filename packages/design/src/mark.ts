/**
 * The Felix mark — one geometry, every rendering of it.
 *
 * A paw print at a run: four toe pads over a main pad, leaning into its stride
 * with two speed streaks trailing it — Felix is a harness for runs, and the mark
 * is one mid-flight. The main pad is where the mark carries state. At rest it is the glyph's own ink and the mark reads as a plain
 * paw; in a tab whose run is working or waiting on a person it takes that
 * state's hue, so the tab strip says what the title says. It is the largest
 * shape in the glyph, which is what keeps the hue legible once the browser
 * downsamples the mark to 16px.
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
 * The four toe pads, left to right. Always the glyph's ink.
 *
 * Mirrored about the tile's centre line, the inner pair higher and larger than
 * the outer. Every gap — toe to toe, toe to main pad — is at least 2 units,
 * which is 1px at 16: closer than that and the browser's downsample fuses the
 * toes into one arc over the pad.
 */
export const MARK_TOES = [
  { cx: 7, cy: 14, r: 2.6 },
  { cx: 12.2, cy: 8.2, r: 2.8 },
  { cx: 19.8, cy: 8.2, r: 2.8 },
  { cx: 25, cy: 14, r: 2.6 },
] as const;

/**
 * The main pad, which takes the run state's hue: a rounded dome over a base
 * that dips once at the centre, so it reads as a pad rather than an oval at
 * any size larger than a tab. Symmetric about x = 16, spanning y 15.2–26.
 */
export const MARK_PAD_PATH =
  'M16 15.2C20 15.2 23.6 18.2 23.6 21.8C23.6 24.4 21.6 26 19 26C17.6 26 16.8 25.6 16 25.6' +
  'C15.2 25.6 14.4 26 13 26C10.4 26 8.4 24.4 8.4 21.8C8.4 18.2 12 15.2 16 15.2Z';

/**
 * How the paw sits on the tile: the upright print above, scaled to 82% and
 * leaned 30° forward about its own centre, then set right of centre so the
 * streaks have room behind it. Applied as a `transform` rather than baked into
 * the coordinates, so the print stays legible as the upright, mirrored paw it
 * was drawn as. The scale costs the toe gaps — 1.6 units, under a pixel at 16 —
 * so in a tab the toes soften into one arc over the pad. That is accepted: at
 * 16px what has to read is the pad's hue and the streaks, and both do.
 */
export const MARK_STRIDE = 'translate(19 16.5) rotate(30) scale(0.82) translate(-16 -17)';

/**
 * The speed streaks, in tile coordinates, always the glyph's ink: each a wedge
 * from a 1-unit tail to a round 2-unit head. The heads span y 14–16 and 20–22,
 * whole pixels at 16px, so the streaks stay two crisp dashes in a tab where the
 * tapered tails dissolve. Staggered, the upper one longer, so they read as
 * motion rather than as an equals sign.
 */
export const MARK_STREAKS = [
  'M2 14.5L8 14A1 1 0 0 1 8 16L2 15.5Z',
  'M4 20.5L8.5 20A1 1 0 0 1 8.5 22L4 21.5Z',
] as const;

/** The three states `presence.ts` tracks. `idle` draws the pad in glyph ink. */
export type MarkState = 'idle' | 'working' | 'blocked';

/**
 * The tile is always the dark ink, in either colour scheme. A tab strip is
 * browser chrome rather than our page, so the mark cannot follow our theme
 * there; a dark tile is what keeps the two state hues vivid — `STATE_DARK` is
 * the ramp tuned to read on near-black — and a white glyph on it holds its
 * shape against a dark strip as well as a light one.
 */
export const MARK_INK = { tile: NEUTRAL[950], glyph: NEUTRAL[50] } as const;

export const MARK_PAD_FILL: Record<MarkState, string> = {
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
  const pad = inverted ? glyph : MARK_PAD_FILL[state];
  const box = MARK_GRID + inset * 2;
  const rx = square ? 0 : (MARK_TILE.radius * box) / MARK_GRID;
  const label = title
    ? ` role="img" aria-label="${title}"><title>${title}</title>`
    : ' aria-hidden="true">';
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-inset} ${-inset} ${box} ${box}"${label}`,
    `<rect x="${-inset}" y="${-inset}" width="${box}" height="${box}" rx="${rx}" fill="${tile}"/>`,
    ...MARK_STREAKS.map((d) => `<path d="${d}" fill="${glyph}"/>`),
    `<g transform="${MARK_STRIDE}">`,
    ...MARK_TOES.map((t) => `<circle cx="${t.cx}" cy="${t.cy}" r="${t.r}" fill="${glyph}"/>`),
    `<path d="${MARK_PAD_PATH}" fill="${pad}"/>`,
    '</g>',
    '</svg>',
  ].join('');
}

/** `markSvg` as a `data:` URL, for a `<link rel="icon">` swapped at runtime. */
export function markDataUrl(options?: MarkSvgOptions): string {
  return `data:image/svg+xml,${encodeURIComponent(markSvg(options))}`;
}
