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
hides the mechanism and so inverts the product. Then **warm-neutral editorial** — cream, serif
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
  thread list — and the header wordmark, which alone is set uppercase with wide tracking. There
  is no display tier: this surface has no hero.
- **Prose** (400, 16px, 1.6): transcript message bodies, both sides, and the composer's
  textarea — at the same size on purpose, so a message does not change size when it is sent.
  Held to a reading measure (`max-w-3xl`) rather than the full pane width.
- **Title** (600, 13px, 1.5): panel and section headers, disclosure rows, the empty-thread
  readout's heading.
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

**Where the code is off the ramp.** Three headings outside the workbench use sizes the ramp does
not define: the access gate's panel headline (`text-2xl`, 24px) and the gate form's and error
boundary's `h1` (`text-lg`, 18px). The stylesheet's own comment still assigns 24px to "the
greeting", which no longer exists — the greeting is now a 13px title. Treat those three as
incumbent, not as a display tier to reuse.

## Layout

A fixed-height application shell, never a scrolling page: `h-screen` with `flex-col`, one
scrolling region inside, and everything else `shrink-0`. The header is `--header-height: 3rem`,
a token because two unrelated files need the same number — the header sizes itself from it and
the toast layer clears it by it. They previously agreed by coincidence, and did not. Rail
headers match it at 48px, so the header's rule and each rail's rule line up.

The workbench is **three zones**: the workspace (18rem), the transcript at reading width
(`max-w-3xl`, turns 24px apart) with the composer anchored beneath it, and the run instrument
(`clamp(22rem, 24vw, 30rem)` — the panel is what widens on a large display, not the
transcript). An attention line runs full width under the header on every address.

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

**Where the system and the code disagree.** The access-key gate's form card borrows
`--shadow-composer` (and the composer's 16px radius) to give it an edge on a page with no other
boundary; that is a second floating surface the One Lifted Surface Rule does not account for.
The gate's decorative side panel is also the app's one gradient (`muted` to `background`), which
the first anti-reference names.
The vendored primitives in `packages/ui/src` are shadcn defaults and still carry theirs —
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

## Shapes

Radius is a scale from `--radius: 0.625rem`: `sm` 6px, `md` 8px, `lg` 10px, `xl` 14px, plus
`full` for pills. Controls use `md`; notices and error slabs use `lg`; chips, badges, the
deadline chip, state dots and the scrollbar thumb use `full`.

Two further steps are in use and are *not* derived from `--radius`: they are Tailwind's stock
values, reached for directly. `xs` (4px, bare `rounded`) is the small-object radius — `kbd`
keys, inline code, row-level icon buttons, the inline rename field. `2xl` (16px) belongs to the
composer and the slash menu it opens, plus the gate's form card. It sits only 2px from `xl`, so
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

### Buttons

- **Shape:** `rounded-md` (8px), 36px default, 32px `sm` (the size most toolbar and card
  buttons use), with `xs` and square icon sizes.
- **Primary:** `bg-primary` with `primary-foreground`, `hover:bg-primary/90`. Used for the one
  affirmative action on a surface — Approve on an approval card.
- **Outline:** page-coloured with a hairline; the Deny beside Approve. The two are equal width
  (`flex-1`) so Deny is not subordinate, though the fill still makes Approve the heavier of the
  pair.
- **Ghost:** transparent until `hover:bg-accent` — the default for header and row affordances,
  including New chat, because a toolbar of filled buttons is chrome competing with content.
- **Secondary:** `bg-secondary`, used for the "this is currently on" state of a toggle (the
  workspace and instrument toggles, the Harness/Chat switch).
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
header carries whichever half is on screen. Rows on a full-width page are held to `max-w-3xl`, so a
status is read with its name rather than found 1300px away.

### Run readout

The top of the instrument, above its tabs: what the run is doing, derived from state the shell
already holds, so it costs no request. A 6px dot and a **state word** at 13px medium in the ramp
colour — *Waiting on you*, *Running*, *Rejoining thread*, *Failed*, *Idle* — then a stopwatch
(`for 3:07` live, `last run 42s` at rest) in tabular mono. Beneath, an 11px definition list:
what it is asking, which tool is in flight and on what, tokens (marked `floor` when some turns
reported none). The word is the live region; the stopwatch is not, because a clock that speaks
every second is noise.

### Transcript turns

- **User turn:** a 2px left rule at `foreground/25`, a "You" label at 11px muted, then the
  message at 16px. No bubble, no fill, no avatar.
- **Assistant turn:** a "Felix" label, then prose, reasoning and tool cards interleaved in the
  order they happened, then a mono usage line. Also no avatar.
- **Empty thread:** a readout, not a greeting — a left-ruled block anchored at the bottom where
  the first turn will land, headed "Empty thread" at title size, listing agent, folder, thread
  and whether the harness is reachable (unreachable in `state-failed`, with the word).

### Tool cards

`rounded-xl` with a `border/60` hairline on `muted/30`. Collapsed, the header reads
**`name · target · duration`** in 11px mono and then the state: the target is what differs
between five `read_file` rows, so it is what the header spends its width on. There is no wrench
— an icon on every card marks a row, not a kind. The state badge is honest about outcome: a shell
tool shows its exit status, and a result the harness marked as an error or refusal is drawn in
`state-failed` rather than under a green `done`. Expanded, input and output sit on
`bg-background` panes (the Nesting Rule) that wrap and cap at 16rem.

### Cards

Reserved. The only carded surfaces are the ones that stop a run — approval and `ui_request`
banners, `rounded-xl` at `state-blocked/5` with a `/40` border. Everything else in a panel is a
readout and gets a row. This is what keeps the app off its nearest anti-reference.

### Approval card

The one place a gated call is decided, reused verbatim by the transcript banner, the attention
line's queue and the instrument. Top to bottom, in reading order: the tool name as a mono badge,
the manifest, the queue count and the **deadline chip**; the reason; the summary; the evidence
(before/after for a write, arguments otherwise, editable); the grant sentence at 13px
(`foreground/85`, measured 12.84:1 light) directly above the buttons, because it is what
Approve actually does; then Approve / Deny / Edit arguments. Evidence precedes the decision.

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
signature case: a lifted `card/80` surface, `rounded-2xl`, with an anchored send control,
banners docked directly above it, a slash menu that opens upward, and a hint line beneath it at
11px that names the keys worth learning from there — Enter, ⇧Enter, and (from `md` up) the
thread switcher and the jump to a waiting approval — as small bordered `kbd` keys.

**Where the composer disagrees with the focus rule.** The composer removes its textarea's ring
and signals focus instead with a `ring/60` border and the heavier composer shadow. That is the
one focus indicator in the app drawn at reduced alpha, and nothing has measured it against the
3:1 the ring was tuned for.

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

- **Don't** add a brand accent colour. There isn't one, and the absence is the system.
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
  `prefers-reduced-motion`.
