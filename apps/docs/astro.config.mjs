// Felix docs — Starlight over MDX in src/content/.
// Static output only; deployed as a Workers static-assets site (wrangler.jsonc).
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://docs.felix.run',
  integrations: [
    starlight({
      title: 'Felix',
      description:
        'Felix — self-hostable managed agents harness: manifests, patterns, sessions, and governance.',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/felix-run/felix' }],
      // Palette from @felix/design (checked-in src/styles/theme.css).
      // theme.css is generated (see @felix/design); brand.css is hand-written.
      customCss: ['./src/styles/theme.css', './src/styles/brand.css'],
      // Served from apps/docs/public/. Previously hotlinked from the harness
      // host, which 404s — a docs site should not depend on an API server, and
      // that one now gates static paths behind auth anyway.
      head: [
        {
          tag: 'link',
          attrs: { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
        },
      ],
      // Explicit sidebar (Starlight autogenerate expects src/content/docs/).
      sidebar: [
        {
          label: 'Guide',
          items: [
            { label: 'Getting Started', slug: 'guide/getting-started' },
            { label: 'Concepts', slug: 'guide/concepts' },
            { label: 'Manifest reference', slug: 'guide/manifest-reference' },
            { label: 'REST API', slug: 'guide/rest-api' },
            { label: 'Management API', slug: 'guide/management-api' },
            { label: 'Deploy', slug: 'guide/deploy' },
          ],
        },
        {
          label: 'Internals',
          items: [
            { label: 'Architecture', slug: 'internals/architecture' },
            { label: 'Manifest pipeline', slug: 'internals/manifest-pipeline' },
            { label: 'Patterns', slug: 'internals/patterns' },
            { label: 'Model client', slug: 'internals/model-client' },
            { label: 'Persistence', slug: 'internals/persistence' },
            { label: 'Governance', slug: 'internals/governance' },
            { label: 'Auth', slug: 'internals/auth' },
            { label: 'Observability', slug: 'internals/observability' },
            { label: 'Testing', slug: 'internals/testing' },
            { label: 'Plugins', slug: 'internals/plugins' },
          ],
        },
        // Live OpenAPI UI (Scalar) from a running harness — hosted at api.felix.run;
        // locally: http://localhost:8080/docs over /openapi.json.
        { label: 'API reference ↗', link: 'https://api.felix.run/docs' },
      ],
    }),
  ],
});
