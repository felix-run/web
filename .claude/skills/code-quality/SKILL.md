---
name: code-quality
description: Run a scoped code-quality sweep of felix-web — dead code and needless indirection, test coverage gaps, type-safety and export-surface hygiene, and dependency or bundle drift. Use when asked to improve code quality, simplify, clean up, remove dead code, find unused exports, check test coverage, audit dependencies, or do a quality pass; it uses only the checks this repo already has and delegates the work to the quality agents.
license: MIT
metadata:
  repo: felix-web
---

# Code-quality sweep

Quality here means: is the code well made, is it tested, is the type surface honest, are the
dependencies clean. Correctness is `code-reviewer`'s question; security is `threat-review`'s;
whether the checks pass at all is `preflight`'s. This skill is the fourth question, and it is the
one nothing in CI asks.

## Scope it first

Default scope is **the current diff** (`git diff main...HEAD`), not the repository. Widen only when
the user asks, and then to one package or one dimension at a time. A sweep of everything produces a
list nobody acts on, and this repo carries deliberate debt that reads as accidental debt from a
distance — see **What not to "fix"** below before reporting anything.

State the scope you chose in the first line of the report.

## Measure with what already exists

Nothing new gets installed. There is no knip, ts-prune, depcheck, madge, or coverage tool here, and
adding one is a separate decision to put to the user.

```bash
pnpm lint            # biome; noExplicitAny and noUnusedVariables are only WARN, so read the warnings
pnpm check-types     # per-package tsc — strictness differs by tier, see references/dimensions.md
pnpm test            # vitest: chat-ui, cowork-client
pnpm check-api-drift # client routes vs the committed harness OpenAPI snapshot
pnpm check-protocol-parity # every SSE event arm has a handler in App.tsx
pnpm check-tailwind-sources # guarded @source trees still reach the compiled CSS
pnpm build           # vite prints per-chunk sizes — this is the bundle measurement
git grep -n 'as any\|as unknown as\|@ts-expect-error\|@ts-ignore'
```

`pnpm lint` passing means little on its own: the two rules that matter most for quality are
warnings, so count them rather than trusting the exit code.

**Unused exports and unused files have no check here.** Do not imply one exists. Verify by hand:
`git grep` the symbol across `apps/` and `packages/`, then confirm it is absent from both `exports`
maps and both app tsconfig `paths`.

## The four dimensions

1. **Simplification and dead code** — abstractions with one caller, wrappers that only forward,
   derived state stored, unreachable branches, exports nothing imports.
2. **Test quality and coverage** — the chat surface (`App.tsx`, composer, inspector panels) is the
   standing gap. Shared behavior belongs in `@felix/test-kit`, run from both apps.
3. **Type safety and API hygiene** — casts and `!` (nothing warns on either), `any` creep, the open
   `StreamEvent` arm, and the public surface of the no-build-step packages.
4. **Dependency and bundle hygiene** — `catalog:` drift in `pnpm-workspace.yaml`, unused deps,
   per-chunk growth in the two Vite apps.

The per-dimension checklist, with the concrete files each one lands on, is in
`references/dimensions.md`. Read it when the sweep goes past a quick pass.

## What not to "fix"

- **The proxy contract is stated twice on purpose** — `worker/index.ts` for production and the
  `/api` rewrite in `vite.config.ts` for `vite dev` (`.claude/rules/protocol-parity.md`). Divergence
  between them is a finding. The duplication is not.
- **`@felix/protocol` is hand-mirrored** from the Python harness in another repo.
- **`packages/ui` and `packages/cowork-client` have no build step** — the exports map plus tsconfig
  `paths` double-wiring is the design.
- **`apps/docs/src/styles/theme.css` is generated** from `packages/design/src/tokens.ts`.
- **shadcn primitives are vendored** and have relaxed lint rules on purpose.

## Who does the work

| Step | Who |
|---|---|
| Find and rank the findings | `code-quality-reviewer` (read-only) |
| Write or strengthen tests | `test-engineer` |
| Apply behavior-preserving cleanups | `refactor-engineer` |
| Change `biome.json`, a tsconfig base, or CI | `dx-engineer` — flag it, don't do it here |
| A correctness bug found on the way | `code-reviewer` |
| Anything touching credentials, the gate, or rendered output | `security-reviewer` |

Findings first, changes second: do not start editing before the list exists and the user has seen
it. Land everything on one branch via PR (`branch-pr-workflow`), scoped as one feature area.

## Report

Scope, then findings grouped by dimension with a named cost for each — the bug it prevents, the
lines it removes, the bytes it saves. Then what you changed, the `preflight` result before and
after, and what you deliberately left alone. Close with what is still unverified: after a quality
sweep the chat surface is almost always still on that list.
