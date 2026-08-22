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
```

### Add a shadcn component

```bash
# Install into the shared UI package
pnpm dlx shadcn@latest add button --cwd packages/ui
```

Apps import from `@felix/ui/<name>` (e.g. `import { Button } from '@felix/ui/button'`).

## Deploy

```bash
# Set apps/chat-ui wrangler vars.FELIX_ORIGIN to your public API
pnpm chat:deploy
pnpm docs:deploy
```

## License

MIT
