#!/bin/bash
# SessionStart (matcher: compact): re-pin the load-bearing felix-web constraints
# that are easy to lose in a summary.
cat <<'TXT'
felix-web post-compaction reminders:
- Tests exist but stop short of the chat surface: pnpm test covers the VFS, the SSE reader, both proxy Workers (shared @felix/test-kit suites) and part of chat-ui React. App.tsx, the composer and the inspector panels are NOT covered. Verification = pnpm check-types + pnpm lint + pnpm test + pnpm build, plus a manual run against the harness on :8080. Never report "tests pass" for the chat surface.
- chat-ui and float keep SEPARATE copies of api.ts/types.ts, and the two worker/index.ts proxies are near-duplicates. A protocol or proxy change usually belongs in both (api-contract-change skill).
- StreamEvent has an open catch-all arm: a new SSE frame type-checks with no handler and silently does nothing. Add the switch case in App.tsx too.
- Never commit to main; never stack PRs. Branch + PR only (branch-pr-workflow skill, hook-enforced).
- Deploys, wrangler secret writes, and remote migrations are ask-gated. If a gate denies you, stop and report — do not re-spell the command.
- apps/docs prose lives at src/content/ (NOT src/content/docs/), and a new page is invisible until it is added to the sidebar in astro.config.mjs.
TXT
exit 0
