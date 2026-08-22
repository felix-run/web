# @felix/docs

Public Felix docs — [Starlight](https://starlight.astro.build) static site at `docs.felix.run`
(Cloudflare Workers static assets).

Edit MDX under **`src/content/docs/`**. Theme CSS (`src/styles/theme.css`) is checked in from
`@felix/design` (`starlightThemeCss()`).

```bash
pnpm --filter @felix/docs dev
pnpm --filter @felix/docs build
pnpm --filter @felix/docs deploy
```

Root shortcuts: `pnpm docs:dev` / `docs:build` / `docs:deploy`.
