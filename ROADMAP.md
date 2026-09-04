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

### Explanations that only a mouse can reach

Two `title` attributes still carry information a keyboard or touch user cannot get at:
`manifests-sheet.tsx:153` (`Canary vN at W%`) and `eval-sheet.tsx:480`, which is the worse of the
two — it holds the judge's `reasoning`, the actual output of an eval, on hover over a line that is
also cut at 80 characters with no way to expand.

The third instance shipped: the run button's `title` explained why it was disabled, on an element
that being disabled could never fire the event to show it. That one is inline now, and
`tests/eval-sheet.test.tsx` pins it.

**Size:** small for the canary badge; the eval one is part of the run-card redesign below.

### The eval run card throws away its own instrumentation

`EvalRun` carries `started_at` and `finished_at`; `ItemScore` carries `duration_ms`,
`tokens_input`, `tokens_output`, `tool_call_count` (`types.ts`). The run card renders **none** of
them — measured: zero references in `eval-sheet.tsx`. Runs stack with no timestamp and no ordering
cue, so two runs of the same dataset are indistinguishable. PRODUCT.md names "what did it cost" as
one of three questions the surface must answer at a glance.

Worse, the judge's `reasoning` — the actual output of an eval — is reachable only through a hover
`title` (`eval-sheet.tsx:340`), and `response` is cut at 80 characters
(`eval-sheet.tsx:341`) with no ellipsis and no way to expand.

**Size:** medium. The data is already in hand; this is a card redesign, and `Collapsible` already
exists in `@felix/ui`.

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

### Seven harness routes nothing calls

`pnpm check-api-drift` prints twenty, up from sixteen when this was written — a contract re-sync on
2026-09-03 (#130) found the records were pinned to a harness fifty commits old. Thirteen of the
twenty are machine-facing (`/health`, `/metrics`, `/mcp`, `/a2a`, `/v1/chat/completions`, and so on)
and belong there. Seven are not:

- **`/documents` — a whole area, and the largest unbuilt thing on this list.** `GET` and `POST
  /documents`, `GET /documents/search`, `DELETE /documents/{doc_id}`: list, add, search, forget, the
  same four verbs `/memory` has and which both clients already have a shape for. Nothing calls any
  of it.
- `PUT /plans/{}` — editing a plan. chat-ui reads plans and cannot change one.
- `POST /eval/runs` — starting an eval. The inspector shows runs and cannot start one.
- `POST /chat/sessions/custom` — no client touches it at all.

CLAUDE.md calls that advisory list "the direction where a whole unbuilt feature shows up", and
`/documents` is precisely that. Each is a feature to scope rather than a bug to fix.

**Note for whoever builds `/documents` in the terminal:** the inspector's tab strip is full. Seven
tabs at `TAB_WIDTH = 10` use 70 of the 72 columns available at eighty. An eighth needs the strip
rethought, not a smaller number.

### `MemoryRecord` models six fields fewer than the harness sends

`pnpm check-payload-shapes` reports `tenant_id`, `updated_at`, `thread_id`, `embedding_dim`,
`embedding_model` and `embedding_json` as unmodelled. The type moved in #132 and now lives at
`packages/felix-client/src/management/memory.ts`, so a terminal client reads the same rows. Advisory, and mostly correct — a row carries
more than one panel needs. But `embedding_model` and `embedding_dim` are the two that answer "why
did recall miss this", which is the question the memory inspector exists for, and `updated_at`
distinguishes a fact that was rewritten from one that was not.

The equivalent advisory on `ApprovalRequest` turned out to be hiding a real gap (#127), so this one
is worth reading rather than assuming benign.

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

**No approval has been driven end to end against a real gated tool.** Everything the approval
banners do — the deadline, the countdown, the lapsed state, the rule and reason, the diff — was
built and checked against `PendingApproval` objects constructed in tests, plus the harness source
read directly. The client has been run against the live harness on `:8080` repeatedly, but never
with a manifest whose rules actually gate a call, so no `approval_required` frame and no
`/approvals` row has been observed in flight.

Three things are therefore claimed rather than seen: that the frame's `reason` is populated in
practice (it is optional on the wire), that the poll's backfill lands within a tick or two of the
frame, and that a decision posted with `edited_args` is accepted by the deployed route — the
committed OpenAPI snapshot documents no request model for `/approvals/{id}/decide`, so the field
names are taken from the harness's own SDK rather than from a schema.

Needs a manifest with an approval rule and one gated call.

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
