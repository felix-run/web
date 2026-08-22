# Felix wire protocol — frame and endpoint catalog

Reference for `api-contract-change`. Source of truth is the Python harness
([felix-run/felix](https://github.com/felix-run/felix)); this file records what the browser clients
currently implement, in `apps/chat-ui/src/{api,types}.ts`.

## Transport

All calls are same-origin under `/api/*`. The `/api` prefix is stripped by the proxy (the Vite dev
proxy in development, `worker/index.ts` in production) before the request reaches the harness.
`apiFetch` attaches the `x-chat-key` header and clears the stored key on 401.

## SSE — `POST /chat/stream`

Frames are `data: <json>` lines separated by `\n\n`, terminated by `data: [DONE]`. The reader keeps
a carry buffer so a frame split across network chunks is not dropped — preserve that discipline in
any new reader.

| Frame | Meaning | Client obligation |
|---|---|---|
| `on_chat_model_stream` / `text_delta` | Token delta | Append to the active assistant turn |
| `on_tool_start` / `tool_start` | Server-side tool began | Open an inline tool card |
| `on_tool_end` / `tool_end` | Server-side tool finished | Close the card with output |
| `tool_request` | **Browser** must run the tool | Execute, then `POST /chat/tool_result` — blocking |
| `approval_required` | Human approval needed | Banner → `POST /approvals/{id}/decide` — blocking |
| `ui_request` | select / confirm / input prompt | Banner → `POST /chat/ui` — blocking |
| `session_progress` | Phase/reason updates | Surface as status |
| `on_chain_end` | Terminal frame | Carries `usage: { input, output }` for the turn |
| `on_error` | Run failed | Show the message; end the turn |
| `done` | Completion, may carry `final` | End the turn |
| `aborted` | Run cancelled | End the turn |

The union's final arm is `{ event: string; data: Record<string, unknown> }` — an unknown frame is
accepted by the compiler and ignored at runtime.

## REST surfaces the clients use

**Chat and session**
- `POST /chat` — non-streaming; `202 + resume_token` means a durable run → poll `GET /chat/runs/{token}`
- `POST /chat/tool_result` — answer a `tool_request` (`thread_id`, `tool_call_id`, `content`, `error`)
- `POST /chat/ui` — answer a `ui_request` (`request_id`, `value`, `cancelled`, `note`)
- `GET /chat/sessions/{id}` — authoritative snapshot: transcript, phase, thinking level, leaf, lease
- `POST /chat/sessions/lease` / `…/lease/release` — exclusive per-tab lease; **409 = held elsewhere**
- `GET /chat/sessions/search?q=` — full-text across the tenant's event log
- `POST /chat/rewind` — move the active leaf to an earlier event
- `POST /chat/abort`, `POST /chat/steer`, `POST /chat/continue`, thinking-level set
- `GET /chat/history/{thread_id}` — **rejects anonymous callers**; hence the `localStorage` mirror in
  `src/lib/threads.ts`

**Inspector and management** (tenant-scoped; anonymous callers resolve to tenant `default`)
- `GET /v1/models` — manifest list for the switcher
- `GET /audit`, `GET /audit/metrics` — activity feed and tool-call rollups
- `GET /approvals?status=pending`, `POST /approvals/{id}/decide`
- `GET /plans` — plan/step progress
- `/eval/datasets…`, `/eval/runs` — eval workbench
- `/jobs…` — scheduled jobs
- `/manifests…` — version log, active pointer, canary weight
- `GET /.well-known/agent-card.json` — A2A discovery card

## Headers

| Header | Direction | Notes |
|---|---|---|
| `x-chat-key` | browser → proxy | Shared gate key; **stripped** by the Worker before upstream |
| `Authorization: Bearer …` | proxy → harness | Injected from `FELIX_API_KEY` when configured |
| `x-manifest-variant` | harness → browser | `stable` \| `canary`; must survive the proxy |

## Conventions

- Wire is `snake_case`; clients convert at the boundary only.
- Each turn sends **only the new user message** — the harness replays thread history server-side.
- Image attachments ride as `ChatMessage.attachments[]` (base64 `data:` URLs), are analyzed on the
  turn they are sent, and are not persisted or replayed.
