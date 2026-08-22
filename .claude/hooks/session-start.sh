#!/bin/bash
# SessionStart: report only things that are actually wrong or worth knowing in
# felix-web. Stdout is injected into context, so stay silent when all is well.
root="${CLAUDE_PROJECT_DIR:-.}"
out=""
add() { out="${out}$1
"; }

[ -d "$root/node_modules" ] || add "- Dependencies not installed. Run: pnpm install"

[ -f "$root/apps/chat-ui/wrangler.jsonc" ] || \
  add "- apps/chat-ui/wrangler.jsonc missing (gitignored). Only needed to deploy: cp apps/chat-ui/wrangler.example.jsonc apps/chat-ui/wrangler.jsonc"

[ -f "$root/apps/float/wrangler.jsonc" ] || \
  add "- apps/float/wrangler.jsonc missing (gitignored, and there is NO example file). Only needed to deploy: mirror chat-ui's, with name felix-float and route float.felix.run"

# Is the Python harness up? Everything under /api/* fails in dev without it.
if ! (exec 3<>/dev/tcp/127.0.0.1/8080) 2>/dev/null; then
  add "- Python Felix harness is NOT listening on :8080, so every /api/* call in chat:dev / float:dev will fail. Start it in the felix-run/felix repo: make up && make migrate"
fi

branch=$(cd "$root" 2>/dev/null && git rev-parse --abbrev-ref HEAD 2>/dev/null)
[ "$branch" = "main" ] && \
  add "- On main. Commits are hook-blocked here; branch before changing anything: git switch -c <type>/<slug> (branch-pr-workflow skill)."

if [ -n "$out" ]; then
  printf 'felix-web session notes:\n%s' "$out"
fi
exit 0
