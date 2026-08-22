#!/bin/bash
# PreToolUse hook (Bash): enforce the branch-pr-workflow skill — no commits on
# the default branch, and no direct pushes to it. Work happens on feature
# branches and lands via PRs. Deny-only for those two operations.
#
# Matching is deliberately narrow, because a false positive blocks legitimate
# work. The command is stripped of heredoc bodies, split into segments, and only
# segments that actually invoke `git` are inspected — then by real argument
# tokens rather than by substring. Previously the whole command string was
# glob-matched, which denied all of these:
#   - a feature-branch push chained with `gh pr create --base <default>`
#   - any `gh` command whose body text happened to quote the blocked pattern
#   - a commit whose heredoc message mentioned it
cmd=$(jq -r '.tool_input.command // empty')
[ -z "$cmd" ] && exit 0
case "$cmd" in *git*) ;; *) exit 0;; esac

PROTECTED="main"

# Drop heredoc bodies: their text is data, not commands.
stripped=$(printf '%s\n' "$cmd" | awk '
  {
    line = $0
    if (indoc) { if (line == delim || line == delim "\r") { indoc = 0 }; next }
    if (match(line, /<<-?[[:space:]]*[\047"]?[A-Za-z_][A-Za-z0-9_]*[\047"]?/)) {
      d = substr(line, RSTART, RLENGTH)
      sub(/^<<-?[[:space:]]*/, "", d); gsub(/[\047"]/, "", d)
      delim = d; indoc = 1
    }
    print line
  }')

deny() {
  jq -cn --arg r "$1" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}

branch=""
get_branch() {
  [ -n "$branch" ] && return
  cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || return
  branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
}

# Split on shell separators, then inspect only real `git` invocations.
printf '%s\n' "$stripped" | tr ';' '\n' | sed 's/&&/\n/g; s/||/\n/g; s/|/\n/g' | \
while IFS= read -r seg; do
  seg="${seg#"${seg%%[![:space:]]*}"}"                  # ltrim
  case "$seg" in
    git\ *|*/git\ *) ;;
    *) continue;;
  esac

  # shellcheck disable=SC2086
  set -- $seg
  shift                                                 # drop the `git` token
  sub=""
  while [ $# -gt 0 ]; do                                # skip global flags (-C dir, -c k=v)
    case "$1" in
      -C|-c) shift 2; continue;;
      -*) shift; continue;;
      *) sub="$1"; shift; break;;
    esac
  done

  case "$sub" in
    commit)
      get_branch
      [ "$branch" = "$PROTECTED" ] && deny "Committing on $PROTECTED is not allowed — every change lands via a PR (branch-pr-workflow skill). Create a branch first: git switch -c <type>/<slug>, then commit there and open a PR with gh pr create."
      ;;
    push)
      refs=""                                           # positional args after `push`
      while [ $# -gt 0 ]; do
        case "$1" in
          -o|--push-option|--repo|--exec|--receive-pack) shift 2; continue;;
          -*) shift; continue;;
          *) refs="$refs $1"; shift; continue;;
        esac
      done
      # refs = [remote] [refspec...]. A refspec whose destination is the
      # protected branch is what we block; feature refspecs pass.
      n=0
      for r in $refs; do
        n=$((n + 1))
        [ $n -eq 1 ] && continue                        # the remote itself
        dest="${r##*:}"                                 # src:dest -> dest; bare ref -> itself
        dest="${dest#refs/heads/}"
        dest="${dest#+}"
        [ "$dest" = "$PROTECTED" ] && deny "Direct pushes to the $PROTECTED branch are not allowed — it moves only by merging PRs on GitHub (branch-pr-workflow skill). Push your feature branch and gh pr create instead."
      done
      if [ "$n" -le 1 ]; then                           # no refspec: pushes the current branch
        get_branch
        [ "$branch" = "$PROTECTED" ] && deny "You are on $PROTECTED and this push has no refspec, so it would push $PROTECTED directly — not allowed (branch-pr-workflow skill). Branch first: git switch -c <type>/<slug>."
      fi
      ;;
  esac
done
exit 0
