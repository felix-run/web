---
name: preflight
description: Run the felix-web verification loop before opening a PR or claiming a change works — type-check, lint, and build across the workspace, plus a reminder of what these checks do and do not cover. Use when asked to verify, check, validate, or make sure a change is sound, and before every commit or PR.
license: MIT
compatibility: Requires pnpm 10.x and Node >= 20 in a felix-web checkout
allowed-tools: Bash(pnpm check-types) Bash(pnpm lint) Bash(pnpm build) Bash(pnpm check-tailwind-sources) Bash(pnpm --filter *) Bash(git status:*) Bash(git diff:*)
metadata:
  repo: felix-web
---

# Preflight

## Current state

Branch: !`git rev-parse --abbrev-ref HEAD`
Changed files:
!`git status --short`

## What "verified" means here

**Test coverage is partial.** `pnpm test` covers the VFS, the disk mount, the SSE reader, the proxy
Worker, the run loop in `@felix/client` (frames in, transcript out), and the terminal client's config
and workspace containment — the SSE reader and Worker through parameterized suites in
`@felix/test-kit`. CI runs lint, check-types, test, build, and the hook batteries in
`.claude/hooks/tests/`.

So a green `pnpm test` says the wire-level plumbing, path containment, and a first slice of the React
tree (thread store, theme provider, `usePoll`, Gate, and `App` end to end) are sound. It says nothing
about **the surfaces that need a terminal or a viewport**: the composer, the inspector panels, and
every Ink component in `apps/tui` still have to be exercised by hand against a running harness. Report exactly which commands you ran and what they returned, and never let "tests
pass" imply coverage that does not exist.

## The loop

Run these from the repo root, in order. Stop at the first failure, fix, restart.

```bash
pnpm check-types    # turbo → tsc --noEmit per package
pnpm lint           # turbo → biome check
pnpm test           # turbo → vitest
pnpm build          # turbo → tsc -b && vite build; astro build
```

Add `pnpm check-tailwind-sources` when the change touches a stylesheet, a shared package that ships
classes, or a dependency that renders markup — none of the four above notice a class Tailwind never
scanned.

Scope to one package when the change is contained — it is much faster:

```bash
pnpm --filter @felix/chat-ui check-types
pnpm --filter @felix/docs build
```

`pnpm format` (`biome format --write .`) fixes formatting; `biome check` reports lint. Formatting is
also applied automatically to files you edit, by the `format-touched` PostToolUse hook.

## Coverage gaps to state out loud

These checks pass on code that is still broken. If your change is in one of these areas, say in your
report that it is unverified, or exercise it manually:

- **Runtime behavior of anything touching `/api/*`.** Needs the Python harness on `:8080`
  (`make up && make migrate` in felix-run/felix), then `pnpm chat:dev`.
- **A new SSE event with no `switch` case.** `StreamEvent` has an open catch-all arm, so this
  type-checks and does nothing. Verify by triggering the frame.
- **Dev/prod proxy divergence.** Nothing mechanically checks that `apps/chat-ui/worker/index.ts`
  and the `/api` rewrite in `apps/chat-ui/vite.config.ts` still describe the same contract. Read
  both when you touch either.
- **The unattended path.** A background run carries no SSE frames, so a blocking state reaches the
  operator only through the `/approvals` poll and `src/lib/presence.ts`. Streaming green says
  nothing about it.
- **The Workers themselves.** `vite build` does not exercise `worker/index.ts`. Use `wrangler dev`
  in the app directory.
- **Docs prose.** `astro build` catches broken links and bad frontmatter, not wrong claims.
- **Whether a class produced any CSS.** Tailwind generates a rule only for a class it scanned, so a
  utility from an unscanned tree leaves the element styled with nothing — a silent, partial failure
  that lint, types, and build all pass. `pnpm check-tailwind-sources` covers the trees named in its
  `GUARDED` table; anything else means looking at the page.

## Report

Finish with: each command and its result, what you verified by hand, and an explicit list of what
remains unverified. If a check failed and you could not fix it, paste the real output — never
summarize a failure as a success.
