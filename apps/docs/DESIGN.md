---
name: Felix docs
description: The operator's manual for a self-hosted agent harness — the same instrument as chat-ui, read rather than operated.
colors:
  page: "#0a0a0a"
  page-light: "#ffffff"
  panel: "#171717"
  panel-light: "#fafafa"
  hairline: "#262626"
  hairline-light: "#e5e5e5"
  ink: "#ffffff"
  ink-light: "#0a0a0a"
  body-text: "#d4d4d4"
  body-text-light: "#404040"
  faint-text: "#a3a3a3"
  faint-text-light: "#737373"
  inline-code-surface: "#262626"
  inline-code-surface-light: "#f5f5f5"
  state-running: "#74d4ff"
  state-running-light: "#00598a"
  state-done: "#5ee9b5"
  state-done-light: "#006045"
  state-blocked: "#ffd230"
  state-blocked-light: "#973c00"
  state-failed: "#ff807f"
  state-failed-light: "#a20002"
typography:
  display:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "clamp(1.8125rem, calc(0.5rem + 3.5vw), 2.625rem)"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "2.625rem"
    fontWeight: 600
    lineHeight: 1.2
  title:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "2.1875rem"
    fontWeight: 600
    lineHeight: 1.2
  body:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.75
  label:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.5
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
  wordmark:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 650
    letterSpacing: "0.07em"
  explorer-method:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 600
rounded:
  control: "8px"
  callout: "8px"
  row: "6px"
  pill: "999px"
spacing:
  measure: "40rem"
  column: "58rem"
  hero-column: "72rem"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.page}"
    rounded: "{rounded.control}"
    typography: "{typography.label}"
  button-secondary:
    backgroundColor: "{colors.page}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    typography: "{typography.label}"
  button-minimal:
    textColor: "{colors.ink}"
    typography: "{typography.label}"
  sidebar-current:
    backgroundColor: "{colors.hairline}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
  callout-note:
    textColor: "{colors.ink}"
    rounded: "{rounded.callout}"
  callout-caution:
    textColor: "{colors.state-blocked}"
    rounded: "{rounded.callout}"
  inline-code:
    backgroundColor: "{colors.inline-code-surface}"
    textColor: "{colors.body-text}"
    typography: "{typography.code}"
---

# Design System: Felix docs

This file describes `apps/docs` — the Starlight site at docs.felix.run and the Scalar page at
`/reference/`. chat-ui's system is the root `DESIGN.md`; the two share one palette and one state
ramp, both from `@felix/design`, and this file records only what the docs do with them. It is
**derived from the shipped code** (`src/styles/brand.css`, `src/components/`, the generated
`src/styles/theme.css`), including the places where the code and the intent disagree. When the
two drift, fix whichever is wrong and say which in the commit; do not tighten the prose to match a
wish.

## Overview

**Creative North Star: "The Operator's Manual"**

The manual that ships with the instrument. chat-ui is the Workbench, where an operator watches a
run and decides what it may do; the docs are the same machine written down, for the moments that
operator is not at the bench — setting it up, looking up a route, learning why a run behaved the
way it did. The palette is the Workbench's, hue still means state and nothing else, and the page
shows the mechanism rather than a friendlier account of it: real event names, real routes, real
error reasons.

It is a reading surface, so the rules are the ones reading needs. Prose is held to a measure;
tables, code and figures take the full column because they are data, not prose. Reference is
reached two ways — the sidebar for "what is this", the Route index for "where is this route" —
and a page ends on a next step: the home page and Getting Started on an explicit list, every
other page on Starlight's previous/next pair, which follows the sidebar's order.

Most of the chrome is Starlight's, recoloured from `@felix/design` rather than redrawn. What is
Felix's own is small and deliberate: the wordmark, the reading measure, the callouts on the state
ramp, the stream-events list, RunTrace and the Route index. The page ground is flat: the dot grid
that once sat behind the top of the reading column was removed (2026-10-08).

**Key Characteristics:**

- A pure neutral field (Tailwind `neutral`) in both themes; dark is the default.
- Hue only from the four-state ramp, only where there is something to do or know.
- Prose at 40rem inside a 58rem column; tables, code and figures use the column.
- The mechanism drawn as data: RunTrace on the home page, events as a stacked list.
- Flat surfaces separated by hairlines; no shadow authored anywhere in the docs' own CSS.

## Colors

A neutral grey scale carries every surface and all text; four state hues are the only colour, and
they appear on callouts, RunTrace and the explorer's method labels — never as decoration.

**Where the system and the code disagree.** Code blocks are highlighted by Expressive Code's
default themes — Night Owl in dark mode — and its cyans and violets are the only saturated colour
on the site outside the state ramp. Left as it is on purpose for now: a code theme that reads well
is its own job, and replacing it is a decision rather than a fix. It is the open colour question.

The neutral hexes are canonical in `packages/design/src/tokens.ts` and reach the site through the
generated `src/styles/theme.css` (`pnpm sync:theme`; hand edits are hook-blocked). The state hexes
are the same file's `STATE_DARK`/`STATE_LIGHT`, which are themselves derived from chat-ui's oklch
values and held to them by `pnpm check-state-palette`. Starlight's semantic grey slots are filled
from these, so `--sl-color-white` means "highest-contrast text" in both themes, not white.

### Neutral

- **Page** (`#0a0a0a` / `#ffffff`): the page ground, `--sl-color-black`.
- **Panel** (`#171717` / `#fafafa`): the sidebar, one tonal step off the page. The header is on
  the page colour (`--sl-color-bg-nav`), separated by its hairline alone.
- **Hairline** (`#262626` / `#e5e5e5`): every rule, table border and row separator — and the
  sidebar's current-page fill.
- **Ink** (`#ffffff` / `#0a0a0a`): headings, links, the current page, button fills,
  `--sl-color-white`.
- **Body text** (`#d4d4d4` / `#404040`): prose. 13.36:1 and 10.37:1 measured on the page.
- **Faint text** (`#a3a3a3` / `#737373`): the table of contents, captions, the verb column in the
  Route index. 7.85:1 dark, **4.74:1 light** — the site's floor, passing AA at 13px with little
  room. Nothing smaller or fainter should be introduced.
- **Inline code surface** (`#262626` / `#f5f5f5`).

### State (the only hue)

- **Running** (`#74d4ff` / `#00598a`): RunTrace's in-flight rows; `GET` in the explorer.
- **Done** (`#5ee9b5` / `#006045`): tip callouts; RunTrace's finished rows; `POST` in the
  explorer.
- **Blocked** (`#ffd230` / `#973c00`): caution callouts; RunTrace's "Waiting on you" row; `PUT`
  and `PATCH` in the explorer.
- **Failed** (`#ff807f` / `#a20002`): danger callouts; `DELETE` in the explorer.

### Named Rules

**The State-Only Hue Rule.** Hue appears only from the ramp, and only where the reader has
something to do or know. A note is information, not a state, so notes are neutral; they used to
draw in "running", the live colour, on text that was neither.

**The Flat-Mix Rule.** A tint is mixed into the page colour (`color-mix(in srgb, hue 6%,
--sl-color-black)`), never laid on as an alpha, so a callout is one flat colour whatever sits
behind it.

The explorer's method colours are a mapping by hue family, not meaning: a `POST` is not "done".
It exists because Scalar's light defaults put `GET` at 3.78:1; on the ramp it measures 7.20:1.

## Typography

**Body and display:** the system sans stack (Starlight's `--sl-font-system`).
**Code:** the system mono stack (`--sl-font-system-mono`).

**Character:** no webfont, on purpose — the docs read in the operator's own system face, the same
face chat-ui and a terminal use, and load nothing to do it. Scalar's Inter is replaced with the
same stacks.

### Hierarchy

- **Display** (600, `clamp(29px, 0.5rem + 3.5vw, 42px)`, 1.1, −0.02em, max 16ch, balanced): the
  home hero title only.
- **Headline** (600, 42px wide / 35px narrow, 1.2): a page's `h1` — Starlight's scale.
- **Title** (600, 35px / 29px, 1.2): `h2`. `h3` and `h4` step down Starlight's scale.
- **Body** (400, 16px, 1.75): prose, held to **40rem (~76 characters)**.
- **Label** (600, 14px): buttons, the header's Route index link (full ink, like the icon beside
  it), the sidebar's current page.
- **Code** (13px inline, measured; code blocks at Expressive Code's own size; 13px on the events
  list's `data` line).
- **Wordmark** (650, 0.07em tracking, uppercase in CSS; Starlight's `--sl-text-h4`, 20px, and
  1.25rem in the explorer's header): the site title. The string stays
  "Felix", so the accessible name, the tab and search snippets keep the proper noun.

### Named Rules

**The Route-Heading Rule.** A heading that is a route (`` ## `POST /chat` ``) is set in the code
face without the inline-code chip; at heading size the chip was a slab heavier than every prose
heading beside it.

Unlike chat-ui, the docs have a display tier — chat-ui's "nothing above 16px" is an instrument's
rule and does not apply to a manual.

## Layout

Starlight's three columns — sidebar, content, table of contents — with the content column at
**58rem** (`--sl-content-width`; Starlight's default is 45rem) and every prose element inside it
held to **40rem** (`--felix-measure`): paragraphs, lists, headings, blockquotes, callouts,
`<details>`, and the prose inside `<Steps>`. Tables, code blocks, the events list and figures take
the whole column. The home page has no sidebar or TOC and widens to **72rem**
(`:root[data-has-hero]`), centred.

Breakpoints are Starlight's (50rem, where the header's links appear; 72rem, where the sidebar and
table of contents sit beside the content) plus three of the docs' own, each chosen by content: the
home hero goes two-column at **64rem**; RunTrace stacks below a **32rem container** (a container query, so
it behaves the same in the hero and full width); the Route index stacks at **50rem**.

### Named Rules

**The Two-Measure Rule.** Prose reads at 40rem; data takes the column. Never widen prose to fit a
table, and never let a table's widest cell decide how prose wraps.

**The Whole-Token Rule.** Code is never broken mid-token. A table that cannot fit stacks on a
phone — each row a block, each cell under its column name (`public/enhance.js` marks tables of
three or more columns; `brand.css` stacks them below 50rem) — and the events list is stacked at
every width. A route or field in a heading wraps between its segments: the same script adds a
break opportunity after each `/` and `.`, and such headings step down to 0.8em below 50rem.
Route index paths break the same way, server-side. An earlier rule broke table code anywhere and
shredded JSON mid-key; before that, headings split `{thread_id}` into `{thread_i` / `d}`.

## Elevation & Depth

**Flat.** The docs' own CSS authors no shadow. Depth is a tonal step (panel against page, the
inline-code surface) and separation is a hairline.

**Where the system and the code disagree.** Starlight defines shadow tokens (`--sl-shadow-sm/md/lg`)
and its own components draw `box-shadow` — search, the mobile menu toggle and table of contents,
the skip link, pagination, the banner. Scalar's request panels draw their own too. Treat these
as incumbent, not as licence: a new docs component takes a tonal step.

## Shapes

- **8px** (`0.5rem`): buttons (`.sl-link-button`, chat-ui's `rounded-md`, replacing Starlight's
  pill) and callouts.
- **6px** (`0.375rem`): the blocked row in RunTrace.
- **Full**: state dots in RunTrace.

Borders are 1px hairlines, all the way round when a thing is bounded (callouts) and top-only when
things are listed (Route index rows, events, Where next). No coloured border is thicker than 1px:
callouts once carried a 2px coloured left rule, which is the category default this system rejects.

## Components

### Buttons

Starlight's `LinkButton`, three variants, 8px corners. **Primary** is an ink fill with page-colour
text (the one action a page most wants — "Run it locally"); **secondary** is an ink outline;
**minimal** is a text link with no chrome. Focus is the site-wide ring below.

### Callouts (asides)

A hairline border all the way round at 40% of the hue, a 6% tint, the title and icon in the hue,
body text in the ordinary body colour. Note is neutral (ink); tip is done; caution is blocked;
danger is failed. **Caution is for things that can hurt a deployment** — a note about what an
older harness did is a note. Titles that wrap take 1.35 leading.

### RunTrace (`src/components/RunTrace.astro`)

The docs' signature: one approval-gated turn over `POST /chat/stream`, drawn as the frames the
harness sends, abridged. An ordered list on a 1px rail; each row a state dot, the event in mono,
and a sentence. The blocked row carries a flat tint and says **"Waiting on you"** in words; the
decision row is a hollow dot marked **"Your request"**, because it is not a frame. Every event
name is copied from the REST API Events list and must be renamed there and here together.

### Events list (`.event-list`, in `guide/rest-api.mdx`)

The stream's events as a `<dl>`: the event in bold mono, what it means, then the `data` shape on a
line of its own that scrolls if it must. Nothing sits beside the JSON, so nothing clips.

### Route index (`src/components/RouteIndex.astro`)

Every route in the release spec, grouped by its tags in the spec's own order (the explorer's),
one hairline row each: verb and path in mono, what the route is for, and where it is explained —
the guide section (read from the guides' route headings and table rows) or its explorer entry.
"What it is for" is the guide's `Purpose` column where one exists, then the first sentence of the
harness docstring, then the spec's generated title with its acronyms fixed. Every row has an
anchor (`#get-chat-stream-thread_id`) so one route can be linked. A filter box narrows the rows as
you type; a jump list of tags replaces the table of contents, which cannot see headings a
component renders. Group headings are 18px — they label a list, not a page section.

Verbs stay neutral here although the explorer colours them: that colour is Scalar's convention,
mapped onto the ramp only so it passes contrast, and the State-Only Hue Rule gives hue no job in a
list of routes.

### Product screenshot (`.product-shot`, top of Concepts)

A real capture of chat-ui, never a mock: a `<figure>` through Astro's `Image` (passthrough
service: shipped as authored, with its dimensions set), a 1px hairline frame at 8px so a dark capture keeps an edge on the dark page, the
image shown at its own pixel size and never enlarged — a full window scaled to the column was
~6px UI text, so the figure is a crop that reads at 1:1, linking the full capture — and a faint
caption held to 30rem that says what the image shows and where it came from. Code in a caption
takes the body colour (the faint colour on the code surface is 4.3:1). Alt text describes the
state on screen, not the file.

### Sidebar current page

A tonal step (hairline fill), ink text, 600 weight. Starlight's inverted white pill made "where
you are" the loudest object on the page.

### Where next (`.where-next`, home)

The sidebar's three groups, abridged — every Start and Reference page including the explorer, and
four of the internals — as plain lists under small faint labels, hairline-separated. It is also
the home page's only navigation on a phone, where the splash layout has no menu. The 404 page
(`src/content/404.mdx`) uses the same component for its ways back in, and has no hero, so the
home page's RunTrace cannot appear there.

### The explorer header (`src/pages/reference.astro`)

A 3.5rem bar above Scalar — the wordmark, Start, Route index, and a note that response bodies are
documented in the guides — reserved through `--scalar-custom-header-height`. The theme is resolved
from Starlight's `starlight-theme` before first paint, and Scalar's own toggle is hidden.

### Browser surfaces

Focus is a **2px outline in ink, offset 2px**, on every interactive element; selection is ink at
22% mixed into the page; content-link underlines sit **0.2em** clear of descenders; table numbers
are tabular.

## Do's and Don'ts

### Do:

- **Do** hold prose to `--felix-measure` (40rem) and let tables, code and figures take the column.
- **Do** take hue only from the state ramp, and only where there is something to do or know.
- **Do** mix tints into the page colour (`color-mix(…, --sl-color-black)`), never alpha them.
- **Do** separate with 1px hairlines and tonal steps.
- **Do** show real names: event types, routes and error reasons exactly as the harness sends them,
  with the source they were read from.
- **Do** end a page on where to go next.

### Don't:

- **Don't** break code mid-token to make a table fit; scroll it or restack it.
- **Don't** draw a coloured border thicker than 1px, or a callout with a thick left rule.
- **Don't** use caution for a version note, or hue for a plain note.
- **Don't** hand-edit `src/styles/theme.css`; change `packages/design/src/tokens.ts` and run
  `pnpm sync:theme`.
- **Don't** introduce text fainter than faint-text (4.74:1 light) or smaller than 13px. The one
  exception is Scalar's method badges in the explorer sidebar, raised from 10px to **11px**, chat-ui's
  own floor for text — its element, sized for its box, so only its size is overridden.
- **Don't** author a shadow; Starlight's and Scalar's are incumbent, not a pattern.
