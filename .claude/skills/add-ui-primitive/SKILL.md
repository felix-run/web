---
name: add-ui-primitive
description: Add or update a shared shadcn/ui primitive in packages/ui so both felix-web apps can use it. Use when a component is needed in chat-ui and float, when running shadcn add, or when an import from @felix/ui fails to resolve — the package has no build step, so exports and tsconfig paths must be wired by hand.
license: MIT
compatibility: Requires pnpm and network access for `pnpm dlx shadcn`
metadata:
  repo: felix-web
---

# Adding a shared UI primitive

`@felix/ui` has **no build step**. It exports raw `.tsx` source, resolved through `paths` in each
app's tsconfig. That means adding a component is three wiring steps, not one.

## 1. Add the component

```bash
pnpm dlx shadcn@latest add <name> --cwd packages/ui
```

Config comes from `apps/chat-ui/components.json`: style `new-york`, base color `neutral`, CSS
variables on, `lucide` icons, `utils` aliased to `@felix/ui/lib/utils`. Files land in
`packages/ui/src/`, flat — no `components/ui/` nesting.

If shadcn writes an import that assumes an app layout (`@/lib/utils`, `@/components/...`), rewrite it
to the package's own relative path (`./lib/utils`) so the file is valid from inside `packages/ui`.

## 2. Check the export map

`packages/ui/package.json` already covers the flat layout:

```json
"exports": {
  "./*": "./src/*.tsx",
  "./lib/utils": "./src/lib/utils.ts"
}
```

A new `src/<name>.tsx` is exported automatically as `@felix/ui/<name>`. Anything that is **not** a
top-level `.tsx` — a subdirectory, a `.ts` helper, a hook — needs its own `exports` entry.

## 3. Check the tsconfig paths in both apps

`apps/chat-ui/tsconfig.json` and `apps/float/tsconfig.json` both carry:

```json
"@felix/ui/*": ["../../packages/ui/src/*"],
"@felix/ui/lib/utils": ["../../packages/ui/src/lib/utils.ts"]
```

The wildcard covers new flat components. A new subpath in step 2 needs a matching `paths` entry in
**both** apps, or one app fails to type-check while the other passes.

## 3a. Route new dependencies through the catalog

A dependency shadcn pulled in (a new Radix package, `cmdk`, …) belongs in
`packages/ui/package.json` — not just in the app that consumes the component.

Shared versions live in the `catalog:` block of `pnpm-workspace.yaml`, so:

- **Already in the catalog** → reference it as `"catalog:"`, never a literal version.
- **Only `packages/ui` uses it** → a literal version in `packages/ui/package.json` is correct.
- **A second package now needs a dep that was single-use** → promote it: move the version into the
  catalog and change both manifests to `"catalog:"`.

`pnpm add` writes a literal version even when the catalog already has that package (pnpm's default
`catalogMode: manual`), so check the manifest after adding. Then `pnpm install`.

## 4. Verify

```bash
pnpm --filter @felix/ui check-types
pnpm --filter @felix/chat-ui check-types
pnpm --filter @felix/float check-types
pnpm lint
```

## House rules

- Apps import from `@felix/ui/<name>`; never copy a primitive into `apps/*/src/components/`.
- Compose, don't fork: app-specific behavior wraps the primitive in the app.
- `packages/ui/src/**` has relaxed a11y lint rules in `biome.json` (`useSemanticElements`,
  `useKeyWithClickEvents`, `noArrayIndexKey`). That is a concession to shadcn's generated markup —
  do not treat it as license to write inaccessible custom components.
- Tailwind v4 is CSS-first: theme tokens live in each app's `src/index.css`, and there is no
  `tailwind.config`. A primitive that needs a new token requires adding it to **both** apps' CSS.
