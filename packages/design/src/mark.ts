/**
 * The Felix mark — one geometry, every rendering of it.
 *
 * A paw print: four toe pads over a main pad. The main pad is where the mark
 * carries state. At rest it is the glyph's own ink and the mark reads as a plain
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

/** The four toe pads, left to right. Always the glyph's ink. */
export const MARK_TOES = [
  { cx: 8.5, cy: 13, r: 3 },
  { cx: 15, cy: 9.5, r: 3 },
  { cx: 21.5, cy: 10, r: 3 },
  { cx: 27, cy: 14, r: 3 },
] as const;

/** The main pad, which takes the run state's hue. */
export const MARK_PAD = { cx: 16, cy: 21, rx: 6.5, ry: 5 } as const;

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
    ...MARK_TOES.map((t) => `<circle cx="${t.cx}" cy="${t.cy}" r="${t.r}" fill="${glyph}"/>`),
    `<ellipse cx="${MARK_PAD.cx}" cy="${MARK_PAD.cy}" rx="${MARK_PAD.rx}" ry="${MARK_PAD.ry}" fill="${pad}"/>`,
    '</svg>',
  ].join('');
}

/** `markSvg` as a `data:` URL, for a `<link rel="icon">` swapped at runtime. */
export function markDataUrl(options?: MarkSvgOptions): string {
  return `data:image/svg+xml,${encodeURIComponent(markSvg(options))}`;
}
