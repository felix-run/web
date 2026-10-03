import { defaultRehypePlugins, type StreamdownProps } from 'streamdown';

type RehypePlugins = NonNullable<StreamdownProps['rehypePlugins']>;

/**
 * Math in a reply, rendered by a KaTeX that loads the first time a reply has some.
 *
 * Streamdown's defaults are kept in their order — raw, katex, sanitize, harden;
 * sanitize and harden run *after* KaTeX, so the order is part of what is safe —
 * with KaTeX's slot left out until it is wanted. The options are streamdown's
 * own (`errorColor`), read off its default entry rather than restated.
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
  loading ??= import('rehype-katex')
    .then(({ default: rehypeKatex }) => {
      withMath = entries.map(([name, plugin]) =>
        name === 'katex' ? [rehypeKatex, katexOptions] : plugin,
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
