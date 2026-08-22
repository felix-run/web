// Felix docs — Starlight over MDX in src/content/docs/.
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
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/felix-run/felix' },
      ],
      // Palette from @felix/design (checked-in src/styles/theme.css).
      customCss: ['./src/styles/theme.css'],
      head: [
        {
          tag: 'link',
          attrs: { rel: 'icon', href: 'https://make.felix.run/favicon.svg', type: 'image/svg+xml' },
        },
      ],
      sidebar: [
        { label: 'Guide', items: [{ autogenerate: { directory: 'guide' } }] },
        { label: 'Internals', items: [{ autogenerate: { directory: 'internals' } }] },
        // API reference is served by a running harness (Scalar over /openapi.json).
        { label: 'API reference ↗', link: 'https://make.felix.run/docs' },
      ],
    }),
  ],
});
