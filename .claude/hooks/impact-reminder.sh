#!/bin/bash
# PostToolUse (Edit|Write|MultiEdit): when a file with a known counterpart is
# edited, name the counterpart. This repo duplicates several surfaces on
# purpose, and the duplicates drift silently.
fp=$(jq -r '.tool_input.file_path // empty')
[ -z "$fp" ] && exit 0
rel="${fp#"${CLAUDE_PROJECT_DIR:-.}"/}"

emit() {
  jq -cn --arg ctx "$1" \
    '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:$ctx}}'
  exit 0
}

case "$rel" in
  apps/chat-ui/src/types.ts|apps/chat-ui/src/api.ts)
    emit "Wire contract touched. float keeps its OWN copy: check apps/float/src/${rel##*/} and decide explicitly whether it needs the same change. If you added a StreamEvent arm, add the matching case in apps/chat-ui/src/App.tsx — the union's catch-all arm means an unhandled frame type-checks and silently does nothing. See the api-contract-change skill." ;;
  apps/float/src/types.ts|apps/float/src/api.ts)
    emit "Wire contract touched in float. chat-ui keeps its OWN copy: check apps/chat-ui/src/${rel##*/}, and add the matching case in apps/float/src/App.tsx if you added an event arm. See the api-contract-change skill." ;;
  apps/chat-ui/worker/index.ts)
    emit "Proxy Worker changed. apps/float/worker/index.ts is a near-duplicate implementing the same /api/* contract — apply the same change there unless you can say why not. The dev proxy in apps/chat-ui/vite.config.ts is a third copy of the same contract." ;;
  apps/float/worker/index.ts)
    emit "Proxy Worker changed. apps/chat-ui/worker/index.ts is a near-duplicate implementing the same /api/* contract — apply the same change there unless you can say why not. The dev proxy in apps/float/vite.config.ts is a third copy of the same contract." ;;
  apps/*/vite.config.ts)
    emit "The dev /api proxy mirrors the production Worker (prefix strip + FELIX_ORIGIN). If you changed proxy behavior, apps/chat-ui/worker/index.ts and apps/float/worker/index.ts must match, or dev and prod diverge silently." ;;
  packages/ui/src/*)
    emit "Shared UI package changed. @felix/ui has NO build step: a new non-flat export needs an entry in packages/ui/package.json exports AND a matching paths entry in BOTH apps/chat-ui/tsconfig.json and apps/float/tsconfig.json. New dependencies belong in packages/ui/package.json. See the add-ui-primitive skill." ;;
  packages/cowork-client/src/*)
    emit "Client-tool / VFS code changed — this is the surface where the MODEL drives the user's filesystem. Re-check path normalization against '..', absolute paths, and encoded traversal, and confirm destructive operations still require approval. chat-ui and float bind this package separately (src/lib/cowork.ts, src/lib/client-tools.ts) with different VFS storage keys. Consider the threat-review skill." ;;
  packages/design/src/tokens.ts)
    emit "Design tokens changed. apps/docs/src/styles/theme.css is generated from these via starlightThemeCss() and is checked in — regenerate it, or the docs site keeps the old palette. See the docs-sync skill." ;;
  apps/docs/src/content/*)
    emit "Docs content changed. If you ADDED a page, it stays invisible until it is registered in the sidebar in apps/docs/astro.config.mjs (autogenerate is off because prose lives at src/content/, not src/content/docs/). Verify with: pnpm --filter @felix/docs build" ;;
  .claude/agents/*|.claude/skills/*|.claude/hooks/*)
    emit "Toolkit file changed. Update .claude/README.md if you added or removed a piece. Hooks additionally need wiring in .claude/settings.json and a session restart to take effect; skills and agents hot-reload. See the toolkit-authoring skill." ;;
esac
exit 0
