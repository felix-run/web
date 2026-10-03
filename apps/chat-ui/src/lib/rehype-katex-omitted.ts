/**
 * What streamdown's static `rehype-katex` import resolves to in a build.
 *
 * Streamdown lists `rehype-katex` among its default rehype plugins, imported at
 * the top of its own bundle, so every first load carried KaTeX — about 75 kB
 * gzipped — for a reply that contains math perhaps once a week. `vite.config.ts`
 * points that one import here; `lib/katex-plugin.ts` imports the real plugin on
 * demand and `Response` passes it only once a reply has math in it.
 *
 * An attacher that returns no transformer is a no-op to unified.
 */
export default function rehypeKatexOmitted(): void {}
