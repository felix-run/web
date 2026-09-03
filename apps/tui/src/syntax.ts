/**
 * How markdown and code are coloured.
 *
 * `<markdown>` and `<code>` both take a `SyntaxStyle` as a *required* prop, and
 * it is the whole of their palette: a style with no entry for a scope draws
 * that scope in the default colour, which is how a reply can render with
 * working tree-sitter highlighting and completely flat emphasis. Two vocabularies
 * arrive here and both have to be covered.
 *
 * **`markup.*`** is what the markdown renderer emits for its own syntax —
 * `markup.strong`, `markup.italic`, `markup.raw` for code spans and fences,
 * `markup.heading`, `markup.quote`, `markup.list`, `markup.link.label` and
 * `markup.link.url`. Miss one and that piece of markdown renders as plain text
 * with its markers removed, which is exactly the state this client was in
 * before it had a markdown renderer at all.
 *
 * **Everything else** is a tree-sitter capture from a fenced block — `keyword`,
 * `string`, `comment`, `type` and their dotted refinements. Only the parsers
 * OpenTUI bundles are registered (javascript, typescript, markdown, zig), on
 * purpose: a parser for any other language is fetched over the network on first
 * use, and this client talks to the harness and to nothing else. A `python` or
 * `bash` fence therefore draws as unstyled text inside a real code block, which
 * is still an improvement on one flat colour for every language.
 *
 * Colours are ANSI **indices**, not names and not hex. The distinction is not
 * cosmetic: `parseColor` resolves the name `"magenta"` to the fixed literal
 * `#FF00FF`, so a named colour is absolute true-colour that overrides whatever
 * scheme the person chose for their terminal. `RGBA.fromIndex(5)` carries the
 * intent instead, and is written out as a palette reference — which is how a
 * solarized or gruvbox terminal gets to keep deciding what "magenta" looks like
 * on the one surface that should always have inherited it.
 */

import { RGBA, type StyleDefinitionInput, SyntaxStyle } from '@opentui/core';

/** The sixteen the terminal owns. Bright variants are `8 + n`. */
const ANSI = {
  red: RGBA.fromIndex(1),
  green: RGBA.fromIndex(2),
  yellow: RGBA.fromIndex(3),
  blue: RGBA.fromIndex(4),
  magenta: RGBA.fromIndex(5),
  cyan: RGBA.fromIndex(6),
  grey: RGBA.fromIndex(8),
  brightBlue: RGBA.fromIndex(12),
} as const;

/**
 * Dotted captures fall back to their parent, so `keyword.return` picks up
 * `keyword` and only the refinements worth separating are named.
 */
const STYLES: Record<string, StyleDefinitionInput> = {
  // --- the markdown's own syntax ---
  'markup.strong': { bold: true },
  'markup.italic': { italic: true },
  'markup.strikethrough': { dim: true },
  'markup.heading': { bold: true, fg: ANSI.cyan },
  'markup.quote': { dim: true, italic: true },
  'markup.list': { fg: ANSI.cyan },
  // Inline spans and fenced blocks. The fence's *contents* are re-styled by the
  // captures below when a parser exists; this is the fallback when none does.
  'markup.raw': { fg: ANSI.cyan },
  'markup.link.label': { fg: ANSI.brightBlue, underline: true },
  'markup.link.url': { dim: true },

  // --- tree-sitter captures inside a fence ---
  keyword: { fg: ANSI.magenta },
  'keyword.return': { fg: ANSI.magenta, bold: true },
  string: { fg: ANSI.green },
  'string.escape': { fg: ANSI.yellow },
  number: { fg: ANSI.yellow },
  boolean: { fg: ANSI.yellow },
  constant: { fg: ANSI.yellow },
  comment: { fg: ANSI.grey, italic: true },
  type: { fg: ANSI.cyan },
  'type.builtin': { fg: ANSI.cyan, italic: true },
  function: { fg: ANSI.blue },
  'function.builtin': { fg: ANSI.blue, italic: true },
  constructor: { fg: ANSI.blue },
  'variable.builtin': { fg: ANSI.magenta, italic: true },
  'variable.parameter': { italic: true },
  operator: { fg: ANSI.magenta },
  'punctuation.bracket': { dim: true },
  'punctuation.delimiter': { dim: true },
  attribute: { fg: ANSI.yellow },
  module: { fg: ANSI.cyan },
  label: { fg: ANSI.yellow },
};

let cached: SyntaxStyle | null = null;

/**
 * The one style, built once.
 *
 * `SyntaxStyle` holds a native allocation and interns every scope name it is
 * asked for, so building one per render would leak steadily through a long
 * conversation. Every `<markdown>` and `<code>` in the app shares this.
 */
export function syntaxStyle(): SyntaxStyle {
  if (!cached) cached = SyntaxStyle.fromStyles(STYLES);
  return cached;
}
