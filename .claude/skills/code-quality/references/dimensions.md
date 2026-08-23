# Quality dimensions — the concrete targets in this repo

Companion to the `code-quality` skill. Each section names the files a check actually lands on, so a
sweep looks in the right place instead of grepping the whole tree.

## 1. Simplification and dead code

- **Unused exports have no detector.** The surfaces to walk by hand:
  `packages/felix-protocol/package.json` (`.`, `./stream`, `./types`),
  `packages/ui/package.json` (`./*`, `./lib/utils`),
  `packages/cowork-client`, and `packages/test-kit` (`./proxy-worker`, `./sse`).
  For each exported symbol: `git grep -n '<symbol>' apps packages`. A hit only inside its own
  package means it is not a public export and should stop being one.
- **Unused files**: `git ls-files 'apps/*/src/**' 'packages/*/src/**'` and check each basename is
  imported somewhere. Files under `packages/ui/src` are the exception — they are reachable through
  the `./*` wildcard export whether or not anything imports them today.
- `correctness/noUnusedImports` is **error** and `correctness/noUnusedVariables` is only **warn** in
  `biome.json`, so unused locals survive CI in `packages/*`. Both apps set `noUnusedLocals` and
  `noUnusedParameters` in their own tsconfig, so app code is covered and package code is not.
- React-specific shapes worth checking in `apps/*/src`: `useEffect` writing state a render could
  derive, a `useMemo` over a primitive, a wrapper component that only forwards props, and options
  on a hook that no call site passes.

## 2. Test quality and coverage

- Two configs: `apps/chat-ui/vitest.config.ts` and `packages/cowork-client/vitest.config.ts`. No
  root config, no coverage tool.
- Contract-level behavior lives in `packages/test-kit/src/proxy-worker.ts` and
  `packages/test-kit/src/sse.ts`, invoked from `apps/chat-ui/tests/`. The suites are parameterized
  on an injected implementation, which is what lets the contract be stated independently of its
  caller — see `apps/chat-ui/tests/sse.test.ts`.
- Covered today: the VFS, the SSE reader, the proxy Worker, and chat-ui's thread store, theme
  provider, `usePoll`, presence, and Gate. **Uncovered: `App.tsx`, the composer, the inspector
  panels.**
- Coverage questions to ask of an existing suite: does it assert what a user observes, or which
  setter ran; would its failure name the defect; does it pin an error path as well as a happy path.

## 3. Type safety and API hygiene

- Nothing warns on `!` — `style/noNonNullAssertion` is **off** — and `suspicious/noExplicitAny` is
  **warn**, so new `any` merges green. Count the warnings in `pnpm lint`; do not read a zero exit
  code as a clean bill.
- Strictness is not uniform, and code moving between tiers can lose a guarantee:

  | Flag | root / `packages/*` | `apps/chat-ui` |
  |---|---|---|
  | `strict` | on | on |
  | `noUncheckedIndexedAccess` | **on** | **off** |
  | `noUnusedLocals` / `noUnusedParameters` | off | **on** |
  | `exactOptionalPropertyTypes` | explicitly **false** | off |

  So an indexed read is `T \| undefined` in a package and `T` in an app, and `{ foo: undefined }`
  satisfies `{ foo?: X }` everywhere. Harmonizing these is a `dx-engineer` change — flag it, don't
  do it inside a quality sweep.
- `StreamEvent` in `packages/felix-protocol/src/types.ts` ends in an open `{ event: string; … }`
  arm. A new frame type compiles with no handler and silently does nothing, so "the types pass" says
  nothing about SSE completeness. Cross-check the arms against the `switch` in `App.tsx`.
- Widening a shared package's surface is a commitment: the `exports` map **and** the `paths` block
  in `apps/chat-ui/tsconfig.json` both have to change. A helper with a single call site does not
  belong in a shared package.

## 4. Dependency and bundle hygiene

- `pnpm-workspace.yaml` `catalog:` is the single source of truth for anything used by two or more
  workspace packages; each manifest references it as `"catalog:"`. pnpm's default is
  `catalogMode: manual`, so `pnpm add` writes a **literal** version even for a catalogued package —
  a literal in a manifest is usually drift, not a decision. Check with:
  `git grep -n '": "\^' apps/*/package.json packages/*/package.json`
- A dependency used by exactly one package correctly keeps its literal version there. Promote it to
  the catalog only when a second package takes it.
- Unused dependencies: for each entry in a manifest's `dependencies`, `git grep` the package name
  in that workspace's `src/`. Nothing checks this automatically.
- Bundle: `pnpm build` prints per-chunk sizes for chat-ui. Compare against the same build
  on `main` rather than judging an absolute number, and attribute growth to a specific import — a
  new dependency pulled into the initial chunk is the usual cause.
