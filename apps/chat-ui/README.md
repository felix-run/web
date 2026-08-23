# Chat UI — streaming chat + a harness inspector

A React + Vite SPA (**shadcn/ui + Tailwind CSS v4**) for the **self-hosted Python
Felix** harness ([felix-run/felix](https://github.com/felix-run/felix)). UI components
are unchanged from the TypeScript orchestrator chat-ui; the Worker/Vite proxy now
targets Python Felix (`FELIX_ORIGIN` / `:8080`) instead of the Workers API.

The chat components follow the [Vercel AI Elements](https://ai-sdk.dev/elements) shape — a streaming `Conversation`, markdown `Response` (via [`streamdown`](https://www.npmjs.com/package/streamdown)), inline tool cards, a `Composer`, and a manifest selector — but are wired to Felix's SSE event model (`on_chat_model_stream` / `on_tool_start` / `on_tool_end` / `on_error`) rather than the AI SDK's `useChat`/`UIMessage`.

## What it demonstrates

**Chat (left):**
- **Multimodal composer** — the input is the AI-Elements `PromptInput` engine (ported from a production Felix chat UI): **attach images** (paperclip, drag-and-drop, or paste) with removable thumbnail previews, an **inline manifest picker**, **voice dictation** (Web Speech API, where supported), **slash commands** (`/new`, `/clear`, `/theme`), a live character counter, and Enter-to-send / Shift+Enter-for-newline. Attached images are inlined as base64 `data:` URLs and sent on the user turn.
- **Vision** — attachments ride on the chat request as `ChatMessage.attachments[]` (a Felix extension; see below) and the harness maps them to provider-native image blocks (Anthropic `image`, OpenAI `image_url`), so a vision-capable model actually *sees* the image. Attachments are analyzed on the turn you send them and are not persisted/replayed.
- **Streaming** — token deltas render live; `on_tool_start`/`on_tool_end` become collapsible tool cards, so the react tool loop is visible as it runs.
- **Greeting + suggested actions** — an empty conversation shows a welcome overview and a grid of starter prompts (the AI Elements `Greeting`/`SuggestedActions` shape); clicking one sends it as the first turn.
- **Message actions** — hovering a turn reveals **Copy** (any turn) and, on the last assistant turn, **Regenerate**. Because Felix's session log is append-only, regenerate resets the server transcript and replays the prior history up to the prompting user turn, then streams a fresh answer in place of the old one (rather than re-sending and double-counting the turn).
- **Theme toggle** — light / dark / system, persisted; tracks the OS preference live while on `system` (the `ModeToggle` shape, wired to the shadcn `.dark` tokens already in `index.css`).
- **Per-turn token usage** — each assistant turn shows the cumulative `input`/`output` tokens for that turn (all react sub-calls summed), read from a `usage` field the harness now stamps on the terminal `on_chain_end` frame.
- **Conversation history** (the History button, a left rail) — every thread is kept in `localStorage` (an index + a per-thread transcript blob); click a past conversation to resume it, or trash it to delete (best-effort server reset too). Each turn still sends *only the new user message* and Felix replays the thread server-side. On open, a thread is hydrated from the server event log (`GET /chat/history/{thread_id}`, reconstructed into the transcript) **when authenticated** — that route rejects anonymous callers, so the anonymous dev demo falls back to the `localStorage` copy. "New thread" starts a fresh one.
- **Manifest switcher** — the inline picker in the composer toolbar, populated from `GET /v1/models`.
- **Agent spec** (the 🤖 button in the header) — a read-only panel showing the *resolved* manifest the harness compiled for the selected agent: pattern, model + fallbacks, tools, skills, memory, session strategy, governance (judges/approvals/policies/limits), connectivity, and inbound auth (`GET /manifests/{name}`), plus the A2A discovery card for the default agent (`GET /.well-known/agent-card.json`).
- **Canary badge** — reads an `x-manifest-variant` response header. The current harness does not
  send one (canary routing is decided server-side by a deterministic hash), so the badge stays dark;
  the resolved variant is available on `GET /manifests/{name}` if it should be re-sourced.

**Inspector (right, toggleable) — the harness-parity panels:**
- **Activity** — polls `GET /audit`: a live feed of `tool_call`, `judge_score`, `guardrail_block`, `approval_request`/`approval_decision`, `plan_step`, `model_switch`, … events with type badges.
- **Metrics** — polls `GET /audit/metrics`: tool-call rollups over the last hour, folded per tool (total calls, error count, slowest avg latency) — the same `orchestrator_tool_calls` view an operator reads.
- **Approvals** — polls `GET /approvals?status=pending` and posts to `POST /approvals/:id/decide`: the human-in-the-loop queue with Approve / Deny.
- **Plans** — polls `GET /plans`: plan title + step statuses (populated by the `deep` pattern).
- **Skills** — shows the latest `list_skills` result captured from the stream, and a button that asks the agent to manage its skills (activation is model-driven via the `list_skills`/`activate_skill`/`deactivate_skill` tools — there's no REST surface).

**Eval workbench (header → "Eval", a slide-over):**
- The `/eval` offline-benchmark surface. Create a golden dataset, append items with a simplified rubric (`criteria` for the LLM judge + `must_include` substring gates), then **Run vs `<manifest>`** to replay every item against the currently-selected agent and judge each response. Per-item pass/fail + scores come back inline (`POST /eval/datasets/{name}/run` → `GET /eval/runs`). The harness has no per-item route, so appending an item is a read-modify-write of the whole dataset (`PUT /eval/datasets/{name}`).

**Scheduled jobs (header → "Jobs", a slide-over):**
- The `/jobs` registry — persistent, tenant-scoped cron-scheduled agent runs. Create a job (name + 5-field cron + manifest; empty cron = never swept), watch `last_status`/`next_run_at`, expand a job for its **run history**, or delete it. The harness exposes no run-now route, so runs are observed rather than triggered. The worker's `run_scheduled_jobs` cron does the sweeping — which needs `felix-scheduler` running alongside `felix-worker`, or nothing fires. (`GET /jobs`, `PUT /jobs/{name}`, `GET /jobs/{name}/runs`, `DELETE /jobs/{name}`.)

**Manifest lifecycle (header → "Manifests", a slide-over):**
- The `/manifests` surface — an append-only version store with an active pointer and a weighted canary. **Import** any resolvable manifest (e.g. the bundled `governed`) into the tenant store, edit the JSON to **append a new version**, **activate** an earlier version by number, and drive a **weighted canary** with the slider. Routing is a deterministic hash of tenant, thread and both versions, so a thread stays on one side for the whole rollout. Writes need the `manifests:write` scope; with `FELIX_AUTH_MODE=none` the harness skips scope checks entirely.
  - The harness exposes no version *list* route, so there is no version log to render — activate by number instead.
  - *Demo:* Import `governed` → **Edit current** (tweak the `system_prompt`) → **Save new version** → set it as **canary @ 50%** → **Clear canary** to drop it.

These endpoints are tenant-scoped but allow anonymous callers (resolving to tenant `default`), so in the no-auth dev loop they read back exactly what your chat turns produce.

## Which bundled manifest to drive

Felix ships eight bundled manifests — `quick`, `deep`, `router`, `oss-only`, `hybrid-router`,
`support`, `cowork`, `governed`. Two light up the parity panels:

- **`cowork`** (the default here) — client tools (`local_shell`, `local_open`) that run *in this tab*,
  plus approvals gating `write_file` and `local_shell`. Ask it to write a file: the call is held,
  the approval banner appears, approve it and the run continues.
- **`governed`** — the fullest governance example: a skill, a scope policy on `calculator`, an
  approval on `activate_skill`, content and command screening, guardrails, and SOC 2 / EU AI Act
  framework mapping. Good for filling Activity with `policy_decision` and `judge_score` rows.

For the Plans tab, switch to `deep` and ask a multi-step question.

## Why a proxy Worker

Felix serves no static assets and sets no CORS headers, so a browser app can't call it
cross-origin. This Worker (1) serves the built SPA from Assets and (2) proxies `/api/*`
to `FELIX_ORIGIN` (HTTP), stripping the `/api` prefix. Same-origin → no CORS on the harness.
SSE bodies pass through unbuffered. See [`worker/index.ts`](./worker/index.ts).

```
browser ──/api/*──▶ chat-ui Worker ──FELIX_ORIGIN──▶ Felix (Python)
        ◀── SSE / JSON ──              ◀── SSE / JSON ──
```

When `CHAT_UI_KEY` is set (production), the Gate prompts for that shared key and sends
`x-chat-key`; the Worker checks it and **strips** the header before upstream.

## Local dev

```bash
# terminal 1 — Python Felix (repo: felix-run/felix)
make up && make migrate

# terminal 2 — this monorepo
pnpm chat:dev   # Vite :5173, /api → :8080 (no CHAT_UI_KEY gate)
```

Open http://localhost:5173.

## Deploy

```bash
cp wrangler.example.jsonc wrangler.jsonc
# set vars.FELIX_ORIGIN to your public Python Felix API
pnpm --filter @felix/chat-ui build
pnpm --filter @felix/chat-ui exec wrangler secret put CHAT_UI_KEY   # once
pnpm --filter @felix/chat-ui exec wrangler deploy
```

Production today: `chat.felix.run` → `FELIX_ORIGIN=https://api.felix.run`. Enter the
`CHAT_UI_KEY` in the Gate when prompted. Rotate with `wrangler secret put CHAT_UI_KEY`.

## Files

| Path | Purpose |
|---|---|
| `worker/index.ts` | Proxy Worker: serves assets, forwards `/api/*` to `FELIX_ORIGIN` |
| `src/api.ts` | SSE client for `/chat/stream` + REST helpers for `/v1/models`, `/audit`, `/approvals`, `/plans` |
| `src/types.ts` | chat-ui's own types; the wire contract itself lives in `@felix/protocol` |
| `src/components/chat/` | `Conversation`, `Response`, `Message`, `MessageActions`, `Tool`, `MultimodalInput`, `PreviewAttachment`, `SlashCommandMenu`, `Greeting`, `SuggestedActions` |
| `src/components/ai-elements/prompt-input.tsx` | The AI-Elements `PromptInput` engine (attachments, drag/drop, paste, controlled state) |
| `src/hooks/use-speech-recognition.ts` | Web Speech API voice-dictation hook |
| `src/components/theme-provider.tsx`, `theme-toggle.tsx` | Light/dark/system theme context + `ModeToggle` |
| `src/components/inspector/` | The Activity / Metrics / Approvals / Plans / Skills panel |
| `src/components/eval/` | The `/eval` workbench slide-over (datasets, items, runs) |
| `src/components/manifests/` | The `/manifests` lifecycle slide-over (publish, activate, canary) |
| `src/components/jobs/` | The `/jobs` scheduled-jobs slide-over (create, list, run history) |
| `src/components/agent/` | The agent-spec slide-over (resolved manifest + A2A card) |
| `src/components/chat/thread-list.tsx` | The conversation-history left rail |
| `src/lib/threads.ts` | Multi-thread localStorage + event-log → transcript rebuild |
| `packages/ui` (`@felix/ui`) | Shared shadcn/ui primitives, imported as raw source |
| `src/hooks/usePoll.ts` | Interval poller used by the Inspector tabs |
| `components.json`, `src/index.css` | shadcn config + Tailwind v4 theme tokens |

## Notes

- **Vision (a core extension).** Image attachments required a small, backward-compatible change to the harness itself: `ChatMessage` gained an optional `attachments: { url, media_type, filename? }[]`, and the model adapter maps it to provider-native image blocks — Anthropic `image` (base64 / url source), OpenAI `image_url`. Attachments are *not* written to the session log, so they are analyzed once on the turn they are sent rather than re-fed on every replay. To actually see images analyzed, point a vision-capable model at the manifest via `FELIX_MODEL_ROUTES`.
- **Auth.** With `FELIX_AUTH_MODE=none` (loopback-only) the bundled manifests and Inspector endpoints work anonymously against tenant `default`; Compose defaults to `api_key` and mints a local key. Behind real auth, have the proxy Worker inject an `Authorization` header before forwarding (or run Felix behind Cloudflare Access and let the JWT flow through). `GET /chat/history/:thread_id` hard-rejects anonymous, so the transcript is restored from `localStorage` rather than that route.
- **Bundle size.** `streamdown` bundles `shiki` (and mermaid) for code/diagram rendering; syntax grammars are code-split and lazy-loaded. Fine for a demo; swap `Response` for a lighter markdown renderer if you need a smaller bundle.
- **Adapting AI Elements.** The chat components are original, built on the same libraries AI Elements use (`streamdown`, `use-stick-to-bottom`, shadcn primitives) and adapted to Felix's SSE events instead of the AI SDK data model.
