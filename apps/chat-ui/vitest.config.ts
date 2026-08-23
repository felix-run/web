import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // Node by default for the wire-level suites; the component suites opt into a
    // DOM with a `@vitest-environment happy-dom` docblock, which is the only
    // per-file mechanism Vitest 4 still supports (environmentMatchGlobs is gone).
    environment: 'node',
  },
});
