---
target: toaster toast
total_score: 34
p0_count: 0
p1_count: 0
timestamp: 2026-09-02T02-57-25Z
slug: apps-chat-ui-src-main-tsx-toaster-toast-call-sites
---
Re-run after five merged PRs (#112, #113, #114, #115, #116). Same target, same slug.

## Design Health Score

| # | Heuristic | Score | Was | Key Issue |
|---|-----------|-------|-----|-----------|
| 1 | Visibility of System Status | 3 | 2 | No history: once an error is dismissed it is gone. |
| 2 | Match System / Real World | 4 | 3 | `describeError` now reaches every failure. |
| 3 | User Control and Freedom | 3 | 2 | Persistent errors have no dismiss-all. |
| 4 | Consistency and Standards | 3 | 1 | One sentence still goes out on two channels (below). |
| 5 | Error Prevention | 4 | 1 | Guards run before the text is consumed, not after. |
| 6 | Recognition Rather Than Recall | 3 | 2 | Nothing records what already failed. |
| 7 | Flexibility and Efficiency | 3 | 2 | ⌥T exists and is announced, but never shown. |
| 8 | Aesthetic and Minimalist Design | 4 | 1 | The surface is the app's own now. |
| 9 | Error Recovery | 4 | 1 | Retry where safe; no copy affordance. |
| 10 | Help and Documentation | 3 | 2 | The messages are the help; nothing leads onward. |
| **Total** | | **34/40** | **17/40** | **Good** |

## Anti-Patterns Verdict

**LLM assessment.** The register clash is gone. The toast reads as part of this app: its own state tokens, its own font and radius, 200ms motion, and a surface sitting 1.29:1 above the page rather than 18.97:1. The previous verdict was that this layer was *undesigned* rather than AI-generated; it is now designed, and the reasoning is in the file rather than in a PR description.

**Deterministic scan.** `detect.mjs --json apps/chat-ui/src` returns **3 findings, all in `index.css`, and all three are false positives**:

- `flat-type-hierarchy` (12/14/16px, 1.3:1) reads the token block. The product register asks for 1.125–1.2 between steps in app UI; 1.3 already exceeds it. Wrong register applied to a product surface.
- `em-dash-overuse` (210) counts **CSS comments**, not copy. This file is deliberately heavy on prose comments and that is the house style.
- `numbered-section-markers` (01, 03, 10, 11, 12) is reading digits out of `oklch()` values and percentages.

Worth noting: the first run of this critique scanned the same directory and returned `[]`. The difference is my own commentary in #113 and #116 crossing the em-dash threshold, which is a fair reminder that the check exists. So I ran the real version of it against user-facing strings, which is what the rule is actually about: **five em dashes remain in UI copy, none of them in this target** — `gate.tsx:61`, `thread-list.tsx:238`, `presence.ts:26-27`, and `agent-sheet.tsx:134` (that last one is an em dash as a "no value" placeholder, which is correct typography). The toast layer's one em dash was removed in #115.

**Browser evidence.** Measured on settled toasts against a live harness across the five PRs, and re-measured after #116:

```
theme            follows the app in both directions (was hardcoded "light")
fill             oklch(0.264 …) dark / oklch(0.944 …) light, opaque
title contrast   6.35:1 dark, 6.99:1 light        (was 4.35:1, below AA)
success/info/warning on their own tints: 9.79 / 9.02 / 10.22 dark
border           state colour at 65%, ≥3.56:1 vs page   (WCAG 1.4.11)
header bottom    48        toast top 60           (was 31, across the header)
close button     24 × 24 at top 53                (was 20 × 20, SC 2.5.8)
z-index          60                               (was 999999999)
radius/font/dur  10px / inherited / 200ms         (was 8px / vendor / 400ms)
persistence      error still on screen after 8s, Retry re-issued the request
selection        dragging the detail selects; data-swiping stays false
```

## Overall Impression

The instrument panel's most irreversible moments are no longer handled by its least considered surface. What is left is not defects so much as two consequences of the fixes and three small edges.

The biggest remaining opportunity is the one the original critique named and none of the five PRs addressed: **there is still no record of what happened.** Errors persist until dismissed, which is a large improvement, but the moment one is dismissed it is gone, and an operator who steps away during a burst of failures comes back to a stack rather than a log.

## What's Working

1. **`lib/error-toast.tsx` is the right shape.** One reporter, and `retry` as a property of the *operation* rather than of the error, with the reason recorded at each refusal ("a steer that failed on the response rather than the request would queue the same message into the run twice"). That is a distinction most codebases get wrong by deriving retryability from a status code.
2. **Prevention moved ahead of reporting.** `refusal` is one derived value behind the send button, the composer hint and the Enter key. The bug it closed was specific and invisible: `SendOrStop` swaps in a `type="button"` Stop mid-run, so PromptInput's `submitButton.disabled` check had nothing to find.
3. **The state palette is now shared.** A failed toast and a failed tool card are the same red, from the same token, verified at the same contrast.

## Priority Issues

### [P2] Persistent errors stack, and there is no way to clear them

`toastError` sets `duration: Infinity`. Sonner's `visibleToasts` default is **3** and is not overridden, and nothing in the app calls `toast.dismiss()`. Five failures in a row (the harness going down mid-session is the obvious case, where several actions and polls fail together) leave a stack that must be dismissed one at a time, each ✕ a 24px target, with the rest queued behind.

**Why it matters.** This is a cost the persistence fix introduced. It is the right trade against a 4-second error, but it is currently unbounded in the wrong direction.

**Fix.** Either cap it (`visibleToasts` stays 3 and older errors collapse into "3 more failures" that opens a list), or give the group a single "Dismiss all" once more than one error is up. The second is cheaper and does not need a new surface.

**Suggested command**: `/impeccable harden`

### [P2] Errors still announce as politely as acknowledgements

Sonner renders one `<section aria-live="polite">` for every toast and exposes no per-toast politeness, so "Steer queued" and a failed approval arrive at identical urgency. This was investigated in #116 and left deliberately: escalating the region makes acknowledgements interrupt, a nested `role="alert"` inside a subtree inserted all at once is not reliably re-announced, and mutating a third-party node's `aria-live` at runtime would catch whatever else is on screen.

**Why it matters.** It is the one accessibility finding from the first run still open, and PRODUCT.md treats these as defects rather than polish.

**Fix.** The honest one is upstream or around the dependency: either a patch that accepts a politeness per toast, or an app-owned assertive live region that renders error text *instead of* letting sonner's region carry it, which requires suppressing the polite announcement rather than adding a second.

**Suggested command**: `/impeccable audit`

### [P3] One sentence, two channels

`REATTACHING_REFUSAL` is shared, which fixed the wording, but not the treatment. `multimodal-input.tsx:308` sends it through `refuseSubmit` → `toastProblem` (error styling, persists). `App.tsx:680` sends the same string through `toast.message` (neutral, dismisses in 4s). The same refusal looks like two different events depending on which guard caught it — which is the exact failure the shared constant was meant to end.

**Fix.** Route `App.send`'s guard through `toastProblem` too. One line.

**Suggested command**: `/impeccable polish`

### [P3] `/x is not available in this client yet` is still a dead end

The copy is now accurate, which it was not before. It still tells the operator only what does not work. The commands that *do* exist are one keystroke away in the same menu, so this could name them.

**Suggested command**: `/impeccable clarify`

## Persona Red Flags

**Alex (Power User).** Much better: Retry removes the round trip to the harness logs for a transient 5xx, and an error no longer vanishes before it can be read or copied. Still hits the stack problem first, because a power user is exactly who generates five failures in a row, and still has no dismiss-all. ⌥T focuses the toasts and nothing on screen says so.

**Sam (Accessibility-Dependent).** The two things that were measurable are fixed: 24×24 target, and contrast that clears AA on every state in both themes. The announcement-urgency gap is unchanged and is now the only open a11y item on this surface. The region is labelled "Notifications alt+T", so it is at least reachable, and errors persisting means a polite announcement arrives to find the toast still there.

**The Supervising Operator (PRODUCT.md).** The rule was "a signal that exists only in the viewport does not exist". Delete and rewind still gate their undo behind a toast, but the delete undo is now honest when the window has closed rather than silently half-restoring. The deeper form of the finding stands: an operator who looks away during a failure has no record of it afterwards.

## Minor Observations

- No copy affordance on the detail. Selection works and persistence gives unlimited time, so this is smaller than it was, but one click would beat a drag.
- `toast.success('Context compacted', { id: pending })` reuses the loading toast's id, so compaction reads as one object changing state. Worth keeping in mind as the pattern if another long operation appears.
- The `--z-toast: 60` token is the only z-index in the app that is not `z-50`. That is deliberate and commented, but it does mean the "scale" is two values, one of which is a Tailwind utility nine primitives repeat.
- `visibleToasts` is left at sonner's default rather than set explicitly, so the stacking behaviour above is inherited rather than chosen.

## Questions to Consider

- What would a notification *log* cost here? The inspector already has panels for audit events and activity; failures are arguably the same kind of record, and that would close both the history gap and the stack problem at once.
- Is "Steer queued" a toast because it belongs in a toast, or because a steer writes nothing into the transcript? If a steer rendered as a pending turn, the toast would not be needed and the run would read correctly on reload.
- The delete and rewind undos both live in toasts. If an operator is assumed not to be looking, what is the version of undo that survives them looking away?
