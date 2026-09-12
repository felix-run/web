---
target: toaster toast
total_score: 17
p0_count: 1
p1_count: 3
timestamp: 2026-09-01T21-30-36Z
slug: apps-chat-ui-src-main-tsx-toaster-toast-call-sites
---
## Design Health Score

Scoped to the notification layer (the `<Toaster>` in `main.tsx` and the 30 `toast.*` call sites), not the app as a whole.

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Every event gets the same slab. `toast.error('Disconnected. Reconnecting…')` reports a self-healing status in the alarm channel. |
| 2 | Match System / Real World | 3 | `describeError` is genuinely excellent writing. Eight call sites bypass it and print `TypeError: Failed to fetch`. |
| 3 | User Control and Freedom | 2 | Undo exists for delete and rewind, but lives only inside a 7s toast, and can be defeated by hovering it. |
| 4 | Consistency and Standards | 1 | Two error vocabularies, two state-colour systems, vendor font and radius. The toast is the one surface outside the design system. |
| 5 | Error Prevention | 1 | Five composer paths destroy the operator's typed message and report it in a 4s toast. |
| 6 | Recognition Rather Than Recall | 2 | Errors vanish in 4s. No history, no copy affordance, no notification log. |
| 7 | Flexibility and Efficiency | 2 | sonner's ⌥T toast-focus hotkey exists and is never surfaced. No dismiss-all, no persistence. |
| 8 | Aesthetic and Minimalist Design | 1 | A near-white slab measuring 18.97:1 against the page, laid across the header, for a typo. |
| 9 | Error Recovery | 1 | No Retry action despite copy that says retrying is worth it. Detail string is uncopyable and gone in 4s. |
| 10 | Help and Documentation | 2 | The `describeError` messages are the contextual help. Nothing leads anywhere from a toast. |
| **Total** | | **17/40** | **Poor** |

## Anti-Patterns Verdict

**LLM assessment.** This does not read as AI-generated. It reads as *undesigned*: `<Toaster position="top-center" richColors closeButton />` is a nine-word line that imports an entire second visual system into an app that has an unusually deliberate one. Nobody chose the pink, the red, the 8px radius, the 400ms ease, or the light theme. They arrived with the dependency. Anti-reference #1 in PRODUCT.md is "the scaffolded AI chat default"; the toast layer is the one place in this app where the scaffold was never removed.

The specific failure is the register clash. `approval-decision.tsx` is careful work: the comments argue about button emphasis, fold thresholds, and reading order. Three files away, the app's most attention-grabbing element is a vendor default.

**Deterministic scan.** `detect.mjs --json` over `apps/chat-ui/src` returned `[]`, exit 0. Clean, and correctly so. It is also structurally blind here: the entire visual surface of the toast lives in `node_modules/sonner/dist/styles.css`, which no repo-scoped scan will reach. This is worth naming as a pattern. The repo has four bespoke guards for contracts that fail silently (`check-api-drift`, `check-protocol-parity`, `check-payload-shapes`, `check-tailwind-sources`), and the toast layer is the same failure shape with no guard: it compiles, lints, passes every check, and renders wrong.

**Browser evidence.** Live measurement in Chrome against a real harness, dark theme active:

```
htmlClass:                  "dark"
toasterTheme:               "light"       <- never set, sonner defaults to light
toastBg:                    rgb(255,240,240)
titleColor:                 rgb(230,0,0)  @ 13px
contrast_title_on_toast:    4.35:1        <- fails WCAG AA (4.5:1)
contrast_toastBg_vs_pageBg: 18.97:1       <- brightest object on screen
toastFont:  ui-sans-serif, system-ui, -apple-system, "sys...   (sonner's own stack)
appFont:    ui-sans-serif, system-ui, sans-serif, "Apple ...   (the app's)
toastRadius: 8px            appRadius: 0.625rem (10px)
zIndex:      999999999
transition:  0.4s
closeRect:   20 x 20 px     <- fails WCAG 2.2 SC 2.5.8 (24x24)
headerRect:  height 48      toast settles y 31-86, crossing the header
toastRole:   null           ariaLive: polite (errors announced as calmly as "Steer queued")
```

All four `richColors` light variants fail AA at 13px: error 4.36:1, success 4.29:1, info 4.35:1, warning 3.07:1. PRODUCT.md: "Contrast failures ... are treated as defects, not polish."

No overlay was injected. The target is a transient element that only exists while a toast is on screen, so the detector's static overlay would have had nothing to mark. Evidence is direct DOM measurement and screenshots instead.

## Overall Impression

The conversation surface of this app is carefully argued. The notification surface is unowned, and it is where the app's most irreversible moments happen to live: deleting a conversation, rewinding a branch, losing a typed message, learning the harness rejected something.

Biggest opportunity: the toast layer is currently *decoration that carries state*, which is the exact inversion of PRODUCT.md principle 4. Make it a member of the design system, then decide, per call site, whether a toast is the right instrument at all. Roughly a third of the current calls are logging, not notifying.

## What's Working

1. **`describeError` is the best-written thing in this codebase.** "The harness has no route to compact this conversation. It is probably running an older version than this client expects." That is a real diagnosis with a real next step, in the house voice, and the 404 comment explains why the action is named. It deserves to be used everywhere it is currently skipped.
2. **The delete undo is architecturally right.** Holding the server-side delete for the toast duration rather than firing it immediately, and failing toward *keeping* data if the tab closes mid-window, is the correct direction to fail in, and the comment says so.
3. **`toast.promise` on compact** is the one call site that models a real lifecycle rather than announcing a fact.

## Priority Issues

### [P0] Five composer paths destroy the operator's typed message

`prompt-input.tsx:694-711` clears the composer whenever the async `onSubmit` resolves without throwing. Every early return in `multimodal-input.tsx` `handleSubmit` resolves normally, so the text is cleared and replaced by a toast:

- `> 32,000 chars` (line 257): the longest message the operator will ever type, deleted, reported in a 4s toast.
- Not connected (line 252): text gone, "Disconnected. Reconnecting…"
- Unknown slash command (line 246): explicit `clear()` at line 247.
- Unimplemented slash command (`handleSlashSelect`, line 222): `clear()` runs *before* the guard.
- Reattaching (`App.tsx:656`): "Rejoining this thread, stop it first to send."

**Why it matters.** Nielsen #9's top criterion is "preserves user work". This does the opposite in the one place where work exists. The 32k case is aggravated by `maxLength={MAX_TEXT_LENGTH + 200}` with the comment "slack so the toast can fire": the design intent was to let the toast fire, and the consequence of firing it was not traced.

**Fix.** Guard before submit, not after. Disable the send control with an inline reason when disconnected or reattaching, show a live character count that turns red past 32k rather than accepting and discarding, and make the unknown-command path leave the text in place so it can be edited. Where a toast must still fire on a destructive path, attach `action: { label: 'Restore text', onClick: ... }`.

**Suggested command**: `/impeccable harden`

### [P1] The toast renders in light theme, always, and fails AA

`main.tsx:28` passes no `theme`. sonner 1.7.4 defaults to `theme = "light"`. In dark mode, measured live: `data-theme="light"` under `html.dark`, a `rgb(255,240,240)` slab at 18.97:1 against the page, with 4.35:1 red text that fails AA at 13px. It lands across the 48px header.

**Why it matters.** Three separate PRODUCT.md commitments in one element: "No alarm colors for ordinary states", "WCAG 2.2 AA, enforced", and principle 3, "One shell, not three panes". It also fails in the least detectable way possible, because a developer working in light mode will never see it.

**Fix.** Pass `theme={resolved}` from `useTheme()`. Then replace `richColors` with the app's own tokens through `toastOptions.classNames` or a `--normal-*` / `--error-*` override block in `index.css`, keyed to `--state-failed`, `--state-done`, `--state-running`, `--state-blocked`, which already exist and are already tuned per theme. Take the font and `--border-radius` with it.

**Suggested command**: `/impeccable colorize`

### [P1] The delete undo can be clicked after it has stopped working

`App.tsx:537-559`. `commit` is a plain `window.setTimeout(..., 7000)`. The toast's own 7s timer pauses on hover, which sonner does by default. Hover the toast for two seconds, then click Undo at t=7.5s: the toast is still on screen and still offers Undo, `undone = true` and `clearTimeout` both no-op because the timer already fired, and `deleteThreadHistory` has already run. The thread reappears in the rail from the restored local copy with its server transcript gone.

**Why it matters.** Hovering the toast is the natural precursor to clicking the button inside it, so the race is on the likely path, not an edge case. Silent partial success is the worst failure shape for an undo.

**Fix.** Do not race two timers. Fire `commit` from the toast's own `onAutoClose`, or track a deadline and have Undo call the restore path only when `Date.now() < deadline`, telling the operator plainly when it is too late.

**Suggested command**: `/impeccable harden`

### [P1] Errors are unreadable, uncopyable, unretryable, and inconsistent

Four problems on one element. Default duration is 4s for a two-line error whose description is a raw harness string. There is no copy affordance, and the toast is gone before an operator can select it. `describeError` writes "This is usually transient, so it is worth retrying" and the toast offers no Retry. And eight call sites (`App.tsx:663, 748, 757, 765, 870, 889`, plus `multimodal-input.tsx:99`) print `String(err.message ?? err)` raw, so whether the operator gets "The harness failed while trying to continue this run" or `TypeError: Failed to fetch` depends on which control they touched.

**Why it matters.** PRODUCT.md's operator is supervising a live run. An error they could not read, copy, or retry is an error they will go find in the harness logs instead, which the doc names as the failure condition for the whole product.

**Fix.** `duration: Infinity` for `toast.error` so errors persist until dismissed. Route every error through `describeError`. Add `action: { label: 'Retry' }` where the operation is idempotent, and make the detail selectable.

**Suggested command**: `/impeccable clarify`

### [P2] A third of the toasts are logging, not notifying

"Steer queued", "Continued", "Duplicated", "Thinking: high", "Reattached <name>", "Rewound to this message." These are confirmations of things the operator just did, on controls whose own state could confirm them. `cycleThinking` is the clearest case: it is a button that cycles, so holding it produces a stack of stale toasts naming levels that are no longer current, while the control itself already shows the answer.

**Why it matters.** PRODUCT.md asks for calm and for "no motion that competes with streaming text". A 400ms-animated slab across the header, during a run, to say "Thinking: high" competes directly. It also devalues the channel: an operator who learns to ignore toasts will ignore the approval and error ones too.

**Fix.** Confirm in place. The thinking control shows its own level; the workspace strip shows its own mount; a forked thread appearing selected in the rail is the confirmation. Keep toasts for what has no home on screen: errors, undoable destructive actions, and background-run events.

**Suggested command**: `/impeccable distill`

## Persona Red Flags

**Alex (Power User).** Cycles thinking level four times while reading a stream and gets four stacked slabs over the header, each one animating for 400ms. Wants to copy a harness error into a terminal and cannot: 4 seconds, no selection, no history. Discovers there is no way to dismiss all toasts at once, and no way to know that ⌥T focuses them, because sonner's hotkey is never surfaced. Pastes a long spec into the composer, is told it exceeds 32,000 characters, and finds the paste gone.

**Sam (Accessibility-Dependent).** Every toast announces `aria-live="polite"`, so "Steer queued" and "The harness failed while trying to continue this run" arrive at identical urgency, both queued behind whatever is being read. The close button is 20x20 CSS px, failing WCAG 2.2 SC 2.5.8, and sits half outside the toast's own corner. Error state is carried by a red fill at 4.35:1, below AA, though the type icon does mean colour is not the sole channel. At 200% zoom the top-centre toast covers more of the header.

**The Supervising Operator (from PRODUCT.md).** The doc's own rule is "a signal that exists only in the viewport does not exist". Every undoable destructive action in this app is gated behind exactly such a signal. Delete a thread, look at the harness logs for eight seconds, come back: it is gone, and nothing on screen records that it happened or that an undo was ever offered.

## Minor Observations

- `z-index: 999999999` from sonner's stylesheet against a codebase whose only other z-index is a single `z-50`. Nothing can ever be layered above a toast, including a modal.
- `transition: 0.4s` exceeds the product register's 150-250ms band. sonner does honour `prefers-reduced-motion`, correctly.
- "Rejoining this thread — stop it first to send." carries an em dash; the rest of the app's copy does not.
- `toast.info('/x is not implemented yet')` is a dead end. It could name what is implemented, or the command could not be listed.
- `toast.success('Duplicated')` names the effect, not the object. Every other message in the app names its target.
- Dismissing the delete toast with the ✕ silently forfeits the undo. Nothing says so.
- The close button is enabled globally, which puts a 20px control on toasts that live 4 seconds and do not need one.

## Questions to Consider

- If the toast layer used `--state-failed` and `--state-blocked`, would an operator read a failed toast and a failed tool card as the same fact? Right now they are two different reds.
- Which of these thirty messages would you miss if the toast never appeared? That set is the real notification layer; the rest is instrumentation looking for a home.
- The delete undo already proves this app can defer a destructive action. What would it take for that pattern to survive an operator who is not looking at the tab, which PRODUCT.md says to assume?
- Is top-centre right for an app whose two most common toast sources are the composer at the bottom and the history rail on the left?
