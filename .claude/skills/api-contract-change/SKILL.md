---
name: api-contract-change
description: Procedure for changing the wire contract between the felix-web browser clients and the Python Felix harness — a new or changed SSE event, REST endpoint, request/response field, or header. Use whenever adding an event type, calling a new /api route, changing types.ts or api.ts, or reconciling the clients with a harness change, because the contract is hand-mirrored across four files in two apps.
license: MIT
metadata:
  repo: felix-web
---

# Changing the client ↔ harness contract

The contract is **hand-mirrored**, duplicated per app, and has a type-level hole that hides mistakes.
Follow this in order.

## The four files (plus two more)

| File | Role |
|---|---|
| `apps/chat-ui/src/types.ts` | Wire types + the `StreamEvent` union |
| `apps/chat-ui/src/api.ts` | `apiFetch` wrapper, SSE reader, one function per endpoint |
| `apps/float/src/types.ts` | Independent copy, usually a subset |
| `apps/float/src/api.ts` | Independent copy, usually a subset |

Plus the consumers: `apps/chat-ui/src/App.tsx` and `apps/float/src/App.tsx`, where the `switch` over
`StreamEvent` lives.

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

2. **Add the typed arm** in `apps/chat-ui/src/types.ts`, above the catch-all arm. Keep fields
   optional if the harness may omit them.

3. **Add the client function** in `api.ts` if it is a REST call. Match the house style: go through
   `apiFetch` (never bare `fetch`), check `res.ok`, throw
   `` `${route}: ${res.status} ${detail.slice(0, 200)}` `` on failure.

4. **Handle it** in `App.tsx`. If the frame is one the run **blocks on**, you must answer it on
   every path including errors and aborts, or the conversation hangs with no visible error:
   - `tool_request` → execute via `@felix/cowork-client`, then `POST /chat/tool_result`
   - `approval_required` → `POST /approvals/{id}/decide`
   - `ui_request` → `POST /chat/ui`

5. **Decide about float, explicitly.** Then do it or write down why not. The two apps drift only by
   intent, never by accident:
   ```bash
   diff apps/chat-ui/src/types.ts apps/float/src/types.ts
   ```

6. **Verify.** `pnpm check-types && pnpm lint` proves nothing about the frame itself — trigger it
   against a live harness (`pnpm chat:dev`, `pnpm float:dev`) and confirm the UI reacts. Use the
   `preflight` skill for the full loop.

7. **Document it** if the change is user-visible or operator-relevant: `apps/docs/src/content/`
   (see the `docs-sync` skill), and `CLAUDE.md` if it changes the architecture description.

## Also mirrored, and easy to forget

- **The proxy contract exists in three places**: both `worker/index.ts` files and each
  `vite.config.ts` dev proxy. A new path prefix or header must be handled in all three.
- **Response headers** the UI reads (`x-manifest-variant`) must survive the proxy untouched.
- **`202 + resume_token`** on `POST /chat` puts the client into durable-run polling — a new endpoint
  that can return 202 needs the same treatment.
