# Felix web

pnpm monorepo: `apps/chat-ui`, `apps/docs`, `packages/design`, `packages/harness/docs`.

Harness runtime lives in **felix-run/felix** (Python). This repo only hosts Workers frontends.

- Chat proxies `/api/*` → `FELIX_ORIGIN` (local Vite → `:8080`).
- Docs prose: edit `packages/harness/docs/`; `apps/docs` syncs into Starlight.
