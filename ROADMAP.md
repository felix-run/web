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

---

## Sheets

### Labels name the API field, not the thing

`agent-sheet.tsx` prints wire keys verbatim: `max_tokens`, `checkpointer`, `full_replay`,
`a2a peers`, `mcp servers`. PRODUCT.md asks for the opposite — labels that name the thing. This is
the single largest remaining gap for the second audience the brief names, a viewer meeting the
product cold.

Same file, related: the Connectivity section renders six rows that on a typical manifest are all
`—`, at the same visual weight as Governance. A panel of absences.

**Size:** small. A label map, and a decision about whether empty Connectivity rows earn their space.

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

### Three explanations are hover-only, and one can never be read

`title` attributes carrying real information: 2 in `eval-sheet.tsx`, 3 in
`manifests-sheet.tsx`. They are invisible to touch and to keyboard.

One is worse than invisible. `eval-sheet.tsx:193-198` sets
`disabled={running || items.length === 0}` and `title={items.length === 0 ? 'Add an item first' : …}`
— so the explanatory half of that tooltip only exists in the state where the element is disabled,
and **disabled elements do not fire mouse events**. The one message that tells you how to proceed
is the one nobody can see.

**Size:** small. Inline the reason, as the manifest sheet now does for its refusals.

### A failing eval run is the quieter thing

`eval-sheet.tsx:322` renders the run badge as
`variant={run.fail_count === 0 ? 'default' : 'secondary'}` — `default` is the primary fill,
`secondary` is muted grey. A clean run shouts and a failing run whispers, which is backwards. The
score rows eighteen lines below get it right, using `text-state-done` / `text-state-failed`.

**Size:** trivial, but decide it against the state palette rather than swapping the two variants.

### Two readings of one canary state, sixty lines apart

`manifests-sheet.tsx:418` shows "none in flight" when `liveCanaryV != null && liveWeight > 0` is
false. `manifests-sheet.tsx:477` keeps **Clear canary enabled** whenever `liveCanaryV != null`. So a
canary pinned at 0% reports itself as absent while offering a button to clear it.

**Size:** trivial. Pick one definition of "in flight" and use it in both places.

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

### `usePoll` stringifies errors before anything can read them

`usePoll.ts:33` does `setError(String((err as Error)?.message ?? err))`. `ErrorNotice` and
`describeError` both want the raw error: an unreachable harness is identified by the `TypeError`
that `fetch` rejects with, and stringifying first throws that away. It currently survives on a
regex fallback matching "failed to fetch", which is fragile and locale-adjacent.

`error-notice.tsx` documents this hazard in its own docblock, and `jobs-sheet.tsx` then feeds it a
stringified error anyway — the one caller that cannot avoid it.

**Size:** small, but it ripples: the hook's public `error` type changes, and the inspector and its
tests consume it.

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

---

## Unverified

**Narrow-viewport behaviour of the sheets.** Below the `sm` breakpoint `SheetContent` is `w-full`
with no max-width, so full-bleed is correct *by construction*, but it has never been confirmed in a
browser: `resize_window` moves the OS window without moving the page's layout viewport
(`innerWidth` stayed 1698 at a 390px window), so the breakpoint never engaged. The same limitation
blocked a 4K check in an earlier pass.

Needs a real device, a browser whose device-emulation the tooling can drive, or a test that asserts
on the classes rather than the rendering.

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
