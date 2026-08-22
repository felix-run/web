#!/bin/bash
# PreToolUse (Edit|Write|MultiEdit): deny edits to generated or build-output
# files. Edit the source that produces them instead.
fp=$(jq -r '.tool_input.file_path // empty')
[ -z "$fp" ] && exit 0

deny() {
  jq -cn --arg r "$1" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}

case "$fp" in
  */apps/docs/src/styles/theme.css|apps/docs/src/styles/theme.css)
    deny "apps/docs/src/styles/theme.css is GENERATED from @felix/design (packages/design/src/tokens.ts via starlightThemeCss()). It is checked in, but hand edits are reverted by the next regeneration. Change the tokens and regenerate instead — see the docs-sync skill." ;;
  */pnpm-lock.yaml|pnpm-lock.yaml)
    deny "pnpm-lock.yaml is generated. Change dependencies with pnpm (pnpm add / remove / update --filter <pkg>) and let it regenerate; a hand-edited lockfile breaks CI's install." ;;
  *.tsbuildinfo)
    deny "*.tsbuildinfo is TypeScript build cache. Delete it if it is stale; never edit it." ;;
  */dist/*|*/.wrangler/*|*/.astro/*|*/node_modules/*|*/.turbo/*)
    deny "That path is build output or a dependency/cache directory (dist, .wrangler, .astro, .turbo, node_modules). Edit the source and rebuild — pnpm build." ;;
esac
exit 0
