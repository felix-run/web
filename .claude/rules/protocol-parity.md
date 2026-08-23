---
paths:
  - "apps/chat-ui/src/api.ts"
  - "apps/chat-ui/src/types.ts"
  - "apps/chat-ui/src/App.tsx"
  - "apps/chat-ui/src/lib/presence.ts"
  - "apps/*/worker/index.ts"
  - "apps/*/vite.config.ts"
---

# Duplicated surfaces — parity rules

Two contracts in this repo exist in more than one place **on purpose**, and one type has a hole in
it by design. None of the three is a candidate for "extract a shared module".

`@felix/test-kit` holds the proxy Worker and the SSE reader to their contracts, and
`pnpm check-protocol-parity` holds every `StreamEvent` arm to having a handler — all three fail CI.
Everything the suites and that check do not cover is maintained by reading.

## 1. The `/api/*` proxy contract — two copies

`apps/chat-ui/worker/index.ts` runs in production; the `server.proxy` block in
`apps/chat-ui/vite.config.ts` runs only under `vite dev`. Both strip the `/api` prefix and forward to
the harness. They cannot be one module — different runtimes, different config — so if they drift,
dev and production behave differently and nothing reports it.

In the Worker specifically: `x-chat-key` is deleted before the upstream fetch, the gate comparison
stays constant-time, and the response body is passed through untouched (`duplex: 'half'`) so SSE and
`x-manifest-variant` survive.

## 2. `StreamEvent` has a hole

The union in `@felix/protocol` ends in `{ event: string; data: Record<string, unknown> }`. A new
event arm with no matching `switch` case in `App.tsx` **compiles, passes lint, and does nothing at
runtime**. Always add the handler with the type.

`pnpm check-protocol-parity` now fails CI on exactly that. It reads the union arms out of
`packages/felix-protocol/src/types.ts` and the branches out of `apps/chat-ui/src/App.tsx`, and
reports any arm the client ignores. It recognizes both spellings, a `switch` and an if-chain.

Gaps that predate the check are grandfathered in `scripts/protocol-parity-baseline.json`. It is a
**one-way ratchet**: a new gap fails, and fixing a grandfathered one also fails until you run
`pnpm check-protocol-parity --update` to bank it. Never hand-edit an entry in to silence a new gap —
that is the one move the file exists to prevent.

Frames the run blocks on must be answered on every path, including errors and aborts, or the
conversation hangs with no error shown:

- `tool_request` → execute in the browser → `POST /chat/tool_result`
- `approval_required` → `POST /approvals/{id}/decide`
- `ui_request` → `POST /chat/ui`

## 3. Blocking states have two delivery paths

A blocking state is supposed to arrive as an SSE frame, and does not reliably: the harness may not
announce a gated tool on the stream, and a **durable** run (`POST /chat` → `202 + resume_token`)
carries no frames at all — `/chat/runs/{token}` reports only its own status. So the same state is
also discovered by the `/approvals` poll in `App.tsx`, which runs for as long as a run is in flight,
and announced outside the viewport through `src/lib/presence.ts`.

Wiring only the frame is the failure this rule exists to prevent: it looks correct in a watched tab
and hangs forever in an unwatched one.
