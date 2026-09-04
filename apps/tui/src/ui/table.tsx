/**
 * A real table, because the alternative is re-inventing column fitting badly.
 *
 * `TextTableRenderable` exists in `@opentui/core` but — unlike what the
 * published docs say — is **not** a registered JSX intrinsic at 0.5.10:
 * `baseComponents` in `@opentui/react` does not contain `text-table`. It has to
 * be registered with `extend()`.
 *
 * That registration lives here, in the module that exports the only wrapper
 * which renders the element, rather than in `main.tsx` or a bare side-effect
 * import. Tests mount components without `main.tsx`, so registering there would
 * make every table test fail on an unknown element; and an import that exists
 * only for its side effect is the import a tidy-up deletes. Reaching the
 * element means importing `Table`, which means this module body has already
 * run.
 *
 * What it does not give you: **no row cursor and no row selection.** It is a
 * display table. Where a panel needs a cursor, that is a `<select>` beside the
 * table, not a property of it. It also has no per-column alignment — see
 * `num()` in `../format.ts`.
 */

import {
  type ColorInput,
  fg,
  stringToStyledText,
  type TextChunk,
  TextTableRenderable,
} from '@opentui/core';
import { extend } from '@opentui/react';
import type { Theme } from '../theme.js';

declare module '@opentui/react' {
  interface OpenTUIComponents {
    'text-table': typeof TextTableRenderable;
  }
}

// Module scope, not an effect: the reconciler reads the catalogue at
// createInstance and throws `Unknown component type: text-table` if this has
// not run.
extend({ 'text-table': TextTableRenderable });

/**
 * One cell.
 *
 * A coloured cell is a chunk carrying a resolved colour from the theme; an
 * uncoloured one goes through `stringToStyledText` so the terminal keeps
 * deciding what it looks like. Never a colour *name*: `parseColor` resolves
 * `"magenta"` to a literal `#FF00FF` and paints it over the user's scheme.
 */
export function cell(text: string, color?: ColorInput): TextChunk[] {
  return color ? [fg(color)(text)] : stringToStyledText(text).chunks;
}

export function Table({
  head,
  rows,
  theme,
}: {
  head: string[];
  /** Each row is already formatted — the table lays out, it does not format. */
  rows: Array<Array<{ text: string; color?: ColorInput }>>;
  theme: Theme;
}) {
  const content = [
    head.map((h) => cell(h, theme.faint)),
    ...rows.map((row) => row.map((c) => cell(c.text, c.color))),
  ];
  return (
    <text-table
      content={content}
      wrapMode="none"
      columnWidthMode="full"
      columnFitter="balanced"
      showBorders={false}
      outerBorder={false}
      columnGap={2}
      selectable
    />
  );
}
