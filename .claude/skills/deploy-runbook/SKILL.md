---
name: deploy-runbook
description: Deploy a felix-web Worker (chat-ui or docs) to Cloudflare — prerequisites, secrets, the deploy command, and post-deploy verification. Invoke manually with /deploy-runbook when you intend to ship; deploys and secret writes are ask-gated and must never be triggered automatically.
license: MIT
compatibility: Requires wrangler, a Cloudflare account with access to the felix.run zone, and network access
disable-model-invocation: true
argument-hint: "[chat-ui|docs]"
metadata:
  repo: felix-web
---

# Deploy runbook

**This skill has side effects.** Never run a step here unless the user has asked for a deploy in
this turn. `wrangler deploy`, `wrangler secret put`, and remote migrations are ask-gated in
`.claude/settings.json`; if a gate denies you, stop and report — do not re-spell the command to get
around it.

## Targets

| App | Script | Route |
|---|---|---|
| `@felix/chat-ui` | `pnpm chat:deploy` | `make.felix.run` |
| `@felix/docs` | `pnpm docs:deploy` | `docs.felix.run` |

Each `*:deploy` script is `pnpm build && wrangler deploy` inside that package.

## 1. Preconditions

- On a branch, with the change **merged to `main`** — `main` is the deploy source. Deploying an
  unmerged branch is a deliberate exception the user has to state.
- `pnpm check-types && pnpm lint && pnpm build` clean (the `preflight` skill).
- For chat-ui, the **production harness serves every route the client calls**. The default drift
  check compares against the committed record, not against what `api.felix.run` actually runs, and
  the two version independently:
  ```bash
  FELIX_API_KEY=<a key api.felix.run accepts> pnpm check-api-drift:live https://api.felix.run
  ```
  A failure names each call that would 404 in production — upgrade the harness first, or accept
  that those surfaces fail there. Exit 2 is the key or the network, not drift.
- Normally nothing to do by hand: `.github/workflows/deploy.yml` deploys both Workers after CI
  passes on `main`, and the docs again on `felix-deployed` from felix-run/ops after a production
  roll. Dispatch it (`gh workflow run deploy.yml -f app=docs|chat-ui|both`) to deploy now. Both
  `wrangler.jsonc` files are tracked; a local `pnpm *:deploy` needs `wrangler login`.

## 2. Config and secrets

`vars` in `wrangler.jsonc` is **public** — the only thing that belongs there is `FELIX_ORIGIN`, the
public origin of the Python harness (production: `https://api.felix.run`).

Secrets go through wrangler, once per Worker, and are ask-gated:

The chat-ui Worker takes none: browsers sign in to the harness (GitHub or Google login), so the
harness must have one on before this deploy. A Worker deployed before the shared access key was
retired still holds `CHAT_UI_KEY` and `FELIX_API_KEY`; they are ignored — delete them:

```bash
pnpm --filter @felix/chat-ui exec wrangler secret delete CHAT_UI_KEY
pnpm --filter @felix/chat-ui exec wrangler secret delete FELIX_API_KEY
```

## 3. Deploy

```bash
pnpm chat:deploy     # or docs:deploy
```

## 4. Verify — actually check, don't assume

```bash
curl -sS -o /dev/null -w 'spa=%{http_code}\n' https://make.felix.run/
curl -sS -o /dev/null -w 'api=%{http_code}\n' https://make.felix.run/api/v1/models   # 401 expected when the gate is on
```

Then in a browser: the SPA loads, the Gate signs you in, a chat turn streams, and the Inspector
polls. A 502 with `felix_origin_unset` means `vars.FELIX_ORIGIN` is missing; a 401 on every call
means the harness refused the session — check its auth mode and login settings.

## 5. Rollback

Redeploy the previous good commit, or roll back the deployment in the Cloudflare dashboard
(`wrangler deployments list` / `wrangler rollback`). State which one you are doing. A rollback of
the frontend does **not** roll back the Python harness — they version independently.

## Report

Target, commit deployed, commands run with real output, verification results, and anything that
still needs a human check.
