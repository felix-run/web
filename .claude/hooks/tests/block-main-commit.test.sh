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

[ -x "$HOOK" ] || { echo "not executable: $HOOK"; exit 1; }
command -v jq >/dev/null || { echo "jq required"; exit 1; }

# Two scratch repos, one on each kind of branch. The suite must never read the
# branch of the repo it lives in: several rules are branch-dependent, so using
# the real checkout made the result depend on what the developer happened to
# have checked out — it passed on a feature branch and failed on main.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkrepo() { # mkrepo <dir> <branch>
  git init -q -b "$2" "$1"
  git -C "$1" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
}
mkrepo "$tmp/protected" main
mkrepo "$tmp/feature" feat/example

pass=0; fail=0

t() { # t <deny|allow> <main|feature> <label> <command>
  local expect="$1" ctx="$2" label="$3" c="$4" dir out got
  [ "$ctx" = main ] && dir="$tmp/protected" || dir="$tmp/feature"
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

echo "cross-repo: the branch that matters is the target repo's, not this one's"
# The bug this section exists for: `cd <other repo> && git commit` was denied
# whenever *this* repo sat on the protected branch, regardless of where the
# other repo was. A docs commit on a feature branch of a sibling checkout was
# blocked with "Committing on main is not allowed" while on a feature branch.
t allow main "commit in another repo that is on a feature branch" \
  "cd $tmp/feature && git commit -m x"
t deny  feature "commit in another repo that is on the protected branch" \
  "cd $tmp/protected && git commit -m x"
t allow main "git -C at a feature-branch repo" \
  "git -C $tmp/feature commit -m x"
t deny  feature "git -C at a protected-branch repo" \
  "git -C $tmp/protected commit -m x"
# -C is per-invocation, so it overrides an earlier cd rather than inheriting it.
t deny  feature "-C overrides an earlier cd" \
  "cd $tmp/feature && git -C $tmp/protected commit -m x"
t allow main "cd is overridden by -C pointing somewhere safe" \
  "cd $tmp/protected && git -C $tmp/feature commit -m x"
# A push with no refspec pushes the current branch, so it follows the target too.
t allow main "refspec-less push from another repo on a feature branch" \
  "cd $tmp/feature && git push"
t deny  feature "refspec-less push from another repo on the protected branch" \
  "cd $tmp/protected && git push"
# Quoting and ~ are ordinary in a real command line.
t allow main "quoted path to a feature-branch repo" \
  "cd '$tmp/feature' && git commit -m x"

echo "cross-repo: unresolvable paths keep the strict fallback"
# Over-denying is the safe direction. A path the hook cannot evaluate must not
# become a way to slip a commit past it.
t deny  main "cd through an unexpanded variable falls back to this repo" \
  'cd "$SOME_DIR" && git commit -m x'
t deny  main "cd - falls back to this repo" \
  'cd - && git commit -m x'
t allow feature "unresolvable cd from a feature branch is still allowed" \
  'cd "$SOME_DIR" && git commit -m x'
# A directory that is not a repo yields no branch, so nothing is denied.
t allow main "cd into a non-repo" \
  "cd $tmp && git commit -m x"

echo
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
