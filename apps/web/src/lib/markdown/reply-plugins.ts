import { defaultRehypePlugins, type StreamdownProps } from 'streamdown';

type RehypePlugins = NonNullable<StreamdownProps['rehypePlugins']>;
type RehypePlugin = RehypePlugins[number];

/**
 * A reply's rehype plugins, with the two heavy ones loaded the first time a reply needs
 * them: KaTeX for math, and `rehype-raw` — with the whole of parse5 — for raw HTML.
 * Streamdown imports both at the top of its bundle, so every first load carried about
 * 128 kB gzipped of the two; a build points those imports at a no-op
 * (`vite.config.ts`, `lib/rehype-omitted.ts`) and this module is the one importer let
 * through to the real ones.
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
 * **`rehype-raw` keeps its place, before sanitize.** Until it has loaded, a reply's raw
 * HTML reaches the sanitizer as `raw` nodes, which it drops: for the moment the plugin
 * takes to arrive the element is missing, never unsanitized.
 *
 * KaTeX's stylesheet loads here too — see `loadMath`.
 *
 * The options are streamdown's own (`errorColor`), read off its default entry
 * rather than restated.
 *
 * Each list is built once per combination, so `Response` can tell which one it holds by
 * identity, and keys its `Streamdown` on that: streamdown memoizes on the text
 * and ignores `rehypePlugins`, so swapping the list is a remount or nothing.
 */

/** What streamdown itself checks before loading KaTeX's stylesheet: `$$` is math, `$` is not. */
export function needsMath(text: string): boolean {
  return text.includes('$$');
}

/**
 * Something that may be raw HTML: a `<` opening a tag, a closing tag or a comment. Loose on
 * purpose — `<div>` in a code block asks for the plugin it does not need, which costs one
 * load; the reverse would leave an element missing.
 */
export function needsRaw(text: string): boolean {
  return /<[a-z!/]/i.test(text);
}

/** Which of the two this tab has loaded. */
export interface LoadedPlugins {
  math: boolean;
  raw: boolean;
}

const entries = Object.entries(defaultRehypePlugins);
const katexOptions = (defaultRehypePlugins.katex as unknown as [unknown, object])[1];

let rehypeKatex: RehypePlugin | null = null;
let rehypeRaw: RehypePlugin | null = null;
let loadingMath: Promise<void> | null = null;
let loadingRaw: Promise<void> | null = null;
const lists = new Map<string, RehypePlugins>();

const keyOf = ({ math, raw }: LoadedPlugins) =>
  `${math ? 'math' : ''}${raw ? '+raw' : ''}` || 'plain';

/** What has loaded so far. */
export function loadedPlugins(): LoadedPlugins {
  return { math: rehypeKatex !== null, raw: rehypeRaw !== null };
}

/**
 * The list for these plugins, the same array every time it is asked for, so `Response`'s
 * key and streamdown's identity check agree. A plugin not yet loaded is left out.
 */
export function pluginsFor(want: LoadedPlugins): RehypePlugins {
  const math = want.math ? rehypeKatex : null;
  const raw = want.raw ? rehypeRaw : null;
  const key = keyOf({ math: math !== null, raw: raw !== null });
  let list = lists.get(key);
  if (!list) {
    list = entries.flatMap(([name, plugin]): RehypePlugin[] => {
      if (name === 'katex') return [];
      if (name === 'raw') return raw ? [raw] : [];
      // KaTeX straight after sanitize — see the header. Everything else keeps
      // streamdown's order.
      if (name === 'sanitize' && math) return [plugin, [math, katexOptions] as RehypePlugin];
      return [plugin];
    }) as RehypePlugins;
    lists.set(key, list);
  }
  return list;
}

/** The list with neither loaded: what every reply starts with. */
export const PLAIN: RehypePlugins = pluginsFor({ math: false, raw: false });

function loadMath(): Promise<void> {
  // The stylesheet is ours to load, with the plugin and before the swap.
  // Streamdown asks for it itself with a dynamic `import()` when a reply has
  // `$$`, but in a production build that request is never made — the dev
  // server makes it, which is how its absence went unseen — and without the
  // stylesheet nothing hides KaTeX's MathML, so every formula is followed by a
  // plain-text copy of itself.
  loadingMath ??= Promise.all([import('rehype-katex'), import('katex/dist/katex.min.css')])
    .then(([{ default: plugin }]) => {
      rehypeKatex = plugin as RehypePlugin;
    })
    .catch((error) => {
      // A failed chunk load (a deploy replaced it, the network dropped) leaves
      // the math as source rather than retrying on every render; the next page
      // load asks again.
      loadingMath = null;
      throw error;
    });
  return loadingMath;
}

function loadRaw(): Promise<void> {
  loadingRaw ??= import('rehype-raw')
    .then(({ default: plugin }) => {
      rehypeRaw = plugin as RehypePlugin;
    })
    .catch((error) => {
      // As for math: the HTML stays out until the next page load asks again.
      loadingRaw = null;
      throw error;
    });
  return loadingRaw;
}

/** Load whichever of the two `want` asks for and this tab does not have yet. */
export function loadPlugins(want: LoadedPlugins): Promise<void> {
  const pending: Promise<void>[] = [];
  if (want.math && !rehypeKatex) pending.push(loadMath());
  if (want.raw && !rehypeRaw) pending.push(loadRaw());
  // Each loads on its own: one failing does not hold the other back.
  return Promise.allSettled(pending).then(() => undefined);
}
