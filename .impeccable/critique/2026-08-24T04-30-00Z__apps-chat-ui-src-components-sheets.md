---
target: the four slide-over sheets (re-critique)
total_score: 24
p0_count: 0
p1_count: 3
timestamp: 2026-08-24T04-30-00Z
slug: apps-chat-ui-src-components-sheets
previous_score: 18
previous_timestamp: 2026-08-24T02-15-00Z
---
# Re-critique: the sheets

Target: `jobs-sheet.tsx` (238), `eval-sheet.tsx` (341), `manifests-sheet.tsx` (400),
`agent-sheet.tsx` (285), plus `error-notice.tsx`, `confirm-button.tsx`,
`sheet-boundary.tsx`, `lib/time.ts` and `packages/ui/src/sheet.tsx`.
Driven live against the harness on `:8080`, 1698×941, both themes.

**24 / 40 — Fair.** Up from 18 after PRs #48 and #49.

## Design Health Score

| # | Heuristic | Was | Now | Key issue |
|---|-----------|:---:|:---:|---|
| 1 | Visibility of System Status | 1 | **3** | Nothing confirms an irreversible activation succeeded; eval discards `started_at`, `duration_ms`, `tokens_*` that are on the wire |
| 2 | Match System / Real World | 3 | **2** | Raw API keys as labels: `max_tokens`, `checkpointer`, `full_replay`, `a2a peers` |
| 3 | User Control and Freedom | 1 | **3** | `ConfirmButton` is strong; still no undo and no sight of what you'd roll back *to* |
| 4 | Consistency and Standards | 1 | **2** | The error fix landed in jobs and not in eval or manifests; three focus-ring treatments |
| 5 | Error Prevention | 1 | **3** | Confirmations exist now, but `canaryValid` accepts versions that do not exist |
| 6 | Recognition Rather Than Recall | 2 | **2** | Production traffic is re-pointed by typing a version number from memory |
| 7 | Flexibility and Efficiency | 3 | **2** | Enter submits in eval and manifests but not jobs; no shortcuts, no deep links |
| 8 | Aesthetic and Minimalist Design | 3 | **2** | 45 `text-xs` to 8 `text-sm` across four files — the ramp exists and one step is used |
| 9 | Error Recovery | 0 | **2** | The mechanism is right; the wiring reports the wrong operation in two of four sheets |
| 10 | Help and Documentation | 3 | **3** | Good descriptions; three explanations live only in hover `title`, one on a disabled control |
| **Total** | | **18** | **24/40** | **Fair** |

The two PRs did what they set out to do. Error Recovery went 0 → 2, User Control 1 → 3,
Error Prevention 1 → 3. What is left is a different and more interesting class of problem:
the sheets are no longer *broken*, they are *undesigned*. Every remaining issue is a
decision that was never made, rather than a mistake that was made.

Two scores went **down**, and neither is a regression in the code. They are things the
earlier critique scored generously because more urgent failures were in front of them:
the type hierarchy (8) and the raw-API-key labels (2) were both true in the first pass.

## Anti-Patterns Verdict

**Deterministic scan:** `detect.mjs` over all eight files returns **0 findings**, exit 0.

**LLM assessment:** not AI-generated, and the evidence is the commentary. `confirm-button.tsx:50-53`
("Measured on the approval buttons, where ten clicks produced ten POSTs"), the window-capture
Escape rationale at `:62-70`, the null-versus-empty note at `jobs-sheet.tsx:51-54`. No generator
writes those; they are notes from someone who watched the thing fail.

The honest counter-evidence is not slop but **absence of decision**: four sheets, four vertical
stacks of `rounded-md border` boxes at one type size, differing only in which fields they list.
Nothing about the manifest sheet *looks* like it moves production traffic.

**Measured craft**, canvas-composited OKLCH (method validated at 7.59:1 for `muted-foreground`
on `background`):

| Check | Result |
|---|---|
| Contrast, Jobs / Eval / Manifests | **0** failures |
| Contrast, Agent spec | **9** failures — the `—` placeholder, 2.65:1 dark, 2.04:1 light |
| Target sizes | all ≥ 24×24 ✓ |
| Buttons without an accessible name | 0 ✓ |
| **Inputs** without an accessible name | **3** ✗ |
| Horizontal overflow | none ✓ |
| Focus trap / Escape | correct ✓ |
| `prefers-reduced-motion` | present ✓ |
| Widths | 448 / 576 / 576 / 576 ✓ |

One correction to my own method: a first pass flagged "Import as version" at 1.12:1. That was a
bug in the measurement, not the button — it composited from `parentElement` and so skipped the
button's own background. Re-measured from the element itself, it passes. The nine `—` failures
survive the corrected method.

## P1 — Two production-traffic controls have no accessible name

Verified in source, not inferred:

- `manifests-sheet.tsx:311` — the canary weight slider is a bare `<input type="range">` with no
  `aria-label`, no `<label>`, no `title`. It announces as **"slider, 25"**. It decides what
  percentage of live traffic moves to a new version.
- `manifests-sheet.tsx:377` — the manifest JSON editor has `aria-invalid` and `aria-describedby`
  and **no name of any kind**. That is my own work from #49: I wired a description onto a control
  that has nothing to describe.
- `eval-sheet.tsx:278` — same, with only a placeholder, which disappears on input (WCAG 3.3.2).

This is systemic. Across all four sheets: **zero `<label>` elements**, **two** `aria-label`s
total — and one of those is on a decorative canary glyph (`manifests-sheet.tsx:129`), not a
control. Also zero `aria-pressed` on the dataset and manifest pickers, whose selected state is
carried by `variant="secondary"` alone, and zero `aria-expanded` on the Runs disclosure.

Unambiguous WCAG 2.2 **4.1.2** failures, in the sheet that re-points production traffic.

## P1 — The app's focus ring fails WCAG 1.4.11, in both themes

Not sheet-specific — it comes from the shared `@felix/ui` Button and reaches every control in the
app — but it is measurable here and PRODUCT.md says AA is enforced.

| Theme | Ring vs page background | Ring vs control surface | Floor |
|---|---|---|---|
| Dark | **1.84:1** | **1.27:1** | 3:1 |
| Light | **1.55:1** | **1.51:1** | 3:1 |

The ring is `ring-ring/50` at 3px. Halving the alpha is what costs it: the token itself is fine,
the 50% is not. It fails against *both* adjacent colours, so there is no reading of 1.4.11 that
rescues it.

The sheet close button is the exception at **4.12:1** — it uses a different treatment
(`ring-2` + `ring-offset-2`, full alpha) which passes. So the app has two focus vocabularies and
the less-used one is the correct one. A third exists on the hand-rolled textareas
(`focus-visible:ring-1`), thinner than either.

## P1 — Error notices name the wrong operation

`ErrorNotice` takes a `doing` verb phrase and builds "Could not {doing}". In two of four sheets
that phrase is hardcoded once and shared by every failure path:

- `manifests-sheet.tsx:101` — `doing="reach the manifest registry"`, reached by **five** sources:
  list refresh (`:57`), import (`:77`), activate / canary / clear (`:208`), save version (`:222`).
- `eval-sheet.tsx:89` — `doing="reach the eval harness"`, reached by **six**.

So a failed **activation** — the highest-stakes operation in the product — reports *"Could not
reach the manifest registry."* The operator cannot tell from that sentence whether traffic moved.
Peak-end: this is the last thing they read.

`jobs-sheet.tsx` does it correctly, with three separate phrases (`:122`, `:135`, `:230`). The
pattern is right there in the same PR; it was applied to one sheet of three.

Compounding: both sheets clear `error` only inside their list refresh (`eval:48`, `manifests:54`),
so a failed write leaves a stale red alert standing while the operator carries on.

## P2 — Production traffic is re-pointed from memory

`manifests-sheet.tsx` renders no version list. The harness has no version-list route, which the
file acknowledges (`:27-29`) — but the response was to build free-text version entry on top of the
gap. So Activate and Apply canary are typed from recall, `canaryValid` (`:244`) accepts any
positive integer including versions that do not exist, and `targetValid` (`:247`) silently
disables the button when you type the version already active, with no reason given.

The note explaining the missing history renders only when `editor == null`, at the bottom of a
ScrollArea (`:412-415`) — far from the field it explains.

## P2 — Everything renders at the caption size

`--text-xs` is 11px and the ramp comment reserves it for "timestamps, counts, badges, captions",
with 13px `sm` for "rows, labels, controls, instructional copy". Measured across the four sheets:

| File | `text-xs` | `text-sm` | `text-base` |
|---|:---:|:---:|:---:|
| jobs | 12 | 4 | 0 |
| eval | 11 | 3 | 0 |
| manifests | 18 | 1 | 0 |
| agent | container-level | 0 | 0 |

45 to 8, zero. Job names, eval item bodies, the JSON editor and instructional copy all sit at the
caption floor, so nothing ranks. The type ramp landed one commit before these sheets were last
touched and they use one step of it. This is PRODUCT.md's own anti-reference: density without
hierarchy.

## What is genuinely good

1. **`ConfirmButton` answers four named failure modes**, not a generic "are you sure": the
   confirm echoes the *resolved* consequence so it catches typos rather than mis-clicks; focus
   moves onto it; the double-fire guard is a ref because batching made state useless; Escape is
   caught at window-capture because Radix's document-capture listener runs first. Each is a
   specific bug with a specific mechanism.
2. **The asymmetry is right.** Activate and Apply canary arm; Clear canary fires immediately,
   because it is the rollback. Most interfaces confirm uniformly and put a speed bump in front of
   the control an operator needs while a rollout is failing.
3. **Three-way run state** (`jobs-sheet.tsx:51-54`): `null` is "not loaded", `[]` is "never ran",
   and they render differently. One line that removes a lie at the moment the answer matters.
4. **`SheetBoundary`** wraps each sheet rather than the group, and re-renders sheet chrome in its
   fallback so the failure stays dismissable. Both correct, neither obvious.

## Not verified

Narrow-viewport behaviour. `resize_window` moved the OS window but not the layout viewport
(`innerWidth` stayed 1698), so the sub-`sm` full-width path is correct by construction and
**untested empirically**. Same tooling limit that blocked the 4K check in the first critique.

## Recommended sequence

1. Add a `Label` primitive to `@felix/ui` and give every field in these four sheets a real name,
   starting with the traffic slider and the JSON editor. Add `aria-pressed` to the pickers and
   `aria-expanded` to the Runs disclosure.
2. Raise the focus ring to ≥3:1 (drop the `/50`, or thicken with an offset like the close button
   already does) and settle on one treatment across Button, Input and the textareas.
3. Thread the verb through the error path in eval and manifests, as jobs already does, and clear
   the action error when an action starts.
4. Give manifests a client-side version record and inline reasons for disabled controls.
5. Promote row content and instructional copy to `text-sm`; keep 11px for metadata and badges.
