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
  scrollbar-thumb: "oklch(0.62 0.01 285.9)"
  state-blocked: "oklch(0.473 0.137 46.201)"
  state-done: "oklch(0.432 0.095 166.913)"
  state-running: "oklch(0.443 0.11 240.79)"
  state-failed: "oklch(0.44 0.19 27.3)"
  destructive: "oklch(0.577 0.245 27.325)"
  recording: "oklch(0.5 0.2 25)"
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.25
  headline:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.6
  prose:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  title:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: 1.45
  value:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: 1.45
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
  2xl: "16px"
  full: "9999px"
spacing:
  row-x: "12px"
  row-y: "6px"
  panel: "16px"
  stack: "10px"
  turn-gap: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
    height: "32px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
    height: "32px"
  button-ghost-hover:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.foreground}"
  rail-header:
    textColor: "{colors.foreground}"
    typography: "{typography.headline}"
    padding: "0 12px"
    height: "48px"
  panel-header:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.title}"
    padding: "12px 16px"
  run-readout:
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    padding: "10px 12px"
  user-turn:
    textColor: "{colors.foreground}"
    typography: "{typography.prose}"
    padding: "2px 0 2px 12px"
  tool-card:
    textColor: "{colors.foreground}"
    typography: "{typography.value}"
    rounded: "{rounded.xl}"
    padding: "8px 12px"
  approval-card:
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.xl}"
    padding: "12px"
  composer:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    typography: "{typography.prose}"
    rounded: "{rounded.2xl}"
    padding: "14px 16px 8px"
  state-chip-blocked:
    textColor: "{colors.state-blocked}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "2px 6px"
  deadline-chip:
    textColor: "{colors.state-blocked}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "2px 6px"
  deadline-chip-lapsed:
    textColor: "{colors.state-failed}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "2px 6px"
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
loud and the eye has nowhere to land. Then **consumer-chat warmth** — the inverted user bubble,
the avatar, the headline asking what you want to work on over a grid of starter cards — which
hides the mechanism and so inverts the product. One piece of that is shipped anyway, by choice:
the empty thread's welcome headline and starter cards came back on 2026-09-30, because an empty
thread that only listed facts left a new operator guessing what to ask. They are confined to the
empty thread, keep the readout beside them, and are gone once the first message lands; the
bubble and the avatar stay out. Then **warm-neutral editorial** — cream, serif
display, marketing cadence — which is the wrong register entirely.

**Key Characteristics:**

- A neutral zinc field where colour means run state and nothing else.
- Rules and tonal steps for separation; cards reserved for things that stop a run.
- One header grammar — icon, title, one at-a-glance value — repeated at every scale.
- Monospace for anything the harness emitted; proportional for anything we wrote.
- Two densities: 16px for the conversation that is read, 11/13px for the instruments that are scanned.
- Tonal depth by default. One surface floats by design, and it is the composer.

## Colors

A neutral zinc field carrying a four-hue state ramp, defined in `oklch` and tuned for contrast
rather than picked by name.

### Primary

- **Ink** (`primary`): the near-black of primary buttons and solid controls. Inverts to
  near-white in dark, so "primary" is a contrast relationship rather than a colour. The
  composer's send control uses the same relationship through `foreground`/`background`.

### Neutral

- **Page** (`background`; dark `oklch(0.141 0.005 285.823)`): the base field.
- **Muted** (`muted`): section headers, chip backgrounds, the resting rail.
- **Muted Foreground** (`muted-foreground`): metadata and secondary copy. The light value is
  `0.53`, not zinc's stock `0.552`, because `0.552` measured 4.39:1 against `--accent` on a
  selected row — under AA. `0.53` clears it at 4.79:1 there and 5.27:1 on page.
- **Hairline** (`border`; dark `oklch(1 0 0 / 10%)`): hairlines only.
- **Focus Ring** (`ring`): the focus indicator. WCAG 1.4.11 holds it to 3:1 against everything
  it abuts; the previous `0.705` reached 2.62:1 on page and 1.55:1 once the primitives drew it
  at 50% alpha. `0.6` measures 3.96:1 and 3.70:1.
- **Code Surface** (`code-surface`; dark `oklch(0.205 0.006 285.885)`): the slab under code and
  tool output. Its own token because the block must sit *off* the page in both themes — one step
  down from white, one step up from near-black — and neither `muted` nor `card` does both.
- **Scrollbar Thumb** (`scrollbar-thumb`; dark `oklch(1 0 0 / 36%)`): deliberately not
  `border`. A thumb is a control and owes 3:1; `border` measured 1.27:1 there.

### The state ramp

Four hues, each doubling as text colour and, at `/15`, as its own surface tint, so both roles
come from one value and are verified once. Cards that stop a run use the same hue at `/5` with a
`/40` border.

- **Blocked** (`state-blocked`; dark `oklch(0.879 0.169 91.605)`): amber. Something is waiting
  on a person.
- **Done** (`state-done`; dark `oklch(0.845 0.143 164.978)`): green. Finished.
- **Running** (`state-running`; dark `oklch(0.828 0.111 230.318)`): blue. In flight — and also
  *rejoining*, which is the same hue with a different word.
- **Failed** (`state-failed`; dark `oklch(0.75 0.16 22.2)`): red *as text*. `destructive` is
  tuned to carry white on a solid fill and reaches only 3.97:1 as text on its own 10% tint, so
  error copy gets a darker value rather than reusing the button colour.
- **Recording** (`recording`): red by convention and *not* a failure. Kept separate so
  restyling errors cannot restyle the microphone.

Idle is not on the ramp. A resting run is drawn with a `muted-foreground/50` dot and plain
foreground text: green would claim the last run succeeded, which an abort does not.

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
puts the surface's two most different states in one colour. The approval deadline chip is the
rule in one element: amber while a person can still answer, red the moment the harness has
answered for them.

## Typography

**Body / UI Font:** system sans (`ui-sans-serif, system-ui, sans-serif`) — Tailwind's default
stack, deliberately unreplaced. A webfont would buy personality this register does not want and
cost a load on a surface read all day.
**Value Font:** system mono (`ui-monospace, SFMono-Regular, Menlo, monospace`).

**Character:** invisible on purpose. The type does no expressive work; hierarchy comes from
weight, muting, and the mono/proportional split. Personality lives in precision, not in letterforms.

The ramp is set in `index.css` by redefining Tailwind's own steps rather than naming new ones,
so every existing `text-xs`/`text-sm` call site landed on it: `xs` is 11px, `sm` 13px, `base`
16px. It replaced ten sizes between 10px and 24px, five of them inside a 4px band, which read as
no hierarchy at all. Two ramps, because two densities are doing different jobs: 11/13 for rails
and panels, which are scanned; 16 for the transcript, which is read.

### Hierarchy

- **Headline** (600, 16px, 1.6): the heading of a whole rail — the instrument's "This run", the
  thread list — the header wordmark, which alone is set uppercase with wide tracking, and the
  headings of the two screens that render instead of the app: the access gate and the crash
  screen.
- **Display** (600, 24px → 28px at `md`, tight tracking): the empty thread's welcome headline,
  and nothing else. It is the one hero on the surface and it exists only while a thread is
  empty.
- **Prose** (400, 16px, 1.6): transcript message bodies, both sides, and the composer's
  textarea — at the same size on purpose, so a message does not change size when it is sent.
  Held to a reading measure (`max-w-3xl`) rather than the full pane width.
- **Title** (600, 13px, 1.5): panel and section headers, disclosure rows.
- **Body** (400, 13px, 1.5): rows, controls, instructional copy, and the prose of a card —
  an approval's reason, its summary, and the grant sentence above its buttons.
- **Label** (400–500, 11px, 1.45): metadata, timestamps, counts, chip text, keyboard hints, the
  "You"/"Felix" speaker labels, and the run readout's rows.
- **Value** (mono, 11px, 1.45): anything the harness emitted — ids, model names, paths, event
  types, token counts, JSON, a tool card's collapsed header.

### Named Rules

**The Provenance Rule.** Monospace marks what the harness said; proportional marks what we
said. A model id, a path, a tool name, an event type and a raw status are mono because they are
quotations. Our own sentences about them are not.

**The 11px Floor.** Text below 11px is a smell requiring justification, not a density tool.
Density comes from tighter rows and fewer borders, never from shrinking type past legibility.

**Tabular numerals on anything that counts.** Token meters, durations, countdowns and queue
counts change in place; proportional figures make them jitter and the eye reads motion as change.

**Nothing but the welcome is set above 16px.** The empty thread's headline is the single
display-size element (`text-2xl`, 28px at `md`). The last three headings off the ramp — the
access gate's panel heading at 24px and the gate form's and error boundary's `h1` at 18px — are
headlines now. No other element uses `text-lg`, `text-xl` or `text-2xl`; reaching for one is
adding a second display element, which this surface does not have.

## Layout

A fixed-height application shell, never a scrolling page: `h-screen` with `flex-col`, one
scrolling region inside, and everything else `shrink-0`. The header is `--header-height: 3rem`,
a token because two unrelated files need the same number — the header sizes itself from it and
the toast layer clears it by it. They previously agreed by coincidence, and did not. Rail
headers match it at 48px, so the header's rule and each rail's rule line up.

The header holds run *state*, not preferences. Immediately after the wordmark, on both
addresses and at every width, one fixed slot says what **this thread's** run is doing:
`blocked` while it waits on an approval or a question, else `running` while it streams, else
nothing — a word and a dot, never the dot alone, and never a finer phase, which is the
instrument's. It is drawn as a **state chip**: rounded-full, the badges' height (22px), the
word and dot in the state's colour on that colour at `/10` — 6.1:1 (`blocked`) and 6.4:1
(`running`) in light, 11.6:1 and 10.2:1 in dark. Bare `text-xs` lost to the filled Verbose pill
beside it, which ranked a viewing preference above the run. Its `title` and an `sr-only` prefix
say it is this thread's run, because the attention line beneath it is tenant-wide. It is not a
live region: the attention line already announces the same change. After it, the tab's modes:
**Verbose**, a `secondary` badge that is also the button turning it off (named *Verbose on,
turn off*), and the **canary** rollout as an outline badge in mono — the version is the
harness's number quoted back, so it is never a filled pill. Its words also say whether this
thread is on the rollout, in an `sr-only` clause, because the foreground-versus-muted colour
that says it on screen says it to nobody who cannot see it.

The left cluster **yields in a fixed order**. The wordmark never shrinks and is never
truncated; the run state never yields. The mark goes first, whole, below `sm`: it repeats the
wordmark beside it, so it is the one thing in the cluster whose loss costs nothing. Below `sm` both modes draw as icons (a scroll for
Verbose, a bird for the canary), their words kept in the accessible name and the `title`.
While the run state is showing below `sm`, the modes step off the screen — at 390px the
wordmark and a `blocked` chip leave no room for one icon beside them. Verbose goes `hidden`,
which also takes it out of the tab order (it is in the Session menu), and the canary, not
focusable, goes `sr-only` and is still read; both return when the run settles. A badge clipped
part-way reads as broken, and one pushed off by overflow is a button focus can reach and
nobody can see, which is why the yield is whole. Past all that the cluster clips at its own
edge rather than running under the right cluster, which is `shrink-0`: at 320px the chip is
clipped, a known limit. On the right: New chat, which is a plus alone below `sm`; the Harness
door — plain navigation carrying no state of its own, and its **word at every width**, icon
and word from `sm`, the word alone below it, because a server glyph beside a panel glyph said
nothing on a phone about which one was a place; the instrument toggle; and one ellipsis menu named
**Session** that opens on what it is named for: *Session* (Continue run, disabled on an empty
thread, and Copy thread id), then *View* (Verbose tools), then *Theme* under its own label as
Light/Dark/System radio items. Theme is a set-once preference and holds no header slot of its
own; Thinking is in the composer.

The workbench is **three zones**: the workspace (18rem), the transcript at reading width
(`max-w-3xl`, turns 24px apart) with the composer anchored beneath it, and the run instrument
(`clamp(22rem, 24vw, 30rem)` — the panel is what widens on a large display, not the
transcript). An attention line runs full width under the header on every address. At rest its
dot is the neutral idle dot; when its latest `/approvals` poll failed it says *Can't reach
approvals* with the age of its last answer, in `state-failed`, and never the all-clear.

Spacing is Tailwind's default scale used narrowly: rows sit at `px-3 py-1.5`, panels pad at
`p-4`, and stacked cards gap at `2.5`. Rhythm comes from repeating a few steps, not from a wide
vocabulary.

Zones yield rather than squeeze, in a fixed order. Three zones want ~1200px of content, so
**1280px** is where all three fit; below it the **instrument** becomes a drawer, because it is
reference material and the half of it that cannot wait already lives in the attention line and
the banner above the composer. Below **1024px** the workspace follows, last because it is the
subject. `/harness` is nav-rail plus panel above **768px**; below it the index *is* the list.
The breakpoints are derived from what the content needs, not from device names.

**The Yield Rule.** A rail never narrows the thing it describes; it leaves.

**Zones move at one speed.** An inline rail opens and closes by animating its width —
`RailPresence` interpolates a grid track between `0fr` and `1fr`, so the transcript beside it
reflows over 200ms `ease-out` instead of jumping 18–30rem in one frame. The rail's content keeps
its own width and is clipped rather than squeezed, so nothing inside rewraps mid-motion, and a
closing rail is `inert` until it unmounts. The narrow-width drawers slide at the same 200ms
`ease-out`, overriding the primitive's 500/300ms `ease-in-out`, so a zone moves the same whether
it is a rail or an overlay. Both are off under `prefers-reduced-motion`: a panel appearing
reports nothing about a run, so unlike the working pulse it has no reason to keep moving.

**The Shrink-Floor Rule.** Anything below a scrolling region carries `flexShrink: 0`. A
transcript longer than the screen will otherwise eat the composer's rows and leave a box you
cannot type in, with nothing on screen to say why. Each component is correct alone; the failure
only appears when they are rendered together against a long transcript.

## Elevation & Depth

**Tonal first, with a small and honest shadow vocabulary.** Depth is mostly a tonal step —
`code-surface` and `card` sit one level off the page in whichever direction the theme allows —
and separation elsewhere is a `1px` rule at `--border`, often at `/60`.

Only two shadows are *tokens*, and both belong to the composer:

### Shadow Vocabulary

- **`--shadow-composer`** (`0 1px 2px oklch(0 0 0 / 5%), 0 4px 16px oklch(0 0 0 / 6%)`): the
  resting composer.
- **`--shadow-composer-focus`** (`0 2px 4px oklch(0 0 0 / 6%), 0 8px 28px oklch(0 0 0 / 10%)`):
  the focused composer, and the slash menu that opens upward out of it.

Further uses in app code: a `shadow-md` on the floating scroll-to-latest button, which is the
one control that overlays the transcript, and `shadow-sm` on the composer's own furniture (send
control, drop hint, notice pill).

The access-key gate follows the tonal model too: its form card is flat — a full-strength
`border` hairline at `rounded-lg`, no shadow — and its side panel is flat `muted`, where it was
the app's one gradient. There is no gradient *fill* anywhere in the app; the transcript's dot
grid is drawn with a `radial-gradient`, but it is a texture, not a fill (the One Texture Rule).

**Where the system and the code disagree.** The vendored primitives in `packages/ui/src` are shadcn defaults and still carry theirs —
`shadow-2xl` on overlays, `shadow-lg` on dialog-class surfaces, `shadow-xs` on outline buttons.
Nothing here has reconciled them with the tonal model above. Treat both as incumbent truth
rather than as a pattern to copy: a new surface should reach for a tonal step, and a primitive
that already ships a shadow is not licence for another.

### Named Rules

**The One Lifted Surface Rule.** The composer is the only element in the workbench that floats
*by design*, because it is the only one always available and always the primary action. It is
also the only element with shadow tokens of its own; everything else either borrows a
primitive's default or uses a tonal step.

**The Nesting Rule.** A pane takes whichever tonal level its container does not: on the page it
is `bg-code-surface`, inside a card it is `bg-background`. Both are flat colours, never alphas —
these panes once carried three different alphas for one job, which made a pane's colour a
function of the tint behind it, and an approval's diff came out faintly amber because the banner
around it was.

**The One Texture Rule.** The app has exactly one decorative texture: an 18px dot grid behind the
transcript's `<main>` (`.bg-dots` in `index.css`), drawn from `--foreground` at
`--dot-grid-alpha` (7% light, 16% dark, because text crosses it and owes its contrast —
`tests/dot-grid-contrast.test.ts` recomputes both) and masked to fade out by 65% of the column's
height. Nowhere else: not behind the workspace, the instrument, `/harness` or any panel, where
rows are scanned rather than read.

**The Solid-Over-Texture Rule.** Anything with a fill that sits over the grid is opaque. An alpha
tint (`bg-muted/30`) mixes with *transparent*, so the grid runs straight through it — a tool card
or a button reads as if it had no fill. `bg-solid-<token>/<n>` mixes with `--background`
instead: the same pixel on the plain page, solid over the dots. Tool cards, starter cards, the
transcript's notes and the message actions' dark hover use it; the composer dock and its input
box are plain `bg-background` / `bg-card`, with no backdrop blur left to do anything.
`tests/solid-over-dots.test.ts` fails on an alpha fill in the files that render over the grid;
a fill that sits on an opaque parent (a row inside a card) is allowlisted there, by name.

## Shapes

Radius is a scale from `--radius: 0.625rem`: `sm` 6px, `md` 8px, `lg` 10px, `xl` 14px, plus
`full` for pills. Controls use `md`; notices and error slabs use `lg`; chips, badges, the
deadline chip, state dots and the scrollbar thumb use `full`.

Two further steps are in use and are *not* derived from `--radius`: they are Tailwind's stock
values, reached for directly. `xs` (4px, bare `rounded`) is the small-object radius — `kbd`
keys, inline code, row-level icon buttons, the inline rename field. `2xl` (16px) belongs to the
composer and the slash menu it opens, and to nothing else. It sits only 2px from `xl`, so
the two do not read as different tiers; it is a separate value by accident of utility, not by
decision.

`xl` is the transcript's radius, not a general one. Its uses in app code are all inside the
conversation column — a tool card, an approval, the `ui_request` banner, an attachment and its
preview, and the focus outline of the approval surfaces. That is a coherent rule worth keeping:
**`rounded-xl` marks a block in the conversation; panels and rails do not use it.** The first
anti-reference is not the radius itself, it is `rounded-xl` bordered cards stacked down a
*panel*, so reach for a rule or a tonal step there.

Borders are hairlines at `--border`, frequently at reduced alpha (`border-border/60`) where a
full-strength rule would read as structure rather than separation. The left rule is a recurring
form: a user turn and the empty-thread readout both hang off a single vertical hairline rather
than sitting in a box. Scrollbars are themed thin with the thumb inset by a transparent 3px
border.

## Components

### The mark

An F drawn as a stem and a top arm on a rounded tile, with the middle arm replaced by a **dot** —
the same state dot the run readout, chips and approvals draw. The dot is where the mark carries
state, so the mark is the State-Only Rule applied to identity rather than an exception to it:
there is still no brand colour, and the only hue the mark ever shows is a run state's.

- **One geometry.** `packages/design/src/mark.ts` holds it on a 32-unit grid with every straight
  edge on an even unit, so at 16px each edge lands on a whole pixel. The stroke is 4 units; a
  6-unit stroke read as a corner bracket with a dot in its pocket rather than as a letter.
  `pnpm sync:brand` renders every static file from it (favicons, touch and PWA icons, the docs'
  header logos and social card); nothing is drawn by hand.
- **In the tab, it carries state.** `presence.ts` repaints the SVG favicon's dot: `state-running`
  while working, `state-blocked` while waiting on a person, and back to the static
  `/favicon.svg` at rest. The tab tile is always the dark ink in either scheme, because the tab
  strip is browser chrome rather than our page, and the dark-theme ramp is the one tuned to read
  on near-black. Safari draws neither an SVG nor a swapped favicon; there the title carries the
  state alone.
- **In the page, it never does.** The header lockup and the auth panel draw the mark at rest: the
  tile is `currentColor` and the glyph is `--background`, which is `primary`'s inversion with no
  theme branch. The header already has a run-state slot beside the wordmark; a coloured dot one
  element to its left would say the same thing twice.
- **It is decorative beside the wordmark.** `aria-hidden` in chat-ui and an empty `alt` in the
  docs, because the wordmark is the accessible name and a second "Felix" would be read out.
- **Lockup:** mark, then the uppercase wordmark, `gap-2`. In chat-ui's header the mark is the
  first thing to yield below `sm` (see Layout). The tile is sized so the glyph inside
  it stands about as tall as the wordmark's caps: 20px beside chat-ui's 16px wordmark, 16px beside
  the auth panel's 13px one, 1.5rem beside the docs' 1.25rem one.

### Buttons

- **Shape:** `rounded-md` (8px), 36px default, 32px `sm` (the size most toolbar and card
  buttons use), with `xs` and square icon sizes.
- **Primary:** `bg-primary` with `primary-foreground`, `hover:bg-primary/90`. Used for the one
  affirmative action on a surface that has no second answer — the gate's Continue, the crash
  screen's Reload.
- **Outline:** page-coloured with a hairline. **Approve and Deny are both outline**, at equal
  width (`flex-1`): a gated call is a question with two answers, and on the surface that
  authorises a write to disk the button styling must not be the thing that picks one. The words
  carry the difference — Approve names its target, and the grant sentence above says what it
  allows.
- **Ghost:** transparent until `hover:bg-accent` — the default for header and row affordances,
  including New chat, because a toolbar of filled buttons is chrome competing with content.
- **Secondary:** `bg-secondary`, used for the "this is currently on" state of a toggle (the
  workspace and instrument toggles). The Harness/Chat switch is **always ghost**: it links to
  the *other* address, so a "current" fill would mark the place being left.
- **Focus:** `focus-visible:ring-[3px]` at `--ring` plus a border shift. Never removed, never
  reduced in alpha — the ring's contrast was measured at full opacity. Toggles that have a
  keyboard binding say so in their `title` and `aria-keyshortcuts`.

### Panels and sections

The repeated unit of the whole app. A header row of **icon · title · one at-a-glance value**,
then a body. The value in the header is load-bearing: it is what should make opening the panel
unnecessary most of the time, and a panel whose header carries no value is usually a panel that
has not decided what it is for.

The same component renders as a disclosure row, as a full page under `/harness`, and bare inside
an instrument tab (where the tab is the heading), chosen by context rather than a prop, so one
section does not become two implementations. A rail's own heading is a headline at 48px,
matching the app header.

Under `/harness` every destination draws the same `PageHeader` (`components/harness/panel.tsx`):
icon, the title the nav uses, then the value **with its unit** (`0 memories`, `last 60 events ·
1 failed`, `3 jobs`) set beside the title rather than at the far edge, and controls pushed right —
wrapping to a second row when the pane is narrow. A page whose value would need a request of its
own shows none; a list that came back at its fetch cap reads `50+`, not a total. A section drawn
bare still computes its value and reports it to the host's header, which is how the Ledger's one
header carries whichever half is on screen. Every page's body **and** its header row are held to
`READING_MEASURE` (`max-w-3xl`) by default, so a status is read with its name rather than found
1300px away and a page's controls end where the rows they act on end; `<Panel fullBleed>` is the
opt-out, and no page takes it today. The rule under the header stays full width; it separates the
header from the pane. Below the header a page is divided into `PageSection`s — a hairline rule and
an `h3` title (Title, 13px 600), never a bordered box — and label/value pairs are a `Facts` grid
with the value a gutter from its label rather than right-aligned across the pane. Lists are rows
between hairlines, as the Ledger's are. `/harness` looks at its own agent — `?agent=` in the address,
defaulting to the one Chat is talking to and never writing back to it — and the **picker lives
only in the headers of the pages it scopes** (Skills, Eval, Agent); a control belongs on the
things it changes, and at the top of the nav it read as filtering tenant-wide pages it does not.
Every link and every page that writes its own view keeps `?agent=`. The nav is two runs under
visible 11px labels that name their lists — Records (Memory, Corpus, Skills, Ledger, Agent) and
Workbenches (Manifests, Jobs, Eval) — split by a full-strength `border` rule. Every link is a Tab
stop, with the arrow keys as an extra. The rail carries exactly two glances, in `state-failed`
and only when non-zero: `Jobs · N failing` and `Ledger · N failed`, counted as those pages'
headers count them. Absence is the rail's all-clear, so it is drawn only for a read that
answered: a failed read shows a muted `unchecked` (a word, not a hover-only `?`), and a count
kept from an earlier read carries its age on screen (`3 failed · 2m`). Every page header ends in a quiet
`Docs ↗` text link to that page's reference on docs.felix.run (a new tab; the Ledger's follows
its half), declared beside the destination and checked against the docs source by
`tests/docs-links.test.ts`, so a renamed heading fails rather than landing at the top of a page.
Every page header row is `min-h-8`, so the
rule under it sits on one line from page to page, and the tab title names the page (`Ledger —
Felix`) behind any run-state prefix. On `/harness` the header drops the conversation's own
controls — New chat, the instrument toggle and the Session menu's run verbs — and keeps the door
back to Chat as plain navigation; the run's state is in the slot beside the wordmark, which is
there on both addresses. The ellipsis menu stays in the same slot on both addresses and the
instrument toggle's slot is held empty at every width, so the right-hand cluster does not move
between them — collapsing it below `sm` was tried, and a door that moves cost more than the gap;
on `/harness` the menu is named **Theme** and holds only the Theme radio group. Two controls have
one home on every page: a view switch (`ViewSwitch`, a toggle group drawn like the Ledger's
tabs) and a create toggle (`CreateToggle`, outline, the plus turning to a cross when open) both
sit in the header, and the form a create toggle opens is the page's first section, with the list
still under it. A view that can be linked is in the address (`?view=usage`,
`?view=asof&turn=12`). Fields are the shared `Input`/`Textarea` at 13px with a visible `Label`;
help that must survive typing goes under the field, never in a placeholder. A header value that
mixes a window with a state draws the window neutral and only the state in its chip
(`last 60 events ·` then `3 failed`, `3 jobs ·` then `1 failing`), and a list puts its failures
where the eye lands — failing jobs first, a failed Activity row's subject in `state-failed`.
A routine `OK` status is a muted word and dot; colour is kept for what went wrong. A page whose
latest read failed after a good one keeps the good rows under one line saying so, and its
header value says how old it is (`0 documents · as of 2m ago`) — it never trades what it last
knew for an error box. **Amber is only for a person being asked to act now**: a denial in the feed is an outlined
badge, a rubric that can never reject is foreground text, a forgotten memory is not red. Names
the harness gave in bulk (tools, skills) are a mono list, not a pill each. `/harness` opens on
the Ledger. Narrow, the way back to the list
takes the header's icon slot rather than a row of its own. An id that has to distinguish rows is cut from the **middle**, not
the end: the Ledger shows a thread id at up to 20 characters with both ends kept, because
`self-triage-changelog-union` and `self-triage-other` share a prefix and differ in the tail.

The workspace zone's header follows the same grammar: folder or drive icon, **Workspace**, then
the mount as its value — the folder's name in mono, or *in-tab* when client tools run against the
tab's own store (including while a folder from last session waits on a reconnect, because until
then that is where tools run). Its actions — *Mount a folder*, *Change folder* / *Disconnect*,
*Reconnect <name>* — are an outline row beneath, never in the value slot: a header that holds an
action says what to do rather than what is, and in the narrow drawer the header row is the one
the close button shares.

### Run readout

The top of the instrument, above its tabs: what the run is doing, derived from state the shell
already holds, so it costs no request. A 6px dot and a **state word** at 13px medium in the ramp
colour — *Waiting on you*, *Running*, *Rejoining thread*, *Failed*, *Idle* — then a stopwatch
(`for 3:07` live, `last run 42s` at rest) in tabular mono — or, on a thread this tab never ran,
`last activity 2d ago` from the thread index, since no duration is derivable from history. Beneath, an 11px definition list:
what it is asking, which tool is in flight and on what, tokens (marked `floor` when some turns
reported none). The word is the live region; the stopwatch is not, because a clock that speaks
every second is noise.

### Transcript turns

- **User turn:** a 2px left rule at `foreground/25`, a "You" label at 11px muted, then the
  message at 16px. No bubble, no fill, no avatar.
- **Assistant turn:** a "Felix" label, then prose, reasoning and tool cards interleaved in the
  order they happened, then a mono usage line. Also no avatar.
- **Reasoning:** a collapsed row, never prose — reasoning at the answer's weight reads as the
  answer. While it streams the row borrows the run readout's grammar: the 6px `state-running`
  dot pulsing, *Thinking* at 11px medium in `state-running`, then a stopwatch and a word count in
  tabular mono (`· 7s · 88 words`), with one muted 13px line of the **newest** reasoning beneath
  it on the reasoning's own left rule — cut from the front (`direction: rtl` on the line, the text
  itself `ltr`), because the first words never change and a row that sits still reads as a stalled
  stream. Settled, the dot becomes a brain icon, the tail goes, and the row states what was
  measured: `Thought for 16s · 180 words`, or `Reasoning · 180 words` for a block rebuilt from
  history, which carries no duration. The pulse is the transcript's one motion, and it runs only
  while no answer text is arriving to compete with.
- **Durable status:** a durable run's stream carries no deltas, so until `final` the turn holds
  the engine's status line — *Durable run accepted…*, *Background · running…*, *Waiting on your
  approval · Write notes.txt*. It is drawn as a status, not as the reply: the state dot, the line
  at 13px medium in the ramp colour, and `for 0:42` muted beside it. `running` pulses; `blocked` is
  amber and still, because nothing is working while a person is being asked; once the run has
  ended the dot drops to the idle grey. The line is the live region, the stopwatch is not. The
  terminal client draws both with the same states — spinner for the dot, `●` for blocked.
  Measured on page in light at 375px: `state-running` text 7.51:1, `state-blocked` 7.09:1, the
  muted stopwatch, count and reasoning tail 5.27:1; the longest approval line wraps inside the
  column with its stopwatch still on screen, and nothing scrolls sideways. In dark, loaded as
  dark rather than toggled: `state-running` 11.94:1, `state-blocked` 13.75:1, muted 7.59:1.
- **Long tokens wrap; wide blocks scroll in place.** Nothing in a turn may widen the column.
  Plain text — the operator's turn, a note, reasoning — wraps with `wrap-anywhere`, so a
  commit hash or an absolute path breaks rather than giving the transcript a sideways scroll
  at phone width. Assistant prose uses `wrap-break-word` instead, which breaks an overflowing
  word the same way but keeps words whole when a box is *sized*: that is what lets a table or
  a code block keep its natural width and scroll inside its own `overflow-x-auto` box rather
  than crushing its columns to a letter each.
- **Empty thread:** a greeting, then the readout. Centred in the column at `max-w-3xl`: the
  Display headline "What do you want to work on?", a 16px muted sentence naming the agent
  ("You're chatting with **cowork**…") — either replaced by the manifest's own
  `metadata.greeting` (`felix.greeting` on `/v1/models`) when it declares one — then the agent's starter prompts as a two-column grid
  of `rounded-xl` outline cards (`border-border/60`, `bg-solid-card/40`, no shadow) — title in 13px
  medium, the prompt it sends beneath in 11px muted, clamped to two lines with the full text on
  hover. They come from the manifest's `metadata.starters` (`felix.starters` on `/v1/models`),
  fall back to a built-in table for a harness that sends none, and are disabled while a run
  streams. Under the cards the readout is one 11px muted line — agent, folder, thread,
  harness — with unreachable in `state-failed`, with the word.

### Tool cards

`rounded-xl` with a `border/60` hairline on `solid-muted/30`. Collapsed, the header reads
**`name · target · duration`** in 11px mono and then the state: the target is what differs
between five `read_file` rows, so it is what the header spends its width on. There is no wrench
— an icon on every card marks a row, not a kind. The state badge is honest about outcome: a shell
tool shows its exit status, and a result the harness marked as an error or refusal is drawn in
`state-failed` rather than under a green `done`. Expanded, input and output sit on
`bg-background` panes (the Nesting Rule) that wrap and cap at 16rem.

### Cards

Reserved. The carded surfaces in the app are the ones that stop a run — approval and
`ui_request` banners, `rounded-xl` at `state-blocked/5` with a `/40` border — plus the empty
thread's starter cards, which exist only until the first message. Everything else in a
panel is a readout and gets a row. Outside the app, the access gate's form is a flat bordered
card, because below `lg` nothing else on that page gives the form an edge. This is what keeps the app off its nearest anti-reference.

### Approval card

The one place a gated call is decided, reused verbatim by the transcript banner, the attention
line's queue and the instrument. Top to bottom, in reading order: the tool name as a mono badge,
the manifest, the queue count and the **deadline chip**; the reason; the summary; the evidence
(before/after for a write, arguments otherwise, editable); the grant sentence at 13px
(`foreground/85`, measured 12.84:1 light) directly above the buttons, because it is what
Approve actually does; then Approve / Deny / Edit arguments — Approve and Deny identical in weight. Evidence precedes the
decision.

Approve names its tool, and a tool name has no spaces to break at: `Approve
github__create_pull_request_review_comment` is wider than the card at phone width. The two
decision buttons therefore override the primitive's `whitespace-nowrap` *on this card only* —
`min-w-0` so `flex-1` still splits the row equally, `wrap-anywhere` so the label takes a second
line rather than leaving the card. It wraps rather than truncates because an ellipsis keeps the
name only in the accessible name, and the sighted operator is deciding too. The tool badge and
the grant sentence carry the same override for the same reason.

### State chips, dots and the deadline chip

A state is never colour alone. Every dot carries adjacent text, and every chip carries its
label; the ramp is the fast channel, not the only one. Chips are `rounded-full`, 11px medium,
`2px 6px`, the ramp colour as text on its own `/15` tint.

The **deadline chip** is the ramp's clearest instance. Live, it reads *Auto-denies in* with the
countdown in tabular mono, amber on amber `/15` — measured 9.07:1 dark and 5.18:1 light on the
card's tint. Lapsed, it reads *Denied · timed out* in `state-failed` on its `/15` tint (6.03:1
dark, 5.72:1 light) and the buttons disable. It is a `timer`, not a live region; a separate
status line announces the last minute and the lapse once each.

### Inputs

`bg-background` with a `--input` border, `rounded-md`, focus ring as above. The composer is the
signature case: a lifted, opaque `card` surface, `rounded-2xl`, with an anchored send control,
banners docked directly above it, a slash menu that opens upward, and a hint line beneath it at
11px that names the keys worth learning from there — Enter, ⇧Enter, and (from `md` up) the
thread switcher and the jump to a waiting approval — as small bordered `kbd` keys.

**Send is the composer's one primary action.** *Run in background* sits beside it as a muted
ghost with a clock icon (icon-only below `sm`, the words kept as its accessible name), because it
is the exception and an equal-weight pill made every send read as a two-way choice. Its
explanation is the button's accessible description and a tooltip that opens on focus as well as
hover — never a `title`, which a keyboard user does not see.

**The agent picker lists manifests in the harness's order**, each name over the provider model
it runs on in 11px mono — `felix.providerModel` from `GET /v1/models`, shown only when it
differs from the name, because it is a quotation of the harness. The trigger shows the name
alone, truncating with an ellipsis, and its accessible name and `title` carry the value
(`Agent: cowork`), as the Thinking picker's do. `felix.contextWindow` is kept by the client but not drawn: the harness computes it from
the manifest *name*, so for most manifests it is the catalog's 128k fallback rather than the
model's real window, and printing it would be exact-looking and wrong.

**The Thinking picker sits beside it**, in the same pill: a brain icon, *Thinking:* in the sans
from `sm` up, then the level in mono, because the level is the harness's own value. It is a
parameter of the next send, like the agent, so it lives where the send is made rather than in the
header, and its accessible name carries the value (`Thinking: high`). Unlike the agent picker it
stays enabled during a run: the level is session state on the harness, not a field of a send.
Its list opens under a non-selectable label, *Token budget, from the next turn*, and each level
carries the budget the harness sends for it, in mono because it is the harness's number quoted
back: *off* sends none, then 128, 512, 1,024, 2,048, 8,192 and 32,000 tokens. The budget is what is
sent, not what the model does with it — a model that takes an effort level gets the budget rounded
to one, and on the current Claude models every level up to *high* rounds to the same effort. That
is the harness's mapping to fix; the list quotes the number rather than disguising it.
`/think` still cycles it, with a toast, because the operator is looking at the text they typed.

**The composer's focus indicator is its border.** It removes its textarea's ring and signals
focus with a full-alpha `--ring` border plus the heavier composer shadow. The border is the
indicator, so it owes 3:1: against the composer surface (opaque `card`) it measures 3.96:1
light and 3.67:1 dark, and 3.53:1 / 3.23:1 against the resting `border/50` it replaces. (Those
were 3.78:1 and 3.34:1 dark while the surface was `card/80` over the dock; making it opaque
lightened it a step, and both still clear 3:1.)
It was `ring/60` until that was measured — 2.10:1 light, 2.15:1 dark — which failed. There is
no reduced-alpha focus indicator left in the app.

## Do's and Don'ts

### Do:

- **Do** spend colour on run state and nothing else — the four-hue ramp, `destructive` for a
  destructive action, `recording` for the microphone.
- **Do** give every panel header one at-a-glance value, so expanding it is usually unnecessary.
- **Do** set monospace for anything the harness emitted and proportional for anything we wrote.
- **Do** set what is read at 16px and what is scanned at 11/13px, and nothing in between.
- **Do** separate with a rule or a tonal step before reaching for a card.
- **Do** carry `flexShrink: 0` on anything below a scrolling region.
- **Do** measure contrast in each theme in its natural state. Flipping `.dark` at runtime leaves
  portalled content reporting stale backgrounds, which invents failures that are not there.
- **Do** state the resting case. A signal that appears only in trouble teaches the operator not
  to look at it.

### Don't:

- **Don't** add a brand accent colour. There isn't one, and the absence is the system. The
  mark's dot is not one either: it is ink at rest and a state's hue only when there is a state.
- **Don't** hand-edit a rendered mark. Change `packages/design/src/mark.ts` and run
  `pnpm sync:brand`.
- **Don't** stack `rounded-xl` bordered cards down a panel. That is the closest anti-reference
  and the fastest way to make this look generated. In the transcript column `rounded-xl` is the
  established block radius and is correct.
- **Don't** put an icon on every row. Icons mark kinds, not rows.
- **Don't** draw a user turn as a bubble or give either speaker an avatar.
- **Don't** introduce a new shadow token. The composer holds the only two; elsewhere reach for a
  tonal step or a rule, and do not read the vendored primitives' shadcn defaults as licence.
- **Don't** encode a status in colour alone, and don't use amber and red interchangeably —
  `blocked` asks a person to act, `failed` reports something that already happened.
- **Don't** edit the frozen hex in `packages/design/src/tokens.ts` to resolve a palette
  mismatch. The stylesheet is authored, the hex is derived.
- **Don't** drop below 11px to gain density.
- **Don't** add motion that competes with streaming text, and honour
  `prefers-reduced-motion`. A "still working" pulse or spinner slows under reduced motion rather
  than stopping: frozen, it reports a live run as a hung one.
