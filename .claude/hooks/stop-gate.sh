#!/bin/bash
# Stop hook: two cheap end-of-turn checks over one git call.
#   1. Docs drift — user-visible surfaces changed with no docs touched: block ONCE
#      per drift-set per session and ask for a sync or an explicit "not needed".
#   2. Verification nudge — TypeScript changed this turn: remind (non-blocking,
#      rate-limited) that the test suites cover the VFS, the SSE reader, the proxy
#      Workers and a slice of chat-ui React, but not the chat surface itself.
input=$(cat)

# Never loop: if we already blocked and Claude continued, let it stop.
[ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false')" = "true" ] && exit 0

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
changed=$({ git diff --name-only HEAD 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null; } | sort -u)
[ -z "$changed" ] && exit 0

sid=$(printf '%s' "$input" | jq -r '.session_id // "nosession"')
state="${TMPDIR:-/tmp}/felix-web-stop-$sid"

# --- 1. docs drift -----------------------------------------------------------
# Surfaces a reader of the docs would notice changing.
surfaces=$(printf '%s\n' "$changed" | grep -E '^(apps/chat-ui/(src/(api|types)\.ts|worker/index\.ts)|apps/chat-ui/wrangler\.example\.jsonc|packages/design/src/tokens\.ts)$')

if [ -n "$surfaces" ]; then
  # Any doc-side change in the same tree counts as "docs were considered".
  if ! printf '%s\n' "$changed" | grep -qE '^(apps/docs/(src/content/|astro\.config\.mjs)|CLAUDE\.md$|\.claude/)'; then
    hash=$(printf '%s\n' "$surfaces" | shasum | cut -c1-12)
    if ! grep -qs "$hash" "$state" 2>/dev/null; then
      echo "$hash" >> "$state"
      files=$(printf '%s\n' "$surfaces" | head -6 | tr '\n' ' ')
      jq -cn --arg r "Docs check: this working tree changes documented surfaces ($files) but nothing under apps/docs/src/content/, astro.config.mjs, or CLAUDE.md changed. Either sync the docs (docs-sync skill) or state plainly why no documentation change is needed. Fires once per drift-set per session." \
        '{decision:"block", reason:$r}'
      exit 0
    fi
  fi
fi

# --- 2. verification nudge ---------------------------------------------------
printf '%s\n' "$changed" | grep -qE '\.(ts|tsx)$' || exit 0
nudge="${state}-verify"
now=$(date +%s)
last=$(cat "$nudge" 2>/dev/null || echo 0)
[ $((now - last)) -lt 1200 ] && exit 0   # at most once per 20 minutes
echo "$now" > "$nudge"

jq -cn '{systemMessage:"TypeScript changed — run /preflight (check-types + lint + test + build). The suites cover the VFS, the SSE reader, the proxy Workers and part of chat-ui React; the chat surface itself is not covered, so a green run is not a verified app."}'
exit 0
