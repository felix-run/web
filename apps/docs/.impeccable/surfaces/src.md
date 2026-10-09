---
version: 1
slug: "src"
primary_target: "src"
related_targets: ["src/content","src/components","src/styles","src/pages/reference.astro","src/content/index.mdx"]
---

# Surface: Felix docs (apps/docs)

## Mode

**Read.** The visitor's success is understanding. A docs index is still Read, not Persuade: the
home page is a front door, not a landing page.

## Readers

- **The self-hosting operator, returning.** Knows the system, has lost the detail: looking up a
  route, an event, a manifest field, an error reason. Arrives by search or the Route index.
- **The cold evaluator.** PRODUCT.md hands demo viewers to "the docs site and a screenshot". Needs
  to see what a run looks like and where to start, in one screen, without cloning anything.

## Strategy

- **Two ways in to reference:** the sidebar for "what is this" (Start / Reference / Internals), the
  Route index for "where is this route". Every route in the release spec is listed there and linked
  to the guide section that explains it; the OpenAPI explorer is for request schemas and trying a
  call, not for response shapes (every harness route returns a bare dict).
- **Show the mechanism.** RunTrace on the home page draws one approval-gated turn as real frames,
  and the top of Concepts shows the same pause as chat-ui draws it — a real capture from a local
  harness, cropped to read at 1:1, captioned with where it came from.
  Expected output in Getting Started is taken from harness source and says which file.
- **Every page ends on a next step.** Home ends on Where next and Getting Started on Where to
  next; every other page ends on Starlight's previous/next, which follows the sidebar. A dead
  address lands on a 404 with the ways back in, not on a decorated splash.
- **Truth over tidiness.** Event names, routes and error reasons exactly as the harness sends them.
  A claim about harness behaviour that has not been read from source or measured is not written.

## Constraints

- Prose lives in `src/content/` (not `src/content/docs/`); new pages need a sidebar entry in
  `astro.config.mjs`. `markdown.processedDirs` must keep covering `src/content/` or asides and
  heading anchors silently stop rendering.
- `src/styles/theme.css` is generated from `@felix/design`; hand edits are hook-blocked.
- chat-ui links into these pages by heading; `apps/chat-ui/tests/docs-links.test.ts` fails on a
  renamed heading.
- `/reference/` must keep reading `starlight-theme` before paint and keep its way back.

## Open

- **Code highlighting.** Night Owl's cyans and violets are the only saturated colour outside the
  state ramp (see DESIGN.md → Colors). Replacing the code theme is a decision, not yet made.
- **The screenshot is under 2x.** Recaptured 2026-10-08 against harness v0.11.2 after chat-ui
  dropped its dotted transcript texture: the card crop is ~1.8x (1400px for ~790 CSS px) and the
  full window is 1492px for a 1728px viewport. The browser tool caps its resolution, and macOS
  `screencapture` could not reach the automation window, so a true 2x capture is still open.
