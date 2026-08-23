import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The VFS persists through localStorage, which does not exist in Node.
    // tests/setup.ts installs a minimal in-memory implementation rather than
    // pulling in jsdom for one API.
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
  },
});
