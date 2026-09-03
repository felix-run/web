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
  STATE_DARK,
  STATE_LIGHT,
  type StatePalette,
  type ThemePalette,
} from '@felix/design/tokens';
import { type CliRenderer, type ColorInput, createTextAttributes, RGBA } from '@opentui/core';
import { useRenderer } from '@opentui/react';
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
  /** A transient message in the status area. */
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
  /** Present but not in play. */
  faint: ColorInput;
  /**
   * The one background this client paints, and only because an overlay has to
   * be opaque — the conversation would otherwise show through the gaps between
   * its rows. Everything else inherits the terminal's own background on
   * purpose: a full-screen app that repaints the ground fights whatever
   * transparency or image the user has set behind it.
   */
  surface: ColorInput;
}

/**
 * ANSI indices, used whenever we are not certain enough to override the user.
 *
 * `RGBA.fromIndex` carries an *indexed* intent, so it is written out as a
 * palette reference rather than as RGB — which is the whole difference between
 * respecting a solarized terminal and painting over it.
 */
const INDEXED: Theme = {
  notice: RGBA.fromIndex(3),
  blocked: RGBA.fromIndex(3),
  danger: RGBA.fromIndex(9),
  failed: RGBA.fromIndex(1),
  running: RGBA.fromIndex(4),
  ready: RGBA.fromIndex(2),
  faint: RGBA.fromIndex(8),
  // The terminal's own background, so an overlay is opaque without introducing
  // a colour the user did not choose.
  surface: RGBA.defaultBackground(),
};

function fromPalette(state: StatePalette, neutral: ThemePalette): Theme {
  return {
    notice: RGBA.fromHex(state.blocked),
    blocked: RGBA.fromHex(state.blocked),
    danger: RGBA.fromHex(state.danger),
    failed: RGBA.fromHex(state.failed),
    running: RGBA.fromHex(state.running),
    ready: RGBA.fromHex(state.done),
    // No design token: the neutral scale's faint values are tuned against a
    // painted background, and this client paints none.
    faint: RGBA.fromIndex(8),
    // Offset from the page rather than equal to it, so the picker reads as
    // floating above the conversation instead of cut into it.
    surface: RGBA.fromHex(neutral.bgSubtle),
  };
}

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
