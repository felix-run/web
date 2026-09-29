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
- **Show the mechanism.** RunTrace on the home page draws one approval-gated turn as real frames.
  Expected output in Getting Started is taken from harness source and says which file.
- **Every page ends on a next step.** Home ends on Where next; guides end on Where to next.
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

- A real chat-ui screenshot of a run waiting on an approval does not exist yet.
- The architecture page's ASCII topology has an ambiguous `│` under `felix-scheduler`; redraw it
  once someone confirms which processes use which stores.
