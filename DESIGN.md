---
name: Felix chat-ui
description: The instrument panel for a self-hosted agent harness.
colors:
  background: "oklch(1 0 0)"
  foreground: "oklch(0.141 0.005 285.823)"
  card: "oklch(1 0 0)"
  muted: "oklch(0.967 0.001 286.375)"
  muted-foreground: "oklch(0.53 0.016 285.938)"
  accent: "oklch(0.967 0.001 286.375)"
  primary: "oklch(0.21 0.006 285.885)"
  primary-foreground: "oklch(0.985 0 0)"
  border: "oklch(0.92 0.004 286.32)"
  ring: "oklch(0.6 0.015 286.067)"
  code-surface: "oklch(0.98 0.001 286.375)"
  state-blocked: "oklch(0.473 0.137 46.201)"
  state-done: "oklch(0.432 0.095 166.913)"
  state-running: "oklch(0.443 0.11 240.79)"
  state-failed: "oklch(0.44 0.19 27.3)"
  destructive: "oklch(0.577 0.245 27.325)"
  recording: "oklch(0.5 0.2 25)"
typography:
  title:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: "1.25rem"
  body:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.25rem"
  label:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: "1rem"
  value:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: "1rem"
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
spacing:
  row-x: "12px"
  row-y: "6px"
  panel: "16px"
  stack: "10px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-ghost-hover:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.foreground}"
  panel-header:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.title}"
    padding: "12px 16px"
  state-chip-blocked:
    backgroundColor: "{colors.state-blocked}"
    textColor: "{colors.state-blocked}"
    rounded: "{rounded.lg}"
    padding: "2px 6px"
    typography: "{typography.label}"
---

# Design System: Felix chat-ui

## Overview

**Creative North Star: "The Workbench"**

This is not a chat app that happens to log tool calls; it is a window onto a running process
that happens to accept messages. The mounted folder is the subject, the thread is how you talk
to it, and the machinery is on display because supervising it is the job. The surface is read
daily by one operator who ran the harness themselves and holds the gate key — so density,
learned affordances, and labels that assume the harness was configured by the reader are all
permitted. What is not permitted is a tidier abstraction standing in front of what the harness
actually reported.

The register is **instrumented, calm, exact**. Instrumented: show real states, real numbers,
real event types. Calm: an autonomous process already generates uncertainty, and the interface
does not add to it — no alarm colours for ordinary states, no motion competing with streaming
text, no celebration. Exact: a number is a number, and rounding away information the operator
would act on is a defect, not a simplification.

The confirmed anti-references are specific and close. The nearest is the **scaffolded AI-chat
default** — untouched neutral tokens, `rounded-xl` bordered cards stacked down every panel, an
icon on every row, a gradient somewhere: recognisable as generated rather than designed. Then
**density without hierarchy**, the observability-dashboard failure where every panel is equally
loud and the eye has nowhere to land. Then **consumer-chat warmth**, which hides the mechanism
and so inverts the product. Then **warm-neutral editorial** — cream, serif display, marketing
cadence — which is the wrong register entirely.

**Key Characteristics:**

- A neutral zinc field where colour means run state and nothing else.
- Rules and tonal steps for separation; cards reserved for things that stop a run.
- One header grammar — icon, title, one at-a-glance value — repeated at every scale.
- Monospace for anything the harness emitted; proportional for anything we wrote.
- Tonal depth by default. One surface floats by design, and it is the composer.

## Colors

A neutral zinc field carrying a four-hue state ramp, defined in `oklch` and tuned for contrast
rather than picked by name.

### Primary

- **Ink** (`oklch(0.21 0.006 285.885)`): the near-black of primary buttons and solid controls.
  Inverts to near-white in dark, so "primary" is a contrast relationship rather than a colour.

### Neutral

- **Page** (`oklch(1 0 0)` light / `oklch(0.141 0.005 285.823)` dark): the base field.
- **Muted** (`oklch(0.967 0.001 286.375)`): section headers, chip backgrounds, the resting rail.
- **Muted Foreground** (`oklch(0.53 0.016 285.938)`): metadata and secondary copy. The light
  value is `0.53`, not zinc's stock `0.552`, because `0.552` measured 4.39:1 against `--accent`
  on a selected history row — under AA. `0.53` clears it at 4.79:1 there and 5.27:1 on page.
- **Border** (`oklch(0.92 0.004 286.32)` light / `oklch(1 0 0 / 10%)` dark): hairlines only.
- **Ring** (`oklch(0.6 0.015 286.067)`): the focus indicator. WCAG 1.4.11 holds it to 3:1
  against everything it abuts; the previous `0.705` reached 2.62:1 on page and 1.55:1 once the
  primitives drew it at 50% alpha. `0.6` measures 3.96:1 and 3.70:1.
- **Code Surface** (`oklch(0.98 0.001 286.375)` light / `oklch(0.205 0.006 285.885)` dark): the
  slab under code and tool output. Its own token because the block must sit *off* the page in
  both themes — one step down from white, one step up from near-black — and neither `muted` nor
  `card` does both.

### The state ramp

Four hues, each doubling as text colour and, at `/15`, as its own surface tint, so both roles
come from one value and are verified once.

- **Blocked** (`oklch(0.473 0.137 46.201)` / dark `oklch(0.879 0.169 91.605)`): amber. Something
  is waiting on a person.
- **Done** (`oklch(0.432 0.095 166.913)` / dark `oklch(0.845 0.143 164.978)`): green. Finished.
- **Running** (`oklch(0.443 0.11 240.79)` / dark `oklch(0.828 0.111 230.318)`): blue. In flight.
- **Failed** (`oklch(0.44 0.19 27.3)` / dark `oklch(0.75 0.16 22.2)`): red *as text*.
  `--destructive` (`oklch(0.577 0.245 27.325)`) is tuned to carry white on a solid fill and
  reaches only 3.97:1 as text on its own 10% tint, so error copy gets a darker value rather than
  reusing the button colour.
- **Recording** (`oklch(0.5 0.2 25)`): red by convention and *not* a failure. Kept separate so
  restyling errors cannot restyle the microphone.

### Named Rules

**The State-Only Rule.** Colour is the fastest channel for "healthy / waiting / failed", and
spending it on decoration spends the operator's attention. Outside the four-hue ramp, the
destructive action colour, and the recording indicator, the interface is neutral. There is no
brand accent, and adding one is a regression.

**The Two-Client Rule.** The ramp is authored as `oklch()` in `apps/chat-ui/src/index.css`,
where the lightness is tuned and the comments say why, and frozen as sRGB hex in
`packages/design/src/tokens.ts` because neither a terminal nor `RGBA.fromHex` takes `oklch()`.
`pnpm check-state-palette` converts the first to the second and fails when they disagree. The
stylesheet is the authored form; the hex is derived. Never edit the hex to match a change.

**The Attention-Blocked Rule.** `blocked` (amber) means a person is being asked to act.
`failed` (red) means something already went wrong and nobody is being asked. Collapsing the two
puts the surface's two most different states in one colour.

## Typography

**Body / UI Font:** system sans (`ui-sans-serif, system-ui, sans-serif`) — Tailwind's default
stack, deliberately unreplaced. A webfont would buy personality this register does not want and
cost a load on a surface read all day.
**Value Font:** system mono (`ui-monospace, SFMono-Regular, Menlo, monospace`).

**Character:** invisible on purpose. The type does no expressive work; hierarchy comes from
weight, muting, and the mono/proportional split. Personality lives in precision, not in letterforms.

### Hierarchy

- **Title** (600, 0.875rem/1.25rem): panel and section headers. There is no display or headline
  tier — this surface has no hero, and the largest type in the app is a 14px semibold header.
- **Body** (400, 0.875rem/1.25rem): transcript prose and panel copy. The transcript is held to a
  reading measure rather than the full pane width.
- **Label** (400, 0.75rem/1rem): metadata, timestamps, counts, chip text.
- **Value** (mono, 0.75rem/1rem): anything the harness emitted — ids, model names, paths, event
  types, token counts, JSON.

### Named Rules

**The Provenance Rule.** Monospace marks what the harness said; proportional marks what we
said. A model id, a path, a tool name, an event type and a raw status are mono because they are
quotations. Our own sentences about them are not.

**The 11px Floor.** Text below 11px is a smell requiring justification, not a density tool.
Density comes from tighter rows and fewer borders, never from shrinking type past legibility.

**Tabular numerals on anything that counts.** Token meters, durations and queue counts change in
place; proportional figures make them jitter and the eye reads motion as change.

## Layout

A fixed-height application shell, never a scrolling page: `h-screen` with `flex-col`, one
scrolling region inside, and everything else `shrink-0`. The header is `--header-height: 3rem`,
a token because two unrelated files need the same number — the header sizes itself from it and
the toast layer clears it by it. They previously agreed by coincidence, and did not.

Spacing is Tailwind's default scale used narrowly: rows sit at `px-3 py-1.5`, panels pad at
`p-4`, and stacked cards gap at `2.5`. Rhythm comes from repeating a few steps, not from a wide
vocabulary.

Zones yield rather than squeeze. Rails switch from an inline column to an overlay sheet at
content-driven widths — the chat column wants ~560px before the transcript and composer feel
cramped — so the breakpoints are derived from what the content needs, not from device names.
A rail never narrows the thing it describes; it leaves.

**The Shrink-Floor Rule.** Anything below a scrolling region carries `flexShrink: 0`. A
transcript longer than the screen will otherwise eat the composer's rows and leave a box you
cannot type in, with nothing on screen to say why. Each component is correct alone; the failure
only appears when they are rendered together against a long transcript.

## Elevation & Depth

**Tonal first, with a small and honest shadow vocabulary.** Depth is mostly a tonal step —
`code-surface` and `card` sit one level off the page in whichever direction the theme allows —
and separation elsewhere is a `1px` rule at `--border`.

Only two shadows are *tokens*, and both belong to the composer:

### Shadow Vocabulary

- **`--shadow-composer`** (`0 1px 2px oklch(0 0 0 / 5%), 0 4px 16px oklch(0 0 0 / 6%)`): the
  resting composer.
- **`--shadow-composer-focus`** (`0 2px 4px oklch(0 0 0 / 6%), 0 8px 28px oklch(0 0 0 / 10%)`):
  the focused composer.

Three further uses exist in app code and are deliberate: a `shadow-md` on the floating
scroll-to-latest button, which is the one control that overlays the transcript, and four
`shadow-sm` inside the composer's own furniture.

**Where the system and the code disagree.** The vendored primitives in `packages/ui/src` are
shadcn defaults and still carry theirs — `shadow-2xl` on overlays, `shadow-lg` on dialog-class
surfaces, `shadow-xs` on outline buttons. Nothing here has reconciled them with the tonal model
above. Treat that as incumbent truth rather than as a pattern to copy: a new surface should
reach for a tonal step, and a primitive that already ships a shadow is not licence for a fifth.

### Named Rules

**The One Lifted Surface Rule.** The composer is the only element in the app that floats *by
design*, because it is the only one always available and always the primary action. It is also
the only element with shadow tokens of its own; everything else either borrows a primitive's
default or uses a tonal step.

**The Nesting Rule.** A pane takes whichever tonal level its container does not: on the page it
is `bg-code-surface`, inside a card it is `bg-background`. Both are flat colours, never alphas —
these panes once carried three different alphas for one job, which made a pane's colour a
function of the tint behind it, and an approval's diff came out faintly amber because the banner
around it was.

## Shapes

Radius is a single scale from `--radius: 0.625rem`: `sm` 6px, `md` 8px, `lg` 10px, `xl` 14px.
Controls use `md`; chips and pills use `lg` or full.

`xl` is the transcript's radius, not a general one. Its eight uses in app code are all inside
the conversation column — the message bubble, a tool card, an approval, the `ui_request` banner,
the workspace strip, an attachment preview, a suggested action. That is a coherent rule worth
keeping: **`rounded-xl` marks a block in the conversation; panels and rails do not use it.** The
first anti-reference is not the radius itself, it is `rounded-xl` bordered cards stacked down a
*panel*, so reach for a rule or a tonal step there.

Borders are hairlines at `--border`, frequently at reduced alpha (`border-border/60`) where a
full-strength rule would read as structure rather than separation. Scrollbars are themed thin
with a `--scrollbar-thumb` that is deliberately *not* `--border`: as a control it owes 3:1 under
WCAG 1.4.11, and `--border` measured 1.27:1, which is invisible.

## Components

### Buttons

- **Shape:** `rounded-md` (8px), height 36px default, with `xs`/`sm`/`lg` and square icon sizes.
- **Primary:** `bg-primary` with `primary-foreground`, `hover:bg-primary/90`.
- **Ghost:** transparent until `hover:bg-accent` — the default for header and row affordances,
  because a toolbar of filled buttons is chrome competing with content.
- **Secondary:** `bg-secondary`, used for the "this is currently on" state of a toggle.
- **Focus:** `focus-visible:ring-[3px]` at `--ring` plus a border shift. Never removed, never
  reduced in alpha — the ring's contrast was measured at full opacity.

### Panels and sections

The repeated unit of the whole app. A header row of **icon · title · one at-a-glance value**,
then a body. The value in the header is load-bearing: it is what should make opening the panel
unnecessary most of the time, and a panel whose header carries no value is usually a panel that
has not decided what it is for.

The same component renders as a collapsible row inside a rail and as a full page under a route,
chosen by context rather than a prop, so one section does not become two implementations.

### Cards

Reserved. The only carded surfaces are the ones that stop a run — approval and `ui_request`
banners. Everything else in a panel is a readout and gets a row. This is what keeps the app off
its nearest anti-reference.

### Inputs

`bg-background` with a `--input` border, `rounded-md`, focus ring as above. The composer is the
signature case: a lifted surface with an anchored send control, banners docked directly above
it, and a slash menu that opens upward.

### State chips and dots

A state is never colour alone. Every dot carries adjacent text, and every chip carries its
label; the ramp is the fast channel, not the only one.

## Do's and Don'ts

### Do:

- **Do** spend colour on run state and nothing else — the four-hue ramp, `destructive` for a
  destructive action, `recording` for the microphone.
- **Do** give every panel header one at-a-glance value, so expanding it is usually unnecessary.
- **Do** set monospace for anything the harness emitted and proportional for anything we wrote.
- **Do** separate with a rule or a tonal step before reaching for a card.
- **Do** carry `flexShrink: 0` on anything below a scrolling region.
- **Do** measure contrast in each theme in its natural state. Flipping `.dark` at runtime leaves
  portalled content reporting stale backgrounds, which invents failures that are not there.
- **Do** state the resting case. A signal that appears only in trouble teaches the operator not
  to look at it.

### Don't:

- **Don't** add a brand accent colour. There isn't one, and the absence is the system.
- **Don't** stack `rounded-xl` bordered cards down a panel. That is the closest anti-reference
  and the fastest way to make this look generated. In the transcript column `rounded-xl` is the
  established block radius and is correct.
- **Don't** put an icon on every row. Icons mark kinds, not rows.
- **Don't** introduce a new shadow token. The composer holds the only two; elsewhere reach for a
  tonal step or a rule, and do not read the vendored primitives' shadcn defaults as licence.
- **Don't** encode a status in colour alone, and don't use amber and red interchangeably —
  `blocked` asks a person to act, `failed` reports something that already happened.
- **Don't** edit the frozen hex in `packages/design/src/tokens.ts` to resolve a palette
  mismatch. The stylesheet is authored, the hex is derived.
- **Don't** drop below 11px to gain density.
- **Don't** add motion that competes with streaming text, and honour
  `prefers-reduced-motion`.
