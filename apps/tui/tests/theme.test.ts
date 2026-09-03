import { describe, expect, it } from 'bun:test';
import { STATE_DARK, STATE_LIGHT } from '@felix/design/tokens';
import { RGBA } from '@opentui/core';
import { resolveTheme } from '../src/theme';

/**
 * When this client is allowed to override the terminal's palette.
 *
 * The answer is "only when both halves of the question have one". A named
 * colour is not a request for the terminal's palette — `parseColor` resolves
 * `"magenta"` to the literal `#FF00FF` — so the sixteen literals this replaced
 * were absolute true-colour painting over whatever scheme the user chose. An
 * ANSI *index* is the opposite: a reference into their own sixteen.
 */

const hex = (c: unknown) => RGBA.prototype.toString.call(c);
const roles = ['notice', 'blocked', 'danger', 'failed', 'running', 'ready', 'faint'] as const;

describe('resolveTheme', () => {
  it('uses the design palette when the terminal can and we know the scheme', () => {
    const dark = resolveTheme({ themeMode: 'dark', trueColor: true });
    expect(hex(dark.blocked)).toBe(hex(RGBA.fromHex(STATE_DARK.blocked)));
    expect(hex(dark.failed)).toBe(hex(RGBA.fromHex(STATE_DARK.failed)));

    const light = resolveTheme({ themeMode: 'light', trueColor: true });
    expect(hex(light.blocked)).toBe(hex(RGBA.fromHex(STATE_LIGHT.blocked)));
    expect(hex(light.blocked)).not.toBe(hex(dark.blocked));
  });

  /**
   * Without true-colour a hex is approximated to the nearest palette entry,
   * which is strictly worse than asking for that entry outright.
   */
  it('falls back to the terminal palette when it cannot do true colour', () => {
    const theme = resolveTheme({ themeMode: 'dark', trueColor: false });
    for (const role of roles) {
      expect((theme[role] as RGBA).intent).toBe('indexed');
    }
  });

  /**
   * The riskier half. Not knowing the scheme and guessing means picking
   * dark-mode colours for a light terminal — pale yellow on white.
   */
  it('falls back when the terminal has not said whether it is light or dark', () => {
    const theme = resolveTheme({ themeMode: null, trueColor: true });
    for (const role of roles) {
      expect((theme[role] as RGBA).intent).toBe('indexed');
    }
  });

  it('keeps the local write visually distinct from a harness approval', () => {
    // Different risks: one is the harness asking permission, the other is this
    // process about to touch your disk with no server in between.
    const theme = resolveTheme({ themeMode: 'dark', trueColor: true });
    expect(hex(theme.danger)).not.toBe(hex(theme.blocked));
  });

  it('tells every state apart, on both paths', () => {
    for (const inputs of [
      { themeMode: 'dark' as const, trueColor: true },
      { themeMode: null, trueColor: false },
    ]) {
      const theme = resolveTheme(inputs);
      const distinct = new Set(
        (['blocked', 'danger', 'failed', 'running', 'ready', 'faint'] as const).map((r) =>
          hex(theme[r]),
        ),
      );
      expect(distinct.size).toBe(6);
    }
  });
});
