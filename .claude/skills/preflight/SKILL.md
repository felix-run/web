---
name: preflight
description: Run the felix-web verification loop before opening a PR or claiming a change works — type-check, lint, and build across the workspace, plus a reminder of what these checks do and do not cover. Use when asked to verify, check, validate, or make sure a change is sound, and before every commit or PR.
license: MIT
compatibility: Requires pnpm 10.x and Node >= 20 in a felix-web checkout
allowed-tools: Bash(pnpm check-types) Bash(pnpm lint) Bash(pnpm build) Bash(pnpm --filter *) Bash(git status:*) Bash(git diff:*)
metadata:
  repo: felix-web
---

# Preflight

## Current state

Branch: !`git rev-parse --abbrev-ref HEAD`
Changed files:
!`git status --short`

## What "verified" means here

**Test coverage is partial.** `pnpm test` covers the VFS, the SSE reader, and the proxy Worker —
the last two through shared suites in `@felix/test-kit` that run against both chat-ui and float. CI
runs lint, check-types, test, build, and the hook batteries in `.claude/hooks/tests/`.

So a green `pnpm test` says the wire-level plumbing, path containment, and a first slice of the React
tree (thread store, theme provider, `usePoll`, Gate) are sound. It says nothing about **the chat
surface**: `App.tsx`, the composer, and the inspector panels still have to be exercised by hand
against a running harness. Report exactly which commands you ran and what they returned, and never let "tests
pass" imply coverage that does not exist.

## The loop

Run these from the repo root, in order. Stop at the first failure, fix, restart.

```bash
pnpm check-types    # turbo → tsc --noEmit per package
pnpm lint           # turbo → biome check
pnpm test           # turbo → vitest
pnpm build          # turbo → tsc -b && vite build; astro build
```

Scope to one package when the change is contained — it is much faster:

```bash
pnpm --filter @felix/chat-ui check-types
pnpm --filter @felix/float lint
pnpm --filter @felix/docs build
```

`pnpm format` (`biome format --write .`) fixes formatting; `biome check` reports lint. Formatting is
also applied automatically to files you edit, by the `format-touched` PostToolUse hook.

## Coverage gaps to state out loud

These checks pass on code that is still broken. If your change is in one of these areas, say in your
report that it is unverified, or exercise it manually:

- **Runtime behavior of anything touching `/api/*`.** Needs the Python harness on `:8080`
  (`make up && make migrate` in felix-run/felix), then `pnpm chat:dev` / `pnpm float:dev`.
- **A new SSE event with no `switch` case.** `StreamEvent` has an open catch-all arm, so this
  type-checks and does nothing. Verify by triggering the frame.
- **chat-ui / float divergence.** Nothing mechanically checks that the two copies of `api.ts` and
  `types.ts`, or the two proxy Workers, agree. Diff them yourself:
  ```bash
  diff apps/chat-ui/src/types.ts apps/float/src/types.ts
  diff apps/chat-ui/worker/index.ts apps/float/worker/index.ts
  ```
- **The Workers themselves.** `vite build` does not exercise `worker/index.ts`. Use `wrangler dev`
  in the app directory.
- **Docs prose.** `astro build` catches broken links and bad frontmatter, not wrong claims.

## Report

Finish with: each command and its result, what you verified by hand, and an explicit list of what
remains unverified. If a check failed and you could not fix it, paste the real output — never
summarize a failure as a success.
