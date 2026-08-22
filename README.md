# Felix web

Turborepo + [Biome](https://biomejs.dev/) monorepo for Felix frontends on
Cloudflare Workers. Talks to the self-hosted Python harness
([felix-run/felix](https://github.com/felix-run/felix)).

Layout follows the [Turborepo basic example](https://github.com/vercel/turborepo/tree/main/examples/basic)
(`apps/*` + shared `packages/*`). UI primitives are **[shadcn/ui](https://ui.shadcn.com/)**
in `packages/ui` (`@felix/ui`).

| Path | Role |
|------|------|
| `apps/chat-ui` | Streaming chat + inspector (Vite → CF Workers) |
| `apps/float` | Workspace float client (`cowork` manifest, client tools, approvals) |
| `apps/docs` | Starlight docs site (`@felix/docs`) → CF Workers |
| `packages/ui` | Shared [shadcn/ui](https://ui.shadcn.com/) components |
| `packages/design` | Design tokens for docs / chrome |
| `packages/typescript-config` | Shared `tsconfig` bases |

## Commands

```bash
pnpm install
pnpm chat:dev          # Vite → proxies /api to Python Felix :8080
pnpm float:dev         # Float client on :5174 → same /api proxy
pnpm docs:dev
pnpm build             # turbo run build
pnpm lint              # turbo → biome
pnpm format            # biome format
pnpm check-types
pnpm sync:theme        # regenerate apps/docs theme.css from @felix/design tokens
```

CI runs `lint`, `check-types`, `build`, and the hook tests in `.claude/hooks/tests/` on every PR.

## Dependencies — pnpm catalogs

Every dependency used by **more than one** workspace package is declared once in
[`pnpm-workspace.yaml`](./pnpm-workspace.yaml) under `catalog:`, and referenced from each
`package.json` with the `catalog:` protocol:

```jsonc
// apps/chat-ui/package.json
"react": "catalog:",
"wrangler": "catalog:",
```

- **Bump a shared version in one place** — `pnpm-workspace.yaml` — then `pnpm install`. No more
  hunting the same package across seven manifests, and no more silent drift (before catalogs,
  `wrangler` was `^4.0.0` in the apps and `^4.90.1` in docs).
- **A dependency used by exactly one package keeps its literal version** in that package's
  `package.json` (`astro`, `streamdown`, `turbo`, `@biomejs/biome`, …). Promote it to the catalog
  when a second package starts using it.
- `pnpm add <pkg>` writes a literal version even when the catalog already has that package
  (pnpm's default `catalogMode: manual`) — change it to `"catalog:"` by hand, or set
  [`catalogMode`](https://pnpm.io/settings#catalogmode) if you want that automated.
- `pnpm publish` / `pnpm pack` substitute the real range for `catalog:`, exactly like `workspace:`.

Requires pnpm ≥ 9.5; this repo pins 10.33.2 via `packageManager`.

### Add a shadcn component

```bash
# Install into the shared UI package
pnpm dlx shadcn@latest add button --cwd packages/ui
```

Apps import from `@felix/ui/<name>` (e.g. `import { Button } from '@felix/ui/button'`).

If `shadcn` pulls in a new dependency that another package already uses, add it to the catalog in
`pnpm-workspace.yaml` and reference it as `"catalog:"` rather than pinning a second version.

## Deploy

```bash
# Set apps/chat-ui wrangler vars.FELIX_ORIGIN to your public API
pnpm chat:deploy
pnpm docs:deploy
```

## License

MIT
