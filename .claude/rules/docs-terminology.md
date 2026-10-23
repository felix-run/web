---
paths:
  - "apps/docs/**"
---

# Docs terminology

## "Worker" and "Cloudflare Worker"

Two different things in these docs are called a worker, and readers cannot tell them apart from
context alone. Name them like this:

- **Worker** (capitalized, no qualifier) is the harness's compose worker — the `felix-worker`
  image, the Taskiq consumer that runs durable runs, crons and deliveries. Write "the Worker",
  "each Worker polls", "the Worker's `webhook_delivery` cron".
- **Cloudflare Worker** is anything deployed to Cloudflare Workers: the workspace gateway
  (`deploy/cloudflare/workspace-gateway` in the harness checkout) and chat-ui's `/api/*` proxy
  (`apps/chat-ui/worker/index.ts`). Always spell it out — "the gateway's Cloudflare Worker", "the
  chat-ui Cloudflare Worker" — never a bare "Worker", "gateway Worker" or "proxy Worker", since bare
  "Worker" means the compose service.

Leave these alone:

- A literal name in code — the compose service `worker`, the image `felix-worker`, `apps/worker`,
  `worker/index.ts`, metric and span names. A list of compose services (`api`, `worker`,
  `scheduler`) is written as code, not as bolded words.
- "service worker" (the browser's), a browser's Web Worker, and "Workers AI" (a model provider).
- Server processes — `FELIX_WORKERS`, "Granian worker processes", "per worker" in the connection
  pool sizing — which are neither.
- Sample terminal sessions, where "worker" is what a person typed.
- `apps/docs/src/diagrams/*.svg`, which `pnpm sync:diagrams` copies from the harness. Fix the
  wording there, in felix-run/felix.
