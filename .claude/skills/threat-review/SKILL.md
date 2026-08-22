---
name: threat-review
description: Security review procedure for felix-web, scoped to this architecture — the proxy Workers and their credential handling, the shared-key gate, browser-executed client tools and the virtual filesystem, rendered model output, and secret placement. Use before merging changes to worker/index.ts, auth, cowork-client, or anything that renders or executes untrusted content, and for a periodic security pass.
license: MIT
metadata:
  repo: felix-web
---

# Threat review

Scope to the diff (`git diff main...HEAD`) unless a full audit is requested. A finding must name a
concrete attack in **this** architecture — who, what input, what they get. Category names are not
findings.

The exhaustive per-surface checklist is in `references/checklist.md`. This file is the shape of the
review.

## The system, as an attacker sees it

```
attacker-controlled ──▶ browser ──▶ proxy Worker ──▶ Python harness ──▶ model
                                         │                                │
                                    holds secrets            emits tool calls the BROWSER runs
```

Three properties make this different from a normal SPA:

1. **The Worker holds credentials the browser must never see** — `CHAT_UI_KEY` is checked and
   stripped; `FELIX_API_KEY` is injected outbound.
2. **The model can drive the user's filesystem.** `tool_request` frames are executed in the browser
   by `@felix/cowork-client`, against an in-tab VFS or a real File System Access mount.
3. **Model output is rendered as markdown** and may embed content from tools, pages, and files the
   model read — the classic prompt-injection → rendered-output path.

## Review order

1. **Credential flow.** Is `x-chat-key` still deleted before the upstream fetch? Can `FELIX_API_KEY`
   reach a response body, an error, or a log? Is the key comparison still constant-time?
2. **Gate coverage.** Does the check run for every `/api/*` request regardless of method or path
   shape? Is there a path that reaches `ASSETS` or upstream without passing it?
3. **Upstream request construction.** `FELIX_ORIGIN` is concatenated with a client-controlled path
   and query. Can traversal, an absolute URL, or CRLF retarget the request or inject a header?
4. **Client tools.** Can a tool argument escape the VFS root or the mounted directory? Are
   destructive operations gated by approval rather than by a name check? Assume every argument is
   attacker-chosen, because a prompt-injected model chooses them.
5. **Rendering.** Any `dangerouslySetInnerHTML`, raw HTML passthrough, unsanitized link scheme
   (`javascript:`, `data:`), or tool output rendered as markup instead of text?
6. **Secrets at rest.** Anything sensitive in `wrangler.jsonc` `vars`, in a tracked `.dev.vars`, in
   `index.html`, or in the client bundle. `vars` and `VITE_`-prefixed env are public by construction.
7. **Trust claims.** Does any new code treat the shared `CHAT_UI_KEY` as user identity, or widen what
   an anonymous caller (tenant `default`) can reach?

## Calibration

- Rank by exploitability, not by category severity.
- Separate **confirmed** (you traced the path) from **needs verification** (plausible, unproven).
- Say what you did not review.
- If the diff has no security impact, say so in one line. Do not inflate a review to look thorough.

## Report

Per finding: `file:line`, the attack narrative, impact, fix. Then the two lists above, then scope
not covered.
