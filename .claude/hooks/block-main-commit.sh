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

# Which repository a `git` invocation actually targets.
#
# This used to always read CLAUDE_PROJECT_DIR, which is wrong the moment a
# command operates on another checkout: `cd ~/other-repo && git commit` was
# denied whenever *this* repo happened to be on the protected branch, even
# though the other one was on a feature branch. That is the false-positive
# failure mode the header warns about, on an axis it did not consider.
#
# Two things move the target, and both are honoured: a `cd` earlier in the same
# command, and `git -C <dir>` on the invocation itself. When a path cannot be
# resolved statically — `cd "$SOME_VAR"`, `cd -` — the fallback stays
# CLAUDE_PROJECT_DIR. That can still over-deny, which is the safe direction for
# a guard: a false positive is an inconvenience, a false negative is a commit on
# the protected branch.
project_dir="${CLAUDE_PROJECT_DIR:-.}"
cwd="$project_dir"

# Strip one layer of surrounding quotes and expand a leading `~`.
unquote() {
  v="$1"
  case "$v" in
    \'*\') v="${v#\'}"; v="${v%\'}";;
    '"'*'"') v="${v#'"'}"; v="${v%'"'}";;
  esac
  case "$v" in "~") v="$HOME";; "~/"*) v="$HOME/${v#~/}";; esac
  printf '%s' "$v"
}

# Resolve <path> against the tracked cwd; empty if it still contains an
# unexpanded shell expression.
resolve_dir() {
  d=$(unquote "$1")
  case "$d" in *'$'*|*'`'*|"") printf ''; return;; esac
  case "$d" in /*) printf '%s' "$d";; *) printf '%s/%s' "$cwd" "$d";; esac
}

branch_of() { # branch_of <dir>
  ( cd "$1" 2>/dev/null && git rev-parse --abbrev-ref HEAD 2>/dev/null )
}

# Split on shell separators, then inspect only real `git` invocations.
printf '%s\n' "$stripped" | tr ';' '\n' | sed 's/&&/\n/g; s/||/\n/g; s/|/\n/g' | \
while IFS= read -r seg; do
  seg="${seg#"${seg%%[![:space:]]*}"}"                  # ltrim
  # A `cd` moves where any later `git` in this command runs.
  case "$seg" in
    cd|cd\ *)
      # shellcheck disable=SC2086
      set -- $seg
      shift
      if [ $# -eq 0 ]; then
        cwd="$HOME"                                     # bare `cd` is $HOME
      else
        case "$1" in
          -) cwd="$project_dir";;                       # `cd -` is not resolvable
          *) d=$(resolve_dir "$1"); cwd="${d:-$project_dir}";;
        esac
      fi
      continue;;
  esac

  case "$seg" in
    git\ *|*/git\ *) ;;
    *) continue;;
  esac

  # shellcheck disable=SC2086
  set -- $seg
  shift                                                 # drop the `git` token
  sub=""
  gitdir=""                                             # `-C <dir>`, if given
  while [ $# -gt 0 ]; do                                # skip global flags (-C dir, -c k=v)
    case "$1" in
      -C) gitdir="$2"; shift 2; continue;;
      -c) shift 2; continue;;
      -*) shift; continue;;
      *) sub="$1"; shift; break;;
    esac
  done

  # `-C` wins over the tracked cwd for this invocation only.
  if [ -n "$gitdir" ]; then
    d=$(resolve_dir "$gitdir")
    target="${d:-$project_dir}"
  else
    target="$cwd"
  fi

  case "$sub" in
    commit)
      branch=$(branch_of "$target")
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
        branch=$(branch_of "$target")
        [ "$branch" = "$PROTECTED" ] && deny "You are on $PROTECTED and this push has no refspec, so it would push $PROTECTED directly — not allowed (branch-pr-workflow skill). Branch first: git switch -c <type>/<slug>."
      fi
      ;;
  esac
done
exit 0
