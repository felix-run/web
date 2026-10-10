/**
 * The Felix mark — one geometry, every rendering of it.
 *
 * A cat's head whose face is a prompt: the tile itself is the head, ears and
 * all, and on it sit a `>` and the cursor after it. Felix is a cat and a
 * harness you drive from a prompt, and the mark is both at once. The cursor is
 * where the mark carries state. At rest it is the glyph's own ink and the face
 * reads as an idle prompt; in a tab whose run is working or waiting on a person
 * it takes that state's hue, so the tab strip says what the title says.
 *
 * The silhouette does the work at 16px, the size a tab actually shows: ears are
 * the one shape no other tab has, and they survive a downsample that turns any
 * interior detail to mush. So the interior is kept to two marks, each at least
 * two pixels across at 16.
 *
 * Colour is not decoration here (DESIGN.md's State-Only Rule): the head and
 * prompt are neutral ink, and the only hue the mark ever shows is a state's.
 * Everything that draws the mark — the static favicons, the runtime favicon in
 * `apps/chat-ui/src/lib/presence.ts`, the in-page lockups — builds from these
 * numbers, so none of them can drift from the others.
 */
import { STATE_DARK } from './tokens';

export const MARK_GRID = 32;

/**
 * The head, which is also the tile: the old rounded square's 7-unit bottom
 * corners, its top raised into two ears that peak a unit inside the grid's
 * corners. The ears are what make the mark ownable at 16px, so they are drawn
 * wide (10 units at the base) rather than true to a cat's proportions.
 */
export const MARK_HEAD_PATH =
  'M7 32C3.1 32 0 28.9 0 25V13.5L1.2 2.4C1.3 1.3 2.6 0.9 3.3 1.7L10.4 9H21.6L28.7 1.7' +
  'C29.4 0.9 30.7 1.3 30.8 2.4L32 13.5V25C32 28.9 28.9 32 25 32Z';

/** The `>`, as a round-capped 3-unit stroke. Always the glyph's ink. */
export const MARK_CHEVRON = { d: 'M8 15.5L13.5 19.75L8 24', width: 3 } as const;

/**
 * The cursor, which takes the run state's hue. Every edge is on an even unit,
 * so at 16px it is a crisp 4×2-pixel block rather than a smear — it is the one
 * shape whose colour has to read in a tab.
 */
export const MARK_CURSOR = { x: 18, y: 22, width: 8, height: 4, rx: 0.5 } as const;

/** The three states `presence.ts` tracks. `idle` draws the cursor in glyph ink. */
export type MarkState = 'idle' | 'working' | 'blocked';

/**
 * The head is always the dark ink, in either colour scheme. A tab strip is
 * browser chrome rather than our page, so the mark cannot follow our theme
 * there; a dark tile is what keeps the two state hues vivid — `STATE_DARK` is
 * the ramp tuned to read on near-black — and a white glyph on it holds its
 * shape against a dark strip as well as a light one.
 */
// Pinned rather than read from `NEUTRAL`: the favicons, touch icons and social card
// are rendered from this and checked in, and the mark's ink is the brand, not a theme.
export const MARK_INK = { tile: '#0a0a0a', glyph: '#fafafa' } as const;

export const MARK_CURSOR_FILL: Record<MarkState, string> = {
  idle: MARK_INK.glyph,
  working: STATE_DARK.running,
  blocked: STATE_DARK.blocked,
};

export interface MarkSvgOptions {
  state?: MarkState;
  /**
   * Extra room around the head, in grid units. A maskable icon is cropped to a
   * circle by the platform, so the ear tips must sit inside the central 80%;
   * `0` is the tab favicon.
   */
  inset?: number;
  /**
   * Fill the whole canvas, for platforms that draw no transparency (iOS, a
   * maskable launcher icon). The ears would vanish into a dark field, so the
   * field is the light ink and the dark head stands on it.
   */
  square?: boolean;
  /**
   * Light head, dark glyph — the mark on a dark *page*, where the page is ours
   * and the head follows `primary`'s inversion. Idle only: the state hues are
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
  const head = inverted ? MARK_INK.glyph : MARK_INK.tile;
  const glyph = inverted ? MARK_INK.tile : MARK_INK.glyph;
  const cursor = inverted ? glyph : MARK_CURSOR_FILL[state];
  const box = MARK_GRID + inset * 2;
  const c = MARK_CURSOR;
  const label = title
    ? ` role="img" aria-label="${title}"><title>${title}</title>`
    : ' aria-hidden="true">';
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-inset} ${-inset} ${box} ${box}"${label}`,
    square
      ? `<rect x="${-inset}" y="${-inset}" width="${box}" height="${box}" fill="${glyph}"/>`
      : '',
    `<path d="${MARK_HEAD_PATH}" fill="${head}"/>`,
    `<path d="${MARK_CHEVRON.d}" fill="none" stroke="${glyph}" stroke-width="${MARK_CHEVRON.width}" stroke-linecap="round" stroke-linejoin="round"/>`,
    `<rect x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}" rx="${c.rx}" fill="${cursor}"/>`,
    '</svg>',
  ].join('');
}

/** `markSvg` as a `data:` URL, for a `<link rel="icon">` swapped at runtime. */
export function markDataUrl(options?: MarkSvgOptions): string {
  return `data:image/svg+xml,${encodeURIComponent(markSvg(options))}`;
}
