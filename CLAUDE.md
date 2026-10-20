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
| `apps/tui` (`@felix/tui`) | Full-screen terminal chat client (OpenTUI → Bun) |
| `apps/docs` (`@felix/docs`) | Starlight docs site → Workers static assets |
| `packages/ui` (`@felix/ui`) | shadcn/ui primitives, consumed as raw `.tsx` source |
| `packages/felix-protocol` (`@felix/protocol`) | The wire contract — SSE reader + shared types |
| `packages/felix-client` (`@felix/client`) | Headless chat client — transport, transcript model, the one `StreamEvent` switch, plus the read-only management reads |
| `packages/cowork-client` | Browser VFS, File System Access mount, client-side tool executor |
| `packages/test-kit` | Reusable behavioral suites — the proxy Worker contract and the SSE reader |
| `packages/design` | Neutral palette + theme-CSS builders (docs theme is generated from these) |
| `packages/skill-format` (`@felix/skill-format`) | The harness's SKILL.md bundle rules in TS, for live validation in the skill editor; the harness stays authoritative |
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
pnpm test              # turbo → vitest (cowork-client, chat-ui); bun test (tui)
pnpm check-api-drift   # client routes vs the committed harness OpenAPI snapshot
pnpm check-api-drift:live [origin]  # …vs a running deployment (FELIX_API_KEY; not in CI)
pnpm check-protocol-parity  # SSE events: every arm handled, every emitted event modelled
pnpm check-tailwind-sources # every @source-covered tree still reaches the compiled CSS
pnpm check-payload-shapes   # every required client field is one the harness actually sends
pnpm sync:harness [path]    # re-record all three contract files from a harness checkout
pnpm sync:brand             # re-render favicons, touch/PWA icons, docs logo + social card (needs rsvg-convert, magick)
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
matching. `@felix/tui` covers what a terminal adds on its own: config precedence,
the prompt-history file's cap and self-healing, the OSC 52 clipboard's four outcomes, the attention signals' focus gate, the
editor round trip, the thread rail's scroll window, and the workspace executor's containment and
settle guarantees — **and, since `tests/render.ts`, its rendered components too, plus `app.tsx`
itself.** Every one of them
mounts on a renderer that writes to memory rather than a tty, so what is asserted is the frame:
`transcript.test.ts` on the tool card's two states and on what the markdown stripper does to
emphasis, `rails.test.ts` on the rail's window at a cursor thirty rows down and on a status line
that must never wrap, `prompts.test.ts` on all three blocking banners and the keys that answer
them, `composer.test.ts` on the keystroke sequence no hand-run reproduces reliably — a paste that
submits itself halfway through when the terminal does not bracket it, and shift+Enter opening a
line rather than sending.

The app's own three are worth knowing about separately, because they cover the rules that are
easiest to break from outside the file that holds them. `app.test.ts` mounts the real `App` over a
stubbed `globalThis.fetch` — the one seam, since everything else `App` needs is injected — and the
double records requests rather than only answering them, so `/think high` is pinned to the field
name the harness reads and not to a notice that says the right thing while sending nothing.
`keys.test.ts` drives `route()` from `src/keys.ts`, which is the precedence chain as a pure
function: **`preventDefault()` does not stop another global handler** — it gates only the focused
renderable — and a child's `useKeyboard` runs before its parent's, so what actually keeps the app
off the keyboard while a run waits on a person is the `blocked` early return. Anyone adding an
overlay will walk past that guard; these fail when they do. `write-gate.test.ts` covers the prompt
between the model and the disk: that it always settles, that a second request refuses the first
rather than orphaning its resolver, and that its own deadline fires before the executor's so a `y`
pressed too late cannot still write. **`apps/tui` runs its whole suite under `bun test`**, not Vitest: the package is
Bun-only, so a second runner for the pure half bought nothing but a second test directory. Bun maps a
`vitest` import onto its own runner, which is why the suites moved across untouched — but they import
`bun:test` now, because an import naming a runner that does not run them is a lie the next person
pays for. Two gaps in Bun's shim to know: `vi.advanceTimersByTimeAsync` does not exist (advance
synchronously, then await the promise), and `toHaveBeenCalledOnce` runs but is not typed. React coverage reaches the thread store, the theme provider, `usePoll`, the presence
signals, the Gate, the history rail's per-thread actions, the error reporter every failed
call goes through (`tests/error-toast.test.tsx` pins the translated message, the kept raw
detail, that errors do not dismiss themselves, and that Retry appears only when a caller
says re-running is safe), and the chat surface end to end
(`tests/app-stream.test.tsx` drives the real `App` with a stubbed `fetch`). `tests/composer.test.tsx`
covers what typing *costs*: a burst of keystrokes must not drive React past its update-depth limit,
which is a real failure mode here and not a theoretical one. It also pins what a *refusal* costs.
`PromptInput` clears the composer whenever `onSubmit` resolves and keeps the text only when it
throws, so every guard that returned early destroyed the message it was about to explain. The
over-limit case only reproduces mid-run: `SendOrStop` swaps the submit button for a `type="button"`
Stop while streaming, so PromptInput's own Enter guard has no disabled button left to find. **The inspector panels, and the
composer's slash menu, are still verified by running them.**

One thing that bites when verifying by hand: `usePoll` skips ticks while the tab is **hidden**, and a
browser driven by automation reports `visibilityState: 'hidden'`. An inspector panel will sit on
stale data forever under a driver, which looks like a broken refresh and is not. `.claude/hooks/tests/` covers the hooks.

Three mechanical guards cover the hand-mirrored wire contract, one per direction it can drift.

`pnpm check-api-drift` walks the fetch call sites in `apps/chat-ui/src/api.ts`,
`packages/felix-client/src/transport.ts` and `packages/felix-client/src/management/*.ts` —
including the ones that deliberately bypass the
401-handling wrapper — and diffs path *and* verb against
`apps/chat-ui/harness-openapi.json`, a committed record of what the harness serves. **That file
list is explicit and the script does no discovery**, so a new module of routes that is not added to
the `check-api-drift` script in `package.json` is simply not walked — the check keeps printing
`✓ no drift` while covering fewer calls than it did. Compare the call-site count, not just the exit
code. It catches a route the harness renamed or dropped; it cannot catch a call that hits a real
route for the wrong purpose, and it says nothing about payload shapes. It also prints, advisory only, the routes the
harness serves that nothing calls — sometimes the direction where a whole unbuilt feature shows up,
and sometimes just a duplicate. **An uncalled route is not evidence of a missing feature.**
`POST /eval/runs` sat on that list while `/harness/eval` had started runs all along, through
`POST /eval/datasets/{name}/run` — a second harness route whose docstring reads "Alias for chat-ui".
A list built from call sites cannot tell the two apart, so check the harness for an alias before
building anything it suggests.

**`pnpm check-api-drift:live [origin]` asks the other question: not "does the client match the
contract" but "does it match *this deployment*".** The record is only as current as the last sync,
so a deployment older than it passes the default check while every call to a route it lacks 404s.
It fetches `<origin>/openapi.json` (default `FELIX_ORIGIN`, then `http://localhost:8080`) with
`FELIX_API_KEY` from the environment or `apps/chat-ui/.dev.vars`, fails on a client call the
deployment does not serve, and lists — advisory — the recorded routes it lacks and the ones it has
that the record does not, with both versions. Exit 2 means it could not ask (unreachable, or a key
it refused). It never writes the record, for the reason below: a deployment is not the contract.
It is not in CI, which has no harness to ask.

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
That rule is also why a new area is guarded harness-first: `/documents` returned dataclasses and
built its wire dict inline in each route, so nothing could be recorded and nothing could be guarded
until the shape moved into the store (`felix-run/felix#213`).

All three are **excluded from Biome** in `biome.json`. `pnpm format` reformats JSON, and these are
generated files whose own `$comment` says not to hand-edit them — so formatting them produced a diff
the next sync silently reverted, twice in one session before anyone noticed. A reformatted record is
one nobody re-reads. `.impeccable/design.json` is excluded for the same reason and was invisible
until it wasn't: Biome runs with `vcs.useIgnoreFile`, so that file only came into scope on the day
`.impeccable/` stopped being ignored. Anything generated that leaves the ignore file needs the
exclusion in the same commit.

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

A fifth guard covers the one duplication that is *correct* and still drifts. The run-state ramp —
`blocked` / `done` / `running` / `failed` — is authored as `oklch()` in `apps/chat-ui/src/index.css`,
where the lightness is tuned for contrast and the comments say why, and frozen as sRGB hex in
`packages/design/src/tokens.ts` because neither a terminal nor `RGBA.fromHex` takes `oklch()`.
`pnpm check-state-palette` converts the first to the second and asserts they match, so a change to
one without the other fails rather than showing as the two clients painting a state differently.
It **checks rather than generates**, which is the opposite call from `sync:theme`: there the tokens
are the authored form, here the stylesheet is, and generating the authored form out of the derived
one would discard the reasoning and make the tokens look like a source of truth they are not.

CI (`.github/workflows/ci.yml`) is one `verify` job: `pnpm install --frozen-lockfile`, then lint,
check-types, API drift, protocol parity, Tailwind sources, state palette, payload shapes, build
(chat-ui, docs), tests, then the hook tests — each step runs even if an earlier one fails, so one
red run reports everything. Verification of app behavior still
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
- **A browser's own bearer stands in for the key** — the token from the harness's GitHub login
  (`src/lib/github-login.ts`, the device flow, no redirect). The Worker forwards it untouched, skips
  `CHAT_UI_KEY` and injects nothing, **only while `GET /auth/methods` says `bearer_required`**,
  asked once per isolate and failing closed. Under `FELIX_AUTH_MODE=none` the harness accepts any
  bearer, so without that check `Authorization: Bearer x` was a way past the deployment's only
  lock. `GET /auth/methods`, `POST /auth/github/{device,token}` pass with no credential at all.
- `src/lib/auth.ts` holds **one** credential, key or session, never both: storing one clears the
  other, because the Worker would honour the key and silently run the person as the deployment.
  The gate offers GitHub when `/auth/methods` does, and the key only when the Worker's own 401
  says `gate: 'chat_key'` — a harness 401 is not answered by any key. The session lapses with no
  refresh and no revocation, so the header's account chip (`components/account-chip.tsx`) renews
  in a popover with the shell still mounted, and its Sign out says the token outlives it.
  `/harness/github` offers the same sign-in wherever it says one is needed (2026-10-16: it said so
  under the shared key and offered nothing) — redirect when offered, else the code in place, and
  only while `bearer_required`; from the key or a Google session it forgets `felix.tabThread` and
  reloads, since the new tenant may not hold the thread (`SignInWithGitHub` in `harness/github.tsx`).
- In `vite dev` the Worker is not in the loop, so the `CHAT_UI_KEY` gate is skipped entirely.
- **A cross-site write is refused** (403 `cross_site_request`) before any of the above: any method
  but GET/HEAD with `Sec-Fetch-Site: cross-site`, or an `Origin` that is not the Worker's own.
  The Worker injects `FELIX_API_KEY` itself, so without this a plain form post from another site
  arrived upstream as the deployment. A request with neither header is no browser's and meets
  the key gate as before. `vite.config.ts` mirrors it in a middleware ahead of the proxy, since
  the dev proxy injects the dev key the same way.

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
switch, the transcript, the durable-run and reattach paths, and the approval queue;
`src/app-shell.tsx` mirrors its state with `useSyncExternalStore` and renders. `createFelixClient`
owns the chat REST calls with the origin and credentials injected — `/api` plus `x-chat-key` for a browser that cannot
reach the harness directly, a real origin plus a bearer token for anything that can. Nothing in the
package touches storage, the DOM, or notifications. `src/management/` holds the **read-only** half
of the harness's operator surface — audit, usage, memory, plans, artifacts — composed onto the same
client so a terminal can ask why a run did what it did; those routes were browser-only by accident
rather than by design. The one exception is `management/skills.ts`, the tenant skill library
(`/skill-library`), which has its full write surface there too — reviewing what an agent drafted is
the point of it. Its refusals are thrown as `SkillLibraryError` carrying the parsed `{error, message,
issues?, reasons?}`, because a 409 is a merge (`parent_changed`) or a rename (`skill_exists`) and a
422 a bad bundle or a refused publish; writes measure their JSON body against the harness's 1 MiB
cap before sending.

**chat-ui's shell — routing, the three zones, the sidebar, the instrument, `/harness` — and its
attention line, rendering pipeline, AI Elements and side pane are in `apps/chat-ui/CLAUDE.md`**,
which loads when you work under `apps/chat-ui`. Read it before touching the shell.

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
  chunks). Deltas append to the current turn (`on_chat_model_stream` only until a `text_delta` has
  been seen: an older harness's composite patterns sent every chunk under both names); tool frames
  become inline tool cards, matched to their card by id **and** name, because a client tool's
  `tool_start` and `tool_request` share the call's id;
  usage arrives on `done` (`felix-run/felix#399`) as the final model call's block — never on
  `on_chain_end`, whose `output` reaches the wire as a Python repr string. `input` there is the
  **uncached** prompt only, so anything showing tokens goes through `promptTokens`; reading
  `input` drew `3 in` for a 1,035-token call. `Turn.usage` is the turn's spend and is dropped
  for a turn that ran tools (the final call is one step of it); `Turn.contextTokens` is how full
  the window was and is kept either way, because the final call's prompt held the whole branch.
  The composer's context meter reads that against `/v1/models`' `contextWindow` for the
  *selected* agent, and below `sm` it yields to the agent picker unless the window is ≥90% full.
- **iPhone and iPad are real targets, and Safari is the browser that differs.** The shell is
  `h-[var(--vvh,100dvh)]` — `h-screen` is the large viewport on iOS and put the composer under
  the toolbar — and `src/hooks/use-visual-viewport.ts` sets `--vvh` only while a field has focus
  and the on-screen keyboard has shortened the visual viewport, because Safari pans the page
  rather than resizing it. `viewport-fit=cover` and the `*-safe` utilities in `index.css` go
  together: one without the other either letterboxes or puts controls under the notch. The
  bottom inset reads `--safe-bottom`, which drops to 0 under `data-keyboard`, since Safari keeps
  reporting the home indicator beneath the keys. Enter in the composer is decided by
  `enterAction` in `prompt-input.tsx`: newline on a coarse pointer until a hardware-only key
  (a modifier, an arrow, Tab, Escape) has been seen, send otherwise, ⌘/Ctrl+Enter always sends.
  `tests/touch-viewport.test.tsx` pins those three; insets, Safari's scroll on focus and the
  keyboard itself are only verifiable on a device.
- **The transcript scrolls by turn, not by the bottom edge** (`components/chat/conversation.tsx`,
  on `@felix/ui/message-scroller`). An operator turn is a scroll anchor: sent, it lands near the
  top and the reply grows below; the view follows the stream only while the reader is at the live
  edge. Three rules that are easy to break from `routes/workbench.tsx`. **The greeting is not a
  row**: the scroller applies its opening position when rows first appear, and treats rows added
  after that as new messages, so a counted greeting made a loaded thread arrive as "just sent" and
  open on its first question. **Rows are named by position** (`turn-<i>`), not by turn id, because
  a snapshot rebuild can re-mint ids, and the same transcript under new ids reads as a page of new
  anchors. **Rows are drawn in full** (`[content-visibility:visible]`): with the primitive's default
  off-screen placeholders, the opening jump to the newest question was measured against a long
  reply's 10rem stand-in and missed by ~900px at 1440. `OpenAtLastAnchor` makes that opening jump
  itself, because a cached thread has rows on the first render, before the scroller's own default
  can apply. `tests/conversation.test.tsx` pins the anchors and the full-height rows. **The
  spacer is `-mb-0.5`** (`spacerClassName` in `conversation.tsx`): the primitive sizes it from
  `clientHeight` — the viewport's height *rounded* — and `Math.ceil`s it, so a fractional viewport
  made content up to ~1.5px taller than itself and every short thread drew a near-full scrollbar
  thumb for a 1px scroll (666 over 665). Measured after: 695/695 and 841/841 at 1000 and 1101px.
  **One reply, one label** (2026-10-16): the log keeps a message that both spoke and called a tool
  as its own event, so a rebuilt reply is often two assistant turns, and each drew "Felix". The
  workbench passes `continues` to an assistant turn straight after another and `Message` drops
  the name; the rows stay one per turn, so the position naming and the anchors are untouched
  (`tests/one-reply-label.test.tsx`).

  Three more were found only against a live harness (2026-10-03), where a thread opens from the
  local cache and is then rebuilt from the snapshot. **The viewport is `overflow-anchor: none`**:
  the browser's scroll anchoring locked onto a node in the reply and dragged the view down as it
  streamed, taking the question just anchored off the top (80px → -381px, no input). **The row is
  keyed by position, the message inside it by turn**: the scroller remembers which anchors it has
  handled *by DOM element*, so a rebuild that re-minted turn ids re-created every row and it jumped
  to the first anchor. **The opening position is held while the thread settles**: rows above the
  question keep growing after the jump (the rebuild, late highlighting), and with the browser's
  anchoring off nothing compensated — the question slid ~6,000px down. `OpenAtLastAnchor` moves the
  viewport by the drift on every content resize until the reader scrolls, touches, presses a key
  or the content is still for 1.5s. For a message just sent it holds the scroller's own placement
  rather than re-aiming, so the previous turn still peeks above it.

  Two more from a critique pass (2026-10-17). **The jump to the latest reply has a strip of its
  own** (`data-slot="conversation-jump"`, `h-10` under the viewport, `h-0` on an empty thread):
  floating bottom-centre it covered whatever was there — a plan step at 390px, a workspace note,
  the tokens line — and only while there was more below, i.e. while someone was reading. Padding
  the content cannot fix that, because the button shows only away from the end, where the padding
  is off screen. **A View change keeps the reader's place** (`KeepPlaceAcrossViews`): each level
  adds or removes lines inside turns, so the height above the reader changed and the view landed
  elsewhere. The place — the deepest elements near the viewport's top on the column's centre line,
  then their row — is recorded on every scroll; after the change commits the viewport moves by the
  drift and holds for 600ms, unless the reader takes over. It dispatches `felix:hold-release` on
  the viewport first, which `OpenAtLastAnchor` counts as the reader taking over, so the two never
  pull against each other. `tests/conversation.test.tsx` pins both. **Debug folds long tool I/O**:
  debug opens every card and draws every plan call, so a plan-heavy turn was screens of JSON. A
  card's input or output over 12 lines (`DEBUG_FOLD_LINES` plus a slack of four, so a fold never
  hides one line), or 960 characters, is clipped to ~8 lines under a fade with *Show all N lines* (`tests/tool-card.test.tsx`); outside debug the
  ordinary scrolling cap is unchanged.
- **`shimmer` and `scroll-fade-*` are vendored** into `src/chat-utilities.css`, not imported from the
  CLI package's `tailwind.css`, which also redefines `data-open`, `data-checked` and the other
  `data-*` variants this app uses with their plain Tailwind meaning. Pair `shimmer` with
  `shimmer-color-foreground` on muted or state-coloured text, so the sweep only brightens.
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
- **A durable stream can end without `final`.** `POST /chat/stream` emits `run_accepted` (carrying
  `resume_token`), then `run_status` on each change, then `final` — but only when the run reaches
  `completed`; any other terminal status yields a typed error frame instead, and the API's own
  deadline can close the stream with the run still going. So the engine treats an unsettled
  `resumeToken` after a **clean** stream end the same as after a dropped one: it polls
  `GET /chat/runs/{token}`. `resumeToken` is exactly the right tell — set by `run_accepted`, cleared
  only by `final`. Without that check the turn sits on `Background · running…` for the life of the
  tab while the run finishes behind it, taking the answer and the tool cards with it. Both settle
  paths, plus the `POST /chat` background path, call `EnginePorts.onDurableComplete`, which chat-ui
  wires to `hydrateFromServer`. The stream does carry the run's work — `session_event` frames,
  whole messages tailed from the session log — but not everything the snapshot holds (labels,
  ratings, the leaf), so the thread is re-read once at the end. Hydrating there is safe
  **because** the in-flight turn was built from those same logged events rather than from
  deltas: a snapshot rebuild has no local detail to discard, which is not true of an ordinary
  run, and is why the callback never fires for one.
  **The poll ends on the harness's terminal set, and a reload rejoins** (2026-10-08). On a
  production `cowork` thread the stream closed at the run's 300s deadline with
  `run_expired:<token>`, which the engine showed as the error while the run went on; the poll then
  ran forever, because `expired` was not one of the four statuses it stopped on; and a reload had
  no way back to the run — the snapshot reads `idle` while a durable run works, and no route lists
  a thread's runs — so the next message started a **second run on the same thread**, which the
  harness does not refuse. `isDurableRunOver`/`durableRunFailure` (`@felix/client`,
  `durable-runs.ts`) are the terminal set and the sentence for a run that ended with no answer;
  `run_expired:` with a token in hand is not an error; a failed poll read is retried, a 404 ends
  it. `onRunAccepted`/`onRunSettled` let chat-ui keep the token per thread
  (`src/lib/durable-runs.ts`, `localStorage`), and `loadThread` calls `engine.rejoinRun`, which
  marks the thread streaming — so the composer queues — polls, and settles as `send` does.
  **While it polls it holds the thread's reattach stream open** (`reattachThread({ holdOpen })`,
  2026-10-08, `felix-run/felix#534`): the poll carries no frames, and since #534 the reattach
  stream announces what the run is blocked on — its client tool requests and approvals — as well
  as its transcript. Without it a cowork `local_write` the run asked for after its own stream
  closed reached no client and timed out. `holdOpen` ignores the phase (a durable run's thread
  reads `idle` throughout) and stops only when the poll ends. It replaced a 5s snapshot re-read
  (`onDurableProgress`, removed). The status turn survives the rebuilds because every transcript
  replacement goes through `adoptTurns`. **A `tool_request` can now arrive on two streams** — the
  run's own and the reattach, or two reattaches — so the engine takes each id once
  (`takenToolRequests`); running one twice is two writes to the user's folder.
  **The harness now says so itself** (`felix-run/felix#533`): the snapshot carries `activeRun`
  (`{resumeToken, status, expiresAt}` or null), and a send into a busy thread is
  `409 run_in_progress:<token>`. `rejoinActiveRun` in the shell reads `activeRun` when the key is
  present (null also clears the local record) and falls back to `localStorage` only when it is
  absent — an older harness — or the snapshot could not be read. It runs after the transcript is
  rebuilt, on `loadThread` and on resume. The refusal is `RunInProgressError`, surfacing as the
  `SendOutcome` `'run_in_progress'`: the engine drops the placeholder and `rejoinRun`s the token
  it names; chat-ui hands the message back (`RUN_BUSY_NOTICE`) or, from the queue, restores it to
  the head unpaused so it drains when the run ends; the TUI puts it back in the field.
  **What it cannot do is run a cowork client tool after the stream has closed**: only the durable
  arm of `POST /chat/stream` announces `tool_request`, not `GET /chat/stream/{thread_id}` and not
  the poll, so a `local_*` call issued after that times out. That needs the harness.
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
- **The service worker is `apps/chat-ui/public/sw.js`, hand-written, and it never touches
  `/api/*`.** That is the live console: SSE, uploads, `x-chat-key`, approvals that must be current or
  absent. It does two things: page loads go network-first, falling back to the cached shell so an
  installed app opened offline reaches the gate's "Could not reach the server"; and hashed
  `/assets/*` are cache-first, precached from the page's own `<script>`/`<link>` tags on install.
  Because nothing of a run passes through it, a new version takes over at once (`skipWaiting`),
  with no update prompt, and a deploy needs no version bump: pages are network-first and asset
  names are hashes. Bump `VERSION` only when the caching itself changes. Cache lookups pass
  `ignoreVary`: a module script carries `Origin`, the precache did not, and a server answering
  `Vary: Origin` made every cached script miss. Offline, the shell loaded and stayed blank.
  It registers in production builds only (`src/lib/service-worker.ts`). `tests/sw.test.ts` runs
  the real file against stubbed worker globals.
- **Web Push is how a waiting run reaches a device whose page is not running** (`felix-run/felix#418`).
  The harness pushes when an approval row is *created* (never a reused one) and when an agent asks
  a question; the payload is the kind, the thread and, for an approval, its id, tool and deadline,
  never arguments or the question. `src/lib/push.ts` subscribes; `sw.js` shows the push and routes
  a tap. A tap **posts `felix:open` to an open window** and the shell moves the router, because
  navigating the window would reload it and drop a live run's connection; `navigate()` is only the
  fallback for a window that does not answer. The VAPID key is fetched before the click so the
  click goes straight to the permission prompt (`PushHint`, inside the installed app only, which
  is also the only place iOS allows it). `resyncPush` re-registers a held subscription on every
  load, since the harness drops rows after five failed sends. `presence.ts` shows its own
  notifications through the worker when there is one: an installed iOS app refuses
  `new Notification()`. Without a key on the harness the routes answer 503 and nothing is offered.
- **Coming back to a suspended page** is `src/lib/resume.ts`: `visibilitychange` to visible,
  `pageshow` from the back/forward cache, and `online`, coalesced into one call. A phone freezes
  every timer while the app is in the background, so the shell asks `/approvals` at once on return,
  and calls `engine.checkLiveness()`. That cuts a live stream that has gone silent, which a
  suspended page's connection can do without ever erroring, so the ordinary reattach runs.
  **The shell also runs it every 15s while a stream is live**: a connection can die with the page
  on screen too (a proxy losing its upstream, a network switch), and on 2026-10-03 a stream cut
  mid-reply read *running* for as long as the tab stayed open. It acts **only** once the harness
  has *proved* it heartbeats and the stream has then gone 45s with nothing at all: hanging up
  tears a run down, so a quiet stream in a long tool call must never be cut on a guess. **The
  harness sends `: keep-alive` only after 15s with nothing else to send** (`with_heartbeat` in its
  `routes/_sse.py`) — 45s of live streaming carried none — so a stream that dies while deltas are
  flowing has never shown one of its own. That is why the proof is kept per engine as well as per
  stream: once any stream from this harness has heartbeated, a later one silent for three
  intervals is dead. Durable streams (`resumeToken` set) and reattach streams send no heartbeat
  and are never touched. **A reattach lets go as soon as its snapshot says the thread is not
  working** (`reattach.ts`), rather than when the harness closes an idle reattach ~300s later —
  which had kept a torn-down run reading *running* for five minutes. A reattach that
  began while the page was hidden, or just after it came back, sets the shell's `leftApp`,
  and the transcript says leaving stopped the run and that Run in background would not have
  been stopped; any other drop sets `dropped`, which says the connection dropped and nothing
  more is coming for that run. Both last until the next send or thread, because the rejoin is
  over in a moment and what it rebuilds often has no reply at all — the harness keeps none of a
  run it tore down. Idle on return, the shell re-hydrates only when
  the snapshot holds more turns than the tab, because a rebuild discards local detail.
- **Session state is server-authoritative** — `GET /chat/sessions/{id}` returns the snapshot
  (transcript, phase, thinking level, leaf, lease) used to hydrate a thread, and `GET /chat/sessions`
  is the thread index behind the history rail. The `localStorage` copy in `src/lib/threads.ts` is a
  cache, not the list: `mergeSessions` folds the two, and the split matters because **neither side is
  a superset**. The harness owns which threads exist and what they are *named*
  (`POST /chat/sessions/name`), and since `felix-run/felix#521` each index row also carries a
  `preview` of the first user message and the `manifest` the newest turn ran under — so a thread
  started on another client is titled and attributed rather than listed as a bare id, and the
  harness's manifest wins over the local one, which only knows turns sent from this tab. An older
  harness sends neither. A thread that never reached it — or was created against a different deployment — exists only locally, so those
  rows are kept and marked rather than dropped.
  - **A failed index read is said, and falls back to the last good one.** `refreshThreads` had an
    empty `catch`, so a cold load under 429 showed the local half ("Older 1") as the whole list,
    the header titled the thread with its raw suffix and the composer called its agent "not
    recorded". Every good read is kept in `sessionStorage` (`felix.threadIndex`,
    `src/lib/thread-index.ts`, one tab's like `felix.tabThread`) and merged in when a read fails,
    so the title and agent come from it too; a delete drops its row. The failure is
    `ShellValue.threadIndex`, drawn under the sidebar's Threads heading (*Couldn't refresh the
    harness's threads · showing its list from 3m ago · Retry*, or *showing this browser's N* with
    nothing remembered), neutral for a transient failure — which is also retried on a 2s/5s/15s/
    30s/60s backoff and reported to the health line — and red for one Retry alone can answer.
  - That local manifest is what `loadThread` restores into the agent picker on a thread change, so
    the picker names the agent the next message will actually go to. It is not restored when
    `/v1/models` no longer lists it. **A Radix `Select` reports `""` through `onValueChange`** when
    `value` moves to an option not yet in its list, which is exactly a restore before the list
    arrives; `InlinePicker` drops empty values, or the send would carry no agent at all.
  - Thread ids on the wire are `{tenant}:{suffix}`; clients send and store the **suffix** only
    (`threadSuffix`), because the harness rejects a suffix containing `:` outright.
  - `GET /chat/history/{id}` still rejects anonymous callers, which is why hydration prefers the
    snapshot route.
- **Leases** — each tab mints a holder id and takes an exclusive lease (`/chat/sessions/lease`,
  released on `pagehide`). A 409 means another client drives the thread, and the keeper
  (`src/lib/session-lease.ts`) takes a `shared` observer hold instead: the shell goes read-only
  under a `role="status"` banner. Every hold has its own token, renewed and released with it — the
  harness refuses either by holder id alone (`felix-run/felix#479`). While observing, each renewal
  tick first tries `exclusive` with no token, so a watching tab takes over within one
  `LEASE_RENEW_MS` of the driver leaving; observers are never promoted by the harness. A *first*
  acquire that could only observe also tries again at 1s, 3s and 8s (`SETTLE_RETRY_MS`): a reload's
  keepalive release can land after the new page's acquire, which then watched its own run for 150s
  (`felix-run/felix#532`); a genuine second tab costs three 409s. Every
  driving request carries the tab's token as `X-Felix-Lease-Token` (the `leaseToken` hook on
  `@felix/client`, bound in `api.ts`), and a `409 lease_read_only` / `lease_held` arrives as a
  `LeaseRefusedError` that flips the tab to watching rather than raising a toast. A refused send
  hands its message back: `engine.send` resolves `'lease_refused'` (definite that the message never
  reached the thread), the shell drops the unsent turn and restores the text and images to the
  composer (`kept`), and a refused *queued* message goes back to the head of the queue. Any other
  4xx from `POST /chat/stream` but `408`/`429` is `SendRefusedError` → `'refused'`: also definite,
  and for a reason a resend would only repeat (a thread pinned to another agent's build, an unknown
  agent), so it is not rejoined, its key is dropped, the error line gives the harness's reason
  (`describeError`), and the composer's notice does not promise that sending again will help.
  The terminal (`apps/tui/src/lease.ts`) renews its exclusive hold at half the TTL it asked for,
  keeps a taken hold's token for the header so its writes are refused, and asks for the thread back
  once per interval. `VITE_LEASE_RENEW_MS` shortens the interval for a live check; `tests/session-lease-watch.test.tsx`
  imports `App` after stubbing it.
- **Sticky interrupts** — `approval_required` and `ui_request` frames render as banners and are
  answered out-of-band (`/approvals/{id}/decide`, `/chat/ui`); the run is waiting on them.
  **Not answering an approval is answering it.** The harness calls `wait_for_decision` with the
  rule's `ttl_seconds` — or five minutes when the rule sets none — and on timeout returns `denied`
  with the note `timeout`: the tool is refused and the run moves on. A banner still offering its
  keys past that point is asking about a decision already made, so both clients show the deadline,
  stop accepting an answer once it lapses, and say who made the decision. The same number is also
  the *grant's* lifetime — approving authorizes every byte-identical call to that tool, matched on
  a hash of the arguments, until it expires — which is why the prompt says so rather than implying
  `y` allows one call.
  The frame carries the row's deadline as `expires_at` on a current harness, but **null when the
  rule set no TTL** (the harness then waits its default from the row's creation, which the frame
  does not carry) and absent on an older one. So `syncApprovals` still returns deadlines for
  *every* pending approval rather than only the ones it is adding, and the engine backfills them
  onto approvals that arrived by frame and are therefore already `seen`.
  **`/approvals` is tenant-wide, so adoption is thread-scoped.** It is the only channel a durable
  run's approval has, and without a filter every pending approval in the tenant was lifted into
  whichever thread happened to be open — the transcript banner asking an operator to authorise a
  write on behalf of a conversation they were not looking at, on the one surface in this app that
  authorises a write to disk. `syncApprovals` now skips a row whose `thread_id` names a *different*
  thread, on positive evidence only: a row with no thread is not evidence of belonging elsewhere
  (an older harness sends no key, a newer one sends `""` for a tool called outside a chat), so an
  unattributed approval still reaches the banner exactly as before. A skipped id stays **out of
  `seen`**, or the thread it does belong to would never offer it either.
  **The row carries `thread_id` now** (`felix-run/felix@f679310`, answering `felix-run/felix#232`),
  which is the only attribution a durable run's approval has. It is **optional on the client and
  absent and empty mean the same thing**: an older harness sends no key, a new one sends `""` when
  there was no thread, and distinguishing the two would report the client's version rather than the
  run's. It is the *originating* thread — `create_pending` reuses one pending row for every
  byte-identical call, so it names whichever asked first — and `listApprovals` normalises it to the
  suffix, like every other thread id a client holds. The attention line narrows its copy from
  "across the harness" to "on this thread" only when **every** pending row is provably this thread;
  one row elsewhere, or one carrying no thread, keeps the tenant-wide phrase, because an
  unattributed row is not evidence of being here.
  **The frame arrives promptly, but only because that was fixed.** Until `felix-run/felix#210` the
  harness queued `approval_required` when the call blocked and drained the queue only after the tool
  batch returned, so it reached a live stream in the same flush as `tool_end` — *after* the decision
  it was asking for. A stream blocked on a gated call for 75 seconds carried none at all, and the
  operator saw a tool card stuck at `running`. Re-measured against that fix on 2026-09-11: the frame
  lands ~1s after `tool_start`, while the row is still `pending`. Treat a harness older than that
  commit as poll-only.
  **The durable path is still poll-only, by construction.** Side events are an in-process queue
  keyed by thread id; a durable run's agent is in the worker and its stream is served by the API, so
  no frame can cross. That is what the backfill onto already-`seen` approvals is for.
  **So the turn has to say it is waiting, not only the banner.** A durable run's status turn read
  `Background · running…` for the whole of an approval's deadline, and on 2026-09-23 an operator
  typed "proceed" into the composer while a `write_file` timed out behind it, twice. The engine now
  writes `Waiting on your approval · <call>` into that turn when an approval arrives — by the poll,
  **or by frame**: a v0.4.0 harness announces a durable run's approval on the stream, often straight
  after `run_accepted` and before any `run_status`, which is why `run_accepted` (not the first
  status) is what marks the run in flight. It returns to the run's own status once the approval is
  answered, only while a durable run is in flight — what `durableStatus` tracks and every exit from
  `send` clears. The status line is refreshed *before* the approval's card opens, because a card is
  placed at the text's length and a line rewritten afterwards would split around it.
  And a finished call is not a successful one. `classifyToolResult` in `@felix/client` reads the
  **start** of a result for the harness's failure spellings — `[tool error/<code>]`,
  `[error/…]`/`[fatal/…]`, the control refusals (`[policy …]`, `[limits]`, …) and the
  `[approval <note>]` outcomes — plus a bare `error: …` from the five workspace tools, which is
  what a harness older than `felix-run/felix#308` returns. Both clients' tool cards draw a failed
  or refused call as such instead of `done`: a `write_file` that failed with `Errno 13` sat under
  a green `done` badge on the reference deployment.
  **An `[approval <note>]` outcome is its own kind, `denied`, and is not a failure** (2026-10-10).
  One declined `write_file` used to read red `refused` on its card and in Changes and `● Failed`
  in the Activity ledger, while the run readout said Idle. Now every surface says `denied` in the
  neutral tone; red stays for `failed` and for a control's `refused`. The result says only *that*
  it was denied; who and when are on the decided `/approvals` row, which
  `src/lib/denials.ts` matches back to the card **by order** (the n-th denied call of a tool on
  the thread is the n-th denied row for it, and nothing when the counts disagree), read once per
  thread by `DenialsSync` in the workbench, which publishes to a small store the card reads
  (`components/chat/denial-context.ts`). `decided_by` names a principal, and through the
  proxy every browser is the same one, so the card says **"Denied by you" only when this browser
  made the decision** (`markDecided` records it in `felix.decidedHere`), the recorded principal
  otherwise, and plain *Denied* when no row matches. The harness has no route that re-issues one
  call, so the card's **Ask again** only puts an editable request in the composer
  (`draftMessage`, the kept-message path) and sends nothing. In the audit, an approval's denial
  is a `policy_deny` with `control: 'approvals'`, and the harness writes the turn's
  `final_response` as `error` when its last batch held any denial; `src/lib/audit-outcome.ts`
  reads that reply as `after-denial` (from `payload.denied_calls`, or, on a harness without it,
  from a turn with a denial and no broken call), so it is not a second failure, in the ledger or
  in the sidebar's Activity glance.
  The rule path now sends `reason` too — the manifest rule's `description`, so a banner can say
  `Confirm writes to the workspace` rather than only `workspace-write`. The `/approvals` row still
  carries none, so it is frame-only and stays optional.
  **There is a third answer besides yes and no.** `edited_args` on the decision approves a
  *modified* call and the harness takes it — verified end to end on 2026-09-11, with the client's
  exact payload: the model asked to write `notes.txt`, the decision substituted a different path and
  body, and the tool ran with the substituted arguments while the original path was never created.
  `DecideRequest` is `extra: "forbid"` and allows exactly `decision`/`status`, `note` and
  `edited_args`, which is the set `decideApproval` sends — a fourth field would be a 422 — the TUI opens `$EDITOR` on the arguments
  (`e`), chat-ui swaps its arguments pane for a textarea. `parseEditedArgs` refuses anything that is
  not a JSON **object**, because the harness spreads the value over the call's arguments and an
  array or a string would arrive as a tool call with *no arguments at all* — a silent success that
  runs the wrong thing. An unmodified edit approves plainly rather than sending the originals back:
  `edited_args` installs a substitution that the **reuse path also applies**
  (`manifests/builder.py`), so an edited approval stands for every identical call until the grant
  expires rather than correcting the one in front of you.
- **Images are uploads, not inline.** `submit` in `app-shell.tsx` fits each image to the harness's
  600 KiB `/files` limit in the browser (`fitImage` in `src/lib/image-upload.ts`: WebP, else JPEG on
  white; a GIF over the limit is refused rather than flattened), uploads it, and sends
  `attachments[].url` as `felix-file://<id>`. Inline `data:` URLs land in the session log and are
  re-sent to the model every turn, and the API's 1 MiB body limit refused anything over ~750 KB
  while the composer advertised 10 MB. A steer uploads nothing, since it carries text only.
  `submit` **throws** on a failed upload so the composer keeps the message. `/files` 409/503/400
  are translated in `explainUpload`, because the shared `describeError` reads every 409 as an
  approval someone else decided, and told an operator with a full quota that the image was "no
  longer pending". Thumbnails resolve through `GET /files/{id}`, whose response names **no** media
  type, so `sniffImageType` reads it off the bytes. Hydration restores `metadata.attachments`, which
  it used to ignore, so a reload had dropped every thumbnail.
- **Tabular tool results are drawn as tables** (`parseTabular` in `@felix/client`, `ToolTable` in
  chat-ui), with a Table / Raw toggle and a 100-row cap that says what it hides. It recognises a
  JSON array of records, a small envelope around one (`items`, `rows`, `results`, …), and CSV/TSV,
  and it is **deliberately conservative**: a miss leaves output as the text it was, while a false
  positive mangles output that was fine. The first draft read three lines of comma-laden prose as
  a CSV; header cells must now be label-like and no line may end like a sentence. A failed call
  and a `local_shell` result keep their own rendering.
- **A tool's images are drawn in its card** (`ToolImages` in `components/chat/tool.tsx`), outside
  the fold, because a screenshot hidden behind the chevron made every browser call read as text.
  `ToolCall.images` is filled by `toolImages` in `@felix/client` from a tool result's
  `metadata.attachments` (the snapshot and a durable run's `session_event`s) and from
  `tool_end.attachments` (`felix-run/felix#500`; an older harness sends none, so its images appear
  on the next hydrate). `toolImages` keeps a `felix-file://` reference or an inline raster `data:`
  URL and **drops anything else**: a remote URL in an `<img>` is a request the tool's author chose,
  made from the operator's browser as the card renders. References resolve through
  `useDrawableUrl` (`hooks/use-drawable-url.ts`), the same fetch-once path a message's attachments use.
- **A checklist, a child agent and a permission mode** (`@felix/client`, `agent-work.ts`). Three
  harness features announce themselves beside the tool calls, and each is also readable off the
  calls, which is all a transcript rebuilt from the log has. `todo_updated` lands on the open
  `todo_write` call (`ToolCall.todos`, so a list shows before the call returns), and
  `checklistFromCall` makes any accepted write a `PlanState` keyed `CHECKLIST_ID`, so
  `plansInTurn` draws it with the plan card in both clients and folds the later writes. A refused
  write (no frame, a `[` result) is no checklist. `subagent_start`/`subagent_end` carry no call
  id, so they mark the open `task` call by agent name (`ToolCall.subagent`); `subagentOf` reads
  the same from the call's `agent`/`background` arguments and a background result's task id, and
  a background child reads *in background*, never *done*, because nothing on this thread's stream
  says when it ends. The permission mode is `EngineState.permissionMode` (null is the default),
  filled from the snapshot's `permissionMode` when the key is present and by
  `permission_mode_changed` (an approved `exit_plan_mode`; `POST /chat/mode` emits none). The
  composer draws a chip off the default that returns the thread to default, and `/plan` toggles
  plan mode in both clients; the waiver modes are shown, never offered, because `/v1/models`
  does not say which an agent allows.
- **Output styles** (`spec.output_styles`, `POST /chat/style`). `/v1/models` lists an agent's
  styles (`ManifestEntry.outputStyles`, `defaultOutputStyle`); the thread's choice is the
  snapshot's `outputStyle`, null for the agent's default. chat-ui keeps it **keyed by thread**
  (`storedStyle` in the shell), so a thread with no snapshot yet never shows the last thread's,
  and draws a Style picker beside Thinking only when the selected agent declares styles. A stored
  name the selected agent does not declare reads as **Default** — that is what the harness runs —
  and a set is checked against the agent selected for the next message (`manifestRef`, since the
  composer's memo can hold a stale callback). `InlinePicker` drops empty values, so Default is
  the id `__default__`, labelled plain `default` — the trigger shows it in a 10rem cap, where
  "Default (terse)" read "Defaul…" — with the style it stands for in its description. The
  terminal has `/style [name|default]`.
- **Side questions** (`/ask <question>`, `POST /chat/ask`). Answered from the thread's context and
  added to nothing, so the answer is **never a turn**: chat-ui draws it as `SideAnswerCard` above
  the composer (`ShellValue.sideQuestion`, keyed by thread), the terminal as a notice. The
  composer answers `/ask` **before** its watching/reattaching/queue guards, because a side question
  takes no lease and writes nothing — mid-run and watching are exactly when it is wanted. A thread
  the harness has never seen is said (`SideQuestionError` `unknown_thread`, or `unsentRef`), not
  asked. `/ask` is this client's, so an agent command of that name is shadowed, like `/new`.
- **Spilled tool outputs** — a manifest with `artifacts.enabled` replaces any oversized tool result
  with a preview plus `[artifact:<id> key=… chars=N]`, and the rest lives in the object store.
  `parseArtifactMarker` in `@felix/protocol` reads that reference off the end of a tool output (only
  the end: one quoted mid-text is a tool *talking about* an artifact) and the tool card fetches
  `GET /artifacts/{manifest_id}/{artifact_id}` on request. The tenant is in the key and is
  deliberately not a parameter — the harness takes it from the caller's credentials.
- **Memory** — `/memory` is what the agent has stored across sessions, surfaced at
  `/harness/memory` so a stale or hostile fact can be found and removed without a database
  console. Four views — Recent, Search (the agent's own hybrid ranking, whose hits report *which
  retriever* found them), As of, Forgotten — and an **Add** form that writes one (`POST /memory`),
  an injection ingress by design, which is why the form says so. **Every row leads with where it
  came from**: the conversation (a link), the turn (a link into As of), the agent, when it was
  written and whether it has been recalled since — the hunt ends at "which conversation taught it
  this", and `kind · imp · seq` could not answer it. The line has a grammar of its own: muted, `from` and
  the quoted title **end-cut** at 32 (`endTruncate`; a middle cut broke a sentence into two
  fragments, and a title already ending in `…` gets no second one), links marked by an underline that is always there
  (colour alone told them from the text by nothing — a title is usually the user's first message,
  so a bare one read as the fact's next sentence) and padded to 24px without a taller line. Retriever channels (`via lexical`) appear on Search hits only: a Recent or As-of
  row was retrieved by nothing, so the old "lexical only" on unembedded rows is gone. Three rules that are easy to break.
  **As of is per conversation**: `origin_seq` is an ordinal into one thread's log, so the view asks
  for the thread before the turn and sends `thread_id` (`felix-run/felix#548`); without it
  `as-of/4` collected every conversation's fourth turn. The client re-filters by thread, because an
  older harness ignores the parameter. **Add names the agent** ("Recalled by"): an agent recalls
  only rows stored under its own manifest id, and the form used to send `''`, so every memory added
  here was recalled by nobody. **`DELETE` is soft** — the row becomes `forgotten`, which is why the
  UI says "forget" — and the page offers Undo and a Forgotten view with Restore
  (`POST /memory/{id}/restore`, gated on whoever forgot it). A failed forget is said on its row:
  `ConfirmButton` has no `catch`, so a rejecting `onConfirm` used to leave it armed with nothing on
  screen, and its `shrink-0` is a `restingClassName`, never a `className` — on `className` it reaches
  the armed row too, which then cannot narrow on a phone. An older harness's missing forgotten
  list is an empty state, not an error: a retry gets the same answer. Reads need the `memory:read` scope, so a 403 here means a narrow key, not an empty store.
- **Usage** — `/usage` is the token meter, and two of its fields are easy to misread. `model_id` is
  the logical route the operator configured; `wire_model_id` is the provider's own id and is what the
  row was **priced** by, so the two disagreeing on a custom route is the thing worth seeing. And
  `cost_usd: 0` **does not mean free** — a model with no entry in the pricing catalog is metered but
  unpriced, its tokens counting against the caps while its spend records as zero and
  `limits.max_cost_usd` failing open for it. Anything summing that column is summing an
  underestimate, so chat-ui labels the total `Cost (floor)` and says how many turns were unpriced,
  and the terminal leaves the cell blank rather than drawing `$0`.

  **The Activity page's totals come from `/usage/summary`, not from adding up `/usage`.** The panel used to
  sum whichever page of rows it had fetched — `limit: 40` — and label the result the total, so
  "Cost (floor)" described a page rather than a period. The summary route groups and totals
  server-side over a window (thirty days unless asked otherwise) and echoes the range it used, which
  is the number an operator was already reading it as. It also counts the unpriced gap properly: a
  bucket priced at `0` with tokens in it is an unpriced model, and its `calls` says how many turns
  that covers, so the warning is over the window rather than over whatever was on screen.

  **The page is a ledger by thread** (`components/harness/activity-ledger.tsx`, grouping in
  `src/lib/ledger.ts`). One `usePoll` tick reads four things for one window: the audit events
  (`listAuditWindow`, which follows `/audit`'s cursor under `since` up to 2,000 and says when it
  stopped), spend per thread (`GET /usage/threads`, `felix-run/felix#542`), `/usage/summary` for
  the totals and the by-model table, and 20 recent `/usage` rows only to find routes priced as
  another model, which the summary drops. Usage rows carry `thread_id` in the full
  `{tenant}:{suffix}` spelling the audit payload uses; `buildLedger` folds both to the suffix. A
  harness without the route answers 404, `listUsageByThread` returns `null`, and the page says no
  thread can show a cost rather than drawing every one as free. The window opens on **since this
  browser last left the page** (`felix.activity.lastVisit`), falling back to 24h; window and
  filters are in the address, and `?thread=<suffix>` opens one entry on arrival (the Jobs page links
  a job's spend there, and its failures — `1 thread failed · 7d` from the glance's two reads
  narrowed to the job's threads by full id, so a fresh-thread job counts one per failed run and
  links to the week without `?thread=`, because a
  job that failed four days ago and ran cleanly since read only `last ● OK` beside this page leading
  with it; its `last` reads `Failed` when the scheduler said OK but the turn that firing ran broke,
  `jobThreadOutcome`; the poll still runs until its first answer, since an open entry pauses it).
  **The account line leads with failures and what they cost** (2026-10-16, `failureSentence`):
  `1 thread failed after 943 turns — $27.17 of $27.60.`, then denials (`denialSentence`). It used to
  carry denials alone, so a week whose one failed job held nearly all the spend read "1 thread had a
  call denied at an approval". The share obeys `spendState`: `≥` when a failed thread's spend is a
  floor or unrecorded or the total holds unpriced calls, and words, not `$0.00`, when none of it was
  metered per thread. **A reload is not a visit**: the stamp is written on unmount and
  `pagehide` only after the page has been on screen `VISIT_MIN_MS` (5s), and a tab measures from
  the value it first read, held in `sessionStorage` (`felix.activity.sessionSince`) — before both,
  any reload, remount or second tab turned the window into "since a minute ago". The sidebar's
  Activity glance counts **threads that failed** over **a week** (2026-10-16; it was a day, and a job that failed
  four days earlier left it blank while this page led with it) — or over less when its reads do
  not reach that far back, which its span says (`glanceWindow`: `· 3h`, not `· 7d`) — and links
  with `?since=7d` (`navSearch`), which holds either. **It merges two reads** (`useRecentAudit`,
  `useRecentErrors`, `mergeReads`): the newest 60 events, and the newest 60 with `status=error`.
  Measured on the reference harness, a job firing every few minutes put 60 events at 106 hours and
  even 500 (262 KB) at 112, so the failure was in neither; the errors read reached 576 hours in
  16 KB. The first read stays for the turns around a failure and a control's refusals (`denied`,
  not `error`). **"Failed" is counted in threads on every surface** (2026-10-17): the glance
  summed failure *events* (`3 failed · 7d`) beside this page's `1 with failures` and a job row's
  calls-or-turns, three units for one broken thread. Now the glance (`recentFailures`), the page
  header and a job's row all run `failureTally` over `buildLedger` — the page's own reading, in
  turns — and say it with `failureLabel` (`1 thread failed`), and `useWeekFailures` is the one
  hook behind the glance, the job rows and the page's pointer. It is the same rule over the same
  window, not the same rows: the glance has its two reads, the page with `?since=7d` up to 2,000
  events. The `""` bucket is never a thread: its failures are counted apart as events and said
  (`N failed outside a thread`) only when no thread failed, so neither surface is blank over one
  nor adds the two units. The *Failed* mark on a thread row (`threadOutcomes`) is a different
  question — its **newest** turn — so a thread that broke and ran cleanly since counts in the
  glance and carries no mark. **A window shorter than the week points at it**: on "since last
  visit" or 24h, when the window holds no failure and the week does, the page says
  `Nothing new since your last visit · 1 thread failed in the last 7 days` (or *No failures since
  your last visit · …* above a clean list) with *Show the last 7 days*, because reaching the page
  any way but the glance's link (the phone's `/harness` list, a bookmark, Back) read "Nothing ran"
  under a red glance. A window with no model call shows no cost figure, not `$0.00`.
  **Spend before
  per-thread metering lives in the `""` bucket**: `meteringStart` finds the first attributed call
  when unattributed spend came before it (`Infinity` when none is attributed at all), and
  `spendState` tells a thread's cell `cost`, `floor` (`≥`), `unrecorded` or `none` — so a thread
  whose calls predate the upgrade never reads as having spent nothing. Polling stops while a thread is
  open, as the feed's did while a row was. **`tokens_input` is the uncached prompt only**:
  `tokenSplit`/`tokenLine` count the whole prompt as "in" and name what the cache served and
  stored, because a row printed as `5 in` hid 3,228 cache writes and looked cheaper than a row
  that cost a fifth as much. `summarizeWindow` reads `totals` off the response rather than re-adding
  `items` — adding them would reintroduce exactly the bug, since the items are what the harness
  chose to return and the totals are what it counted.

  `UsageSummaryItem` is guarded against `felix/usage/store.py:_summary_item_dict`, which had to be
  extracted harness-first (`felix-run/felix#242`) because the response was built inline and the
  recorder only reads `_<row>_dict` functions — the same reason `/documents` was unguardable before
  `#213`. `UsageSummaryTotals` is derived from the item type with `Pick` rather than declared,
  because `_summary_totals_dict` builds its dict imperatively and the recorder lists it as
  `unreadable`; a `GUARDED` entry naming it would fail by design, and deriving keeps the field names
  in the one place that *is* checked.
- **Documents** — `/documents` is the corpus the agent *retrieves* from, where `/memory` is what it
  *learned*; the operator question is the same one, so the panels are the same shape deliberately.
  Two differences change what a UI may say. A search hit is a **chunk**, not a document, so the
  passage is what gets rendered — the title alone would hide the thing actually retrieved. And
  `DELETE` is **hard**, unlike memory's soft forget: it removes every chunk and answers with how
  many, which is why the button says "Delete" and the confirmation names the count. Ingest is
  idempotent on `(source, title)`, so re-adding replaces — and a typo'd title is a second document
  rather than a correction, which the Add form says where the decision is made. A hit's `channels`
  reading `lexical` alone means the vector retriever never *ran* (no embedder configured), not that
  it ran and disagreed.
- **Skill library** — `/harness/skills` holds the agent's active/declared skills and the tenant
  library — below them, or **above them while a draft is waiting**, since that queue is why an
  operator opens the page. The library is a review queue (oldest draft first, its gate verdict and
  diff against live open on the first row, publish or reject with a note) and a feedback inbox —
  each a section above the list **only while it holds something** (or its read failed); empty,
  both are one quiet line in the Library heading (*No drafts or feedback waiting*), because two
  headed "nothing" sections sat above the list an operator came for. (`useStickyFailure` keeps
  a failed section mounted through its own retry-on-mount, which otherwise flipped it away and
  back forever.) Then the list, filtered by status and source through two `sm` Selects with
  visible labels (it opens on **In use** — anything live or with a draft waiting,
  sorted out on the client since the route takes one status; archived skills are under Archived
  and All, and an In use view that hid everything says how many rather than "empty"). Below it,
  **Manage** — one disclosure, closed by default and remembered for the tab
  (`felix.skills.manageOpen` in `sessionStorage`), mounting nothing while closed — holds Import
  from GitHub, Personal libraries and the tenant's **publish policy** form, which lives here and not
  on a skill's page: it re-decides every skill's drafts. `?manage=import|personal|policy` opens it
  on that section; the Gate tab's policy link is `?manage=policy`. Import's Browse is never
  disabled (a greyed primary read as chrome): pressed empty it names the missing source. `?skill=&tab=&v=&against=` is a skill's
  page (Versions, Gate, Evals, Feedback; an old `tab=edit` opens Versions), so any view is a link; the Gate tab is still
  `tab=review` in the address, and a stored version's files are a section of Versions, so an old
  `tab=files` link lands there. **No decision is asked before the evidence:** every publish and
  rollback confirm reads the gate's verdict (`GET …/preview`) fresh alongside the live version, a
  draft on Versions carries its one-line verdict (`GateLine`), and Save's "Publish now" asks the
  same replacing-live question and relabels its button. **A draft the gate has refused is not
  offered Publish** — the harness has no override, so the slot is *Edit to fix* beside Reject —
  once the verdict is known (`useKnownPreview` reads the cached preview and never fetches; a row
  whose verdict was never read still offers Publish, and arming reads it). An armed confirm the
  gate refuses has no confirm button. The Gate tab carries a draft's decision too. Scores are red
  only where they would block under the policy in force (`ScoreReadout`'s `policy`), and amber on
  this surface is kept for what waits on a person. Version selects say each version's state. The
  sidebar's Skills row carries an amber `N waiting` glance from its own 60s poll of the queue
  (`SKILL_QUEUE_POLL_KEY` — not the page's Query cache, which would pull the lazy chunk into the
  entry), and the attention line's all-clear reads *No approvals or questions waiting.*, because
  a draft is on no poll it reads. The list follows `next_cursor` past
  *empty* filtered pages — the route filters after reading — for a bounded number of pages, then
  says there is more rather than "none". A save names `parent_version`; a 409 `parent_changed`
  stops at a choice (reload the newer version, or keep the edits with its diff on screen) and never
  retries by itself. Keeping the edits lists every *other* file the newer version added, changed or
  deleted (by digest) and holds the save until each is taken or kept, because a save sends the whole
  bundle. Every decide surface — queue row, Versions, the chat card — lists every file that differs
  from live, not only SKILL.md, and says when the draft was edited from something other than live.
  Stored bundles are immutable, so `invalidateLibrary` never refetches them: the post-save cache is
  seeded with the files sent, and a refetch would swap in the harness's redacted read. Skill text is agent-written: `SkillMarkdown` is the transcript pipeline minus
  `rehype-raw` (no HTML element from markdown) and loads no remote image, and `assetDataUrl` builds
  `data:` URLs only for the raster types on the harness's table, never SVG. `create_skill` /
  `update_skill` results render `SkillProposalCard` above the tool card, offering Publish (the same
  word as everywhere else, not "Approve") only once the library confirms the version is still a
  draft, and only the link after a 403. The library,
  the editor and the card are lazy chunks (the YAML parser and Query ride in them). The
  highlighter caps every spanning pattern and leaves lines over 4000 characters untokenized — a
  sticky regex runs at every position, so one unbounded span made a long line quadratic. The
  harness's `/harness` layout renders one tree at every width, so crossing 768px no longer
  remounts a page (and its unsaved edits). The quality loop is `management/skill-quality.ts`:
  an **Evals** tab (queue an evaluation, re-read every 3s only while one is queued or running,
  baseline → with-skill → uplift per scenario, and whether it `counts_for_gate` — an agent's
  version counts only an evaluation on its bundle's own `evals/`), a **Feedback** tab (file,
  accept with "improve with AI" on by default, reject with a note, follow an applied rewrite to
  its draft and load it into the editor), a feedback inbox beside the review queue, and the
  tenant policy form on the library page, which shows what the tenant set against what is in force
  because the policy is tighten-only (the deployment settings are a floor). Every publish and rollback
  re-reads the skill before arming and sends `expected_live_version` — the live version its
  question named — and a 409 `live_changed` re-asks naming the new one; it never retries.
  **A version says where it came from** (`VersionProvenance`): an import's GitHub source, ref,
  commit and license, `import lineage` while the gate still judges it as an import, and what an
  adoption or a promotion copied; `SkillSource` is open (`agent`, `operator`, `import`,
  `promoted`). An imported skill's page says whether its source has moved on (`UpstreamLine`,
  from `SkillDetail.upstream`). `refusalOf` reads a bare `{detail: "<code>"}` as that code — the
  personal-library 403s arrive that way, not as `{error, message}`.
  **My skills is the caller's own library** (`?lib=me`, the `~me` routes). Every per-skill client
  function takes a trailing `library` and keeps **two literal call sites** — org and
  `` `/skill-library/~${librarySegment(library)}/…` `` — because `check-api-drift` reads only a
  path literal right after the call's paren (a variable, a ternary or even a comment there hides
  the call) and matches `~{library}` by shape, so a literal `~me` would read as a route the harness
  lacks. chat-ui provides the library through `SkillLibraryContext`; every hook in `queries.ts`
  reads it and keys its cache by it (last key element, so `invalidateLibrary` is unchanged), which
  is what lets the list, page, editor and actions serve both. The team's queue, feedback, evals
  and policy are not shown there (`ORG_ONLY_TABS`), and a once-published version offers
  **Promote** (`PromoteButton`), which drafts into the team library and never publishes. A 403
  that names its code (`no_personal_library`, `missing_scope:…`) is said in its words, not as
  the generic `skills:write` one.
  **An administrator reads other people's libraries** (`?lib=<32 hex>`, `listPersonalLibraries`
  → `GET /-/personal`, which strips the `~`). The team page's *Personal libraries* section (under Manage) lists
  them **only on Show** — the harness audits every listing as `personal_library_accessed`, so a
  mount or a poll would record looks nobody took. That library is read-only except Archive:
  `useLibraryReadOnly()` (a library that is neither the team's nor `me`) makes `VersionDecision`
  and `RollbackButton` render nothing, `useOpenSkillEditor` answer null (so no Edit anywhere),
  and leaves out New skill, Promote and Adopt.
  `tests/skill-admin-personal.test.tsx` pins it.
  **A skill is edited in the side pane, and only there** (2026-10-11). The skill page's Edit,
  *Edit to fix* on a refused draft, *Apply to editor* on an applied feedback rewrite, New skill
  and the chat card's Edit all go through `useOpenSkillEditor` (`open-skill-editor.ts`), which
  opens a `kind: 'skill'` pane item (key `skill:<library>/<name>`) — beside the skill's page when
  opened from there, since the pane is drawn on `/harness` too. The pane draws it through the lazy
  `skill-pane-view.tsx`, which is `EditPanel` over `useSkillEditor` unchanged, plus a Versions link
  back to the page (left out when that page is the one beside it). **The editor's state
  lives on the item** (`SkillEditSnapshot`: `loadedFrom`, `parent`, the working copy while it
  differs, and a rebase's `onto`/`base`/`mine`/`resolutions`), handed back on every change
  (`onKeep`) and read on the next mount (`kept`), because an inactive pane tab renders nothing —
  and losing a rebase in progress would let a save undo files the newer version changed.
  `useSkillBundle` takes the kept copy as `draft` once, on its first load, and guards that load
  against StrictMode's second effect run, which otherwise put the stored files back over it (the
  bug a first version shipped to dev; `tests/skill-library-actions.test.tsx` remounts under
  `StrictMode` on a warm cache to pin it). An apply-from-version refuses rather than replace an
  unsaved edit. The Versions tab no longer compares against "the editor".
  `tests/skill-editor-pane.test.tsx` and the `PaneShell` fixture cover the rest.
  **Skills from GitHub** are `management/skill-import.ts` and `components/skills/skill-import.tsx`:
  *Import from GitHub* (browse, then import one as a draft; a file inside the cooldown says the day
  it can be taken rather than offering an import the harness would refuse), *Imported skills*
  (`/-/upstream`, read from the recorded state, re-checked only on *Check now* — every check
  spends the tenant's hourly GitHub budget, so nothing here polls GitHub), *Check the source* on an
  imported skill's page (the harness's unified diffs, drawn as text, and the update saved as a
  draft), and *Adopt* on an import-lineage version with its required reason. The section hides on a
  404 (a harness without imports).
- **Labels** — `POST /chat/sessions/label` names a turn by the same event id `rewindChat` takes, and
  the snapshot's `labels` map reads them back. It was a write-only route here for a different reason
  than the rest: `SessionSnapshot` did not model the field the harness had always sent, so a label
  could be set and never seen. The chip renders outside the hover-revealed actions row, because
  finding the labelled turn again by scrolling is the whole point.
- **Editing a sent message** is rewind + send: the leaf moves to the edited message's
  `parentEventId` (never the message itself, which would leave the original in context), then only
  the new text is sent. The original stays on another branch, so the toast offers to restore it.
  This is also why `snapshotToEvents` walks `metadata.parent_id` from the leaf rather than slicing
  at it: after an edit the abandoned reply sits between the branch point and the leaf in `seq`
  order. A just-sent message has no parent id yet, so the edit hydrates first; the first message
  of a thread has nothing to branch from and offers no Edit.
- **Feedback** — `POST /chat/sessions/feedback` (`felix-run/felix#403`) rates an assistant turn;
  the snapshot's `feedback` map reads it back and each change is a `turn_feedback` audit event.
  A reply written in this tab has no event id, so `rateTurn` resolves one from the snapshot by
  position among same-role turns (`serverEventId`) and refuses when the counts disagree rather
  than rating the wrong answer. A thumbs-down with a note can file an eval case: the preceding
  user message, `llm_judge` against the note, created in the dataset if it does not exist. No
  note means no case, because there is nothing to judge against. The rating buttons render
  *before* the hover-hidden actions, so a saved rating sits at the edge instead of floating after
  invisible buttons.
- **Enter mid-run queues; it does not steer.** `POST /chat/steer` is irrevocable — the harness
  offers no way to list, edit or withdraw a queued message — and a `kind: "steer"` cancels the
  run's remaining tool calls the moment it lands. So the shell holds mid-run messages in
  `useMessageQueue` (per thread, in the tab), the composer draws them as a tray it overlaps, and
  the shell's drain effect sends the head as an ordinary turn once `streaming` drops. Steering is a
  per-row act, refused for a row with images (a steer is text only). Stop, a failed run, and
  arriving on a thread that already has a queue all **pause** it — sending the next step after
  any of those would be the client deciding to carry on. `draining` guards the gap an image
  upload opens between taking a message and `streaming` turning true; without it the next render
  takes a second one. `tests/queued-messages.test.tsx` pins all of it at the wire.
- **Other verbs** the UI drives: abort, steer/follow-up, continue, thinking level, rewind
  (`/chat/rewind` moves the active leaf), fork/compact/export, and full-text
  `/chat/sessions/search`. **Continue is for a turn that stopped short** — the harness refuses
  `nothing_to_continue` and `already_complete` — so `continueOffer` (`src/lib/continue-run.ts`)
  reads the last non-note turn and the phase, the Session menu leads with *Continue run* only
  then (otherwise it follows Copy thread id, disabled, saying why), and `/continue` toasts the
  reason instead of spending a request (2026-10-16, `tests/continue-run.test.tsx`).
- **The empty thread's greeting is the manifest's, unless it is about a folder that is not
  there** (2026-10-16). `felix.greeting` has one headline, and cowork's is "What should we do in
  this folder?" — over a readout saying *none mounted*. For an agent whose tools work in the
  browser (`inBrowser`) with no folder mounted, `Greeting` uses its own headline and says the
  tools work in the tab's storage until one is; the starters stay.

Each turn sends **only the new user message** — Felix replays thread history server-side.

### The terminal client

`apps/tui` is the same conversation without a browser. Its rules — config precedence, the
real-filesystem workspace, keyboard ownership, the renderer's traps and the test harness — are
in `apps/tui/CLAUDE.md`, which loads when you work under `apps/tui`.

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

The root `tsconfig.json` explicitly **excludes** `apps/chat-ui` and `apps/docs` (JSX / Astro virtual
modules don't resolve under the workspace options); those apps type-check via their own configs.

### Docs

Prose is MDX under `apps/docs/src/content/` — note **not** `src/content/docs/`; `content.config.ts`
overrides Starlight's loader base for that reason. New pages must also be added to the explicit
`sidebar` in `astro.config.mjs` (autogenerate is off). `src/styles/theme.css` is checked in but
generated from `@felix/design`'s `starlightThemeCss()` — change the tokens in
`packages/design/src/tokens.ts` and run `pnpm sync:theme`. Hand edits to the CSS are blocked by a
hook, because the next regeneration would silently revert them.

The docs have their **own `apps/docs/DESIGN.md`** ("The Operator's Manual"), a sibling of the root
one, which is chat-ui's. Impeccable treats a directory with a DESIGN.md as its project root, so
`/impeccable` targeted at `apps/docs` reads that file, and its detector stops judging the docs
against chat-ui's type ramp. The docs' surface brief lives at
`apps/docs/.impeccable/surfaces/src.md`, keyed to `src` and a few paths under it: a brief's
targets are **relative to that app root** and matched exactly, so `apps/docs` itself is rejected
as a target (`invalid-target`) — name `apps/docs/src` or a registered path. The sidecar
`apps/docs/.impeccable/design.json` is generated, so it is excluded from Biome like the root one.

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
- **Touch rules live in CSS, not in each component.** Text fields are 16px under
  `@media (pointer: coarse)` from an *unlayered* rule in `apps/chat-ui/src/index.css` — inside a
  layer, any `text-sm` would outrank it and iOS would zoom on focus. Hover reveals are gated on
  `[@media(hover:hover)]`, never on a width breakpoint, and dense controls grow with `coarse:`.
  `tests/touch-affordances.test.tsx` pins the first two by shape, since happy-dom evaluates
  neither media query.
- Node ≥ 20, pnpm 10.33.2 (`packageManager` pinned). React 19, Tailwind v4 (CSS-first, no config file).
