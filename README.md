# Felix web

Cloudflare Workers frontends for the self-hosted Python harness
([felix-run/felix](https://github.com/felix-run/felix)).

| App | Role | Deploy |
|-----|------|--------|
| `apps/chat-ui` | Streaming chat + harness inspector | Workers (static assets + `/api` proxy) |
| `apps/docs` | Public docs (Starlight) | Workers static assets |
| `packages/design` | Shared tokens | library |
| `packages/harness/docs` | Docs markdown source | synced into Starlight |

The **harness itself stays out of this repo** (CPython / Compose / Helm). Chat-ui
proxies `/api/*` to your Felix origin (`FELIX_ORIGIN`).

## Quick start

```bash
pnpm install

# Terminal A — Python Felix (from felix-run/felix)
# make up && make migrate

# Terminal B — chat UI (proxies to :8080)
pnpm chat:dev

# Docs
pnpm docs:dev
```

## Deploy (Cloudflare Workers)

```bash
# Chat UI — set origin to your public Felix API
cd apps/chat-ui
# wrangler.jsonc: vars.FELIX_ORIGIN = "https://api.your-domain.com"
pnpm deploy

# Docs
pnpm --filter @felix/docs deploy
```

Optional gate: `wrangler secret put CHAT_UI_KEY` then send `x-chat-key` from the SPA.

## License

MIT — same as Felix.
