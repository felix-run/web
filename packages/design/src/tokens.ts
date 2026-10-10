/**
 * Felix design tokens — the single source of truth for the neutral
 * monochrome palette (Tailwind's `neutral` scale) shared across the
 * workspace. The Starlight docs site checks in `apps/docs/src/styles/theme.css`
 * generated via `starlightThemeCss()`.
 *
 * Pure constants + string builders — no imports, safe for Workers and
 * Node alike. Change a hex here and regenerate theme.css so surfaces move
 * together.
 */

/**
 * The warm neutral scale (2026-10-10, the Warm Workbench redesign) — the only
 * colors the docs surfaces use. Converted from the stone/charcoal oklch values
 * chat-ui authors in `apps/chat-ui/src/index.css` (hue ~60–75, chroma under
 * 0.016), so the docs and the app share one material: `100` is chat-ui's stone
 * ground, `0` its sheet, `900`/`950` its charcoal sheet and ground. `500` sits a
 * step darker than an even ramp would put it so faint text clears AA on the
 * stone sidebar (4.80:1) as well as on the page (5.45:1).
 */
export const NEUTRAL = {
  0: '#fefdfc',
  50: '#f8f6f4',
  100: '#f2eeea',
  200: '#e3dfda',
  300: '#d2cdc8',
  400: '#aaa39c',
  500: '#706760',
  600: '#5c534d',
  700: '#463e39',
  800: '#292623',
  900: '#1b1816',
  950: '#110f0d',
} as const;

/** Semantic slots one scheme (light or dark) fills from the scale. */
export interface ThemePalette {
  /** Page background. */
  bg: string;
  /** Slightly offset panel background (sidebar, nav). */
  bgSubtle: string;
  /** Filled UI background (hover, active nav item, inline code). */
  bgMuted: string;
  /** Hairline borders. */
  border: string;
  /** Primary text. */
  text: string;
  /** Secondary text. */
  textMuted: string;
  /** Tertiary text (placeholders, sidebar inactive). */
  textFaint: string;
  /** Accent — monochrome by design: near-black on light, near-white on dark. */
  accent: string;
  /** Text/icon color on an accent-filled control. */
  accentContrast: string;
}

export const LIGHT: ThemePalette = {
  bg: NEUTRAL[0],
  // The stone ground: chat-ui's sidebar and shell, so the docs' sidebar matches.
  bgSubtle: NEUTRAL[100],
  bgMuted: NEUTRAL[100],
  border: NEUTRAL[200],
  text: NEUTRAL[950],
  textMuted: NEUTRAL[700],
  textFaint: NEUTRAL[500],
  accent: NEUTRAL[900],
  accentContrast: NEUTRAL[50],
};

export const DARK: ThemePalette = {
  // The charcoal sheet for the page and the darker ground for the panels, as chat-ui.
  bg: NEUTRAL[900],
  bgSubtle: NEUTRAL[950],
  bgMuted: NEUTRAL[800],
  border: NEUTRAL[800],
  text: NEUTRAL[50],
  textMuted: NEUTRAL[300],
  textFaint: NEUTRAL[400],
  accent: NEUTRAL[50],
  accentContrast: NEUTRAL[900],
};

/**
 * The states a run can be in, which the neutral scale cannot express.
 *
 * Everything above is monochrome by design, and that is right for surfaces:
 * a page, a border, a piece of text. It is wrong for *status* — "waiting on
 * you" and "this failed" have to be told apart at a glance, and greys cannot
 * do it. So this is the one place hue is allowed, and it stays a closed set of
 * five rather than a palette anyone can add to.
 *
 * The reference values are the oklch pairs in `apps/chat-ui/src/index.css`,
 * where this ramp was born and is still consumed from — converted here to sRGB
 * hex because that is what a terminal and a `RGBA.fromHex` can take, and CSS
 * `oklch()` cannot be handed to either. Aligning chat-ui to read these back is
 * worth doing and is not this change.
 *
 * `failed` and `danger` are deliberately distinct. `danger` is tuned to carry
 * white on a solid fill (a destructive button); as *text* on its own tint it
 * only reaches about 4:1, so error copy gets the darker `failed` instead.
 */
export interface StatePalette {
  /** Waiting on a person — an approval, a question. */
  blocked: string;
  /** Finished, and finished well. */
  done: string;
  /** In flight. */
  running: string;
  /** Failed, as text. */
  failed: string;
  /** Failed, as a filled control. Carries white. */
  danger: string;
}

export const STATE_LIGHT: StatePalette = {
  blocked: '#973c00',
  done: '#006045',
  running: '#00598a',
  failed: '#a20002',
  danger: '#e7000b',
};

export const STATE_DARK: StatePalette = {
  blocked: '#ffd230',
  done: '#5ee9b5',
  running: '#74d4ff',
  failed: '#ff807f',
  danger: '#ff6467',
};

/**
 * Map one palette onto Scalar's CSS variables.
 *
 * Scalar colours HTTP methods from its own blue/green/orange/yellow/red, and
 * its light-mode defaults put `GET` at 3.78:1 — under AA, on 10px text. Those
 * slots take the state ramp instead, which is tuned for contrast in both modes:
 * GET running, POST done, PUT and PATCH blocked, DELETE failed. The mapping is
 * by hue family, not by meaning; nothing here claims a POST is "done".
 */
function scalarVars(p: ThemePalette, s: StatePalette): string {
  return `
    --scalar-color-blue: ${s.running};
    --scalar-color-green: ${s.done};
    --scalar-color-orange: ${s.blocked};
    --scalar-color-yellow: ${s.blocked};
    --scalar-color-red: ${s.failed};
    --scalar-background-1: ${p.bg};
    --scalar-background-2: ${p.bgSubtle};
    --scalar-background-3: ${p.bgMuted};
    --scalar-border-color: ${p.border};
    --scalar-color-1: ${p.text};
    --scalar-color-2: ${p.textMuted};
    --scalar-color-3: ${p.textFaint};
    --scalar-color-accent: ${p.accent};
    --scalar-button-1: ${p.accent};
    --scalar-button-1-color: ${p.accentContrast};
    --scalar-button-1-hover: ${p.text};
    --scalar-sidebar-background-1: ${p.bgSubtle};
    --scalar-sidebar-color-1: ${p.text};
    --scalar-sidebar-color-2: ${p.textFaint};
    --scalar-sidebar-border-color: ${p.border};
    --scalar-sidebar-item-hover-background: ${p.bgMuted};
    --scalar-sidebar-item-hover-color: ${p.text};
    --scalar-sidebar-item-active-background: ${p.bgMuted};
    --scalar-sidebar-color-active: ${p.text};
    --scalar-sidebar-search-background: ${p.bg};
    --scalar-sidebar-search-border-color: ${p.border};
    --scalar-sidebar-search-color: ${p.textFaint};`;
}

/**
 * Scalar `customCss`: both schemes, respecting Scalar's own light/dark
 * toggle (`.light-mode` / `.dark-mode` on the root).
 */
export function scalarThemeCss(): string {
  return `
  .light-mode {${scalarVars(LIGHT, STATE_LIGHT)}
  }
  .dark-mode {${scalarVars(DARK, STATE_DARK)}
  }
`;
}

/** The state ramp as `--felix-state-*`, which the docs' asides read. */
function stateVars(s: StatePalette): string {
  return `
  --felix-state-blocked: ${s.blocked};
  --felix-state-done: ${s.done};
  --felix-state-running: ${s.running};
  --felix-state-failed: ${s.failed};`;
}

/**
 * Starlight custom stylesheet: overrides the `--sl-*` custom properties for
 * both schemes. Starlight is dark-first (`:root` is dark; light is
 * `:root[data-theme="light"]`), and its gray ramp is *semantic* — `white` is
 * "highest-contrast text" and `black` is "page background" in BOTH schemes,
 * so the light block re-fills the same slots with flipped values.
 *
 * The state ramp rides along so `brand.css` can colour asides with the hues
 * chat-ui and the terminal use, instead of Starlight's own blue/purple/orange.
 */
export function starlightThemeCss(): string {
  return `/* @generated from @felix/design/tokens — run the docs sync to refresh. */
:root {
  --sl-color-accent-low: ${DARK.bgMuted};
  --sl-color-accent: ${DARK.accent};
  --sl-color-accent-high: ${NEUTRAL[0]};
  --sl-color-white: ${NEUTRAL[0]};
  --sl-color-gray-1: ${DARK.text};
  --sl-color-gray-2: ${DARK.textMuted};
  --sl-color-gray-3: ${DARK.textFaint};
  --sl-color-gray-4: ${NEUTRAL[600]};
  --sl-color-gray-5: ${DARK.border};
  --sl-color-gray-6: ${DARK.bgSubtle};
  --sl-color-black: ${DARK.bg};
  --sl-color-hairline: ${DARK.border};
  --sl-color-bg-inline-code: ${DARK.bgMuted};${stateVars(STATE_DARK)}
}
:root[data-theme="light"] {
  --sl-color-accent-low: ${LIGHT.bgMuted};
  --sl-color-accent: ${LIGHT.accent};
  --sl-color-accent-high: ${LIGHT.text};
  --sl-color-white: ${LIGHT.text};
  --sl-color-gray-1: ${NEUTRAL[800]};
  --sl-color-gray-2: ${LIGHT.textMuted};
  --sl-color-gray-3: ${LIGHT.textFaint};
  --sl-color-gray-4: ${NEUTRAL[400]};
  --sl-color-gray-5: ${NEUTRAL[300]};
  --sl-color-gray-6: ${LIGHT.bgMuted};
  --sl-color-gray-7: ${LIGHT.bgSubtle};
  --sl-color-black: ${LIGHT.bg};
  --sl-color-hairline: ${LIGHT.border};
  --sl-color-bg-inline-code: ${LIGHT.bgMuted};${stateVars(STATE_LIGHT)}
}
`;
}
