import { defineConfig } from 'vite';

/**
 * A Node bundle, not a web one.
 *
 * `ssr` externalises everything in node_modules — ink, react, and Node's own
 * builtins stay `import`s at runtime — while the linked workspace packages,
 * which ship raw TypeScript with no build step, are inlined. That is the whole
 * reason a bundler is here: `node` cannot import `@felix/client`'s `.ts` source
 * directly.
 */
export default defineConfig({
  build: {
    ssr: 'src/main.tsx',
    outDir: 'dist',
    target: 'node20',
    rollupOptions: {
      output: {
        entryFileNames: 'felix.js',
        // The bin field points here, so it has to be executable on its own.
        banner: '#!/usr/bin/env node',
      },
    },
  },
  esbuild: { jsx: 'automatic' },
});
