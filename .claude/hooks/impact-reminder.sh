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
    emit "Wire contract touched. The shared types live in packages/felix-protocol and the chat half of the HTTP surface in packages/felix-client — check whether the change belongs in one of those rather than here. If you added a StreamEvent arm, add the matching case in packages/felix-client/src/engine.ts — the union's catch-all arm means an unhandled frame type-checks and silently does nothing. See the api-contract-change skill." ;;
  packages/felix-client/src/engine.ts)
    emit "The one StreamEvent switch. Every client renders this — chat-ui today, any other surface after it — so a change here is not scoped to one app. A new arm in packages/felix-protocol/src/types.ts needs its case here or the frame silently does nothing; pnpm check-protocol-parity reads THIS file. Frames the run blocks on (tool_request, approval_required, ui_request) must be answered on every path, errors and aborts included." ;;
  apps/tui/src/workspace.ts)
    emit "Terminal client tools changed — this is the surface where the MODEL drives the user's REAL filesystem, not a VFS. Re-check resolveWithin against '..', absolute paths, encoded traversal and symlinks (it compares real paths for that reason), and confirm writes still wait on the confirmation prompt. Every path must settle with a RESULT, never a throw or a hang. Consider the threat-review skill." ;;
  packages/felix-client/src/transport.ts)
    emit "Chat routes changed. pnpm check-api-drift reads this file alongside apps/chat-ui/src/api.ts — keep the paths as literals passed to chatFetch/rawFetch (harness-relative, no /api prefix) or the call becomes invisible to the check. Response *shapes* are guarded separately by pnpm check-payload-shapes." ;;
  apps/chat-ui/worker/index.ts)
    emit "Proxy Worker changed. The dev proxy in apps/chat-ui/vite.config.ts is a second copy of the same /api/* contract (prefix strip + FELIX_ORIGIN) — apply the same change there, or dev and prod diverge silently." ;;
  apps/chat-ui/vite.config.ts)
    emit "The dev /api proxy mirrors the production Worker (prefix strip + FELIX_ORIGIN). If you changed proxy behavior, apps/chat-ui/worker/index.ts must match, or dev and prod diverge silently." ;;
  packages/ui/src/*)
    emit "Shared UI package changed. @felix/ui has NO build step: a new non-flat export needs an entry in packages/ui/package.json exports AND a matching paths entry in apps/chat-ui/tsconfig.json. New dependencies belong in packages/ui/package.json. See the add-ui-primitive skill." ;;
  packages/cowork-client/src/*)
    emit "Client-tool / VFS code changed — this is the surface where the MODEL drives the user's filesystem. Re-check path normalization against '..', absolute paths, and encoded traversal, and confirm destructive operations still require approval. chat-ui binds this package in src/lib/cowork.ts. Consider the threat-review skill." ;;
  packages/design/src/tokens.ts)
    emit "Design tokens changed. apps/docs/src/styles/theme.css is generated from these via starlightThemeCss() and is checked in — regenerate it, or the docs site keeps the old palette. See the docs-sync skill." ;;
  apps/docs/src/content/*)
    emit "Docs content changed. If you ADDED a page, it stays invisible until it is registered in the sidebar in apps/docs/astro.config.mjs (autogenerate is off because prose lives at src/content/, not src/content/docs/). Verify with: pnpm --filter @felix/docs build" ;;
  package.json|apps/*/package.json|packages/*/package.json)
    emit "Manifest changed. Shared dependency versions live in the catalog: block of pnpm-workspace.yaml — a dep used by 2+ workspace packages is declared once there and referenced as \"catalog:\" here. pnpm add writes a LITERAL version even when the catalog already has the package (default catalogMode: manual), so check what landed. Promote a dep to the catalog the moment a second package needs it, and run pnpm install." ;;
  .claude/agents/*|.claude/skills/*|.claude/hooks/*)
    emit "Toolkit file changed. Update .claude/README.md if you added or removed a piece. Hooks additionally need wiring in .claude/settings.json and a session restart to take effect; skills and agents hot-reload. See the toolkit-authoring skill." ;;
esac
exit 0
