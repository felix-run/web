#!/bin/bash
# Statusline: model, branch + dirty count, and whether the harness is reachable.
input=$(cat)
model=$(printf '%s' "$input" | jq -r '.model.display_name // .model.id // "?"')
proj=$(printf '%s' "$input" | jq -r '.workspace.project_dir // .cwd // "."')
cd "$proj" 2>/dev/null

branch=$(git branch --show-current 2>/dev/null)
[ -z "$branch" ] && branch=$(git rev-parse --short HEAD 2>/dev/null)
dirty=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')

if (exec 3<>/dev/tcp/127.0.0.1/8080) 2>/dev/null; then h="harness✓"; else h="harness✗"; fi
[ "$branch" = "main" ] && branch="main⚠"

echo "felix-web ⎇ ${branch:-?} (${dirty}±) | $h | $model"
