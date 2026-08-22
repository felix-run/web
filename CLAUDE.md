# Felix web

pnpm monorepo: `apps/chat-ui`, `apps/docs` (`@felix/docs`), `packages/design`, `packages/ui`.

Harness runtime lives in **felix-run/felix** (Python). This repo only hosts Workers frontends.

- Chat proxies `/api/*` → `FELIX_ORIGIN` (local Vite → `:8080`).
- Docs prose: edit `apps/docs/content/` (MDX) directly.
