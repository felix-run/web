---
name: Felix chat-ui
description: The instrument panel for a self-hosted agent harness, warm enough to live in all day.
colors:
  ground: "oklch(0.952 0.007 75)"
  background: "oklch(0.995 0.002 75)"
  foreground: "oklch(0.235 0.012 55)"
  card: "oklch(1 0 0)"
  sidebar-accent: "oklch(0.995 0.002 75)"
  secondary: "oklch(0.945 0.008 75)"
  accent: "oklch(0.945 0.008 75)"
  muted: "oklch(0.952 0.007 75)"
  muted-foreground: "oklch(0.49 0.016 58)"
  primary: "oklch(0.265 0.014 55)"
  primary-foreground: "oklch(0.985 0.004 75)"
  border: "oklch(0.905 0.008 70)"
  input: "oklch(0.88 0.009 70)"
  ring: "oklch(0.58 0.02 60)"
  code-surface: "oklch(0.972 0.005 75)"
  scrollbar-thumb: "oklch(0.6 0.012 60)"
  state-blocked: "oklch(0.473 0.137 46.201)"
  state-done: "oklch(0.432 0.095 166.913)"
  state-running: "oklch(0.443 0.11 240.79)"
  state-failed: "oklch(0.44 0.19 27.3)"
  destructive: "oklch(0.577 0.245 27.325)"
  recording: "oklch(0.5 0.2 25)"
typography:
  display:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.333
    letterSpacing: "-0.025em"
  figure:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.333
    letterSpacing: "-0.025em"
  page-title:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.025em"
  statement:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.556
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.65
  prose:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.65
  title:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.45
  value:
    fontFamily: "JetBrains Mono Variable, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.45
rounded:
  xs: "4px"
  sm: "10px"
  md: "12px"
  lg: "14px"
  xl: "18px"
  2xl: "22px"
  full: "9999px"
spacing:
  sheet-inset: "8px"
  tray-gap: "6px"
  row-x: "12px"
  row-y: "6px"
  stack: "10px"
  panel: "16px"
  approval: "20px"
  turn-gap: "24px"
components:
  sheet:
    backgroundColor: "{colors.background}"
    rounded: "{rounded.2xl}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.title}"
    rounded: "{rounded.full}"
    padding: "8px 16px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "color-mix(in oklab, {colors.primary} 90%, transparent)"
  button-outline:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    typography: "{typography.title}"
    rounded: "{rounded.full}"
    padding: "6px 14px"
    height: "32px"
  button-outline-hover:
    backgroundColor: "{colors.accent}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    typography: "{typography.title}"
    rounded: "{rounded.full}"
    padding: "6px 14px"
    height: "32px"
  button-ghost-hover:
    backgroundColor: "{colors.accent}"
  button-decision:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    typography: "{typography.title}"
    rounded: "{rounded.xl}"
    padding: "6px 14px"
    height: "auto"
  new-chat:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.title}"
    rounded: "{rounded.full}"
    height: "36px"
  sidebar-row:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "6px 10px"
  sidebar-row-current:
    backgroundColor: "{colors.sidebar-accent}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
  thread-search:
    backgroundColor: "{colors.sidebar-accent}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.full}"
    height: "36px"
  tab-list:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.full}"
    height: "36px"
  tab-active:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.title}"
    rounded: "{rounded.full}"
  view-switch:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    height: "32px"
  user-turn:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.foreground}"
    typography: "{typography.prose}"
    rounded: "{rounded.2xl}"
    padding: "12px 16px"
  tool-card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.xl}"
    padding: "10px 14px"
  approval-card:
    backgroundColor: "color-mix(in oklab, {colors.state-blocked} 5%, {colors.background})"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.2xl}"
    padding: "20px"
  composer:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    typography: "{typography.prose}"
    rounded: "{rounded.2xl}"
    padding: "14px 16px 8px"
  run-readout:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.2xl}"
    padding: "12px 14px"
  ledger-tray:
    backgroundColor: "{colors.ground}"
    rounded: "{rounded.2xl}"
    padding: "6px"
  ledger-tile:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.xl}"
    padding: "12px"
  page-icon-tile:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.xl}"
    size: "32px"
  state-chip-blocked:
    backgroundColor: "color-mix(in oklab, {colors.state-blocked} 10%, {colors.background})"
    textColor: "{colors.state-blocked}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
    height: "22px"
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

**Creative North Star: "The Warm Workbench"**

This is not a chat app that happens to log tool calls; it is a window onto a running process
that happens to accept messages. The mounted folder is the subject, the thread is how you talk
to it, and the machinery is on display because supervising it is the job. It is read daily by
one operator who ran the harness themselves and holds the gate key, so density, learned
affordances, and labels that assume the harness was configured by the reader are all permitted.
What is not permitted is a tidier abstraction standing in front of what the harness actually
reported.

Since 2026-10-10 the *material* is warm, because this is a tool opened every day. A stone ground
carries the shell and the sidebar; a near-white sheet floats on it and holds everything that is
read. Soft radii go on what is touched, an engineered grotesk (Geist) carries prose and UI, and a
mono (JetBrains Mono) marks what the harness said. The register underneath is unchanged:
**instrumented, calm, exact**. Instrumented: real states, real numbers, real event types. Calm:
no alarm colours for ordinary states, no motion competing with streaming text, no celebration.
Exact: a number is a number. Warmth is a property of the surface, never of the facts. It never
swaps a status for a friendlier one, never hides a call, and never adds a colour that does not
mean state.

The confirmed anti-references are specific. The **scaffolded AI-chat default**: stock shadcn
tokens (the zinc palette this redesign replaced), the system font, flat hierarchy, bordered cards stacked down every panel, an icon on
every row, a gradient somewhere. This redesign was made to leave it. **Density without
hierarchy**: every panel equally loud, nowhere for the eye to land. **Consumer-chat fiction**:
the inverted user bubble, the avatar, statuses softened into reassurance, the harness tucked out
of sight. Warmth is now the chosen register, and the fiction stays out. The empty thread's
welcome headline and starter cards are kept by choice: they are confined to the empty thread and
gone once the first message lands. **Warm-neutral editorial**: cream, serif display, marketing
cadence. The ground is stone, never cream, and the face is a sans.

**Key Characteristics:**

- Two neutral levels: a warm stone ground under a near-white floating sheet. Colour means run state and nothing else.
- Tone and one confident scale step for separation; hairlines only where tone cannot do it.
- One header grammar (icon, title, one at-a-glance value) repeated at every scale.
- Monospace for anything the harness emitted; Geist for anything we wrote.
- A 12/14/16 ramp, with single steps at 18, 20 and 24 reserved for named roles.
- Pills for what you press, 22px corners for what you read or decide on.
- Four shadows, each a role: the sheet, the lift, the focused lift, the approval.

## Colors

Two warm neutral levels and a four-hue state ramp, all authored in `oklch` in
`apps/chat-ui/src/index.css` and tuned for contrast, not picked by name. Neutral chroma stays
under 0.01 at hue 55–75, so the warmth reads as stone rather than paper.

### Primary

- **Warm Ink** (`primary`; dark `oklch(0.93 0.008 75)`): the near-black of every filled control:
  Send, New chat, the gate's Continue. It inverts to near-white in dark, so "primary" is a
  contrast relationship, not a hue. "You can act here" is drawn in ink and never in a fifth
  colour. Primary foreground on it measures 14.70:1 light and 14.10:1 dark.

### Neutral

- **Stone Ground** (`ground`; dark `oklch(0.17 0.006 60)`): the shell behind everything, and the
  sidebar. Also the tone of every surface that *holds* things on the sheet: a user turn, the run
  readout, the Activity ledger's tray, a page's empty state, the tab and view-switch tracks, the
  page icon tile. Light `muted` is the same value.
- **Sheet** (`background`; dark `oklch(0.212 0.007 60)`): the floating surface that holds the
  header, the transcript, the instrument and every `/harness` page. Foreground on it measures
  16.47:1 light and 15.25:1 dark.
- **Card White** (`card`; dark `oklch(0.235 0.008 60)`): one step above the sheet: the composer,
  a tool card, an outline button's face. Popovers use the sheet's value.
- **Sidebar Lift** (`sidebar-accent`; dark `oklch(0.24 0.008 60)`): a selected row on the ground
  is lifted to the sheet's own colour in light (`shadow-sheet` with it), and to a step above the
  sheet in dark. The thread search field sits on it too.
- **Warm Wash** (`accent`, `secondary`; dark `oklch(0.27 0.008 60)`): hover fills on the sheet
  and the "this is on" fill of a toggle.
- **Muted Ink** (`muted-foreground`; dark `oklch(0.72 0.013 70)`): metadata and secondary copy.
  Measured 6.20:1 on the sheet, 5.46:1 on the ground and 5.35:1 on `accent` (light); 7.10:1,
  7.70:1 and 6.07:1 in dark.
- **Hairline** (`border`; dark `oklch(0.95 0.02 70 / 10%)`) and **Field Edge** (`input`; dark
  `/16%`): hairlines and the resting edge of a field, an outline button and the composer.
- **Focus Ring** (`ring`; dark `oklch(0.6 0.015 70)`): the focus indicator, held to 3:1 against
  what it abuts. Computed from the tokens for this record: 4.24:1 on the sheet, 4.30:1 on card,
  3.74:1 on the ground (light); 4.46:1, 4.22:1, 4.84:1 (dark).
- **Code Surface** (`code-surface`; dark `oklch(0.18 0.006 60)`): the slab under a fenced block
  or a shell result. It sits *off* the sheet in both themes, one step down in light and one step
  down toward the ground in dark.
- **Scrollbar Thumb** (`scrollbar-thumb`; dark `oklch(0.62 0.01 70)`): a control, so not
  `border`. 3.90:1 on the sheet and 3.44:1 on the ground (light).
- **Selection** is `foreground` mixed at 14% into transparent: ink on ink, never a state colour.

### The state ramp

Four hues, unchanged by the redesign, each doubling as text colour and as its own surface tint,
so both roles come from one value and are verified once. Measured 2026-10-10: every state colour
is above 6.2:1 on either neutral level and 6.4:1 on its own `/10` tint.

- **Blocked** (`state-blocked`; dark `oklch(0.879 0.169 91.605)`): amber. Something is waiting
  on a person.
- **Done** (`state-done`; dark `oklch(0.845 0.143 164.978)`): green. Finished.
- **Running** (`state-running`; dark `oklch(0.828 0.111 230.318)`): blue. In flight, and also
  *rejoining*, which is the same hue with a different word.
- **Failed** (`state-failed`; dark `oklch(0.75 0.16 22.2)`): red *as text*. `destructive` is
  tuned to carry white on a solid fill and reaches only 3.97:1 as text on its own 10% tint, so
  error copy gets a darker value.
- **Recording** (`recording`): red by convention and *not* a failure. Kept separate so
  restyling errors cannot restyle the microphone.

Idle is not on the ramp. A resting run is a `muted-foreground/50` dot and plain foreground text:
green would claim the last run succeeded, which an abort does not.

### Named Rules

**The State-Only Rule.** Colour is the fastest channel for "healthy / waiting / failed", and
spending it on decoration spends the operator's attention. Outside the four-hue ramp, the
destructive action colour and the recording indicator, the interface is warm neutral. There is
no brand accent; warmth lives in the neutrals' hue, never in a fifth colour.

**The Stone-Not-Cream Rule.** Neutral chroma stays under 0.01. Above that the ground reads as
paper and the surface drifts into the editorial register it is not.

**The Two-Client Rule.** The ramp is authored as `oklch()` in `apps/chat-ui/src/index.css` and
frozen as sRGB hex in `packages/design/src/tokens.ts`, because neither a terminal nor
`RGBA.fromHex` takes `oklch()`. `pnpm check-state-palette` fails when they disagree. The
stylesheet is the authored form; never edit the hex to match a change.

**The Attention-Blocked Rule.** `blocked` (amber) means a person is being asked to act.
`failed` (red) means something already went wrong and nobody is being asked. The approval
deadline chip is the rule in one element: amber while a person can still answer, red the moment
the harness has answered for them.

## Typography

**UI and Prose Font:** Geist Variable (with `ui-sans-serif, system-ui, sans-serif`)
**Value Font:** JetBrains Mono Variable (with `ui-monospace, SFMono-Regular, Menlo, monospace`)

Both are self-hosted through `@fontsource-variable` and imported at the top of `index.css`; no
request leaves the origin for a face.

**Character:** an engineered grotesk, precise at 12–14px and still comfortable in a long reply.
The warmth is carried by the surfaces; the type stays an instrument's, close enough in shape to the
mono that the pair reads as one product. It replaced Onest on 2026-10-10, the day the material
changed, chosen over Barlow, Red Hat Text and Archivo from a side-by-side at the app's real sizes.
Hierarchy comes from weight, one scale step, muting, and the mono/proportional split.

The ramp redefines Tailwind's own steps, so every existing `text-xs`/`text-sm` landed on it:
`xs` is 12px, `sm` 14px, `base` 16px (line height 1.65). The dense steps rose a pixel each in the
redesign, from 11/13, because the surface is meant to be comfortable all day. Above 16px,
Tailwind's stock `lg` (18), `xl` (20) and `2xl` (24) are each held by one named role, always
semibold with tight tracking.

### Hierarchy

- **Display** (600, 24px rising to 28px at `md`, tight): the empty thread's welcome headline,
  and nothing else. It exists only while a thread is empty.
- **Figure** (600, 24px, tight): the Activity page's account sentence (`2 threads ran, 1 with
  failures. $1.41 spent.`) and, in mono, its *Where the spend went* total. The one number a page
  is opened to read.
- **Page Title** (600, 20px, tight): a `/harness` page's `h2`.
- **Statement** (600, 18px, tight): what a person is being asked or told at a glance: an
  approval's summary (the sentence answered by Approve or Deny), the run readout's state word,
  and the instrument's "This run" heading.
- **Headline** (600, 16px): a page section's `h3`, the uppercase wordmark (`tracking-wider`), and
  the headings of the access gate and the crash screen.
- **Prose** (400, 16px, 1.65): transcript message bodies, both sides, and the composer's
  textarea, at one size so a message does not change size when sent. Held to `max-w-3xl`.
- **Title** (600, 14px): panel and disclosure headers, button labels (every button is semibold),
  tab labels, a tool card's summary at 500.
- **Body** (400, 14px): rows, controls, instructional copy, an approval's reason and grant
  sentence.
- **Label** (500–600, 12px): metadata, timestamps, counts, chip text, group labels, keyboard
  hints, the "You"/"Felix" speaker labels (semibold; *Felix* in foreground, *You* muted).
- **Value** (mono, 12px): anything the harness emitted: ids, model names, paths, event types,
  token counts, JSON, a tool's raw name under its summary, an approval's tool badge (14px there).

### Named Rules

**The Provenance Rule.** Monospace marks what the harness said; Geist marks what we said. A
model id, a path, a tool name, an event type and a raw status are mono because they are
quotations. Our own sentences about them are not.

**The One-Step Rule.** Each size above 16px belongs to a role, not to a component. Reaching for
`text-lg`, `text-xl` or `text-2xl` means claiming Statement, Page Title or Figure; a second use
must be the same kind of thing (a question asked, a page named, the number a page is for).

**The 12px Floor.** Text below 12px is a smell requiring justification, not a density tool.
Density comes from tighter rows and fewer borders, never from shrinking type past legibility.

**Tabular numerals on anything that counts.** Token meters, durations, countdowns and queue
counts change in place; proportional figures make them jitter.

Markdown headings are held to the ramp, because the renderer's defaults (30/24/20/18px) are not.
In a reply, at 16px prose, `#` and `##` are the body size in semibold, `###` in medium, and
`####`–`######` the 14px title, muted. In a rendered skill file `#` is a headline (16px) and the
rest step down by weight and muting.

## Layout

A fixed-height application shell, never a scrolling page: `h-[var(--vvh,100dvh)]` with
`flex-col`, one scrolling region inside, and everything else `shrink-0`. The shell is the stone
ground. The header is `--header-height: 3rem`, a token because two unrelated files need the same
number: the header sizes itself from it and the toast layer clears it by it.

**The sheet floats from 1024.** Everything but the sidebar (header, transcript, composer,
instrument, every `/harness` page) sits on one `background` surface. Inline (from 1024px) it
stands 8px off the top, bottom and right edges, with the largest radius (22px), `shadow-sheet`
and its own overflow clip; its left edge meets the sidebar, which has no border of its own, so
the ground's tone is the only divider. Below 1024, where the sidebar is a drawer, the sheet is
the whole screen, edge to edge. The sidebar's brand row takes the same 8px top margin so it stays
on the header's line. Inside the sheet the header keeps its bottom hairline (`border/60`); the
instrument keeps a left hairline and a faint card tint (`bg-solid-card/40`); the composer dock
has no rule above it, since the composer's own lift is its edge.

**The brand belongs to the sidebar, and the mark is its toggle.** The app sidebar runs full
height beside the header, and its top row is the header's line (the same `--header-height` plus
the top safe-area inset) carrying the mark and the wordmark. The mark sits where the menu's icons
sit, so collapsed to icons it heads their column and the wordmark is clipped by the narrowing
panel rather than snapping out. The mark *is* the toggle (named *Sidebar*, `aria-pressed`, ⌘\),
and it points the way a click will move the sidebar: closed, it faces the way it was drawn, `>_`;
open, it turns round to face back. The turn is a horizontal flip about the tile's own centre,
played as the sidebar moves; reduced motion makes it instant. Below 1024, where the sidebar is a
drawer, the mark and wordmark stand at the start of the header instead, toggling the drawer, and
the drawer heads itself with the same row, its mark named *Close sidebar*. The wordmark is the
page's one `h1` wherever it is the app's name on screen (the sidebar inline, the header narrow)
and a span inside the drawer. There is no toggle in the header from 1024 and no slot held empty
for one.

The header holds run *state*, not preferences. It starts (after the brand, below 1024) with one
fixed slot, on both addresses and at every width, that says what **this thread's** run is doing:
`blocked` while it waits on an approval or a question, else `running` while it streams, else
nothing: a word and a dot, never the dot alone, and never a finer phase, which is the
instrument's. It is drawn as a **state chip**: a pill 22px tall, the word and dot in the state's
colour on that colour at `/10`. Its `title` and an `sr-only` prefix say it is this thread's run,
because the attention line is tenant-wide. It is not a live region: the attention line already
announces the same change. After it, the tab's modes: **Verbose**, a `secondary` badge that is
also the button turning it off (named *Verbose on, turn off*), and the **canary** rollout as an
outline badge in mono. The canary's words also say whether this thread is on the rollout, in an
`sr-only` clause.

The left cluster **yields in a fixed order**. The brand never shrinks and the wordmark is never
truncated; the run state never yields either. Below `sm`, while a run state is showing, the
wordmark steps aside (it stays the `h1` for a reader), and so does New chat. Below `sm` both modes
draw as icons (a scroll for Verbose, a bird for the canary), their words kept in the accessible
name and the `title`. While the run state is showing below `sm`, the modes step off the screen:
Verbose goes `hidden` (it is in the Session menu), and the canary goes `sr-only` and is still
read; both return when the run settles. Past all that the cluster clips at its own edge rather
than running under the right cluster: at 320px the chip is clipped, a known limit. There is **no
door to `/harness`** in the header: the sidebar lists its eight pages. Before the controls sits
the **attention line** (below). On the right: New chat, only where the sidebar is a drawer, and
a plus alone below `sm`; the instrument toggle; and one ellipsis menu named **Session**:
*Session* (Continue run, Copy thread id), *View* (Verbose tools), then *Theme* as Light/Dark/
System radio items. Thinking is in the composer.

The workbench is **three zones**: the app sidebar (17rem expanded, 3.25rem as icons: 8px either side of the 36px icon buttons, the gap the sheet keeps everywhere else) on the ground,
and on the sheet the transcript at reading width (`max-w-3xl`, turns 24px apart) with the
composer anchored beneath it, and the run instrument (`clamp(22rem, 24vw, 30rem)`; the panel is
what widens on a large display, not the transcript). The **attention line** is a pill in the
header, right-aligned before the instrument toggle and the menu, on every address. It is the
first thing in the header to give way: the sentence truncates. Below `sm` it is two words that
cannot truncate (*1 waiting*, *No approvals*, *Unreachable*) with *Review* as its chevron alone,
the full sentence kept as the live region and the `title`. It is tinted only when it has
something to say (`state-blocked` at `/10` while a person is asked, `state-failed` while it
cannot vouch for the list) and is muted text on no surface at rest. At rest its dot is the
neutral idle dot; when its latest `/approvals` poll failed it says *Can't reach approvals* with
the age of its last answer, in `state-failed`, and never the all-clear. Expanded, its queue opens
**under the header**, in the flow, held to the transcript's measure on the transcript's centre
line, and is **one line per call** (tool and target in mono, the thread, and a countdown chip
that says what it counts down to: *Auto-denies in 4:20*; the clock alone below `sm`), opening
into the approval card on *Review*. It opens itself only for a call on this thread. A write from
another thread offers *Open thread to review* instead of a card, because only its own banner can
show what the write replaces. The card names the gating rule beside the tool on every surface
that decides one, and never offers to edit a whole file body.

**"Blocked on this thread" is one set.** The title, favicon, notification, header chip, readout
and banner read the engine's approval queue, and the engine adopts every row the always-on
`/approvals` poll lists for this thread, so no surface can say a call is waiting while another
says the thread is idle. While it is blocked, an empty thread's headline and starters step aside
and its readout sits on the floor beside the banner.

The sidebar is expanded by default wherever it fits inline; collapsing it leaves a column of
icons with their names in tooltips, never nothing. The instrument starts open from **1600px**,
where all three zones sit at their own widths, and closed below. A stored choice outranks both.

Spacing is Tailwind's default scale used narrowly: rows sit at `px-2.5`–`px-3` and `py-1.5`,
panels pad at `p-4`, trays at `p-1.5` with `gap-1.5` between tiles, the approval card at `p-5`.
Rhythm comes from repeating a few steps, not from a wide vocabulary. `/harness` pages and
instrument sections are held to the reading measure and **centred on the sheet**, like the
transcript; held to the left they left half the sheet empty at any desktop width.

Zones yield rather than squeeze, in a fixed order. Three zones want ~1200px of content, so
**1280px** is where all three fit; below it the **instrument** becomes a drawer, because it is
reference material and the half of it that cannot wait already lives in the attention line and
the banner above the composer. Below **1024px** the sidebar follows as a drawer (on the ground,
like the inline sidebar), last because it holds every way to anywhere else. `/harness` needs no
nav of its own while the sidebar is inline; between **768px** and **1024px** it draws its rail
beside the panel, and below 768px the index *is* the list. The breakpoints are derived from what
the content needs, not from device names.

**The Yield Rule.** A rail never narrows the thing it describes; it leaves.

**Zones move at one speed.** An inline rail opens and closes by animating its width:
`RailPresence` interpolates a grid track between `0fr` and `1fr`, so the transcript beside it
reflows over 200ms `ease-out` instead of jumping. The rail's content keeps its own width and is
clipped rather than squeezed, and a closing rail is `inert` until it unmounts. The narrow-width
drawers slide at the same 200ms `ease-out`. Both are off under `prefers-reduced-motion`.

**Phones and tablets.** The shell is `100dvh`, never `100vh`: on iOS `vh` is the viewport with
Safari's toolbar *hidden*, which put the composer under the toolbar. It draws edge to edge
(`viewport-fit=cover`) and keeps clear of the notch and home indicator with the `*-safe`
utilities in `index.css`: the header grows a strip above itself (`pt-safe`), the composer's
bottom padding becomes the home-indicator inset where that is larger (`pb-safe-4`), the shell
clears a landscape notch at both sides, and the side drawers clear all three edges they meet.
While an on-screen keyboard is up the shell's height follows the visual viewport (`--vvh`). With
no hardware keyboard in sight, Enter is a newline and Send sends, and the composer's key hint is
not drawn.

Two one-line offers sit above the composer on a phone or tablet, never on an empty thread and
never together: in a browser tab, **install**; inside the installed app, **notifications** (a
bell, one sentence, *Turn on*). Each is muted 12px text with an outline action and a dismiss, and
each is gone for good once dismissed or done. Neither is shown at a desk.

**The Shrink-Floor Rule.** Anything below a scrolling region carries `flexShrink: 0`. A
transcript longer than the screen will otherwise eat the composer's rows and leave a box you
cannot type in, with nothing on screen to say why.

## Elevation & Depth

**Two tonal levels, and four shadows that each mean one thing.** The ground is the floor; the
sheet floats on it; a white card sits one step above the sheet. Inside the sheet, a stone tone
(`ground`) is how something *holds* other things: a tray, a note, a track. Hairlines remain
where tone cannot separate (the header's bottom rule, the instrument's left edge, a card's own
border) and are no longer the default divider.

### Shadow Vocabulary

- **Sheet** (`shadow-sheet`; light `0 0 0 1px oklch(0.3 0.03 55 / 5%), 0 1px 2px oklch(0.3 0.03
  55 / 5%), 0 8px 24px -12px oklch(0.3 0.03 55 / 12%)`; dark `0 0 0 1px oklch(0.95 0.02 70 /
  6%), 0 8px 24px -12px oklch(0 0 0 / 50%)`): one soft, warm lift off a tone. The floating sheet,
  and anything *selected or set* on a tone: the current thread tile, the active sidebar row, the
  active tab and view-switch pill, a tool card, a ledger tile.
- **Lift** (`--shadow-composer`, utility `shadow-lift`; light `0 1px 2px oklch(0.3 0.03 55 /
  6%), 0 6px 20px -4px oklch(0.3 0.03 55 / 10%)`): the primary action floats. The resting
  composer and the New chat pill.
- **Lift, focused** (`--shadow-composer-focus`; light `0 2px 4px oklch(0.3 0.03 55 / 7%), 0
  12px 32px -6px oklch(0.3 0.03 55 / 16%)`): the focused composer and the slash menu that opens
  upward out of it.
- **Approval** (`shadow-approval`; light `0 0 0 4px` of `state-blocked` at 10%, then `0 4px 8px
  oklch(0.3 0.03 55 / 8%), 0 20px 44px -10px oklch(0.3 0.03 55 / 22%)`): a run waiting on a
  person. The one lift above the focused composer, with an amber halo.

Dark replaces the warm shadow colour with black at 30–60%, since a warm shadow on charcoal reads
as nothing. Further uses in app code: `shadow-md` on the floating scroll-to-latest button (the
one control that overlays the transcript) and `shadow-sm` on the composer's own furniture. There
is no gradient as a surface anywhere in the app (a thread row's action fade is a gradient of the
row's own colour, not a decoration), and no texture.

**Where the system and the code disagree.** The vendored primitives in `packages/ui/src` still
carry shadcn defaults: `shadow-2xl` on select and hover-card, `shadow-lg` on dialog, sheet,
popover and dropdown, `shadow-xs` on Input, Switch and ButtonGroup, `shadow-sm` on Textarea and
Card. The redesign reconciled Button (the outline's `shadow-xs` is gone), Tabs and Sidebar only.
Treat the rest as incumbent truth, not as a pattern to copy. `shadow-lift-focus` exists as a
utility but nothing uses it; the composer and slash menu reach the variable directly.

### Named Rules

**The Four Lifts Rule.** Sheet means set on a tone; lift means the primary action; focused lift
means the primary action in use; approval means a person is being waited on. A new surface takes
the lift its role already names. A fifth shadow is a new role and needs a reason that none of the
four covers.

**The Approval-Owns-Attention Rule.** Nothing on screen out-ranks a waiting approval: its lift,
border and radius are the largest on the sheet. A new element that competes with it is wrong.

**The Nesting Rule.** A pane takes whichever tonal level its container does not: on the sheet it
is `bg-code-surface`, inside a card it is `bg-background`. Both are flat colours, never alphas.
`bg-solid-<token>/<n>` (a tint mixed with `--background` rather than with transparent) is the
spelling for a tint that must be one flat colour whatever sits behind it.

## Shapes

Radius is a scale from `--radius: 0.875rem` (14px): `sm` 10px, `md` 12px, `lg` 14px, `xl` 18px,
`2xl` 22px, all derived; `full` for pills; and bare `rounded` (Tailwind's literal 4px) for the
smallest objects: `kbd` keys and inline code.

The roles, as the code uses them, run from what you press to what you read:

- **Pill (`full`)**: everything pressed or toggled. Every button variant and size, badges,
  state and deadline chips, the attention line, the thread search field, tab and view-switch
  tracks and their active pills, state dots, the scrollbar thumb.
- **22px (`2xl`)**: the soft objects a person reads or decides on. The floating sheet, the
  composer and its slash menu, a user turn, a waiting approval, the run readout, the Activity
  ledger's tray and the spend table's tray, a page's empty state; and, as vendored, the select,
  command and hover-card popovers.
- **18px (`xl`)**: an object *in* something. A tool card, a plan card, a starter card, a queued
  message, the watching banner, the `ui_request` banner, a ledger tile, the page icon tile, the
  user-turn edit field, and the **decision buttons**, which are `xl` rather than pills so a label
  that wraps to two lines never reads as a broken pill.
- **14px (`lg`)**: rows on the ground: thread tiles and sidebar menu rows. Also the toast.
- **12px / 10px (`md`, `sm`)**: fields (`Input`, `Textarea`, the rename field) and small
  controls inside rows.

Borders are hairlines at `--border`, often at `/60`, or `--input` on a field and an outline
button. Scrollbars are themed thin with the thumb inset by a transparent 3px border.

**The Soft-Where-Touched Rule.** The larger a thing is as an object of attention, the larger its
corner; a pill is for pressing. An object never takes a pill, and a control never takes a 22px
card corner.

**The Cancelled-Not-Gone Rule.** A call that changed nothing keeps its card. It is drawn with a
dashed `state-failed/40` border and its summary struck through (`decoration-state-failed/60`),
so it still reads as something that was tried. Nothing disappears; it cancels.

## Components

### The mark

**A cat's head whose face is a prompt.** The tile itself is the head, ears and all, and on it sit
a `>` and the cursor after it. The **cursor** is where the mark carries state, so the mark is the
State-Only Rule applied to identity: the only hue it ever shows is a run state's. The head and
the `>` are always neutral ink.

- **One geometry.** `packages/design/src/mark.ts` holds it on a 32-unit grid: the head
  (`MARK_HEAD_PATH`), the `>` (`MARK_CHEVRON`, a round-capped 3-unit stroke) and the cursor
  (`MARK_CURSOR`). `pnpm sync:brand` renders every static file from it; nothing is drawn by hand.
- **Full-bleed icons are light.** iOS and a maskable launcher icon draw no transparency, so there
  the field is the light ink and the dark head stands on it, inset so the ear tips clear the
  corners.
- **In the tab, it carries state.** `presence.ts` repaints the SVG favicon's cursor:
  `state-running` while working, `state-blocked` while waiting on a person, and back to the static
  `/favicon.svg` at rest. The tab mark's head is always the dark ink, and the cursor uses the
  dark-theme ramp. Safari draws neither; there the title carries the state alone.
- **In the page, it never does.** The lockup draws the mark at rest: the head is `currentColor`
  and the prompt is `--background`, which is `primary`'s inversion with no theme branch.
- **It is decorative beside the wordmark.** `aria-hidden` in chat-ui, because the wordmark is the
  accessible name; in chat-ui it sits inside the sidebar toggle, which carries its own name.
- **Lockup:** mark (20px), then the wordmark in Geist 16px semibold, uppercase, `tracking-wider`,
  `gap-2`. In chat-ui the lockup heads the sidebar on the ground.

### Buttons

- **Shape:** pills (`rounded-full`), semibold 14px labels. 36px default, 32px `sm` (most toolbar
  and card buttons), 24px `xs`, square icon sizes.
- **Primary (Warm Ink):** `bg-primary` with `primary-foreground`, `hover:bg-primary/90`. Send, the
  gate's Continue, the crash screen's Reload.
- **New chat** is the sidebar's ink pill with `shadow-lift`: the one way to start, so it floats
  like the composer. It is never disabled by a run, because a new thread leaves the run going.
- **Outline:** `card` face with an `input` edge, `hover:bg-accent`, no shadow. **Approve and
  Deny are both outline**, at equal width (`flex-1`): a gated call is a question with two
  answers, and the button styling must not pick one. The words carry the difference.
- **Ghost:** transparent until `hover:bg-accent`: header and row affordances, and *Run in
  background* beside Send, muted with a clock icon, because it is the exception.
- **Secondary:** `bg-secondary`, the "this is currently on" state of a toggle (the workspace and
  instrument toggles).
- **Decision buttons** (Approve, Deny on the approval card) are `rounded-xl` with `min-w-0` and
  `wrap-anywhere`, so `Approve github__create_pull_request_review_comment` takes a second line
  rather than leaving the card. It wraps rather than truncates because the sighted operator is
  deciding too. The tool badge and the grant sentence carry the same override.
- **Focus:** `focus-visible:ring-[3px]` at full-strength `--ring` plus a border shift. Never
  removed, never reduced in alpha. Toggles with a keyboard binding say so in their `title` and
  `aria-keyshortcuts`.
- **Touch:** controls that are dense at a desk (a turn's 28px actions, the thread row's 24px
  icons, a drawer's close, an attachment's remove) grow under `coarse:` to 40px. They are grown,
  not given an invisible hit slop. A control revealed on hover is revealed only where hover
  exists (`[@media(hover:hover)]`), never by width.

### Tabs and view switches

**Pills on the ground.** `@felix/ui/tabs` draws its list as a stone track (`bg-ground`,
`rounded-full`, 3px inset, 36px) and the active tab as a sheet-coloured pill with `shadow-sheet`,
semibold. The instrument's tabs (Changes, Plans, Tools) use it at 12px. `ViewSwitch` on
`/harness` pages is the same shape at 32px; it is a `role="group"` of `aria-pressed` buttons, not
tabs, because it switches the input above a list its modes share.

### Panels and sections

The repeated unit of the whole app. A header row of **icon · title · one at-a-glance value**,
then a body. The value in the header is load-bearing: it is what should make opening the panel
unnecessary most of the time.

The same component renders as a disclosure row, as a full page under `/harness`, and bare inside
an instrument tab (where the tab is the heading), chosen by context rather than a prop.

Under `/harness` every destination draws the same `PageHeader` (`components/harness/panel.tsx`):
the icon on a 32px stone tile (`rounded-xl`, the glyph 18px at `foreground/80`), the title the nav
uses at 20px, then the value **with its unit** (`0 memories`, `$1.41 · 2 threads · 1 with
failures`, `3 jobs`) beside the title, and controls pushed right, wrapping to a second row when
the pane is narrow. A page whose value would need a request of its own shows none; a list that
came back at its fetch cap reads `50+`. Every page's body **and** its header row are held to
`READING_MEASURE` (`max-w-3xl`) and centred; `<Panel fullBleed>` is the opt-out, and no page takes
it. Below the header a page is divided into `PageSection`s (an `h3` at 16px semibold, never a
bordered box) and label/value pairs are a `Facts` grid. An empty page is a stone panel
(`rounded-2xl bg-ground`) with one muted sentence. `/harness` looks at its own agent (`?agent=`),
and the **picker lives only in the headers of the pages it scopes** (Skills, Eval, Agent). The nav
is two runs under visible 12px labels, Records and Workbenches. The rail carries exactly three
glances, each only when non-zero: `Jobs · N failing` and `Activity · N failed` in `state-failed`,
and `Skills · N waiting` in `state-blocked`. Absence is the all-clear, so it is drawn only for a
read that answered: a failed read shows a muted `unchecked`, and a count kept from an earlier read
carries its age (`3 failed · 2m`). Every page header ends in a quiet `Docs ↗` link, checked
against the docs source by `tests/docs-links.test.ts`. Every page header row is `min-h-8`, so the
rule under it sits on one line from page to page. On `/harness` the header drops the
conversation's own controls; the ellipsis menu stays in the same slot (named **Theme**) and the
instrument toggle's slot is held empty, so the attention line does not move between addresses.
Two controls have one home on every page: a view switch and a create toggle (outline, the plus
turning to a cross when open) both sit in the header, and the form a create toggle opens is the
page's first section. A view that can be linked is in the address. Fields are the shared
`Input`/`Textarea` at 14px with a visible `Label`; help that must survive typing goes under the
field. A header value that mixes a window with a state draws the window neutral and only the
state in its chip. A routine `OK` status is a muted word and dot; colour is kept for what went
wrong. A page whose latest read failed after a good one keeps the good rows under one line saying
so, and its header value says how old it is. **Amber is only for a person being asked to act
now.** Names the harness gave in bulk are a mono list, not a pill each. An id that has to
distinguish rows is cut from the **middle**, not the end.

**The Activity page is a ledger, one entry per thread, drawn as white tiles on a stone tray.**
The list is an `ol` on `bg-ground` at `rounded-2xl` with 6px of padding and 6px between tiles;
each entry is a `rounded-xl` sheet-coloured tile with `shadow-sheet`, opening in place. Each entry
is the thread's title, its worst status as word and dot, its failures **in words** on a second
line in `state-failed` (counted, `local_write blocked by an approval ×7`), its turn and call
counts, and its cost in a right-aligned mono column at fixed cents (`< $0.01`), drawn only when a
thread on screen has a figure. Above the list, a muted when-line and one **Figure** sentence give
the window's account (`2 threads ran, 1 with failures. $1.41 spent.`). Opened, a thread shows its
turns in the order they happened, each headed by what was asked (`h3`) and by clock time; inside a
turn a run of three or more routine events folds to one line, and a run of the same failure folds
to one *red* line with its count. A status the table does not know is a muted word with **no
dot**. The list is one Tab stop that roves. *Where the spend went* sits below as a section: a 16px
heading, the total as a mono Figure, the unpriced warning, then the by-agent-and-model table on its
own stone tray with no rule per row.

The sidebar's workspace section has the sidebar's section header: a small muted **Workspace**
label, then the mount as its value: the folder's name in mono, or *in-tab*. Its actions (*Mount a
folder*, *Change folder* / *Disconnect*, *Reconnect <name>*) are an outline row beneath, never in
the value slot. The section folds from a chevron at the row's right edge and remembers that it
was folded. Under the header: the thread's repository on the harness, then **Files**.

### Changes tab

The instrument's first tab, and the one it opens on, because it is derived from the transcript and
costs no request. Its first line is its scope, *This thread · from its tool calls*. It lists each
workspace path a tool call named and what was done to it: rows, not cards. The path is mono with
the directory truncating before the filename, and the full path is the row's `title`. The stat is
mono, tabular, right-aligned, and claims only what the call proves: an edit is `+N −M`; a
whole-file write is `+N written` and never carries a minus; a read is its verb (`read`, `listed`,
`searched`, `opened`, `ran in`) with `×3` for a repeat. A failed or refused call reads
`failed`/`refused` in `state-failed`, a word and not only a colour. A call in flight reads
`writing…`/`editing…` in muted. Paths a write or edit was attempted on sort first, each newest
first. Such a row is a disclosure showing that call's evidence through the approval card's own
folding pane. While a durable run is in flight and has reported no call, the tab is one muted
line, *Changes appear when the run finishes.*; with nothing at all it says *No tool on this thread
has touched a workspace file yet.*

### Sidebar

On the ground, with no border: the sheet's edge is the divider. It has one order on both
addresses: **New chat** (the ink pill), then **Threads**, then the workspace section, then
**Harness**, with hairline separators between them.

Threads is a heading and a **pill search field** (36px, `sidebar-accent` face, `input` edge, 14px,
a 3px focus ring) that stay put above a list that scrolls inside itself. Workspace and Harness are
one region below it, at most 40% of the viewport, with one scroll of its own; the sidebar itself
never scrolls when expanded. Workspace's *Files* is a disclosure with its entry count, folded
until opened and remembered. The thread groups rank by state, then recency: *Waiting on you*
(`state-blocked`, dot and words), *Running* (`state-running`), *Pinned* (labelled *this browser*),
*Today*, *Yesterday*, *Previous 7 days*, and *Older*, which starts folded and, open, is cut by
month. Group labels are 12px medium muted on the ground, 28px tall, and stick to the top of the
list while their rows scroll under them. Empty groups are not drawn.

**Two label weights, one edge.** The sidebar's three *section* headings (Threads, Workspace,
Harness) are 12px semibold; every *subgroup* label inside them (the date groups, Older, Files,
Records, Workbenches) is 12px medium. All of them start on the rows' text edge, 18px in, and
both scrolling regions reserve their scrollbar's gutter, so the counts down the right edge
(Older's, Files') end on one line whether or not a region is scrolling.

Each row is a **tile** (`rounded-lg`, `px-2.5 py-1.5`): the thread's title over one 12px line
(*Waiting on you* or *Running* first when the row is not already under that group, then the agent
in mono, then how long ago, then *local only* for a thread the harness has never seen). A thread
with no title is listed by its id in muted mono, cut from the middle. **The current tile sits on
the sheet's colour** (`sidebar-accent`) with `shadow-sheet` and `aria-current`; a hovered,
focused or menu-open tile mixes 70% of that colour into the ground. The sidebar's own menu rows
(the harness destinations) follow the same grammar: 36px (44px on a coarse pointer), `rounded-lg`,
the active row lifted to `sidebar-accent` with `shadow-sheet` and semibold. A row's ⋯ menu lies
*over* the end of the row, revealed by that row's hover or focus on a gradient of the row's own
colour; on touch it stays in the row, visible. The menu is Pin, Rename and Fork; then Compact
context and Export JSONL; then any reason an item is unavailable; then Delete, in the destructive
colour. Deleting a thread with a run going or something waiting asks first, in the row (*Stop and
delete* / *Keep*); any other delete is immediate and undoable from a toast.

The list is one Tab stop. Arrows, Home and End move between rows, → reaches a row's menu and ←
returns, Shift+F10 or a right click opens it, Delete deletes. A search drops the groups; a row
whose messages matched shows the words around the match, the match in the foreground.

Collapsed to icons, the column is New chat, Threads, Workspace, then the eight destinations, each
a 36px rounded square. Threads expands the sidebar and puts the caret in the search field. It
carries one 6px dot for the most urgent state and says it as well. Jobs and Activity carry a
`state-failed` dot when their glance reports a failure, Skills a `state-blocked` dot while a draft
waits, each with the glance's own sentence for a reader.

### Run readout

The top of the instrument, above its tabs, under the 18px "This run" heading (no rule beneath it
now). It is a **stone tile** inset 8px from the instrument's sides (`rounded-2xl bg-ground`,
`px-3.5 py-3`), because the run's state is the instrument's headline. An 8px dot and the **state
word** as a Statement (18px semibold) in the ramp colour (*Waiting on you*, *Running*, *Rejoining
thread*, *Failed*, *Idle*), then a stopwatch (`for 3:07` live, `last run 42s` at rest) in tabular
mono, or `last activity 2d ago` on a thread this tab never ran. Beneath, a 12px definition list:
what it is asking, which tool is in flight and on what, tokens. The word is the live region; the
stopwatch is not.

### Transcript turns

- **User turn:** a **stone note**: `rounded-2xl` on `ground`, `px-4 py-3`, a "You" label at 12px
  semibold muted, then the message at 16px. Not a bubble: it is not inverted, not aligned to a
  side, not coloured, and there is no avatar. Its edit field is a `rounded-xl` field on the sheet.
- **Assistant turn:** a "Felix" label in 12px semibold foreground, then prose, reasoning and tool
  cards interleaved in the order they happened, then a mono usage line. No avatar, no surface.
- **Reasoning:** a collapsed row, never prose. While it streams, the 6px `state-running` dot
  pulses, *Thinking* sits in 12px medium `state-running`, then a stopwatch and a word count in
  tabular mono, with one muted 14px line of the **newest** reasoning beneath it on the reasoning's
  own left rule, cut from the front. Settled, the dot becomes a brain icon and the row states what
  was measured: `Thought for 16s · 180 words`, or `Reasoning · 180 words` when rebuilt from
  history.
- **Live words sweep.** A word that says something is still happening carries `shimmer`
  (*Thinking*, a tool card's `running` phase, a durable run's `running` status, *Waiting for the
  harness…*, the reattach notice's "still landing"). It sweeps toward the foreground
  (`shimmer-color-foreground`), so the word only brightens. It stops under
  `prefers-reduced-motion`. Nothing that has finished sweeps.
- **Durable status:** a durable run's stream carries no deltas, so until `final` the turn holds
  the engine's status line (*Durable run accepted…*, *Background · running…*, *Waiting on your
  approval · Write notes.txt*): the state dot, the line at 14px medium in the ramp colour, and
  `for 0:42` muted beside it. `running` pulses; `blocked` is amber and still; once the run has
  ended the dot drops to the idle grey. The line is the live region, the stopwatch is not.
- **Notes are markers, not cards.** A note about the run is a `Marker`: one muted line with a
  16px icon, and no box. This covers the reattach and left-the-page notices (with a hairline
  under them), the step-limit stop (in `state-blocked`), and *Reconnecting to the assistant*. A
  failure is still the failed-tinted box, because it is an error, not a note.
- **Attachments are cards in a row.** An attached image is a small vertical `Attachment`: the
  image, then its name beneath. A row scrolls sideways inside a fading edge. An upload the harness
  no longer holds is `error`: an image-off icon, the failure-tinted border, and *Image no longer
  stored*.
- **Tool output is highlighted where it is code.** JSON arguments and results are syntax-coloured
  (the code block's own palette, not the state ramp) with a copy control, capped at 16rem. A
  shell result's stdout and stderr each sit in a terminal panel on the code surface.
- **A plan is a card in the turn.** `rounded-xl` with a `border/60` hairline, no fill. Title and
  goal, `3 of 7 done` in mono as the header's value, then the steps: an icon in the state ramp
  beside the agent's own status word, never the colour alone.
- **An edited message says it has versions.** `‹ 2 of 3 ›` in 12px mono beside *You*.
- **A labelled turn is a restore point.** After it, a bookmark, the label and *Restore*, then a
  hairline to the edge.
- **The context meter opens a breakdown** on hover or focus. No price: the Activity page is where
  spend is read.
- **The workspace's files are a tree.** Mono 12px, folders before files, icons muted, never
  coloured. Folders holding a path this thread wrote start expanded and those files are in the
  foreground. One Tab stop per folder.
- **An agent's question is a one-item form.** `select` and `input` render as a `Questionnaire`:
  bordered choices or a field, then *Send answer* and *Decline to answer*. Choosing never sends.
- **The transcript scrolls by turn.** Each operator message is an anchor; sent, it lands near the
  top and the reply grows beneath it. The view follows the stream only while the reader is at the
  live edge. *Scroll to latest* fades in, round and outlined on `card` with `shadow-md`, centred
  over the column's foot.
- **Long tokens wrap; wide blocks scroll in place.** Nothing in a turn may widen the column.
  Plain text wraps with `wrap-anywhere`; assistant prose uses `wrap-break-word`, so a table or a
  code block keeps its natural width and scrolls inside its own box.
- **Empty thread:** a greeting, then the readout. Centred in the column at `max-w-3xl`: the
  Display headline "What do you want to work on?", a 16px muted sentence naming the agent (either
  replaced by the manifest's `felix.greeting`), then the agent's starter prompts as a two-column
  grid of `rounded-xl` outline cards (`border-border/60`, `bg-solid-card/40`, no shadow): title
  in 14px medium, the prompt beneath in 12px muted, clamped to two lines. They come from
  `felix.starters`, fall back to a built-in table, and are disabled while a run streams. Under the
  cards the readout is one 12px muted line (agent, folder, thread, harness), with unreachable in
  `state-failed`, with the word. **The composer rises to meet it** where there is room (`rise`: at
  least 768px wide and 928px tall): the greeting sits on the transcript's floor and the composer
  just beneath, and the first message settles the composer to the bottom over 200ms `ease-out`.
  Below the threshold it stays docked.

### Tool cards

**A soft white card, titled in our words over the raw call.** `rounded-xl` on `card` with a full
`border` hairline and `shadow-sheet`. Collapsed, the header leads with the call's **summary**
(its target, in Geist 14px medium, truncating), then the harness's name for the tool in 12px mono
muted, then a shell call's duration in mono, then the state badge; a call with no summary leads
with its mono name. There is no wrench: an icon on every card marks a row, not a kind. The state
badge is honest about outcome: a shell tool shows its exit status, and a result the harness
marked as an error or refusal is drawn in `state-failed`, never under a green `done`. **A failed
or refused call is cancelled, not hidden**: the border turns dashed at `state-failed/40` and the
summary is struck through (the Cancelled-Not-Gone Rule), with the harness's message beneath in
12px `state-failed`. Expanded, input and output sit on `bg-background` panes (the Nesting Rule)
under a `border/60` rule.

### Cards

Cards are for **objects**: a call, a plan, a decision, a question, a starter, a thread in the
ledger. A panel's readouts are still rows. A list of objects on a page is white tiles on a stone
tray, not bordered cards stacked down the pane. Outside the app, the access gate's form is a flat
bordered card.

### Approval card

The one place a gated call is decided, reused verbatim by the transcript banner and the attention
line's queue. **It is the largest and loudest object on the sheet**: `rounded-2xl`, a 2px
`state-blocked/50` border, a flat `state-blocked` 5% tint (`bg-solid-*`), 20px padding and
`shadow-approval`. Top to bottom: the tool name as a mono 14px semibold badge, the manifest, the
queue count and the **deadline chip**; the reason (14px muted); the **summary as a Statement**
(18px semibold), the sentence being answered; the evidence (before/after for a write, arguments
otherwise, editable); the grant sentence at 14px (`foreground/85`) directly above the buttons,
because it is what Approve actually does; then Approve / Deny / Edit arguments, Approve and Deny
identical in weight and `rounded-xl`. Evidence precedes the decision. The transcript banner that
wraps it focuses with a 2px ring offset from the sheet at the same 22px radius.

### State chips, dots and the deadline chip

A state is never colour alone. Every dot carries adjacent text, and every chip carries its label;
the ramp is the fast channel, not the only one. Chips are pills, 12px medium, the ramp colour as
text on its own tint (`/10` for the header and attention chips, `/15` for the deadline chip).

The **deadline chip** is the ramp's clearest instance. Live, it reads *Auto-denies in* with the
countdown in tabular mono, amber on amber `/15`. Lapsed, it reads *Denied · timed out* in
`state-failed` on its `/15` tint, and the buttons disable. It is a `timer`, not a live region; a
separate status line announces the last minute and the lapse once each.

### Inputs

Fields are `rounded-md` with an `--input` edge and the 3px focus ring. On a coarse pointer every
text field is 16px, from one unlayered rule in `index.css`, because iOS zooms the page when a
smaller field takes focus. The composer is the signature case: an opaque `card` surface,
`rounded-2xl`, with an `--input` edge and the **lift**, an anchored send control, banners docked
directly above it, a slash menu that opens upward (`rounded-2xl`, focused lift), and a hint line
beneath it at 12px that names the keys worth learning as small bordered `kbd` keys.

**The composer row rests at five:** an *Add to message* menu (attach images, voice input), the
agent, Thinking, then Run in background and Send, and only Send is primary. The agent and Thinking
pickers are pills (`h-8`, muted wash, value in 12px mono). The mic leaves the menu while it
records (red `recording`, a pulsing halo, one click to stop).

**The agent picker lists manifests in the harness's order**, each name over the provider model it
runs on in 12px mono, shown only when it differs from the name. The trigger shows the name alone,
and its accessible name carries the value (`Agent: cowork`). `felix.contextWindow` is kept by the
client but not drawn, because for most manifests it is the catalog's fallback.

**The Thinking picker sits beside it**, in the same pill: a brain icon, *Thinking:* from `sm` up,
then the level in mono. It stays enabled during a run. Its list opens under *Token budget, from
the next turn*, and each level carries the budget the harness sends for it, in mono.

**The composer's focus indicator is its border.** It removes its textarea's ring and signals focus
with a full-alpha `--ring` border plus the focused lift. The border owes 3:1: computed from the
tokens, `--ring` on the composer's `card` face is 4.30:1 light and 4.22:1 dark, and against the
resting `--input` edge it replaces it is 3.00:1 light, exactly at the threshold.

## Do's and Don'ts

### Do:

- **Do** spend colour on run state and nothing else: the four-hue ramp, `destructive` for a
  destructive action, `recording` for the microphone. Warmth lives in the neutrals.
- **Do** put the shell and the sidebar on the stone ground and everything read on the sheet.
- **Do** give every panel header one at-a-glance value.
- **Do** set monospace for anything the harness emitted and Geist for anything we wrote.
- **Do** set what is read at 16px and what is scanned at 12/14px, and give 18/20/24px only to
  Statement, Page Title and Figure.
- **Do** separate with tone first: a stone tray under white tiles, a stone note in white space.
- **Do** keep a failed or refused call on screen, dashed and struck through.
- **Do** carry `flexShrink: 0` on anything below a scrolling region.
- **Do** measure contrast in each theme in its natural state, on both neutral levels.
- **Do** state the resting case. A signal that appears only in trouble teaches the operator not
  to look at it.

### Don't:

- **Don't** add a brand accent colour. "You can act here" is warm ink, never a fifth hue. The
  mark's cursor is ink at rest and a state's hue only when there is a state.
- **Don't** let the neutrals' chroma rise above 0.01 or move the ground toward cream.
- **Don't** hand-edit a rendered mark. Change `packages/design/src/mark.ts` and run
  `pnpm sync:brand`.
- **Don't** stack bordered cards down a panel. Objects go on a tray as tiles; readouts are rows.
- **Don't** put an icon on every row. Icons mark kinds, not rows.
- **Don't** draw a user turn as an inverted or side-aligned bubble, or give either speaker an
  avatar.
- **Don't** introduce a fifth shadow, and don't read the vendored primitives' shadcn defaults as
  licence for one.
- **Don't** put anything on the sheet that out-ranks a waiting approval.
- **Don't** pill a button whose label may wrap to two lines; use `rounded-xl`.
- **Don't** encode a status in colour alone, and don't use amber and red interchangeably.
- **Don't** edit the frozen hex in `packages/design/src/tokens.ts` to resolve a palette mismatch.
- **Don't** drop below 12px to gain density.
- **Don't** add motion that competes with streaming text, and honour `prefers-reduced-motion`. A
  "still working" pulse or spinner slows under reduced motion rather than stopping.
