---
name: api-contract-change
description: Procedure for changing the wire contract between the felix-web browser clients and the Python Felix harness — a new or changed SSE event, REST endpoint, request/response field, or header. Use whenever adding an event type, calling a new /api route, editing @felix/protocol or either app's api.ts, or reconciling the clients with a harness change, because the contract is hand-mirrored from a separate repo and the type union hides missing handlers.
license: MIT
metadata:
  repo: felix-web
---

# Changing the client ↔ harness contract

The contract is **hand-mirrored** from a repo that is not this one, and the type union has a hole
that hides missing handlers. Follow this in order.

## Where the contract lives

| File | Role |
|---|---|
| `packages/felix-protocol/src/types.ts` | **The wire types and the `StreamEvent` union** |
| `packages/felix-protocol/src/stream.ts` | The SSE reader |
| `apps/chat-ui/src/api.ts` | `apiFetch` wrapper + one function per endpoint |
| `apps/chat-ui/src/types.ts` | chat-ui-only: `Turn`, management surfaces |

Plus the consumer: `packages/felix-client/src/engine.ts`, where the `switch` over `StreamEvent` lives — one switch for every client, and the file `check-protocol-parity` reads.

**Do not re-add wire types to the app's `types.ts`.** They were deliberately collapsed into
`@felix/protocol` after duplicate copies drifted apart from each other and from the harness.

## The trap

`StreamEvent` ends in an open arm:

```ts
| { event: string; data: Record<string, unknown> };
```

A new event therefore **type-checks with no handler and silently does nothing at runtime**. The
compiler will not help you. Neither will CI. See `references/wire-protocol.md` for the full frame
catalog and the flows each frame belongs to.

## Procedure

1. **Confirm the harness side first.** The Python harness ([felix-run/felix](https://github.com/felix-run/felix))
   is the source of truth — it is not in this repo. Read its handler, or capture a real frame:
   ```bash
   curl -N -X POST localhost:8080/chat/stream \
     -H 'content-type: application/json' \
     -d '{"manifest":"cowork","messages":[{"role":"user","content":"hi"}],"thread_id":"probe-1"}'
   ```
   Note the exact field names and casing. The harness speaks `snake_case` on the wire
   (`thread_id`, `approval_id`, `request_id`); the clients map to `camelCase` at the boundary and
   nowhere else.

2. **Add the typed arm** in `packages/felix-protocol/src/types.ts`, above the catch-all arm. Keep
   fields optional only if the harness may genuinely omit them — model what you captured in step 1,
   not what is convenient.

3. **Add the client function** in `api.ts` if it is a REST call. Match the house style: go through
   `apiFetch` (never bare `fetch`), check `res.ok`, throw
   `` `${route}: ${res.status} ${detail.slice(0, 200)}` `` on failure.

4. **Handle it** in `packages/felix-client/src/engine.ts`. If the frame is one the run **blocks on**, you must answer it on
   every path including errors and aborts, or the conversation hangs with no visible error:
   - `tool_request` → execute via `@felix/cowork-client`, then `POST /chat/tool_result`
   - `approval_required` → `POST /approvals/{id}/decide`
   - `ui_request` → `POST /chat/ui`

5. **Decide about the unattended path.** A frame the run blocks on has to reach an operator who is
   not looking: a durable run carries no frames at all, so anything blocking needs a `/approvals`-style
   poll and a `setPresence('blocked')` (`src/lib/presence.ts`), not just a banner.

6. **Verify.** `pnpm check-types && pnpm lint` proves nothing about the frame itself — trigger it
   against a live harness (`pnpm chat:dev`) and confirm the UI reacts. Use the `preflight` skill for
   the full loop.

   For an SSE change run `pnpm check-protocol-parity`, which fails when a `StreamEvent` arm has no
   handler in either app — the failure mode the open union arm hides.

   For a REST change also run `pnpm check-api-drift`, which diffs every client call site's path and
   verb against `apps/chat-ui/harness-openapi.json`. If the harness gained the route you are calling,
   refresh that snapshot in the same PR — instructions are in `scripts/check-api-drift.mjs`.

7. **Document it** if the change is user-visible or operator-relevant: `apps/docs/src/content/`
   (see the `docs-sync` skill), and `CLAUDE.md` if it changes the architecture description.

## Also mirrored, and easy to forget

- **The proxy contract exists in three places**: both `worker/index.ts` files and each
  `vite.config.ts` dev proxy. A new path prefix or header must be handled in all three.
- **Response headers** the UI reads (`x-manifest-variant`) must survive the proxy untouched.
- **`202 + resume_token`** on `POST /chat` puts the client into durable-run polling — a new endpoint
  that can return 202 needs the same treatment.
