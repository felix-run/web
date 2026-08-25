# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Felix web

Turborepo + Biome pnpm monorepo of **Cloudflare Workers frontends** for Felix. The agent runtime
itself is **not here** — it is the self-hosted Python harness at
[felix-run/felix](https://github.com/felix-run/felix), reached over HTTP. There is no server logic
in this repo beyond one thin proxy Worker.

| Path | Role |
|---|---|
| `apps/chat-ui` (`@felix/chat-ui`) | Full streaming chat + harness inspector (React/Vite → Worker) |
| `apps/docs` (`@felix/docs`) | Starlight docs site → Workers static assets |
| `packages/ui` (`@felix/ui`) | shadcn/ui primitives, consumed as raw `.tsx` source |
| `packages/felix-protocol` (`@felix/protocol`) | The wire contract — SSE reader + shared types |
| `packages/cowork-client` | Browser VFS, File System Access mount, client-side tool executor |
| `packages/test-kit` | Reusable behavioral suites — the proxy Worker contract and the SSE reader |
| `packages/design` | Neutral palette + theme-CSS builders (docs theme is generated from these) |
| `packages/typescript-config` | Shared tsconfig bases |

## Commands

```bash
pnpm install
pnpm chat:dev          # Vite :5173 — /api/* proxied to Python Felix on :8080
pnpm docs:dev
pnpm build             # turbo run build (tsc -b && vite build; astro build)
pnpm lint              # turbo → biome check
pnpm format            # biome format --write
pnpm check-types       # turbo → tsc --noEmit
pnpm test              # turbo → vitest (cowork-client, chat-ui)
pnpm check-api-drift   # client routes vs the committed harness OpenAPI snapshot
pnpm check-protocol-parity  # SSE events: every arm handled, every emitted event modelled
pnpm check-tailwind-sources # every @source-covered tree still reaches the compiled CSS
pnpm sync:harness [path]    # re-record both contract files from a harness checkout
pnpm --filter @felix/chat-ui <script>   # scope to one package
pnpm dlx shadcn@latest add <name> --cwd packages/ui   # add a shared primitive
```

Local dev needs the Python harness running separately (`make up && make migrate` in felix-run/felix
→ `:8080`). Without it, the app loads but every `/api/*` call fails.

**Test coverage is partial, and knowing where it stops matters.** `pnpm test` covers the VFS and
the File System Access mount (`packages/cowork-client`), the SSE reader (one implementation in
`@felix/protocol`, exercised through chat-ui's `streamChat`), and the proxy Worker — the last two via
parameterized suites in `@felix/test-kit`, which are the contract those surfaces are held to. React
coverage reaches the thread store (including the server/local session merge), the theme provider,
`usePoll`, the presence signals, the Gate, and the history rail's per-thread actions;
**the chat surface itself is untested** — `App.tsx`, the composer, and the inspector panels are still
verified by running them.

One thing that bites when verifying by hand: `usePoll` skips ticks while the tab is **hidden**, and a
browser driven by automation reports `visibilityState: 'hidden'`. An inspector panel will sit on
stale data forever under a driver, which looks like a broken refresh and is not. `.claude/hooks/tests/` covers the hooks.

Two mechanical guards cover the hand-mirrored wire contract.

`pnpm check-api-drift` walks the fetch call sites in `apps/chat-ui/src/api.ts` — including the three
that deliberately bypass `apiFetch` — and diffs path *and* verb against
`apps/chat-ui/harness-openapi.json`, a committed record of what the harness serves. It catches a
route the harness renamed or dropped; it cannot catch a call that hits a real route for the wrong
purpose, and it says nothing about payload shapes. It also prints, advisory only, the routes the
harness serves that nothing calls — the direction where a whole unbuilt feature shows up.

`pnpm check-protocol-parity` covers the events, in **both** directions: every `StreamEvent` arm must
have a handler, and every event `scripts/harness-events.json` says the harness emits must have an
arm. The second is the one that drifts, because the harness moves independently and the union's open
arm swallows anything it gains — an event nobody models compiles, lints, and does nothing. Handler
gaps that predate the check are grandfathered in `scripts/protocol-parity-baseline.json` as a
one-way ratchet (`--update` banks a fix); an unmodelled event is never grandfathered. Both halves
compare event *names* only — neither can tell you a handler is wrong, just that one exists.

**Both records are regenerated together, from a harness checkout, by
`node scripts/sync-harness-contract.mjs [path]`** — never by curling a running harness. That records
the deployment, not the contract; on 2026-08-24 the local container was two features behind and the
snapshot silently omitted `/memory/*` and `GET /chat/stream/{thread_id}`. FastAPI builds the spec
without a database, so nothing needs to be running.

A third guard covers the stylesheet, which fails in the same silent way for a different reason.
`pnpm check-tailwind-sources` compiles `apps/chat-ui/src/index.css` twice — once as written, once
with every `@source` line stripped — and asserts that each guarded tree's canary classes appear in
the first and not the second. Present in both means the canary proves nothing; absent from both
means Tailwind is no longer scanning that tree, and every class living only there is being dropped
from the build. It compiles because that is the only way to ask what Tailwind actually scanned
rather than what the file says it should have; the two builds are in-memory and take ~250ms total.
The guarded trees and their canaries are the `GUARDED` table at the top of the script, and an
`@source` line reaching outside the app root with no entry there fails — a line nothing can notice
the deletion of is not a guard.

CI (`.github/workflows/ci.yml`) is one `verify` job: `pnpm install --frozen-lockfile`, then lint,
check-types, API drift, protocol parity, Tailwind sources, build (chat-ui, docs), tests, then the
hook tests —
each step runs even if an earlier one fails, so one red run reports everything. Verification of app behavior still
means running it against a live harness.

## Architecture

### The `/api/*` proxy contract

Felix serves no static assets and no CORS headers, so the browser can never call it directly.
`apps/chat-ui/worker/index.ts` implements the contract and `vite.config.ts` mirrors it in dev:

```
browser ──/api/<path>──▶ proxy Worker ──FELIX_ORIGIN/<path>──▶ Python Felix
```

- The `/api` prefix is **stripped**; everything else (SSE bodies, `x-manifest-variant`) passes through.
- `CHAT_UI_KEY` (a Worker secret) gates browser clients: the SPA sends `x-chat-key` from
  `localStorage`, the Worker compares it, then **deletes the header** before going upstream.
  A 401 anywhere drops the stored key and re-prompts via `src/lib/auth.ts` → `components/gate.tsx`.
- `FELIX_API_KEY` (optional) is injected upstream as `Authorization: Bearer …`.
- In `vite dev` the Worker is not in the loop, so the `CHAT_UI_KEY` gate is skipped entirely.

The dev proxy in `apps/chat-ui/vite.config.ts` is a second copy of this contract — change one and
the other diverges silently.

**The dev proxy injects `Authorization` too.** `make up` runs `scripts/dev-key.sh`, which sets the
harness to `FELIX_AUTH_MODE=api_key` and generates a key, so an unauthenticated `vite dev` 401s on
every `/api/*` call. Put the key in `apps/chat-ui/.dev.vars` as `FELIX_API_KEY=…` — the same
gitignored file `wrangler dev` reads for the Worker, so local dev has one secrets file rather than
two. `process.env.FELIX_API_KEY` overrides it for a one-off run, and `FELIX_AUTH_API_KEYS` — the
harness's own spelling, which is what people carry across — is accepted with a notice. With no key configured the header
is simply omitted, which is correct against a harness running `FELIX_AUTH_MODE=none`.

### Client ↔ harness protocol (the part that is easy to get wrong)

`packages/felix-protocol` is the hand-mirrored wire contract. Its `StreamEvent` is the authoritative
list of SSE frames; it ends in an open `{ event: string; ... }` arm, so an unknown event compiles
fine and silently does nothing — when the harness gains an event, add the arm *and* the handler in
`App.tsx`, or it is indistinguishable from an event that never arrives. `apps/chat-ui/src/api.ts`
owns the REST calls and auth; `src/types.ts` keeps only what is app-specific (`Turn` and the
management types).

*Almost* every frame is a bare `data:` line carrying one envelope `{event, type, data, text}`,
terminated by `data: [DONE]`. Two other SSE fields carry meaning, and a reader that matches whole
frames against `data:` silently drops both:

- **`event: error`** is the harness's one typed frame — the only way a stream reports a failure that
  happened after its 200 was sent (`/chat/stream`, the reconnect stream, every durable-run failure).
  Its payload is `{error: {message, type}}`, not the usual envelope; `readSseStream` normalises it
  into an `on_error` event, which the harness itself never emits.
- **`id:`** stamps structural frames with the thread's next session sequence — everything except
  `text_delta`, `on_chat_model_stream` and `session_progress`. It reaches the app through
  `StreamHandlers.onCursor`, and is what `GET /chat/stream/{thread_id}` takes as `Last-Event-ID`.

`apps/docs/src/content/guide/rest-api.mdx` documents both in full; it is the reference, not this
summary.

Flows worth knowing before editing the app:

- **Streaming** — `POST /chat/stream`, SSE decoded with a carry buffer (frames split across network
  chunks). Deltas append to the current turn; `on_tool_start`/`on_tool_end` become inline tool cards;
  the terminal `on_chain_end` carries per-turn `usage`.
- **Client tools** — a `tool_request` frame means the *browser* runs the tool
  (`@felix/cowork-client` → in-tab VFS or a File System Access mount), then answers with
  `POST /chat/tool_result`. This is a real round trip inside the model loop; failing to post a
  result hangs the run.
- **Durable runs** — two entry points, and they behave differently. `POST /chat` may return
  `202 + resume_token`; poll `GET /chat/runs/{token}` (`pollDurableRun`). `POST /chat/stream` with a
  `spec.execution.mode: durable` manifest instead streams the run's *progress* —
  `run_accepted` → `run_status` → `final`, with no deltas at all.
- **Reattaching** — `POST /chat/stream` stamps `id:` on structural frames; `readSseStream` reports
  each through `StreamHandlers.onCursor`, and `src/lib/reattach.ts` hands the newest back to
  `GET /chat/stream/{thread_id}` as `Last-Event-ID` when a stream drops. This rejoins the **thread**,
  not the run: a client that hangs up has its run torn down on purpose, so the UI must say what
  landed rather than imply a reply is still being written. A clean end is not the end of the thread
  — the harness closes an idle reattach at ~300s and expects the client back — so the loop re-checks
  `phase` and returns while it is still working.
- **Session state is server-authoritative** — `GET /chat/sessions/{id}` returns the snapshot
  (transcript, phase, thinking level, leaf, lease) used to hydrate a thread, and `GET /chat/sessions`
  is the thread index behind the history rail. The `localStorage` copy in `src/lib/threads.ts` is a
  cache, not the list: `mergeSessions` folds the two, and the split matters because **neither side is
  a superset**. The harness owns which threads exist and what they are *named*
  (`POST /chat/sessions/name`); it does not record which manifest a thread used, and a thread that
  never reached it — or was created against a different deployment — exists only locally, so those
  rows are kept and marked rather than dropped.
  - Thread ids on the wire are `{tenant}:{suffix}`; clients send and store the **suffix** only
    (`threadSuffix`), because the harness rejects a suffix containing `:` outright.
  - `GET /chat/history/{id}` still rejects anonymous callers, which is why hydration prefers the
    snapshot route.
- **Leases** — each tab mints a holder id and takes an exclusive lease
  (`/chat/sessions/lease`, released best-effort on unload); a 409 means another tab holds the session.
- **Sticky interrupts** — `approval_required` and `ui_request` frames render as banners and are
  answered out-of-band (`/approvals/{id}/decide`, `/chat/ui`); the run is waiting on them.
- **Memory** — `/memory` is what the agent has stored across sessions, surfaced in the inspector so
  a stale or hostile fact can be found and removed without a database console. Listing, the agent's
  own hybrid ranking (`/memory/search`, whose hits report *which retriever* found them), and a
  read-only `as-of/{turn_seq}` view including superseded facts. `DELETE` is **soft** — the row
  becomes `forgotten` and drops out of recall rather than being erased, which is why the UI says
  "forget". Reads need the `memory:read` scope, so a 403 here means a narrow key, not an empty store.
- **Other verbs** the UI drives: abort, steer/follow-up, continue, thinking level, rewind
  (`/chat/rewind` moves the active leaf), fork/compact/export, and full-text
  `/chat/sessions/search`.

Each turn sends **only the new user message** — Felix replays thread history server-side.

### Unattended runs

A background run (`POST /chat` → `202 + resume_token`) has no stream to carry an approval frame, so
`src/lib/presence.ts` and the `/approvals` poll in `App.tsx` exist to make an unwatched tab honest:
the poll surfaces an approval the durable run cannot deliver, and presence puts *working* /
*blocked* / *idle* into `document.title` plus an OS notification when the tab is hidden. Permission
is requested inside the background-run click, never on load.

This was previously a second app (`apps/float`, removed 2026-08-23) that served the same operator at
lower density. What it actually contributed was the constraint above — assume no one is looking —
which is now a mode of chat-ui rather than a separate surface. See `PRODUCT.md`.

### Packages

`@felix/ui` and `@felix/cowork-client` have **no build step** — they export `.tsx`/`.ts` source
directly, resolved via `paths` in each app's `tsconfig.json`. Adding an export means updating the
package `exports` map *and* the tsconfig `paths` in `apps/chat-ui`.

Because `@felix/ui` lives outside the app root, Tailwind's automatic content detection does not see
it; `apps/chat-ui/src/index.css` declares `@source "../../../packages/ui/src"` to compensate. Drop
that line and every utility used *only* inside a primitive (`bg-primary`, the `focus-visible:ring-*`
set) is silently omitted from the build — the class stays on the element, no CSS is generated, and
the component renders unstyled with no error anywhere. A new shared package that ships classes needs
its own `@source` line.

**A dependency can need one too.** `streamdown` — which renders every assistant message — styles
itself with Tailwind classes that live in its own `dist`, so `index.css` sources
`../node_modules/streamdown/dist` as well. The failure is partial and therefore easy to miss: a
class the app also uses elsewhere works, and one only the library emits does not, which is how
markdown lists lost their markers and code blocks lost their entire dark theme (the
`dark:text-(--shiki-dark)!` swap generated no rule, so tokens kept their *light* colours on a
near-black page). The block's own surface is ours: Shiki tries to pass its dark background as
`#fff;--shiki-dark-bg:#24292e`, a value React drops whole, so `index.css` defines
`--shiki-dark-bg` from a `--code-surface` token instead.

The root `tsconfig.json` explicitly **excludes** `apps/chat-ui` and `apps/docs` (JSX / Astro virtual
modules don't resolve under the workspace options); those apps type-check via their own configs.

### Docs

Prose is MDX under `apps/docs/src/content/` — note **not** `src/content/docs/`; `content.config.ts`
overrides Starlight's loader base for that reason. New pages must also be added to the explicit
`sidebar` in `astro.config.mjs` (autogenerate is off). `src/styles/theme.css` is checked in but
generated from `@felix/design`'s `starlightThemeCss()` — change the tokens in
`packages/design/src/tokens.ts` and run `pnpm sync:theme`. Hand edits to the CSS are blocked by a
hook, because the next regeneration would silently revert them.

## Claude Code toolkit

`.claude/` carries project agents, skills, rules, and hooks. **`.claude/README.md` is the index**;
the `toolkit-authoring` skill is how to extend it.

- **Skills** (`/name`): `preflight` (verify), `code-quality` (quality sweep), `branch-pr-workflow`,
  `api-contract-change`, `add-ui-primitive`, `docs-sync`, `deploy-runbook`, `python-harness`,
  `postgres-migration`, `threat-review`, `toolkit-authoring`. They follow the
  [Agent Skills](https://agentskills.io) spec.
- **Subagents**: `workers-engineer`, `ui-engineer`, `python-harness-engineer`, `postgres-engineer`,
  `devops-engineer`, `test-engineer`, `refactor-engineer`, `code-reviewer`, `security-reviewer`,
  `code-quality-reviewer`, `dx-engineer`, `felix-docs-writer`. The three reviewers are read-only by
  design.
- **Hooks that can block you**: `block-generated.sh` (edits to generated files and build output),
  `block-main-commit.sh` (commits on `main`, direct pushes to `origin main`), and `stop-gate.sh`
  (once per session, when documented surfaces changed and no docs did). Others are advisory:
  `format-touched.sh` runs Biome on files you edit — **re-read a file after editing it**, because
  the copy in your context may be stale — and `impact-reminder.sh` names the counterpart file for
  the duplicated surfaces below.
- Editing `.claude/settings.json` needs a session restart; skills, agents, and rules hot-reload.

## Conventions & gotchas

- **Git: never commit to `main`; never stack PRs.** Every change goes on a `<type>/<slug>` branch and
  a PR into `main`, and merging is the human's call. Enforced by `.claude/hooks/block-main-commit.sh`;
  full procedure in the `branch-pr-workflow` skill and `.claude/rules/git-workflow.md`.
- **Deploy config is local-only.** `apps/chat-ui/wrangler.jsonc` is gitignored; the app ships a
  tracked `wrangler.example.jsonc` to copy. `apps/docs/wrangler.jsonc`
  is tracked because it holds no ids. `vars` is public — only `FELIX_ORIGIN` belongs there; secrets
  go through `wrangler secret put`.
- Biome, not ESLint/Prettier: single quotes, semicolons, trailing commas, 2-space indent, 100 cols.
  `noExplicitAny` is a warning; a11y rules are relaxed under `packages/ui/src` and
  `apps/chat-ui/src/components`.
- **Shared dependency versions live in `pnpm-workspace.yaml` under `catalog:`.** Anything used by
  2+ workspace packages is declared once there and referenced as `"catalog:"` in each `package.json`;
  a single-use dep keeps its literal version where it is. Bump a shared version in the catalog, not
  in a manifest. Note that `pnpm add` writes a **literal** version even for a package already in the
  catalog (pnpm's default `catalogMode: manual`) — fix it to `"catalog:"` by hand. See `README.md`.
- Node ≥ 20, pnpm 10.33.2 (`packageManager` pinned). React 18, Tailwind v4 (CSS-first, no config file).
