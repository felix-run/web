#!/bin/bash
# PostToolUseFailure (matcher: Bash): map a failed build/lint/dev command to the
# known cause in this repo, so the fix starts from the shortlist.
input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')

case "$cmd" in
  *pnpm*|*tsc*|*biome*|*vite*|*astro*|*wrangler*|*turbo*) ;;
  *) exit 0;;
esac

jq -cn --arg ctx "felix-web failure shortlist: (1) 'Cannot find module @felix/ui/...' or @felix/cowork-client → those packages have NO build step; the export must exist in the package's exports map AND in the tsconfig paths of BOTH apps/chat-ui and apps/float (add-ui-primitive skill). (2) tsc errors on possibly-undefined index access → the workspace tsconfig sets noUncheckedIndexedAccess; handle the undefined rather than adding '!'. (3) tsc noUnusedLocals/noUnusedParameters → both apps enable them; delete the unused binding. (4) biome check failures → pnpm format fixes formatting; real lint errors need a code change, not a config change. (5) wrangler 'assets directory does not exist' → run the build first ('*:deploy' scripts already do). (6) wrangler cannot find wrangler.jsonc → both app configs are gitignored; copy the tracked wrangler.example.jsonc sitting next to it. (7) ECONNREFUSED / 502 on :8080 in dev → the Python harness is not running; 'make up && make migrate' in felix-run/felix. (8) 502 felix_origin_unset → vars.FELIX_ORIGIN missing in wrangler.jsonc. (9) astro 'does not exist in collection docs' or a missing page → prose lives at src/content/ (not src/content/docs/) and new pages must be registered in the sidebar in astro.config.mjs. (10) ERR_PNPM_OUTDATED_LOCKFILE → run pnpm install; never hand-edit the lockfile. (11) 'vitest not found' / 'no test specified' → only apps/chat-ui, apps/float and packages/cowork-client have a test script and a vitest.config.ts; the other packages have none by design, so scope the run with pnpm --filter rather than adding a config." \
  '{hookSpecificOutput:{hookEventName:"PostToolUseFailure",additionalContext:$ctx}}'
exit 0
