# Roadmap

Known, unaddressed work. Everything here has been **seen** — either measured in a running app or
read in the code, with the evidence recorded next to it. Nothing on this list is a guess about what
might be wrong.

Two rules keep it honest:

- **Cite the evidence.** A finding without a file, a line, or a measurement is a hunch, and hunches
  belong in an issue, not here.
- **Say what has not been checked.** The [Unverified](#unverified) section exists because "we did
  not look" and "we looked and it was fine" are different states, and conflating them is how a gap
  survives three reviews.

Items are removed when they ship, not when they are planned.

## Origin

The chat-ui sheets — jobs, eval, manifests, agent spec — were critiqued twice (`.impeccable/critique/`),
scoring 18/40 then 24/40. Four PRs closed the correctness, consistency, accessibility and
recognition findings: #48, #49, #51, #52. What follows is what those passes found and did not fix.

Four more closed in #139: the wire-key labels, the explanation on a disabled button that could never
fire, the badge that drew a failing run quieter than a passing one, and the canary that reported
itself absent while offering to clear itself.

---

## Sheets

*The critiques' correctness, consistency and recognition findings are closed. What is left is the
one entry that was never a defect.*

### Four workbenches behind one unlabelled ellipsis

Eval, jobs, manifests and the agent spec are reachable only from the toolbar overflow menu
(`aria-label="More tools"`). No shortcut, no URL, no second entry point. PRODUCT.md sets the bar at
"one glance at the right rail" and asks that a cold viewer see the machinery is on display
deliberately.

This is the one item on the list that is a **question, not a defect**: the sheets may be papering
over the absence of a home for this material rather than merely being hard to find. Worth deciding
before adding a fifth sheet.

**Size:** unknown — that is the point. Scope it before building.

---

## Cross-cutting

### The button size ramp exists and nothing uses it

`packages/ui/src/button.tsx:23` defines `size="xs"` (`h-6`). Repo-wide usage: **zero**. Meanwhile
the sheets carry ad-hoc `h-6` / `h-7` / `h-8` overrides, and `h-7` is not a step in the primitive's
ramp at all.

Same shape: `packages/ui/src/textarea.tsx` exists and is imported **zero** times, while two sheets
hand-roll a raw `<textarea>` with their own focus styling.

**Size:** small, mechanical, and it removes a class of drift rather than an instance.

### Unbounded pickers

The dataset picker (`eval-sheet.tsx`) and the manifest picker (`manifests-sheet.tsx`) wrap without a
height cap. Twenty datasets pushes the working panel off-screen. Not reproduced — the local harness
has one of each — so this is read from the code, not measured.

### chat-ui defines colours the design package now owns

`packages/design/src/tokens.ts:106,114` exports `STATE_LIGHT` / `STATE_DARK` — the blocked / done /
running / failed / danger ramp — and `apps/tui/src/theme.ts` reads them. `apps/chat-ui/src/index.css`
still declares its own values for the same five states, twice, at `:122-128` and `:187-190`.

The tokens were promoted out of that stylesheet for the terminal client's benefit, and the
stylesheet was left as it was, so the package's own docstring — "the single source of truth for the
palette" — is true in one direction only. Two definitions of one ramp is the shape that drifts.

Note the formats differ on purpose: chat-ui's are `oklch()` because CSS wants them and the design
package's are sRGB hex because neither a terminal nor `RGBA.fromHex` takes `oklch()`. Aligning them
means deciding which is canonical and generating the other, not deleting one.

**Size:** small, but it is a decision before it is an edit.

### Four harness routes nothing calls

`pnpm check-api-drift` prints seventeen, down from twenty-one once `/documents` was built. Thirteen
are machine-facing (`/health`, `/metrics`, `/mcp`, `/a2a`, `/v1/chat/completions`, and so on) and
belong there. Four are not:

- `GET /usage/summary` — the inspector's usage panel reads `/usage` and aggregates in the client,
  which is the shape this route exists to replace.
- `PUT /plans/{}` — editing a plan. chat-ui reads plans and cannot change one.
- `POST /eval/runs` — starting an eval. The inspector shows runs and cannot start one.
- `POST /chat/sessions/custom` — no client touches it at all.

CLAUDE.md calls that advisory list "the direction where a whole unbuilt feature shows up". What is
left is smaller than what came off it: three single routes and one aggregate.

### `MemoryRecord.embedding_json` stays unmodelled, on purpose

`pnpm check-payload-shapes` reports it as a field the harness sends that nothing models. That is
expected rather than an omission, and it is recorded here so the advisory line does not read as work
nobody got to: the column is documented in the harness as **deprecated and never populated**,
superseded by the pgvector `embedding` column, and slated for removal once its backfill has run
everywhere. Modelling it would be modelling a `null` with a deletion date.

The other five — `updated_at`, `thread_id`, `tenant_id`, `embedding_dim`, `embedding_model` — were
modelled on 2026-09-11, and the embedding pair is rendered: a memory row says `lexical only` when no
embedder ran for it, which is the answer to "why did recall miss this". `UsageEvent` gained
`wire_model_id` and `cost_usd` in the same pass.

**Size:** nothing to do until the harness drops the column, at which point this entry goes too.

---

## Terminal client

### The keyboard is layers in all but name

**Half of this shipped in #133 and #134.** The switch is out of `app.tsx` and into
`apps/tui/src/keys.ts` as a pure `route(key, state) -> Action | null`, with 29 tests that run in
milliseconds rather than by mounting the app. Writing it down settled the thing the original note
got wrong about its own mechanism: **`preventDefault()` does not stop another global handler** — it
gates only the *focused* renderable — and because React runs child effects first, the three banners
in `prompts.tsx` subscribe *before* `App` does. So mutual exclusion was never enforced by
`preventDefault`; it is the `blocked` early return, and that is now a test rather than a sentence.

What remains is the adoption itself. There are still five `useKeyboard` calls (one in `app.tsx`, one
in `composer.tsx`, three in `prompts.tsx`), and `@opentui/keymap` would replace the hand-rolled
precedence with layers carrying priorities and `enabled` predicates. The remaining prize is
`/help`: it is a hand-maintained string in `commands.ts` beside the `COMMANDS` switch, so an
undocumented command is still possible, and a keymap table would generate it.

Two things it does **not** solve, which the original note got right: no focus-traversal API (tab
order stays hand-rolled), and it cannot express the picker's catch-all "every printable character is
filter text" — that needs an intercept or a `useKeyboard` behind the layer.

It pins `@opentui/core` to an exact version, so it lands with a version bump or not at all.

**Size:** medium, and smaller than it was — the risky half (deciding and pinning the precedence
chain) is done. Provider, App layer, picker layer, the three banners, then generate the help panel.
Leave the composer's `CHAT_BINDINGS` alone.

### Every code frame carries one empty row, and the obvious fix is wrong

`apps/tui/src/ui/transcript.tsx:61-65` documents it: `CodeRenderable` measures itself one line
taller than its content, which is invisible unframed and an obvious gap inside a border.

Pinning the box height *does* close it and is a regression — the buffer wraps, so a long line in a
narrow terminal needs more rows than it has lines, and a pinned height silently drops everything
past the fold. A two-line block rendered as one. That was tried, measured, and reverted.

Recorded so the next person does not re-attempt it. A real fix needs the wrapped line count, which
is not known until after layout, or a change upstream.

**Size:** small if upstream fixes the measurement; otherwise not worth it.

---

## Unverified

**Narrow-viewport behaviour of the sheets.** Below the `sm` breakpoint `SheetContent` is `w-full`
with no max-width, so full-bleed is correct *by construction*, but it has never been confirmed in a
browser: `resize_window` moves the OS window without moving the page's layout viewport
(`innerWidth` stayed 1698 at a 390px window), so the breakpoint never engaged. The same limitation
blocked a 4K check in an earlier pass.

Needs a real device, a browser whose device-emulation the tooling can drive, or a test that asserts
on the classes rather than the rendering.

**Both approval unknowns were closed on 2026-09-11** and are recorded here only so the next person
does not re-measure them. The screening gate (`apply_command_screening` → `_await_approval`, a
`decision: require_approval` command rule) fires ~1s after `tool_start` like the rule gate does, and
names itself differently: `rule_id` is the synthetic `command:<reason>` and `reason` repeats it
verbatim, which is why `approvalRuleLabel` exists. A durable run surfaced its approval **9.1s** after
`POST /chat` returned `202` — nearly all of it the worker reaching the gated call, since the row is
visible the moment it is written and a client polling every 2.5s adds at most that. The durable path
has no frame at all: side events are an in-process queue keyed by thread id, and the agent is in the
worker while the stream is served by the API.

---

## Environmental, not code

**The local harness is older than the committed OpenAPI snapshot.** `POST /manifests/{name}/rollback`
— the route `activateManifestVersion` calls — returns 404 against the harness on `:8080`, and that
harness's agent card omits `transparencyNotice`, which `build_agent_card` sends. So **Activate
cannot currently succeed locally**, independent of any client change.

`pnpm check-api-drift` cannot catch this by design: it diffs the client against
`harness-openapi.json`, a committed snapshot, not against whatever is running. A snapshot ahead of
the deployed harness looks identical to a snapshot in sync with it.

Worth knowing before debugging the manifest sheet, and worth considering whether the drift check
should be able to run against a live `/openapi.json` as well as the snapshot.
