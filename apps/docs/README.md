# @felix/docs

Public Felix docs — [Starlight](https://starlight.astro.build) static site at `docs.felix.run`
(Cloudflare Workers static assets).

Edit MDX under **`src/content/`**. Theme CSS (`src/styles/theme.css`) is checked in but
**generated** from `@felix/design` (`starlightThemeCss()`) — change the tokens in
`packages/design/src/tokens.ts`, then regenerate:

```bash
pnpm sync:theme     # = pnpm --filter @felix/design sync:theme
```

```bash
pnpm --filter @felix/docs dev
pnpm --filter @felix/docs build
pnpm --filter @felix/docs deploy
```

Root shortcuts: `pnpm docs:dev` / `docs:build` / `docs:deploy`.
