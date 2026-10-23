/**
 * What the colours mean, in one place.
 *
 * There were sixteen bare colour-name literals across five files, encoding a
 * scheme that existed only in the literals: yellow for waiting, red for danger,
 * magenta for the agent's question, green for ready, grey for inactive. Nothing
 * named it, so nothing could check it, and `createTextAttributes({ dim: true })`
 * was declared four separate times.
 *
 * **When this overrides the terminal, and when it does not.** A named colour is
 * not a request for the terminal's palette: `parseColor` resolves `"magenta"`
 * to the literal `#FF00FF`, so every one of those sixteen literals was absolute
 * true-colour quietly replacing whatever scheme the user chose. That is a poor
 * default for a terminal client. So the palette here is only applied when both
 * halves of the question have an answer — the terminal reports true-colour
 * support *and* it has told us whether it is light or dark. Miss either and
 * every role falls back to an ANSI **index**, which is a reference into the
 * user's own sixteen and is themed by them rather than by us.
 *
 * The five hues come from `@felix/design`, which owns this repo's palette and
 * until now had only a neutral scale — right for surfaces, useless for status,
 * because "waiting on you" and "this failed" cannot be told apart in greys.
 */

import {
  DARK,
  LIGHT,
  NEUTRAL,
  STATE_DARK,
  STATE_LIGHT,
  type StatePalette,
  type ThemePalette,
} from '@felix/design/tokens';
import {
  type CliRenderer,
  type ColorInput,
  createTextAttributes,
  InputRenderable,
  type RenderContext,
  RGBA,
  TextareaRenderable,
  TextRenderable,
} from '@opentui/core';
import { extend, useRenderer } from '@opentui/react';
import { useEffect, useMemo, useState } from 'react';

/** Text attributes, declared once instead of in four files. */
export const DIM = createTextAttributes({ dim: true });
export const BOLD = createTextAttributes({ bold: true });
export const DIM_ITALIC = createTextAttributes({ dim: true, italic: true });

/**
 * The roles this client actually has, which is not the same list as the design
 * tokens — the mapping is where the judgement lives, so it is written down
 * rather than spread across the components.
 */
export interface Theme {
  /**
   * A transient message in the status area: a confirmation, a listing, `/help`.
   * The terminal's own foreground, never `blocked` — amber means a person is
   * being asked to act, and "threads refreshed" in amber taught that amber is
   * weather. A notice that reports a failure is drawn in `failed` instead.
   */
  notice: ColorInput;
  /** The run is stopped, waiting on you: an approval, or the agent's question. */
  blocked: ColorInput;
  /**
   * *This process* is about to touch your disk. Deliberately not `blocked`: the
   * harness asking permission and the client writing a file are different
   * risks, and the second is the one with no server between you and it.
   */
  danger: ColorInput;
  /** Something failed. */
  failed: ColorInput;
  /** A run is in flight. */
  running: ColorInput;
  /** Ready, yours, or focused — the composer's marker, the rail's border. */
  ready: ColorInput;
  /**
   * Secondary *text* — an unselected tab, a table header. It is information, so
   * it is held to 4.5:1: ANSI 8 is not, and in Solarized Dark it is the
   * background itself, which made the inspector's tab names vanish.
   */
  faint: ColorInput;
  /**
   * A frame or rule that only separates — a code block's border, a note's bar,
   * the idle composer. Decorative, so ANSI 8 is right on both paths: it is the
   * user's own "dim", and nothing is lost if their scheme makes it faint.
   */
  rule: ColorInput;
  /**
   * The one background this client paints, and only because an overlay has to
   * be opaque — the conversation would otherwise show through the gaps between
   * its rows. Everything else inherits the terminal's own background on
   * purpose: a full-screen app that repaints the ground fights whatever
   * transparency or image the user has set behind it.
   */
  surface: ColorInput;
  /**
   * A write approval's patch. The renderable's own defaults are dark-theme
   * literals — `#1a4d1a` / `#4d1a1a` rows under the terminal's text — which
   * measured 1.1–2.2:1 on a light terminal, on the evidence for the one
   * decision here that writes to your disk. The `+`/`-` sign carries which is
   * which; the row tint only helps the eye find the runs.
   */
  diff: { addedBg: ColorInput; removedBg: ColorInput; added: ColorInput; removed: ColorInput };
}

/**
 * ANSI indices, used whenever we are not certain enough to override the user.
 *
 * `RGBA.fromIndex` carries an *indexed* intent, so it is written out as a
 * palette reference rather than as RGB — which is the whole difference between
 * respecting a solarized terminal and painting over it.
 */
const INDEXED: Theme = {
  notice: RGBA.defaultForeground(),
  blocked: RGBA.fromIndex(3),
  danger: RGBA.fromIndex(9),
  failed: RGBA.fromIndex(1),
  running: RGBA.fromIndex(4),
  ready: RGBA.fromIndex(2),
  // Not ANSI 8: with no scheme to measure against, the only secondary colour
  // certain to be legible is the terminal's own foreground. Selection is
  // carried by `ready` and the strip's underline, not by this.
  faint: RGBA.defaultForeground(),
  rule: RGBA.fromIndex(8),
  // The terminal's own background, so an overlay is opaque without introducing
  // a colour the user did not choose.
  surface: RGBA.defaultBackground(),
  // No tint: any background is a colour the user did not choose. The signs
  // are their own green and red.
  diff: {
    addedBg: 'transparent',
    removedBg: 'transparent',
    added: RGBA.fromIndex(2),
    removed: RGBA.fromIndex(1),
  },
};

/** `state` laid over `base` at `amount` — a row tint that stays a tint. */
function tint(state: string, base: string, amount: number): RGBA {
  const channel = (hex: string, i: number) => Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const mixed = [0, 1, 2].map((i) =>
    Math.round(channel(state, i) * amount + channel(base, i) * (1 - amount)),
  );
  return RGBA.fromInts(mixed[0] ?? 0, mixed[1] ?? 0, mixed[2] ?? 0, 255);
}

function fromPalette(state: StatePalette, neutral: ThemePalette): Theme {
  return {
    notice: RGBA.defaultForeground(),
    blocked: RGBA.fromHex(state.blocked),
    danger: RGBA.fromHex(state.danger),
    failed: RGBA.fromHex(state.failed),
    running: RGBA.fromHex(state.running),
    ready: RGBA.fromHex(state.done),
    // Measured against the backgrounds terminals actually ship rather than one
    // this client paints: light 6.5–7.5:1 (white, stone, Solarized Light), dark
    // 4.5–8.4:1 (black through a #3b3b3b grey, Solarized Dark, One Dark).
    faint: RGBA.fromHex(neutral === LIGHT ? NEUTRAL[600] : NEUTRAL[400]),
    rule: RGBA.fromIndex(8),
    // Offset from the page rather than equal to it, so the picker reads as
    // floating above the conversation instead of cut into it.
    surface: RGBA.fromHex(neutral.bgSubtle),
    // 12% over the scheme's ground: light #e0ece9 / #f4e0e1 keep 8.9–17:1 under
    // dark text, dark #233129 / #362423 13.6–14.7:1 under white, and the signs
    // stay ≥6:1 against their own row.
    diff: {
      addedBg: tint(state.done, neutral.bg, 0.12),
      removedBg: tint(state.failed, neutral.bg, 0.12),
      added: RGBA.fromHex(state.done),
      removed: RGBA.fromHex(state.failed),
    },
  };
}

/**
 * Text that is the terminal's own colour unless it is told otherwise.
 *
 * Every OpenTUI renderable that draws text defaults to the *literal* white —
 * `TextBufferRenderable`'s `fg` is `RGBA.fromValues(1, 1, 1, 1)`, a textarea's
 * `textColor` is `"#FFFFFF"` — and a literal is true-colour, not a reference to
 * the user's palette. So every `<text>` this client left uncoloured, which is
 * the whole conversation, reached the terminal as `ESC[38;2;255;255;255m`:
 * white on white on a light terminal, the composer included. The rule above —
 * override only when certain — held for every colour this file chose and for
 * none of the ones the library chose instead.
 *
 * Replacing the intrinsics fixes it in one place rather than at every `<text>`,
 * and covers the one nobody has written yet. The text fallback is replaced as
 * well as the initial value, because the `fg` setter falls back to it when a
 * prop goes from a colour back to `undefined` — a thread row losing selection
 * would otherwise turn white. Registered here, at module load, because every
 * component imports this file and the test bench mounts without `main.tsx`;
 * `tests/theme.test.ts` fails if a plain `<text>` stops reporting the default
 * intent, so this cannot be tidied away quietly.
 */
class TerminalText extends TextRenderable {
  constructor(ctx: RenderContext, options: ConstructorParameters<typeof TextRenderable>[1]) {
    super(ctx, { ...options, fg: options.fg ?? RGBA.defaultForeground() });
    this._defaultOptions = { ...this._defaultOptions, fg: RGBA.defaultForeground() };
  }
}

class TerminalTextarea extends TextareaRenderable {
  constructor(ctx: RenderContext, options: ConstructorParameters<typeof TextareaRenderable>[1]) {
    super(ctx, {
      ...options,
      textColor: options.textColor ?? RGBA.defaultForeground(),
      focusedTextColor: options.focusedTextColor ?? RGBA.defaultForeground(),
    });
  }
}

class TerminalInput extends InputRenderable {
  constructor(ctx: RenderContext, options: ConstructorParameters<typeof InputRenderable>[1]) {
    super(ctx, {
      ...options,
      textColor: options.textColor ?? RGBA.defaultForeground(),
      focusedTextColor: options.focusedTextColor ?? RGBA.defaultForeground(),
    });
  }
}

extend({ text: TerminalText, textarea: TerminalTextarea, input: TerminalInput });

/** The renderer facts this needs, so a test does not need a terminal. */
export interface ThemeInputs {
  themeMode: 'light' | 'dark' | null;
  trueColor: boolean;
}

/**
 * Resolve a theme, or fall back to the terminal's own sixteen.
 *
 * Both conditions are required, and for different reasons: without true-colour
 * a hex is approximated to the nearest palette entry, which is worse than
 * asking for that entry outright; without a known scheme we would be picking
 * dark-mode colours for a light terminal, which is how a client ends up with
 * pale yellow on white.
 */
export function resolveTheme({ themeMode, trueColor }: ThemeInputs): Theme {
  if (!trueColor || themeMode === null) return INDEXED;
  return themeMode === 'light' ? fromPalette(STATE_LIGHT, LIGHT) : fromPalette(STATE_DARK, DARK);
}

/** Read the two facts off a live renderer. */
export function themeInputs(renderer: CliRenderer): ThemeInputs {
  return {
    themeMode: renderer.themeMode ?? null,
    // `capabilities` is null until the terminal answers the query, and "not
    // yet" has to read as "no" — an early frame in true-colour that switches to
    // indexed a moment later is a visible flicker on the first thing drawn.
    trueColor: renderer.capabilities?.rgb === true,
  };
}

/**
 * The live theme, following the terminal.
 *
 * A terminal can change scheme mid-session — someone flips their OS to dark at
 * dusk — and reports it, so this subscribes rather than reading once. It also
 * waits for the capability reply on mount: `capabilities` is null for the first
 * frames, which would otherwise pin the whole session to the indexed fallback
 * on the strength of an answer that had not arrived yet.
 */
export function useTheme(): Theme {
  const renderer = useRenderer();
  const [inputs, setInputs] = useState<ThemeInputs>(() => themeInputs(renderer));

  useEffect(() => {
    const refresh = () => setInputs(themeInputs(renderer));
    renderer.on('theme_mode', refresh);
    renderer.on('capabilities', refresh);
    // The reply may already have landed between render and effect.
    refresh();
    return () => {
      renderer.off('theme_mode', refresh);
      renderer.off('capabilities', refresh);
    };
  }, [renderer]);

  return useMemo(() => resolveTheme(inputs), [inputs]);
}
