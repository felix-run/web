---
name: python-harness
description: Conventions and safety rules for working on the Python Felix harness (felix-run/felix) — the runtime that felix-web's browser clients call. Use when a task involves harness source, its SSE/REST surface, its Python tooling, or explaining harness behavior that the web clients depend on. Covers locating the checkout, discovering its real tooling, and the contract that must not break.
license: MIT
compatibility: Requires a checkout of the felix-run/felix repository in scope; Python tooling comes from that repo
metadata:
  repo: felix-web
---

# Working on the Python harness

## It is not in this repository

`felix-web` hosts Cloudflare Workers frontends only. The harness — the agent runtime, the SSE
stream, sessions, manifests, governance, persistence — lives in
[felix-run/felix](https://github.com/felix-run/felix).

Before any harness work:

1. Locate the checkout: the session's working directories, a sibling directory, or ask the user to
   add it (`--add-dir <path>`).
2. If it is not available, **say so and stop**. Do not create Python files inside `felix-web` and do
   not answer harness questions from memory as if you had read the code.

## Discover the tooling; do not assume it

Read `pyproject.toml`, `Makefile`, `README`, and any CI workflow **before writing code**, and adopt
what is actually there — package manager (uv / pip / poetry), formatter and linter (ruff / black),
type checker, test layout and runner, line length, Python version. Run the project's own commands;
do not invent `make test` if the repo doesn't have it.

Local dev, as referenced from this repo: `make up && make migrate` brings the harness up on
`:8080`, which is what `pnpm chat:dev` proxies to.

## The contract you must not break casually

The browser clients hand-mirror the harness's wire format. These are load-bearing:

- **SSE framing** on `POST /chat/stream`: `data: <json>` frames separated by `\n\n`, terminated by
  `data: [DONE]`. Clients decode with a carry buffer.
- **Event names**: `on_chat_model_stream`/`text_delta`, `on_tool_start`/`on_tool_end`,
  `tool_request`, `approval_required`, `ui_request`, `session_progress`, `on_chain_end` (carries
  `usage`), `on_error`, `done`, `aborted`. Renaming one does not fail any build — the clients'
  `StreamEvent` union has an open catch-all arm, so the UI just goes quiet.
- **Blocking round trips**: `tool_request` (answered by `POST /chat/tool_result`),
  `approval_required`, and `ui_request` each hold the run open. Changing their ids or payload shape
  breaks both clients.
- **The manifest `variant`** (`stable`/`canary`) on `GET /manifests/{name}`. There is no
  `x-manifest-variant` response header — the clients stopped reading one that was never sent.
  Canary assignment is a server-side hash, so a client can only learn it from a route that takes
  the thread id.
- **`202 + resume_token`** from `POST /chat`, polled at `GET /chat/runs/{token}`.
- **`snake_case` on the wire.** The clients convert at the boundary.

When you change any of these, name the felix-web files that must change with it — the shared
`packages/felix-protocol` (wire types and the SSE reader, one copy for both apps), each app's own
`src/api.ts`, and the `App.tsx` `switch` in each — and use the `api-contract-change` skill to land
the client side. Route changes also want `apps/chat-ui/harness-openapi.json` refreshed, which
`pnpm check-api-drift` enforces.

## Engineering rules

- **No blocking I/O on the async request path.** Sync DB drivers, `requests`, `time.sleep`, and
  CPU-bound loops stall the event loop and stall every open SSE stream, not just one request.
- **Stream promptly.** Yield frames as they are produced; do not accumulate a full response and
  flush at the end. Long gaps look like a hang to a client that has no timeout.
- **Tenant scoping is a security property.** Every query and audit write carries the tenant.
  Anonymous callers resolving to tenant `default` is a dev affordance, not an authorization model.
- **Errors become `on_error` frames** that render in a browser. Useful message, no secrets, no
  upstream credentials, no raw stack internals.
- **Type-annotate new code** and keep the project's type checker clean.
- Read neighboring modules and reuse their abstractions before introducing a new pattern.

## Verification

Run the harness repo's own lint / type-check / test commands and report them verbatim. If you cannot
run them — no environment, missing services, no database — say that explicitly instead of implying
the change is verified.
