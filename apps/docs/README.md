# @felix/docs

Public Felix docs site — [Starlight](https://starlight.astro.build) static build,
deployed as a Cloudflare Workers static-assets Worker.

**Prose lives in** `packages/harness/docs/` (synced into `src/content/docs/` before
dev/build). Edit those sources, not the synced copies.

The live API reference is the Python harness OpenAPI
(`https://<felix-host>/docs` / `/openapi.json`), not this site.

```bash
pnpm --filter @felix/docs dev
pnpm --filter @felix/docs build
pnpm --filter @felix/docs deploy
```
