#!/bin/bash
# PostToolUse (Edit|Write|MultiEdit): run Biome's safe fixes + formatter on the
# file that was just written, so formatting never becomes a review comment.
# Silent unless the file actually changed on disk.
fp=$(jq -r '.tool_input.file_path // empty')
[ -z "$fp" ] && exit 0
[ -f "$fp" ] || exit 0

root="${CLAUDE_PROJECT_DIR:-.}"
case "$fp" in
  "$root"/*) ;;
  *) exit 0;;                       # outside the project: not ours to format
esac
case "$fp" in
  *node_modules/*|*/dist/*|*/.wrangler/*|*/.astro/*|*/.turbo/*) exit 0;;
esac
case "$fp" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.json|*.jsonc|*.css) ;;
  *) exit 0;;
esac
[ -d "$root/node_modules/@biomejs" ] || exit 0

before=$(shasum "$fp" 2>/dev/null | cut -d' ' -f1)
(cd "$root" && ./node_modules/.bin/biome check --write --no-errors-on-unmatched \
  --files-ignore-unknown=true "$fp") >/dev/null 2>&1
after=$(shasum "$fp" 2>/dev/null | cut -d' ' -f1)

if [ -n "$before" ] && [ "$before" != "$after" ]; then
  jq -cn --arg ctx "Biome reformatted ${fp##*/} on disk after your edit (formatting and safe lint fixes). Re-read the file before editing it again — your in-context copy is stale." \
    '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:$ctx}}'
fi
exit 0
