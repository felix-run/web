---
name: toolkit-authoring
description: How to extend the felix-web Claude Code toolkit — add or change a subagent, an Agent Skills-compliant skill, a path-scoped rule, or a hook, and wire it into .claude/settings.json. Use when asked to add a skill or agent, automate a behavior, create a slash command, or fix a hook, so the new piece follows the repo's conventions and the agentskills.io spec instead of being improvised.
license: MIT
compatibility: Designed for Claude Code; skills follow the agentskills.io Agent Skills spec
metadata:
  repo: felix-web
  spec: https://agentskills.io/specification
---

# Extending the toolkit

Everything lives in `.claude/`: `agents/`, `skills/`, `rules/`, `hooks/`, and `settings.json`.
`.claude/README.md` is the index — **update it whenever you add or remove a piece.**

## Pick the cheapest mechanism that works

| Need | Use | Why |
|---|---|---|
| A fact that is always true about the repo | `CLAUDE.md` | Always in context; costs tokens every session |
| A fact true only in some directories | `.claude/rules/*.md` with `paths:` frontmatter | Loads only when those files are in play |
| A procedure with steps, run on demand | `.claude/skills/<name>/SKILL.md` | Loads only when invoked or matched |
| A separate context with its own tools | `.claude/agents/<name>.md` | Isolates a big job; returns a summary |
| Deterministic enforcement or automation | `.claude/hooks/*.sh` + `settings.json` | Runs whether or not the model cooperates |

Do not reach for a hook when a `.gitignore` line, a script, or an example file would fix it.

## Skills — follow the spec

Format details and the full field tables are in `references/formats.md`. The short version:

- One directory per skill: `.claude/skills/<name>/SKILL.md`. The `name` field **must match the
  directory name**, be 1–64 chars, lowercase alphanumerics and single hyphens, no leading/trailing
  hyphen.
- `description` (≤1024 chars) is the whole discovery mechanism — it is all Claude sees until the
  skill loads. Say **what it does and when to use it**, with the trigger words someone would
  actually type.
- Prefer the six spec fields (`name`, `description`, `license`, `compatibility`, `metadata`,
  `allowed-tools`) so the skill stays portable to other Agent Skills clients. Reach for a Claude Code
  extension only when it buys something real: `disable-model-invocation: true` for anything with side
  effects (deploys, releases), `argument-hint`, `paths`, `context: fork`.
- Keep `SKILL.md` under ~500 lines and move depth into `references/*.md`, loaded on demand. That is
  the point of progressive disclosure — a long reference file costs nothing until it is read.
- Write standing instructions, not one-time steps: the content stays in context for the session.

## Subagents

`.claude/agents/<name>.md`, frontmatter `name`, `description`, then optionally `tools`,
`disallowedTools`, `model`, `color`, `effort`, `permissionMode`.

- The `description` drives automatic delegation — write it as *when to delegate*, and include
  "Use proactively when…" if that is the intent.
- Give reviewers a read-only `tools` list (`Read, Grep, Glob, Bash, WebFetch`). Withholding `Edit`
  and `Write` is what makes a review a review.
- `model: inherit` unless the job is narrow enough to downgrade.
- The body is a system prompt. Repo-specific knowledge is what makes it better than the default
  agent — generic checklists add nothing. End with an explicit output contract.

## Hooks

Scripts in `.claude/hooks/`, wired by event in `.claude/settings.json`. See
`references/formats.md` for the event list and the JSON contracts.

Non-negotiables in this repo:

- **Fail open.** `exit 0` on every path except a deliberate block. A hook that errors must never
  stop work.
- **Fast.** These run on the common path. Well under a second; no network calls.
- **Silent when there is nothing to say.** A hook that fires on every edit trains people to ignore it.
- **Test before wiring**, by piping realistic JSON:
  ```bash
  echo '{"tool_input":{"file_path":"apps/chat-ui/src/api.ts"},"cwd":"'"$PWD"'"}' \
    | .claude/hooks/impact-reminder.sh
  ```
- `chmod +x` the script, use `"$CLAUDE_PROJECT_DIR"` for paths, and remember that a blocking gate
  (`permissionDecision: deny`, or exit 2) needs a reason a reader can act on.
- **A blocking hook needs a test battery**, checked in under `.claude/hooks/tests/`. It is wrong in
  two directions — a false negative lets through what it exists to stop, and a false positive blocks
  real work — and neither shows up until someone is mid-task. `block-main-commit.test.sh` is the
  model: cases for what must be denied, what must be allowed, and a regression case for every
  false positive ever found. Match on argument tokens, not on substrings of the whole command; a
  command's text often quotes the very thing you are matching against.

## After any change

1. Update `.claude/README.md`.
2. If it changes how someone works in the repo, update `CLAUDE.md`.
3. Skills and agents hot-reload; **`settings.json` hook changes need a session restart.** Say so.
4. Land it on a branch via PR (`branch-pr-workflow`) — `.claude/` is version-controlled like the
   rest of the repo.
