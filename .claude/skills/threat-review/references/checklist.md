# felix-web security checklist, by surface

Reference for `threat-review`.

## Proxy Worker — `apps/chat-ui/worker/index.ts`

- [ ] `headers.delete('x-chat-key')` still runs on every upstream path
- [ ] `host` and the `cf-*` headers still stripped (they are trusted signals upstream)
- [ ] `FELIX_API_KEY` appears only as the outbound `Authorization` header — never in a response,
      error body, or log
- [ ] `timingSafeEqual` still used for the gate comparison (length check plus XOR accumulate)
- [ ] Gate covers every method and every `/api/*` path shape; no early return skips it
- [ ] `FELIX_ORIGIN` unset produces a 502, not a request to a relative or attacker-chosen origin
- [ ] Path/query concatenation is not exploitable by `..`, an absolute URL, encoded slashes, or CRLF
- [ ] Client-supplied `Authorization` cannot pass through when `FELIX_API_KEY` is unset — or that is
      a documented, intentional pass-through mode
- [ ] Streaming preserved: body passed through, `duplex: 'half'`, `redirect: 'manual'`, no buffering
- [ ] Response headers not reconstructed in a way that drops or adds sensitive headers
- [ ] The dev proxy in `apps/chat-ui/vite.config.ts` changed with it — it is a second copy of the
      same contract, and a fix in only one leaves dev and production disagreeing

## Gate and identity — `src/lib/auth.ts`, `components/gate.tsx`

- [ ] `CHAT_UI_KEY` is treated as an access gate, never as user authentication or isolation
- [ ] Stored only in `localStorage` under the known key; not sent anywhere but `/api/*`
- [ ] 401 clears the stored key and re-prompts (no silent retry loop that hammers with a bad key)
- [ ] No key, token, or thread id in a URL, query string, or `Referer`-visible position
- [ ] Nothing new widens anonymous (`tenant: default`) access

## Client tools and VFS — `packages/cowork-client`

- [ ] `normalize()` (VFS) rejects a net escape above root; verify against absolute paths,
      backslashes, percent-encoded traversal, and unicode lookalikes
- [ ] `splitContainedPath()` (mount) rejects **every** `..`, not just a net escape — the mount is
      real disk, so it is deliberately stricter than the in-memory VFS. Keep it that way; do not
      "unify" the two guards by loosening this one
- [ ] Every path from a tool argument goes through one of those two checks **before** any handle is
      opened, on every code path. Both are covered by `packages/cowork-client/tests/`
- [ ] File System Access writes stay inside the mounted directory handle
- [ ] The local shell emulation cannot execute real processes or reach outside the mount
- [ ] Destructive operations (delete, overwrite, bulk write) require approval rather than a
      name-based allowlist
- [ ] Tool results returned to the harness do not include content outside the intended scope
- [ ] Approval banners show the **real** arguments — a diff/preview that misrepresents the operation
      is a vulnerability, not a UI bug

## Rendering untrusted content — `components/chat/response.tsx`, `message.tsx`, `tool.tsx`

- [ ] No `dangerouslySetInnerHTML`
- [ ] Markdown renderer does not allow raw HTML passthrough
- [ ] Link schemes constrained (no `javascript:`, no `data:` navigation)
- [ ] Tool inputs/outputs rendered as text, not interpreted as markup
- [ ] Image attachments: MIME and size validated; a `data:text/html` cannot ride an image path
- [ ] Streamed content cannot break out of its container mid-frame (partial-markup injection)

## Secrets and build output

- [ ] `wrangler.jsonc` `vars` contains only `FELIX_ORIGIN`
- [ ] `.dev.vars` gitignored; only `.dev.vars.example` tracked, with empty values
- [ ] `apps/chat-ui/wrangler.jsonc` still gitignored (by `apps/chat-ui/.gitignore`); only
      `wrangler.example.jsonc` tracked. `apps/docs/wrangler.jsonc` is tracked on purpose — it must
      stay free of account and resource ids
- [ ] No secret in `index.html`, in a `VITE_`-prefixed env var, or in `dist/`
- [ ] No source maps published that expose more than intended
- [ ] Nothing sensitive written to `localStorage` beyond the gate key and UI state

## Dependencies and supply chain

- [ ] New dependencies are real, maintained packages (check for typosquats on the exact name)
- [ ] No new postinstall scripts pulled in
- [ ] `pnpm-lock.yaml` changes match the intended dependency change, and nothing else
