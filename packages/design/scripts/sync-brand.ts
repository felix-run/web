/**
 * Regenerate every static rendering of the Felix mark from `src/mark.ts`.
 *
 *   pnpm sync:brand
 *
 * Writes the favicons, touch and PWA icons for chat-ui and the docs, the docs'
 * header logo, and the docs' social card. All of it is checked in — the apps
 * serve these files as-is and CI has no rasteriser — so this is the command to
 * run after changing the geometry, the way `sync:theme` is after the tokens.
 *
 * Rasterising needs `rsvg-convert` (librsvg) and `magick` (ImageMagick) on the
 * PATH; on macOS, `brew install librsvg imagemagick`. They are a dependency of
 * regenerating, not of building, which is why neither is in package.json.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MARK_CHEVRON,
  MARK_CURSOR,
  MARK_GRID,
  MARK_HEAD_PATH,
  MARK_INK,
  markSvg,
} from '../src/mark';
import { DARK, NEUTRAL } from '../src/tokens';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const chatPublic = join(root, 'apps/chat-ui/public');
const docsPublic = join(root, 'apps/docs/public');
const docsAssets = join(root, 'apps/docs/src/assets');

for (const tool of ['rsvg-convert', 'magick']) {
  try {
    execFileSync(tool, ['--version'], { stdio: 'ignore' });
  } catch {
    console.error(`sync:brand needs \`${tool}\` on the PATH (brew install librsvg imagemagick).`);
    process.exit(1);
  }
}

const scratch = mkdtempSync(join(tmpdir(), 'felix-brand-'));
const written: string[] = [];

function write(path: string, body: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  written.push(path.slice(root.length));
}

function png(svg: string, size: number, out: string, height = size): void {
  const src = join(scratch, 'in.svg');
  writeFileSync(src, svg);
  mkdirSync(dirname(out), { recursive: true });
  execFileSync('rsvg-convert', ['-w', String(size), '-h', String(height), src, '-o', out]);
  written.push(out.slice(root.length));
}

/**
 * A 16/32/48 `.ico` for whatever still asks for `/favicon.ico` by convention —
 * crawlers, feed readers, Safari's history view. Each size is rasterised from
 * the vector at that size rather than scaled from the largest, so the 16 keeps
 * the whole-pixel edges the grid was drawn for.
 */
function ico(out: string): void {
  const frames = [16, 32, 48].map((size) => {
    const file = join(scratch, `ico-${size}.png`);
    const src = join(scratch, 'ico.svg');
    writeFileSync(src, markSvg());
    execFileSync('rsvg-convert', ['-w', String(size), '-h', String(size), src, '-o', file]);
    return file;
  });
  execFileSync('magick', [...frames, out]);
  written.push(out.slice(root.length));
}

/** One app's tab and home-screen set. */
function iconSet(dir: string): void {
  write(join(dir, 'favicon.svg'), `${markSvg({ title: 'Felix' })}\n`);
  ico(join(dir, 'favicon.ico'));
  // iOS rounds the corners itself and composites transparency onto black, so
  // the touch icon is a full-bleed square — light, or the ears would vanish
  // into it — with the head pulled in clear of the corners it rounds.
  png(markSvg({ square: true, inset: 5 }), 180, join(dir, 'apple-touch-icon.png'));
}

iconSet(chatPublic);
iconSet(docsPublic);

// chat-ui is opened daily, so it is installable; the manifest's maskable icon
// keeps the ear tips inside the central 80% circle a launcher may crop to —
// they sit ~20 units from the centre, so the canvas is 52 across, leaving a margin.
png(markSvg(), 192, join(chatPublic, 'icon-192.png'));
png(markSvg(), 512, join(chatPublic, 'icon-512.png'));
png(markSvg({ square: true, inset: 10 }), 512, join(chatPublic, 'icon-maskable-512.png'));
write(
  join(chatPublic, 'site.webmanifest'),
  `${JSON.stringify(
    {
      name: 'Felix chat',
      short_name: 'Felix',
      start_url: '/',
      display: 'standalone',
      background_color: MARK_INK.tile,
      theme_color: MARK_INK.tile,
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    null,
    2,
  )}\n`,
);

// The docs header logo, one per theme: Starlight swaps them by `data-theme`.
write(join(docsAssets, 'mark-light.svg'), `${markSvg()}\n`);
write(join(docsAssets, 'mark-dark.svg'), `${markSvg({ inverted: true })}\n`);

/**
 * The docs' social card. The page field and type are the docs' own dark theme
 * (DESIGN.md: `page`, `ink`, `body-text`, `faint-text`), read from the tokens so the
 * card warms with them; the mark is the tab mark at scale, set on a hairline so the
 * dark head does not dissolve into a dark field.
 *
 * The type is the platform's sans and mono, not the docs' Onest and JetBrains Mono:
 * rsvg-convert on macOS lays text out through CoreText and ignores a scratch
 * fontconfig, so a self-hosted face cannot reach it (tested 2026-10-10 — "Onest" and
 * a made-up family rendered byte-identically).
 */
function socialCard(): string {
  const w = 1200;
  const h = 630;
  const size = 168;
  const x = 96;
  const y = 96;
  const k = size / MARK_GRID;
  const sans = "-apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif";
  const mono = "ui-monospace, Menlo, 'SF Mono', monospace";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${DARK.bg}"/>
  <g transform="translate(${x} ${y}) scale(${k})">
    <path d="${MARK_HEAD_PATH}" fill="${MARK_INK.tile}" stroke="${NEUTRAL[800]}" stroke-width="${1.5 / k}"/>
    <path d="${MARK_CHEVRON.d}" fill="none" stroke="${MARK_INK.glyph}" stroke-width="${MARK_CHEVRON.width}" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="${MARK_CURSOR.x}" y="${MARK_CURSOR.y}" width="${MARK_CURSOR.width}" height="${MARK_CURSOR.height}" rx="${MARK_CURSOR.rx}" fill="${MARK_INK.glyph}"/>
  </g>
  <text x="${x - 4}" y="410" font-family="${sans}" font-size="88" font-weight="600" letter-spacing="6" fill="${DARK.text}">FELIX</text>
  <text x="${x}" y="470" font-family="${sans}" font-size="32" fill="${DARK.textMuted}">The operator's manual for a self-hosted agent harness.</text>
  <text x="${x}" y="${h - 80}" font-family="${mono}" font-size="24" fill="${DARK.textFaint}">docs.felix.run</text>
</svg>`;
}

png(socialCard(), 1200, join(docsPublic, 'og.png'), 630);

rmSync(scratch, { recursive: true, force: true });
console.log(`wrote ${written.length} files:\n  ${written.join('\n  ')}`);
