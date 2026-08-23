---
target: chat-ui inspector and history rails
total_score: 18
p0_count: 2
p1_count: 3
timestamp: 2026-08-23T20-11-05Z
slug: apps-chat-ui-src-components
---
# Critique: chat-ui inspector and history rails

Target: `apps/chat-ui/src/components/inspector/inspector.tsx` + `apps/chat-ui/src/components/chat/thread-list.tsx`, inspected live at `http://localhost:5173` against the running harness on `:8080`. Viewport 1512x802, both themes.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Panel is labelled "Live harness activity" but has no aria-live, no last-updated stamp, and no way to distinguish "empty" from "stale" |
| 2 | Match System / Real World | 2 | Raw harness vocabulary surfaced as primary metadata: `manifest_id`, `cowork`, `quick`, `guardrail_block` |
| 3 | User Control and Freedom | 2 | Thread delete is rendered outside the rail and is not clickable; no undo, no confirm |
| 4 | Consistency and Standards | 2 | Two rails, two header grammars; two differently-labelled "new chat" controls; primary buttons do not render as primary |
| 5 | Error Prevention | 1 | Approve/Deny on a gated tool call is one unconfirmed click, with the payload in a 128px scroll box |
| 6 | Recognition Rather Than Recall | 2 | 2 of 6 inspector tabs are off-screen; thread titles clip with no ellipsis |
| 7 | Flexibility and Efficiency | 1 | Zero keyboard handlers in either rail or the shell; no bulk actions, no pinning |
| 8 | Aesthetic and Minimalist Design | 2 | Every tab is the same `rounded-xl` card at 10-11px; no hierarchy, and native scrollbars dominate |
| 9 | Error Recovery | 2 | Errors render clearly but carry the raw exception string and no retry affordance |
| 10 | Help and Documentation | 2 | Empty-state copy is genuinely instructive; nothing else explains the vocabulary |
| **Total** | | **18/40** | **Poor** |

The score is dominated by a small number of severe, cheap-to-fix defects rather than diffuse bad design. Three of them are build-level or layout-level and would each move several rows at once.

## Anti-Patterns Verdict

**Does this look AI-generated?** Not in signature, yes in structure.

**LLM assessment.** There are no slop signatures: no gradient text, no side-stripe accents, no purple-to-cyan palette, no uppercase tracked eyebrows, no hero-metric block. Colour is restrained and semantic. What gives it away is uniformity. Six tabs of information with genuinely different shapes (an append-only event log, a ranked rollup, a running total, a decision queue, an ordered plan, a capability set) are all rendered as the same `rounded-xl border border-border/50 bg-background/80 px-2.5 py-2 text-xs` card in a `space-y-1.5` stack. The panel has no opinion about what matters. That is the "density without hierarchy" anti-reference from PRODUCT.md, and it is the reason nothing in the inspector pulls the eye during a live run.

The second tell is the type scale. `text-[10px]` and `text-[11px]` carry nearly all inspector content, with `text-sm` (14px) only for panel titles. That is a ratio of about 1.27 between the only two steps that exist, applied to six kinds of content. Weight and colour do almost no work.

**Deterministic scan.** `detect.mjs` over `apps/chat-ui/src`: **0 findings**, exit 0. Verified the detector was live by running it against a synthetic slop file, which returned 3 findings (side-tab, gradient-text, ai-color-palette). The clean result is real: this codebase does not contain the pattern families the detector knows. It cannot see structural sameness, which is the actual problem here.

**Visual overlays.** Not injected. The bundled overlay flow targets a static page; this is an authenticated SPA driven through the live harness, so evidence was gathered by direct DOM measurement and screenshots instead. Every claim below carries its measurement.

## Overall Impression

The surface is tidy and the substrate is broken. Someone with taste chose the spacing, the borders, and the empty-state copy, and then three structural faults went unnoticed because they are invisible until you measure: half the shared component library never gets its CSS generated, the history rail renders its rows 151px wider than the rail, and the shell has no responsive behaviour at all.

The single biggest opportunity: `apps/chat-ui/src/index.css` is missing one line. Adding it restores the primary button, the focus rings, and the rest of the `@felix/ui` styling in both apps. It is the highest ratio of design recovered to code changed available anywhere in this repo.

## What's Working

1. **The empty-state copy is the best writing in the app.** "Gated tool calls wait here until you approve or deny them." "Deciding resumes the paused run, no need to re-send." "Switch to the deep agent and ask a multi-step question." Each one names the mechanism and tells you how to produce the state. This is exactly the "instrumented, calm, exact" voice PRODUCT.md asks for, and it is already here.

2. **Polling is correctly scoped.** `usePoll` clears its interval when `enabled` is false, and `enabled` is the panel's `open` state, so a closed inspector costs nothing. `loading && !data` gates the skeletons, so a 3-second refresh does not flash placeholders over live content. That is a detail most implementations get wrong.

3. **Search degrades sensibly.** Local title filter is instant, the server FTS call is debounced at 250ms with cancellation, and server-only hits are separated into their own labelled group rather than being interleaved. The three-state empty message ("Searching...", "No matches", "No chats yet") is correct.

## Priority Issues

### [P0] The shared UI package is not a Tailwind source, so half of `@felix/ui` has no CSS

`apps/chat-ui/src/index.css` contains `@import "tailwindcss"` with no `@source` directive, and `vite.config.ts` just calls `tailwindcss()`. Tailwind v4 auto-detects sources relative to the app root, so `packages/ui/src` is never scanned. Every utility that appears **only** in a `@felix/ui` primitive is absent from the generated stylesheet.

Measured, on a fresh element injected into the live app:

| Class | Used in | Computed result |
|---|---|---|
| `bg-primary` | `packages/ui` only | `rgba(0,0,0,0)` (inert) |
| `text-primary-foreground` | `packages/ui` only | inherits, inert |
| `bg-muted` | `apps/chat-ui` | `oklch(0.967 0.001 286.375)` |
| `bg-primary/5` | `apps/chat-ui` | `oklab(0.21 ... / 0.05)` |
| `bg-destructive/10` | `apps/chat-ui` | `oklab(0.577 ... / 0.1)` |

Consequences visible right now:
- The **"New chat" button** is `variant="default"` (`bg-primary text-primary-foreground`) plus `rounded-full px-3`. It renders as bare text with an icon. The primary action in the app has no primary styling.
- **`focus-visible:ring-[3px]`, `focus-visible:ring-ring/50` and `focus-visible:border-ring`** are declared in the Button base class and never generated. With real keyboard focus on the inspector toggle: `box-shadow: none`, `--tw-ring-shadow: 0 0 #0000`, `outline-style: none`, while `:focus-visible` matches. **No shadcn Button in either app paints a focus indicator.** WCAG 2.2 AA 2.4.7 and 2.4.11 failure.

Verified by fix: adding `@source "../../../packages/ui/src";` to `index.css` flips `bg-primary` to `oklch(0.21 0.006 285.885)`, the real button to a filled pill with `oklch(0.985 0 0)` text, and populates `--tw-ring-shadow: 0 0 0 calc(3px + 0px) color-mix(in oklab, oklch(0.705 0.015 286.067) 50%, transparent)`. Change reverted after testing; the tree is clean.

`apps/float/src/index.css` has the same omission.

**Fix**: add the `@source` line to both apps' `index.css`. Then re-check every `@felix/ui` variant, because this has been masking their appearance since the package was introduced.

**Suggested command**: `/impeccable audit`

### [P0] History rows render 151px wider than the rail, so delete is unclickable and titles clip with no ellipsis

Radix `ScrollArea` renders its viewport's inner wrapper with `display: table; min-width: 100%`. Table sizing is shrink-to-fit with a 100% floor, so it grows to content width instead of being constrained by the viewport. Measured in the live rail:

- rail width **240px**, viewport `clientWidth` **239px**, viewport `scrollWidth` **407px**
- inner wrapper `display: table`, width **407px**
- each row: width **391px**, right edge at **x=399**, while the rail ends at **x=240**
- title span: `scrollWidth` 323 === `clientWidth` 323, so **`truncate` never engages**
- delete button: rendered at **x=369 to x=391**, entirely outside the rail
- `document.elementFromPoint` at the delete button's centre returns a `DIV` in the transcript column, `inRail=false`

So: thread titles are hard-clipped by the aside's overflow with no ellipsis, meaning you cannot tell a truncated title from a short one; and the delete control documented in the component's own docstring is not clickable. Keyboard focus does reach it, which scrolls the rail sideways to reveal it, which is the only way to use it.

This is latent in the inspector too. Its ScrollArea has the same `display: table` wrapper and currently does not overflow only because its content happens to be narrow.

**Fix**: constrain the viewport's inner wrapper. `[&>div]:!block [&>div]:!min-w-0` on the `ScrollArea`, or set `display: block` on `[data-radix-scroll-area-viewport] > div` once in `packages/ui/src/scroll-area.tsx` so both rails and every future consumer inherit the fix.

**Suggested command**: `/impeccable audit`

### [P1] Two of six inspector tabs are off-screen, including the only one with an action

The tab strip is `overflow-x-auto` inside a 352px panel. Measured: `tablist` `clientWidth` **351**, `scrollWidth` **450**. Tab right edges: Activity 1244, Tools 1310, Usage 1382, Approvals 1473, **Plans 1540, Skills 1607**, against a viewport right edge of 1512. Plans is half-cut, Skills is entirely invisible, and Skills contains the only call-to-action in the whole inspector ("Ask agent to list skills").

The affordance is a native horizontal scrollbar consuming **16px of the 55px tab strip**, which reads as a divider rather than a scroll cue. Arrow keys work via Radix roving tabindex, so keyboard users can reach Skills; mouse users have to discover the scroll.

Six peer destinations also breaks the working-memory rule at the panel's only navigation point.

**Fix**: stop treating these as six equal peers. Activity, Approvals and Plans are run-state; Tools, Usage and Skills are session-reference. Either two rows of three, or a primary group of three tabs with the rest behind a menu, or an accordion of stacked sections that removes the navigation decision entirely.

**Suggested command**: `/impeccable layout`

### [P1] The shell has no responsive behaviour; the chat column absorbs 100% of every compression

`ThreadList` is `w-60`, `Inspector` is `w-[22rem] shrink-0`, `main` is `min-w-0 flex-1`. There is **not one breakpoint class in either rail file**. Because `main` is `flex: 1 1 0%` with `min-w-0`, it yields all the way to zero before either rail gives up a pixel. Measured across widths:

| Shell width | History | Inspector | Chat | Composer |
|---|---|---|---|---|
| 1512 | 240 | 352 | 920 | 736 |
| 1280 | 240 | 352 | 688 | 656 |
| 1100 | 240 | 352 | 508 | 476 |
| 980 | 240 | 352 | 388 | 356 |
| 860 | 240 | 352 | 268 | 236 |
| 760 | 240 | 352 | **168** | **136** |

At 1280, a very common laptop width, both rails open leaves 688px of chat. At 980, a split-screen window, the composer is 356px. The product register calls for structural responsive behaviour, and there is none.

**Fix**: collapse the history rail to icons below ~1280 and overlay it below ~1024; float the inspector as a sheet below ~1180 (the `Sheet` primitive is already in `@felix/ui` and already used for jobs, eval, manifests, and agent).

**Suggested command**: `/impeccable adapt`

### [P1] The highest-stakes control in the product has the weakest guardrails

`ApprovalsTab` renders Approve and Deny as equal-weight adjacent buttons, `h-8 flex-1` side by side, with no confirmation and no undo. The payload being approved sits above them in a `max-h-32` scroll box, so a long argument set hides exactly the part worth reading. Approving a gated tool call is the one irreversible thing this UI does.

`ThreadList` delete is the same shape: `onDelete(t.id)` fires on click with no confirm, and the docstring says it removes the thread locally and best-effort server-side.

**Fix**: make Approve and Deny visually unequal, expand the payload by default with a fold for the tail rather than a scroll box, and surface the tool name and target in the button label ("Approve `local_shell`"). Add an undo window on thread delete instead of a confirm dialog.

**Suggested command**: `/impeccable harden`

## Persona Red Flags

**Alex (impatient power user)**: No keyboard shortcuts exist. `grep` for `onKeyDown|metaKey|ctrlKey` across `App.tsx` and both rails returns nothing. Cannot toggle either rail, focus search, switch tabs, or start a new chat from the keyboard. Wants to clear ten old threads and has to hover-reveal a delete button that is rendered outside the rail, one thread at a time, with no bulk select. Has two "new chat" controls 240px apart labelled differently ("New chat" in the header, "New" in the rail) and no idea whether they differ.

**Sam (accessibility-dependent)**: Tabs into the app and gets no focus ring on any Button, because the ring utilities are never generated. Reaches the thread delete button and it is `opacity: 0` with `outline: none` and `box-shadow: none`, so focus is on a control that paints nothing. Turns on a screen reader and the panel announcing itself as "Live harness activity" refreshes every 3 seconds with no `aria-live` anywhere in the inspector, so nothing is announced (WCAG 4.1.3, AA). Neither `aside` has an `aria-label`, so both landmarks announce as unnamed complementary regions. The document has **zero heading elements**, so heading navigation is unavailable across the entire app. The search input has no `aria-label` and no visible label text, relying on placeholder fallback. `prefers-reduced-motion` appears nowhere in `apps/chat-ui/src` or `packages/ui/src` despite the metrics bar animating width and tw-animate-css driving the sheets.

**Riley (stress tester)**: Long thread titles clip with no ellipsis, so truncation is indistinguishable from a short title. `relTime` accepts seconds or ms via a `< 1e12` heuristic and returns "now" for anything under a minute including future timestamps. The activity feed is capped at `limit: 60` and usage at `limit: 40` with no indication that a cap exists or was hit. In `MetricsTab`, `foldByTool` takes `Math.max` of `avg_duration_ms` across rows rather than a weighted mean, so the "~Nms" figure is the worst bucket's average presented as the tool's average. On error with no data, `PanelBody` renders the error banner and the empty state simultaneously.

**Demo viewer (project-specific, from PRODUCT.md)**: Sees a rail row reading "cowork · 18h ago" and a badge reading "Guardrail" with no way to learn what either means. Sees "No activity yet" and cannot tell whether the harness is idle, unreachable, or the panel simply has not polled. The inspector promises "Live harness activity" and shows a static empty state, which reads as broken rather than idle. Nothing on screen conveys that the mechanism on display is the point.

## Minor Observations

- Header grammar diverges between the rails. History is a single `h-12` row matching the app header; Inspector is `px-3 py-2.5` with a two-line title and subtitle stack, so the two rails' content starts at different y-offsets. This is the concrete source of the "bolted on" feeling.
- Native scrollbars are unstyled everywhere (`scrollbar-width: auto`, no `scrollbar-color`). On a machine set to always show scrollbars, the transcript gets a **30px** gutter and the tab strip a **16px** bar, both near-black in light mode. In a 352px panel that is a significant share of the surface spent on chrome.
- `--muted-foreground` rides the AA line in light mode. Measured 4.83:1 on `--background`, and **4.39:1 on `--accent`**, which is the selected history row, so the selected thread's metadata fails AA. Dark mode is comfortable at 7.3 to 7.4:1. Moving light `--muted-foreground` from `oklch(0.552 0.016 285.938)` to `oklch(0.53 0.016 285.938)` yields 4.79:1 on accent and 5.27:1 on background.
- `EVENT_TONE` assigns `bg-amber-500/15` to both `guardrail_block` and `approval_request`, so a block and a request are colour-identical. `StatusDot` pairs colour with a text label, which is correct; the event badges do not.
- Text below 11px carries most of the inspector. `text-[10px]` is used for badges, timestamps, metrics metadata, plan counters, and skill names.
- `usePoll` does not check `document.visibilityState`, so a backgrounded tab with the inspector open keeps polling every 3 seconds.
- The inspector's `onSuggest` prop sends a prompt straight into the chat from a button labelled "Ask agent to list skills". It works, but it is the only place in the app where a panel writes to the composer, and nothing signals that.

## Questions to Consider

- The inspector's six tabs split into run-state (Activity, Approvals, Plans) and session-reference (Tools, Usage, Skills). What if only the first three were ever a rail, and the reference three lived in the sheet surface that already exists for jobs and eval?
- During a live run, which single number would an operator want visible without opening anything? Right now the answer is "none of them", because the inspector must be open and on the right tab. What would a persistent one-line status strip carry?
- The history rail sorts by recency and shows a manifest slug. For someone who runs the same three manifests all week, is recency the useful axis, or is it "which of these is still running, which needs approval, which failed"?
- PRODUCT.md says the mechanism is the interface. The transcript currently hides tool calls behind a `verbose` toggle that defaults off. Is the default backwards?
- If every card in the inspector were forbidden from having a border, what would carry the grouping instead, and would the result be more scannable?
