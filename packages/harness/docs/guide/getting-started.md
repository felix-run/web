---
description: "Stand up the Python Felix harness locally and make your first chat request."
---

# Getting Started

Stand up **Felix** locally and send your first request. Felix is a self-hostable
**managed agents harness**: YAML manifests (`apiVersion: felix/v1`) compile into
runnable agents with governance, durable execution, and multi-protocol surfaces.

- **Harness (runtime):** [felix-run/felix](https://github.com/felix-run/felix) — CPython, Compose / Helm
- **Web (optional):** [felix-run/web](https://github.com/felix-run/web) — chat-ui + docs on Cloudflare Workers

For the mental model, read [concepts.md](concepts.md) after this. For production
deploy shape, see [deploy.md](deploy.md).

## Prerequisites

- Docker + Docker Compose
- [uv](https://docs.astral.sh/uv/) (Python 3.14+) for local CLI / non-Compose runs
- Optional: `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY`, or a local [Ollama](https://ollama.com) daemon

## Bootstrap (Compose)

<Steps>

1. **Clone and configure**

   ```bash
   git clone https://github.com/felix-run/felix.git && cd felix
   cp .env.example .env
   # set POSTGRES_PASSWORD (and keep FELIX_DATABASE_URL in sync):
   openssl rand -hex 32
   ```

2. **Start the lean stack**

   ```bash
   make up
   # or: docker compose up --build
   ```

   Brings up **api** (`:8080`), **worker**, **scheduler**, Postgres+pgvector, and Valkey.
   Object store defaults to `fs` under `/data` (no MinIO required).

   Small hosts: `make up-lite`. MinIO + S3 extras: `make up-full`.

3. **Migrate**

   ```bash
   make migrate
   # or: docker compose exec api felix migrate head
   ```

4. **Health check**

   ```bash
   curl -s http://localhost:8080/health | jq
   make doctor   # from a uv-synced checkout, or: docker compose exec api felix doctor
   ```

</Steps>

## First request — Felix-native `/chat`

The bundled default manifest is `quick`. With `FELIX_AUTH_MODE=none` (dev default):

```bash
curl -s -X POST http://localhost:8080/chat \
  -H 'content-type: application/json' \
  -d '{
    "manifest": "quick",
    "messages": [{ "role": "user", "content": "What is 7 * 6?" }]
  }' | jq
```

Pass `thread_id` as a **suffix** (no `:` / `#`); the server prefixes the tenant id:

```bash
curl -s -X POST http://localhost:8080/chat \
  -H 'content-type: application/json' \
  -d '{
    "manifest": "quick",
    "thread_id": "session-1",
    "messages": [{ "role": "user", "content": "And times 10?" }]
  }' | jq
```

Streaming:

```bash
curl -N -X POST http://localhost:8080/chat/stream \
  -H 'content-type: application/json' \
  -d '{"manifest":"quick","messages":[{"role":"user","content":"Say hi."}]}'
```

## First request — OpenAI-shaped `/v1`

`model` is a Felix **manifest name** (`GET /v1/models`):

```bash
curl -s -X POST http://localhost:8080/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{
    "model": "quick",
    "messages": [{ "role": "user", "content": "Say hi." }]
  }' | jq
```

## Chat UI (optional)

From [felix-run/web](https://github.com/felix-run/web), with Compose Felix already on `:8080`:

```bash
git clone https://github.com/felix-run/web.git felix-web && cd felix-web
pnpm install
pnpm chat:dev     # Vite :5173, proxies /api → http://127.0.0.1:8080
```

## Offline eval (CI / no API keys)

```bash
uv sync --dev
FELIX_DATABASE_URL=memory://local FELIX_OBJECT_STORE=memory FELIX_ALLOW_INSECURE=true \
  uv run felix eval -d smoke -m quick -f fixtures/eval/smoke.json --mock
```

## Where to next

<CardGrid>
  <LinkCard title="Concepts" href="/guide/concepts/" description="Manifests, tenants, threads, patterns." />
  <LinkCard title="Manifest Reference" href="/guide/manifest-reference/" description="Every field with defaults." />
  <LinkCard title="REST API" href="/guide/rest-api/" description="Public endpoints with curl examples." />
  <LinkCard title="Deploy" href="/guide/deploy/" description="Compose, Helm, AWS/GCP notes." />
</CardGrid>
