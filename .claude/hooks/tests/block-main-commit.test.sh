#!/bin/bash
# Test battery for block-main-commit.sh.
#
# This guard blocks work when it is wrong in either direction: a false negative
# lets a commit land on the protected branch, and a false positive stops a
# legitimate push or PR. It regressed once already — the original glob matched
# the entire command string, so a feature-branch push chained with
# `gh pr create --base main` was denied, as was any command whose text merely
# quoted the pattern.
#
# Run from anywhere:  .claude/hooks/tests/block-main-commit.test.sh
set -u
here=$(cd "$(dirname "$0")" && pwd)
HOOK="$here/../block-main-commit.sh"
repo=$(cd "$here/../../.." && pwd)

[ -x "$HOOK" ] || { echo "not executable: $HOOK"; exit 1; }
command -v jq >/dev/null || { echo "jq required"; exit 1; }

# A scratch repo whose current branch IS the protected one, for the
# branch-dependent rules.
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
git init -q -b main "$scratch"
git -C "$scratch" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init

pass=0; fail=0

t() { # t <deny|allow> <main|feature> <label> <command>
  local expect="$1" ctx="$2" label="$3" c="$4" dir out got
  [ "$ctx" = main ] && dir="$scratch" || dir="$repo"
  out=$(jq -cn --arg c "$c" '{tool_input:{command:$c}}' | CLAUDE_PROJECT_DIR="$dir" bash "$HOOK")
  [ -n "$out" ] && got=deny || got=allow
  if [ "$got" = "$expect" ]; then
    pass=$((pass + 1)); printf '  ok    %-6s %s\n' "$got" "$label"
  else
    fail=$((fail + 1)); printf '  FAIL  got=%s want=%s  %s\n' "$got" "$expect" "$label"
  fi
}

echo "regressions: false positives that once blocked real work"
t allow feature "feature push chained with a PR against the protected branch" \
  'git push -u origin docs/catalog-notes | tail -3
gh pr create --base main --head docs/catalog-notes --title "x"'
t allow feature "gh command whose body text quotes the blocked pattern" \
  'gh pr create --base main --body "the guard wrongly denied git push origin main"'

echo "heredoc bodies are data, not commands"
t allow feature "commit whose message mentions the blocked pattern" \
  "git commit -F - <<'EOF'
Fix the guard

It wrongly denied: git push origin main
EOF"
t allow feature "writing a script whose contents mention it" \
  "cat > x.sh <<'HOOK'
# blocks git push origin main
HOOK"

echo "denies the real thing"
t deny feature "explicit protected refspec"      'git push origin main'
t deny feature "HEAD:main"                       'git push origin HEAD:main'
t deny feature "main:main"                       'git push -u origin main:main'
t deny feature "refs/heads/main"                 'git push origin refs/heads/main'
t deny feature "force push"                      'git push --force-with-lease origin main'
t deny feature "src:main from a feature branch"  'git push origin mybranch:main'
t deny main    "commit on the protected branch"  'git commit -m "x"'
t deny main    "commit with a heredoc message"   "git commit -q -F - <<'EOF'
subject
EOF"
t deny main    "bare push"                       'git push'
t deny main    "push -u origin with no refspec"  'git push -u origin'
t deny main    "commit chained after a build"    'pnpm lint && git commit -m x'

echo "allows legitimate work"
t allow feature "feature refspec"                'git push -u origin fix/main-guard-false-positives'
t allow feature "commit on a feature branch"     'git commit -m "x"'
t allow main    "explicit feature refspec"       'git push origin my-feature'
t allow feature "branch named main-ish"          'git push origin main-ish'
t allow feature "branch named feature/main"      'git push origin feature/main'
t allow feature "unrelated command"              'ls -la && pnpm build'
t allow feature "read-only git"                  'git status --short'
t allow feature "-C pointing at another repo"    'git -C ../other status'

echo
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
