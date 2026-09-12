---
target: chat-ui (whole app)
total_score: 26
p0_count: 0
p1_count: 2
timestamp: 2026-08-23T22-38-55Z
slug: apps-chat-ui-src
---
# Critique: chat-ui (whole app)

Target `apps/chat-ui/src`, inspected live against the harness on `:8080`. The previous critique scoped to the two rails; this one covers the surfaces that work never touched: composer, transcript, tool cards, greeting, and the interrupt banners.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Strong. Streaming, tool phases, presence in the tab title, per-section live regions all land |
| 2 | Match System / Real World | 3 | `summarizeToolArgs` is excellent; the greeting still shouts a raw manifest slug as its eyebrow |
| 3 | User Control and Freedom | 2 | Rewind moves the server leaf from a hover icon with a two-word tooltip and no confirmation |
| 4 | Consistency and Standards | 2 | Two different approval UIs for the same decision; 13 uppercase eyebrows as default grammar |
| 5 | Error Prevention | 2 | The banner emphasises Approve, places it above the evidence, and hides 52% of the diff |
| 6 | Recognition Rather Than Recall | 3 | Per-manifest starters, tooltips, event help titles, slash commands |
| 7 | Flexibility and Efficiency | 2 | Composer is rich (steer, background, slash, thinking); navigation has no shortcuts at all |
| 8 | Aesthetic and Minimalist Design | 3 | Type ramp and state palette did their work; eyebrow grammar and the wide-viewport void remain |
| 9 | Error Recovery | 3 | Translated messages, per-section retry, boundaries that recover |
| 10 | Help and Documentation | 3 | Contextual titles and instructive empty states; no route to real docs |
| **Total** | | **26/40** | **Acceptable** |

Up from 18/40. The eight points came from the rails work; the remaining debt sits almost entirely in surfaces that have never been reviewed.

## Anti-Patterns Verdict

**Deterministic scan:** `detect.mjs` over `apps/chat-ui/src` returns **0 findings**, as it did last time. No gradient text, no side stripes, no purple-cyan palette, no hero metrics.

**LLM assessment:** one genuine tell has become systemic. `text-xs font-medium uppercase tracking-wide text-muted-foreground` now appears **13 times across 9 files**: the greeting's manifest name, both interrupt banners, the banner's Before/After labels, tool card Input/Output, the history rail's Server group, and four sheets. That recipe is the app's default answer to "this is a label", which is exactly the point at which a kicker stops being voice and becomes grammar. It is also, at 11px uppercase and tracked, the least readable text in the product.

Second, milder: the greeting's starters are a 2x2 grid of four identically-structured bordered cards. Not the endless icon-heading-text grid the ban targets, but the same reflex at small scale.

**Browser evidence:** no injected overlay. This is an authenticated SPA driven by a live harness, so evidence is direct DOM measurement plus a stubbed approval queue to force the interrupt path. Every number below carries its measurement.

## Overall Impression

The parts that have been worked on are now good, and the difference is stark. The transcript reads well, errors explain themselves, state has one meaning, and the rails hold up. What the previous pass never looked at is where the product is still weakest, and the pattern is consistent: **the surfaces that ask for a decision are the least designed ones.**

The single biggest opportunity is the approval banner. It is the most consequential control in the product, it is the one an unattended run drives an operator back to, and it is currently arranged so that the safest way to use it is to not read it.

## What's Working

1. **`summarizeToolArgs` writes better copy than most of the app.** A pending write renders as "Write notes/todo.md (97 chars)": the verb, the target, and the magnitude in five words. That is the standard the rest of the interrupt copy should be held to.

2. **The write_file diff is a genuinely good idea the inspector lacks.** The banner renders Before and After panes side by side for file writes, with "(new file)" when there is no prior content. It is the only place in the app that shows an operator the actual consequence of approving rather than the arguments that will produce it.

3. **Presence is honest and cheap.** The tab title tracks idle / working / blocked, verified live: it became `(!) Approve — Felix` the moment a stubbed approval entered the queue and returned to `Felix` when the thread was cleared. Notification permission is requested inside the background-run click, never on load.

## Priority Issues

### [P1] The approval banner hides the thing you are approving

Measured on a stubbed `write_file` approval at a 672px card:

- The After pane is `white-space: pre` with `scrollWidth 658` against `clientWidth 313`. **52% of the content being approved is off-screen horizontally**, behind a scrollbar in a 313px pane.
- Approve sits at **y=1180**; the diff starts at **y=1272**. The decision is 92px *above* its own evidence, and pushed to the far right of the card.
- Approve is `oklch(0.92 …)`, a solid fill. Deny is `oklab(1 0 0 / 0.045)`, near-invisible. The irreversible option is the loud one.

Nothing here prevents an operator approving a file write having read none of it, and the layout actively encourages that order.

**Fix:** wrap the diff (`whitespace-pre-wrap break-words`, as the inspector now does), move the buttons below the evidence, and weight Deny at least equally. Name the action: "Approve write to notes/todo.md".

**Suggested command:** `/impeccable harden`

### [P1] Two approval UIs for the same decision

The banner and the Inspector's Approvals section both render a pending gated call, and they agree on nothing:

| | Banner | Inspector section |
|---|---|---|
| Colour | `border-primary/40 bg-accent/40` | `border-state-blocked/40 bg-state-blocked/5` |
| Button label | `Approve` | `Approve local_shell` |
| Loading | `…` | `Deciding…` |
| Payload | Before/After diff, `max-h-36` | folded JSON, wraps, says what it hides |
| Double-submit | `deciding` prop | synchronous ref guard |

Half of this divergence is mine: the previous pass improved the inspector and left the banner untouched, including leaving it outside the state-colour vocabulary that pass introduced. The banner is the more prominent surface of the two.

**Fix:** one approval component used by both, with the banner's diff and the inspector's guards.

**Suggested command:** `/impeccable extract`

### [P2] Rewind is the least-guarded irreversible action in the app

`onRewind` moves the server's active leaf to an earlier event, discarding the forward transcript. It is offered on **every** turn as a hover-revealed icon button with the tooltip "Rewind here", no confirmation, and no undo. Delete now has an undo window and approvals have an in-flight guard; the third destructive action has neither.

**Fix:** the same undo-toast treatment thread delete got, or a confirm naming how many turns it discards.

**Suggested command:** `/impeccable harden`

### [P2] The app has no answer for a wide viewport

Measured at 3840x1503, which is this machine's actual display: content column 768px, **80% of the width unused**, and an **818px vertical gap** between the greeting and the composer because the greeting centres in `min-h-[min(52vh,28rem)]` while the composer is pinned to the bottom. The empty state reads as two disconnected islands in a void.

The previous pass added breakpoints downward from 1152 and never looked up. A max-width column is right for prose; leaving the other 3000px inert is not the same decision.

**Suggested command:** `/impeccable layout`

### [P2] The uppercase eyebrow is now the app's grammar

Thirteen instances across nine files, one recipe. Individually defensible, collectively the thing the skill's bans describe: reached for by reflex whenever a label is needed. It is also the smallest text in the product.

**Fix:** pick a different label cadence (sentence-case at the UI step, weight for emphasis) and reserve uppercase for the two or three places it genuinely earns.

**Suggested command:** `/impeccable typeset`

## Persona Red Flags

**Alex (power user):** Composer is well served: Enter sends, Shift+Enter newlines, Enter steers mid-run, slash commands, background runs, thinking levels. Then nothing else has a shortcut. No key toggles a rail, focuses search, switches inspector sections, or starts a chat. The gap between how considered the composer is and how bare the rest is will read as an unfinished product.

**Riley (stress tester):** Approves a file write without seeing 52% of it. Aborts a run that is waiting on an approval and the banner stays, because `stopRun` does not clear `pendingQueue` and `syncApprovals` only ever appends; whether the queued approval is still live server-side after an abort is not something the client checks. *Not verified end to end, and I initially misreported it as a stuck title: that was a case-sensitivity bug in my own probe, since the label is CSS-uppercased. Worth a look, not a confirmed defect.*

**Sam (accessibility):** The composer textarea, the primary input of the product, has **no accessible name**: no label, no `aria-label`, only a placeholder that disappears on first keystroke. Every other control in the composer is properly labelled, which makes this one an oversight rather than a policy. Elsewhere: contrast is clean across both themes (one element below 4.5:1, the disabled Background button, exempt under 1.4.3), sizes are the intended 11/13/16, and the transcript's smooth auto-scroll is JS-driven so the reduced-motion CSS does not reach it.

## Minor Observations

- `suggested-actions.tsx` sets `style={{ animationDelay: i * 50 + 'ms' }}` on each starter with **no animation defined anywhere**. Dead code from a removed entrance.
- The turn usage line prints in, out, and total; the total is the sum of the two beside it.
- Tool card output panes are `max-h-64 overflow-auto`, the same scroll-box pattern that hides content in the banner, though the stakes are lower.
- `FALLBACK = BY_MANIFEST.quick!` uses a non-null assertion where a literal would not need one.
- The transcript-level error is the one error surface with no retry, while every inspector section now has one.

## Questions to Consider

- If the approval banner is what an unattended run drags someone back to, should it be a banner at the bottom of a transcript at all, rather than something that takes the screen the way its consequences deserve?
- The inspector was rebuilt so a pending approval could interrupt whatever was being read. The banner already interrupts. Do both need to exist?
- What would the greeting look like if it were designed for the 3840px display it is actually being used on, rather than tolerated there?
- Thirteen uppercase labels say the app keeps needing a way to mark a label. Is the answer a better label style, or fewer labels?
