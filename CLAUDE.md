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
| `apps/tui` (`@felix/tui`) | Full-screen terminal chat client (Ink → Node) |
| `apps/docs` (`@felix/docs`) | Starlight docs site → Workers static assets |
| `packages/ui` (`@felix/ui`) | shadcn/ui primitives, consumed as raw `.tsx` source |
| `packages/felix-protocol` (`@felix/protocol`) | The wire contract — SSE reader + shared types |
| `packages/felix-client` (`@felix/client`) | Headless chat client — transport, transcript model, the one `StreamEvent` switch |
| `packages/cowork-client` | Browser VFS, File System Access mount, client-side tool executor |
| `packages/test-kit` | Reusable behavioral suites — the proxy Worker contract and the SSE reader |
| `packages/design` | Neutral palette + theme-CSS builders (docs theme is generated from these) |
| `packages/typescript-config` | Shared tsconfig bases |

## Commands

```bash
pnpm install
pnpm chat:dev          # Vite :5173 — /api/* proxied to Python Felix on :8080
pnpm tui:dev           # terminal client, straight to FELIX_ORIGIN (default :8080)
pnpm docs:dev
pnpm build             # turbo run build (tsc -b && vite build; astro build)
pnpm lint              # turbo → biome check
pnpm format            # biome format --write
pnpm check-types       # turbo → tsc --noEmit
pnpm test              # turbo → vitest (cowork-client, chat-ui)
pnpm check-api-drift   # client routes vs the committed harness OpenAPI snapshot
pnpm check-protocol-parity  # SSE events: every arm handled, every emitted event modelled
pnpm check-tailwind-sources # every @source-covered tree still reaches the compiled CSS
pnpm check-payload-shapes   # every required client field is one the harness actually sends
pnpm sync:harness [path]    # re-record all three contract files from a harness checkout
pnpm --filter @felix/chat-ui <script>   # scope to one package
pnpm dlx shadcn@latest add <name> --cwd packages/ui   # add a shared primitive
```

Local dev needs the Python harness running separately (`make up && make migrate` in felix-run/felix
→ `:8080`). Without it, the app loads but every `/api/*` call fails.

**Test coverage is partial, and knowing where it stops matters.** `pnpm test` covers the VFS and
the File System Access mount (`packages/cowork-client`), the SSE reader (one implementation in
`@felix/protocol`, exercised through chat-ui's `streamChat`), and the proxy Worker — the last two via
parameterized suites in `@felix/test-kit`, which are the contract those surfaces are held to.
`@felix/client` covers the run loop at the wire: frames into `applyEvent`, transcript out, including
the three blocking frames, plus the log-to-transcript rebuild, the reattach loop and the tool-card
matching. `@felix/tui` covers what a terminal adds on its own: config precedence, the markdown
splitter, the prompt-history file's cap and self-healing, the attention signals' focus gate, the
editor round trip, and the workspace executor's containment and settle guarantees — **not** its Ink
components, which are verified by running it. The **one** exception is
`tests/composer.test.ts`, which renders the real composer against real Ink because the behaviour it
pins — focus reports never reaching the prompt, and a paste arriving as one line that still waits for
enter — is either invisible while you are looking at another window or a keystroke sequence no
hand-run reproduces reliably. Two things about Ink 7 that tests there depend on: it reads stdin in
paused mode, and a chunk carrying both text and Enter arrives as one `useInput` call with
`key.return` **false**. React coverage reaches the thread store, the theme provider, `usePoll`, the presence
signals, the Gate, the history rail's per-thread actions, and the chat surface end to end
(`tests/app-stream.test.tsx` drives the real `App` with a stubbed `fetch`). `tests/composer.test.tsx`
covers what typing *costs*: a burst of keystrokes must not drive React past its update-depth limit,
which is a real failure mode here and not a theoretical one. **The inspector panels, and the
composer's slash menu, are still verified by running them.**

One thing that bites when verifying by hand: `usePoll` skips ticks while the tab is **hidden**, and a
browser driven by automation reports `visibilityState: 'hidden'`. An inspector panel will sit on
stale data forever under a driver, which looks like a broken refresh and is not. `.claude/hooks/tests/` covers the hooks.

Three mechanical guards cover the hand-mirrored wire contract, one per direction it can drift.

`pnpm check-api-drift` walks the fetch call sites in `apps/chat-ui/src/api.ts` and
`packages/felix-client/src/transport.ts` — including the ones that deliberately bypass the
401-handling wrapper — and diffs path *and* verb against
`apps/chat-ui/harness-openapi.json`, a committed record of what the harness serves. It catches a
route the harness renamed or dropped; it cannot catch a call that hits a real route for the wrong
purpose, and it says nothing about payload shapes. It also prints, advisory only, the routes the
harness serves that nothing calls — the direction where a whole unbuilt feature shows up.

`pnpm check-protocol-parity` covers the events, in **both** directions: every `StreamEvent` arm must
have a handler in `packages/felix-client/src/engine.ts` — the one switch every client runs — and
every event `scripts/harness-events.json` says the harness emits must have an arm. The second is the one that drifts, because the harness moves independently and the union's open
arm swallows anything it gains — an event nobody models compiles, lints, and does nothing. Handler
gaps that predate the check are grandfathered in `scripts/protocol-parity-baseline.json` as a
one-way ratchet (`--update` banks a fix); an unmodelled event is never grandfathered. Both halves
compare event *names* only — neither can tell you a handler is wrong, just that one exists.

`pnpm check-payload-shapes` covers the third direction, the one the other two are blind to: the
*shape* of a response. Drift compares paths and verbs; parity compares event names; neither reads a
field. Nor can the OpenAPI snapshot — every harness route returns a bare `dict`, so FastAPI
documents all 78 JSON responses as `additionalProperties: true` and the only component schemas in
the spec are the 31 *request* models. The response side of the contract exists solely as dict
literals in the harness's `felix/<area>/store.py` modules, which `scripts/harness-payloads.json`
records. A **required** client field that no serializer sends fails; an **optional** one is fine,
because `?` is the client saying it copes. That distinction is the whole check: `AuditEvent.payload`
was `undefined` on every row the harness ever returned — the wire spells it `payload_json` — and it
typechecked, linted, and passed drift while the Activity feed rendered the manifest's name once per
row. Fields the harness sends that nothing models are advisory. A guarded type naming a serializer
the record does not carry **fails**, including one the recorder listed as `unreadable` (a dict built
imperatively has no literal to read) — a guard that silently checks nothing is worse than none.

**All three records are regenerated together, from a harness checkout, by
`node scripts/sync-harness-contract.mjs [path]`** — never by curling a running harness. That records
the deployment, not the contract; on 2026-08-24 the local container was two features behind and the
snapshot silently omitted `/memory/*` and `GET /chat/stream/{thread_id}`. FastAPI builds the spec
without a database, so nothing needs to be running.

A guard of a different kind covers the stylesheet, which fails in the same silent way for another reason.
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
`packages/felix-client/src/engine.ts`, or it is indistinguishable from an event that never arrives.

**The conversation itself is `@felix/client`, not the app.** `createChatEngine` owns the frame
switch, the transcript, the durable-run and reattach paths, and the approval queue; `App.tsx`
mirrors its state with `useSyncExternalStore` and renders. `createFelixClient` owns the chat REST
calls with the origin and credentials injected — `/api` plus `x-chat-key` for a browser that cannot
reach the harness directly, a real origin plus a bearer token for anything that can. Nothing in the
package touches storage, the DOM, or notifications. `apps/chat-ui/src/api.ts` supplies the browser's
half of that arrangement and keeps the management routes (audit, memory, eval, jobs, manifests,
plans, usage), which only chat-ui reads; `src/types.ts` re-exports both packages and declares those
management shapes.

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
- **Redundant state updates are not free.** The composer cleared a "slash menu dismissed" flag from
  an effect keyed on the text, so every keystroke set state — usually to the value it already held.
  React bails out of those but still counts them, so typing fast enough (a paste, a quick typist)
  reached the nested-update limit: a warning on React 18, a **thrown exception** on 19, and dropped
  characters either way, with nothing on screen to say the message that reached the model was not
  the one that was typed. Derive from the text rather than storing a flag an effect has to reset.

  The same churn had a second, quieter cost. `useSpeechRecognition` listed that per-keystroke
  callback as a dependency, so the live recognition session held whichever copy existed when the mic
  was clicked — and it reads the textarea's contents. Dictating after typing appended to the text as
  it stood at mic-click and **discarded everything typed since**. A callback a long-lived listener
  fires belongs in a ref: it costs nothing per render and cannot go stale.

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
- **Spilled tool outputs** — a manifest with `artifacts.enabled` replaces any oversized tool result
  with a preview plus `[artifact:<id> key=… chars=N]`, and the rest lives in the object store.
  `parseArtifactMarker` in `@felix/protocol` reads that reference off the end of a tool output (only
  the end: one quoted mid-text is a tool *talking about* an artifact) and the tool card fetches
  `GET /artifacts/{manifest_id}/{artifact_id}` on request. The tenant is in the key and is
  deliberately not a parameter — the harness takes it from the caller's credentials.
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

### The terminal client

`apps/tui` is the same conversation without a browser, and the differences are all about what a
browser cannot do rather than about the chat:

- **No proxy, no shared key.** `/api/*` and `x-chat-key` exist because a page cannot reach the
  harness (no CORS, no static assets). This process calls `FELIX_ORIGIN` directly with
  `Authorization: Bearer`, resolved by `src/config.ts` narrowest first: flag, environment, the
  checkout's `apps/chat-ui/.dev.vars`, then `~/.config/felix/config.json`. `.dev.vars` is in that
  list on purpose — it is the repo's *one* local secrets file, and a second client ignoring it made
  that three. It is found from the module's own path, never by walking up from `cwd`, which would
  read whatever credentials an unrelated parent directory happened to hold.
- **Client tools hit the real filesystem** — the one surface here where the *model* drives the
  user's disk. `src/workspace.ts` answers `tool_request` against `process.cwd()`. Every path goes
  through `resolveWithin`, which compares **real** paths and refuses a *broken* symlink outright:
  a dangling link has no real path, so an earlier version walked past it and wrote wherever it
  pointed. Writes also refuse `.git/`, `.husky/`, `node_modules/` and any existing executable —
  in-root paths where writing a file means running a command — and otherwise wait on a prompt
  showing the **absolute** target. `confirm` is a required option, so a caller cannot get a silent
  writer by omitting it; `--yes` is a confirm that always agrees. Reads are *not* confirmed, which
  is the stated trade of running against a real cwd.
- **Every request settles, and nothing outlives its turn.** `settleClientTool` in `@felix/client` is
  the shared deadline. It resolves what the engine awaits but cannot cancel the work, so the write
  prompt carries its own shorter deadline and is cancelled on abort — otherwise a `y` pressed after
  the timeout still writes, long after the model was told the tool failed.
- **One prompt owns the keyboard.** Ink delivers every keypress to *every* mounted `useInput`, so two
  banners on screen means one `y` answers both — a local write and a gated harness-side tool. `App`
  renders exactly one. The same rule is why the composer is disabled while the thread rail has focus:
  otherwise `↑` would recall a prompt *and* move the rail cursor, and `enter` would send a message
  *and* switch threads.
- **Looking away is a state.** `src/attention.ts` puts *working* / *blocked* / *idle* in the window
  title (always) and behind an `OSC 9` notification (only once the terminal has reported losing
  focus) — the terminal's half of chat-ui's `presence.ts`, states and messages matched. Focus comes
  from `DECSET 1004`, and **the reports arrive as input**: Ink 7 hands `ESC [ I` / `ESC [ O` to
  `useInput` as the plain text `[I` and `[O` with no key flags, so an unfiltered composer reads
  `[Ohello[I` after you tab away and back. `isFocusReport` is that filter, and it works because the
  module's own `data` listener sees the raw bytes first: Ink 7 reads stdin in **paused** mode
  (`readable`, then `read()`), and `read()` emits `data` synchronously, so the report is recorded
  before the same chunk reaches `useInput` as text. The reports are *input*, which costs a second
  time: the request for them is written from an `App` effect (`begin`/`end`), never at construction,
  because until Ink has raw mode on the tty **echoes** the terminal's reply and a literal `^[[I` is
  printed into the first frame, where it stays for the session.
- **A paste is not typing, and not a send.** `usePaste` puts the terminal into bracketed paste mode,
  so the text arrives whole on its own channel — without it Ink hands the chunk to `useInput` with
  the newlines still in it and no `return` flag, which is how a pasted paragraph used to land in the
  message as control characters and never send. `flattenPaste` joins the lines with spaces (both
  paths: a terminal that ignores bracketed paste still sends the text raw), and enter is still
  required, because what reaches the model has to be what was read on screen.
- **`ctrl+e` is the only way to write a paragraph.** The composer is one line with no cursor;
  `src/editor.ts` runs `$VISUAL`/`$EDITOR` on a temp file inside Ink's `suspendTerminal`, which
  hands over the terminal and restores it even if the callback throws. An unchanged or emptied file
  returns nothing rather than sending an empty message.
- **The commands are the client's whole surface.** `@felix/client` reaches every chat verb the
  harness serves; a slash command is the only thing that exposes one here, so a verb with no `case`
  in `command()` — rename, fork, compact, export, rewind, search — is a verb this client does not
  have. `/rewind` hydrates first because `Turn.eventId` is only ever set from a snapshot.
- Threads live in `$XDG_STATE_HOME/felix`. Ink redraws the whole tree per frame, so the transcript
  renders only its tail.
- No build step for `dev` (`tsx`); `build` is `vite build --ssr`, which inlines the raw-TS workspace
  packages and externalises ink/react.
- `apps/tui` declares `node >= 22` — Ink's floor, and what CI already runs. Ink also requires
  React ≥ 19.2, which is now the whole workspace's version; for one release it was not, and the
  split lived in a second *named* catalog until chat-ui could follow.

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

**Streamdown's rendered markup is an interface here.** Assistant messages go through it,
and the app has opinions about two parts of the result, styled two different ways for one
reason. Lists it *owns*: `components/chat/response.tsx` overrides `ul`/`ol`/`li`, because the
renderer's `list-style-position: inside` flattens nesting and wraps long lines under their own
markers, and because a component the type checker sees beats a selector aimed at someone
else's DOM. The code block's chrome it cannot own — taking over `pre` means giving up Shiki —
so those rules stay in `index.css` aimed at `[data-streamdown="code-block*"]`, and
`tests/response.test.tsx` reads those selectors back out of the stylesheet and asserts each
one still matches something rendered. That is the failure this repo keeps meeting: a rule that
compiles, matches nothing, and reports nothing. The dependency is pinned **exactly** in the
catalog for the same reason — a caret took it from 1.3 to 1.6 unannounced.

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
