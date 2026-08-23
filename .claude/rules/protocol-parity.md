---
paths:
  - "apps/chat-ui/src/api.ts"
  - "apps/chat-ui/src/types.ts"
  - "apps/chat-ui/src/App.tsx"
  - "apps/float/src/api.ts"
  - "apps/float/src/types.ts"
  - "apps/float/src/App.tsx"
  - "apps/*/worker/index.ts"
  - "apps/*/vite.config.ts"
---

# Duplicated surfaces — parity rules

Three contracts in this repo exist in more than one file **on purpose**.

Two of them have a shared behavioral check: `@felix/test-kit` exports suites that `apps/chat-ui` and
`apps/float` each run against their own copy, so a divergence in the SSE reader or the proxy Worker
fails CI. A third — that every wire event actually reaches a handler — is checked by
`pnpm check-protocol-parity`. **What is still unguarded is the two `api.ts` files**: nothing compares
them, and the type system will not notice.

## 1. The wire contract — four files

`apps/chat-ui/src/{api,types}.ts` and `apps/float/src/{api,types}.ts` are independent copies.
float's is usually a subset. When you change one, decide explicitly about the other and say which
you chose. Full procedure: the `api-contract-change` skill.

## 2. `StreamEvent` has a hole

The union ends in `{ event: string; data: Record<string, unknown> }`. A new event arm with no
matching `switch` case in `App.tsx` **compiles, passes lint, and does nothing at runtime**. Always
add the handler with the type.

`pnpm check-protocol-parity` now fails CI on exactly that. It reads the union arms out of
`packages/felix-protocol/src/types.ts` and the branches out of both `App.tsx` files, and reports any
arm a client ignores — covering both spellings, chat-ui's `switch` and float's if-chain.

Gaps that predate the check are grandfathered in `scripts/protocol-parity-baseline.json`. It is a
**one-way ratchet**: a new gap fails, and fixing a grandfathered one also fails until you run
`pnpm check-protocol-parity --update` to bank it. Never hand-edit an entry in to silence a new gap —
that is the one move the file exists to prevent.

Frames the run blocks on must be answered on every path, including errors and aborts, or the
conversation hangs with no error shown:

- `tool_request` → execute in the browser → `POST /chat/tool_result`
- `approval_required` → `POST /approvals/{id}/decide`
- `ui_request` → `POST /chat/ui`

## 3. The `/api/*` proxy contract — three files

`apps/chat-ui/worker/index.ts`, `apps/float/worker/index.ts` (near-duplicates), and the `server.proxy`
block in each `vite.config.ts`. All three strip the `/api` prefix and forward to the harness. If they
drift, dev and production behave differently and nothing reports it.

In the Workers specifically: `x-chat-key` is deleted before the upstream fetch, the gate comparison
stays constant-time, and the response body is passed through untouched (`duplex: 'half'`) so SSE and
`x-manifest-variant` survive.
