// Starlight docs collection — edit MDX under src/content/ directly.

import { defineCollection } from 'astro:content';
import { docsSchema } from '@astrojs/starlight/schema';
import { glob } from 'astro/loaders';

export const collections = {
  docs: defineCollection({
    // Starlight's docsLoader() hardcodes src/content/docs/; we keep prose at
    // src/content/ (no redundant /docs nesting).
    loader: glob({
      pattern: '**/[^_]*.{md,mdx}',
      base: './src/content',
    }),
    schema: docsSchema(),
  }),
};
