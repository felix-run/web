# Felix web

Chat UI and docs for the self-hosted Python harness
([felix-run/felix](https://github.com/felix-run/felix)).

This monorepo is the TypeScript orchestrator workspace **with the Workers API /
harness / commerce packages removed**. `apps/chat-ui` and `apps/docs` (plus
`packages/design` and `packages/harness/docs`) are kept **as-is** and pointed at
Python Felix.

| Path | Role |
|------|------|
| `apps/chat-ui` | Streaming chat + inspector (Vite SPA → CF Workers) |
| `apps/docs` | Starlight docs site → CF Workers static assets |
| `packages/design` | Shared design tokens |
| `packages/harness/docs` | Markdown source synced into Starlight |

## Develop

```bash
pnpm install

# Terminal A — Python Felix
#   cd ../felix && make up && make migrate

# Terminal B — chat UI (proxies /api → http://127.0.0.1:8080)
pnpm chat:dev

# Docs
pnpm docs:dev
```

## Deploy (Cloudflare Workers)

```bash
# Set vars.FELIX_ORIGIN to your public Python Felix API
pnpm chat:deploy
pnpm docs:deploy
```

Optional: `wrangler secret put CHAT_UI_KEY` in `apps/chat-ui`.

## License

MIT
