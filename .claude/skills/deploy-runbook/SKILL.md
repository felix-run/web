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
| `@felix/chat-ui` | `pnpm chat:deploy` | `chat.felix.run` |
| `@felix/docs` | `pnpm docs:deploy` | `docs.felix.run` |

Each `*:deploy` script is `pnpm build && wrangler deploy` inside that package.

## 1. Preconditions

- On a branch, with the change **merged to `main`** — `main` is the deploy source. Deploying an
  unmerged branch is a deliberate exception the user has to state.
- `pnpm check-types && pnpm lint && pnpm build` clean (the `preflight` skill).
- The config file exists. **`apps/chat-ui/wrangler.jsonc` is gitignored**, so a fresh clone has
  none — copy the tracked example next to it:
  ```bash
  cp apps/chat-ui/wrangler.example.jsonc apps/chat-ui/wrangler.jsonc
  ```
  `apps/docs/wrangler.jsonc` is tracked and needs nothing.

## 2. Config and secrets

`vars` in `wrangler.jsonc` is **public** — the only thing that belongs there is `FELIX_ORIGIN`, the
public origin of the Python harness (production: `https://api.felix.run`).

Secrets go through wrangler, once per Worker, and are ask-gated:

```bash
pnpm --filter @felix/chat-ui exec wrangler secret put CHAT_UI_KEY    # browser gate key
pnpm --filter @felix/chat-ui exec wrangler secret put FELIX_API_KEY  # optional upstream bearer
```

Rotating `CHAT_UI_KEY` invalidates every browser's stored key — users get re-prompted by the Gate.
Say so before rotating.

## 3. Deploy

```bash
pnpm chat:deploy     # or docs:deploy
```

## 4. Verify — actually check, don't assume

```bash
curl -sS -o /dev/null -w 'spa=%{http_code}\n' https://chat.felix.run/
curl -sS -o /dev/null -w 'api=%{http_code}\n' https://chat.felix.run/api/v1/models   # 401 expected when the gate is on
```

Then in a browser: the SPA loads, the Gate accepts the key, a chat turn streams, and the Inspector
polls. A 502 with `felix_origin_unset` means `vars.FELIX_ORIGIN` is missing; a 401 on every call
means the `CHAT_UI_KEY` secret and the key you entered disagree.

## 5. Rollback

Redeploy the previous good commit, or roll back the deployment in the Cloudflare dashboard
(`wrangler deployments list` / `wrangler rollback`). State which one you are doing. A rollback of
the frontend does **not** roll back the Python harness — they version independently.

## Report

Target, commit deployed, commands run with real output, verification results, and anything that
still needs a human check.
