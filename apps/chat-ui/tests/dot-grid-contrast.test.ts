import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The dot grid behind the transcript is decoration that text crosses, so it owes
 * the text its contrast. This recomputes, from `index.css` as written, what the
 * worst pixel costs: a dot's centre, where the fade mask is fully open and the dot
 * is `--foreground` at `--dot-grid-alpha` over `--background`.
 *
 * The composite is taken in gamma-encoded sRGB, which is how a browser blends:
 * the dot is painted in `--foreground` on a layer at `opacity: --dot-grid-alpha`,
 * so its centre pixel is a plain alpha blend of the foreground over the page.
 *
 * It exists because the grid shipped at 16% in both themes, and light-theme 11px
 * muted text over a dot measured 3.70:1: a failure that compiles, renders, and is
 * one pixel wide.
 */

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');

/** The declarations of one block, by the selector that opens it. */
function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no ${selector} block in index.css`);
  const end = css.indexOf('\n}', start);
  return css.slice(start, end);
}

function token(body: string, name: string): string {
  const m = body.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!m?.[1]) throw new Error(`--${name} is not declared in this block`);
  return m[1].trim();
}

function oklch(value: string): [number, number, number] {
  const m = value.match(/^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/);
  if (!m) throw new Error(`not an opaque oklch(): ${value}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** oklch → gamma-encoded sRGB, 0..1, clamped to gamut. */
function toSrgb([L, C, H]: [number, number, number]): number[] {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((x) => {
    const v = Math.min(1, Math.max(0, x));
    return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  });
}

function luminance(c: number[]): number {
  const [r = 0, g = 0, b = 0] = c.map((v) =>
    v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(x: number[], y: number[]): number {
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

function theme(selector: ':root' | '.dark') {
  const body = block(selector);
  const alpha = Number(token(body, 'dot-grid-alpha').replace('%', '')) / 100;
  const page = toSrgb(oklch(token(body, 'background')));
  const ink = toSrgb(oklch(token(body, 'foreground')));
  const muted = toSrgb(oklch(token(body, 'muted-foreground')));
  const dot = ink.map((c, i) => c * alpha + (page[i] ?? 0) * (1 - alpha));
  return { alpha, page, ink, muted, dot };
}

describe('the dot grid behind the transcript', () => {
  it('takes its strength from the per-theme token, as layer opacity', () => {
    // Comments stripped: the rule's own comment names what it avoids.
    const rule = (css.match(/\.bg-dots::before\s*\{[^}]*\}/)?.[0] ?? '').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    expect(rule).toMatch(/radial-gradient\(var\(--foreground\) 1px/);
    expect(rule).toMatch(/opacity:\s*var\(--dot-grid-alpha\);/);
    // A `color-mix()` over a variable compiles with a full-strength fallback for
    // browsers without it, which is the failure this token exists to prevent.
    expect(rule).not.toContain('color-mix');
  });

  for (const selector of [':root', '.dark'] as const) {
    const name = selector === ':root' ? 'light' : 'dark';

    it(`keeps 11px muted text at AA over a dot's centre (${name})`, () => {
      const t = theme(selector);
      expect(contrast(t.muted, t.dot)).toBeGreaterThanOrEqual(4.5);
    });

    it(`keeps foreground text at AA over a dot's centre (${name})`, () => {
      const t = theme(selector);
      expect(contrast(t.ink, t.dot)).toBeGreaterThanOrEqual(4.5);
    });

    it(`is still a texture, not an absence (${name})`, () => {
      // A strength tuned to zero would pass the two above by removing the grid.
      const t = theme(selector);
      expect(contrast(t.dot, t.page)).toBeGreaterThan(1.1);
    });
  }
});
