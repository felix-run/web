/**
 * What streamdown's static `rehype-katex` and `rehype-raw` imports resolve to in a build.
 *
 * Streamdown lists both among its default rehype plugins, imported at the top of its own
 * bundle, so every first load carried them: KaTeX, about 75 kB gzipped, for a reply that
 * has math perhaps once a week, and `rehype-raw` with the whole of parse5, about 53 kB, for
 * a reply that carries raw HTML. `vite.config.ts` points both imports here;
 * `lib/reply-plugins.ts` imports the real plugins on demand and `Response` passes each only
 * once a reply needs it.
 *
 * An attacher that returns no transformer is a no-op to unified.
 */
export default function rehypeOmitted(): void {}
