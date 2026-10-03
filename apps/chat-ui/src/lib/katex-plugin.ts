import { defaultRehypePlugins, type StreamdownProps } from 'streamdown';

type RehypePlugins = NonNullable<StreamdownProps['rehypePlugins']>;

/**
 * Math in a reply, rendered by a KaTeX that loads the first time a reply has some.
 *
 * **KaTeX runs after sanitize, not before it as in streamdown's defaults.** In
 * streamdown's order — raw, katex, sanitize, harden — the sanitizer scrubbed
 * KaTeX's own output: every class name and the MathML went, so a formula drew as
 * its MathML, its TeX source and its glyphs run together (`A=πr2A = \pi r^2A=πr2`)
 * and math had never once rendered in this app. Allowing that markup through the
 * sanitizer instead would mean allowing `style` — KaTeX positions everything
 * with inline heights and offsets — on everything the model writes. So the
 * model's text is sanitized first, exactly as before, and KaTeX then renders
 * the math into markup it generated itself:
 *
 * - it finds math by `class="language-math"` on a `code` (inside a `pre` for a
 *   display block), which the sanitizer's schema keeps — `language-*` is allowed
 *   on `code` — so `remark-math`'s output survives to be found;
 * - `trust` stays at KaTeX's default `false`, so `\href`, `\url`,
 *   `\includegraphics` and `\htmlClass`/`\htmlStyle`/`\htmlId` are refused —
 *   a formula cannot carry a link, an image, or a class of its own choosing;
 * - harden still runs last, over everything.
 *
 * KaTeX's stylesheet loads here too — see `loadMathPlugins`.
 *
 * The options are streamdown's own (`errorColor`), read off its default entry
 * rather than restated.
 *
 * Both lists are built once, so `Response` can tell which one it holds by
 * identity, and keys its `Streamdown` on that: streamdown memoizes on the text
 * and ignores `rehypePlugins`, so swapping the list is a remount or nothing.
 */

/** What streamdown itself checks before loading KaTeX's stylesheet: `$$` is math, `$` is not. */
export function needsMath(text: string): boolean {
  return text.includes('$$');
}

const entries = Object.entries(defaultRehypePlugins);
const katexOptions = (defaultRehypePlugins.katex as unknown as [unknown, object])[1];

export const WITHOUT_MATH: RehypePlugins = entries
  .filter(([name]) => name !== 'katex')
  .map(([, plugin]) => plugin) as RehypePlugins;

let withMath: RehypePlugins | null = null;
let loading: Promise<RehypePlugins> | null = null;

/** The list with KaTeX in place, once it has loaded; null before. */
export function loadedMathPlugins(): RehypePlugins | null {
  return withMath;
}

export function loadMathPlugins(): Promise<RehypePlugins> {
  // The stylesheet is ours to load, with the plugin and before the swap.
  // Streamdown asks for it itself with a dynamic `import()` when a reply has
  // `$$`, but in a production build that request is never made — the dev
  // server makes it, which is how its absence went unseen — and without the
  // stylesheet nothing hides KaTeX's MathML, so every formula is followed by a
  // plain-text copy of itself.
  loading ??= Promise.all([import('rehype-katex'), import('katex/dist/katex.min.css')])
    .then(([{ default: rehypeKatex }]) => {
      // Straight after sanitize — see the header. Every other plugin keeps
      // streamdown's order.
      withMath = entries
        .filter(([name]) => name !== 'katex')
        .flatMap(([name, plugin]) =>
          name === 'sanitize' ? [plugin, [rehypeKatex, katexOptions]] : [plugin],
        ) as RehypePlugins;
      return withMath;
    })
    .catch((error) => {
      // A failed chunk load (a deploy replaced it, the network dropped) leaves
      // the math as source rather than retrying on every render; the next page
      // load asks again.
      loading = null;
      throw error;
    });
  return loading;
}
