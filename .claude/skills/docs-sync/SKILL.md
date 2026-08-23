---
name: docs-sync
description: Keep the Starlight docs site in apps/docs true to the code after a change lands. Use when a feature ships, when docs look stale, when adding a new docs page, or for a periodic documentation audit — covers the non-standard content directory, the manual sidebar, the generated theme CSS, and what belongs here versus in the Python harness repo.
license: MIT
metadata:
  repo: felix-web
---

# Syncing the docs site

Docs live in `apps/docs` (Starlight on Astro), deployed as a static-assets Worker to
`docs.felix.run`.

## Three layout facts that bite people

1. **Prose is at `src/content/`, not `src/content/docs/`.** Starlight's `docsLoader()` hardcodes
   `src/content/docs/`; `src/content.config.ts` overrides it with a `glob` loader to avoid the
   redundant nesting. Do not "fix" this by moving files.
2. **The sidebar is manual.** `astro.config.mjs` lists every page explicitly, because autogenerate
   expects the default directory. **A new MDX file is invisible until you add it to `sidebar`.**
3. **`src/styles/theme.css` is generated.** It is checked in, but derived from `@felix/design`
   (`packages/design/src/tokens.ts` → `starlightThemeCss()`). Change the tokens and run
   `pnpm sync:theme`; never hand-edit the CSS, or the next regeneration silently reverts you.
   A PreToolUse hook blocks the hand edit.

## What is documented here versus elsewhere

`apps/docs` documents **Felix the system** — the harness's concepts, manifests, REST/management
API, deploy, and internals. The harness itself is a separate repo
([felix-run/felix](https://github.com/felix-run/felix), Python).

- Guide pages (`content/guide/`) are for operators and integrators, and must stay **Python-accurate**:
  Compose/Helm, the `felix` CLI, `:8080`. Never describe the old TypeScript Workers runtime,
  `apps/api`, Durable Objects, or commerce plugins as current truth.
- Internals pages (`content/internals/`) describe mechanism. Where a page still reflects the former
  Workers prototype, mark it with a Starlight `Aside` rather than rewriting wholesale.
- The live API reference is a Scalar UI served by a running harness (`/docs` over `/openapi.json`),
  linked from the sidebar — not generated in this repo.

## Procedure

1. **Scope.** Use the files named in the request; otherwise `git diff --name-only main...HEAD`;
   otherwise sweep `src/content/` for stale claims.
2. **Map change → page.** Common mappings:

   | Changed | Docs to check |
   |---|---|
   | `apps/*/worker/index.ts`, wrangler config | `guide/deploy.mdx` |
   | `src/api.ts`, `src/types.ts` (protocol) | `guide/rest-api.mdx`, `internals/architecture.mdx` |
   | Auth, the `x-chat-key` gate | `internals/auth.mdx`, `guide/deploy.mdx` |
   | Manifest fields | `guide/manifest-reference.mdx`, `internals/manifest-pipeline.mdx` |
   | Audit/metrics surfaces | `internals/observability.mdx` |
   | `packages/design/src/tokens.ts` | `pnpm sync:theme` to regenerate `src/styles/theme.css` |
   | Repo architecture | `CLAUDE.md` (not a docs page, but keep it true) |

3. **Write in the existing voice**: dense, factual, present tense, identifiers in backticks, no
   marketing prose. Prefer a surgical edit to a rewrite.
4. **Register new pages** in `astro.config.mjs` → `sidebar`, under Guide or Internals.
5. **Build**: `pnpm --filter @felix/docs build`. This catches broken internal links, bad frontmatter,
   and unregistered collection entries. It does not catch wrong claims — you do.

## Report

List each drift as `source surface → doc page`, was-stale / now-fixed; the files edited; the build
result; and anything you deliberately left alone, flagged for a human.
