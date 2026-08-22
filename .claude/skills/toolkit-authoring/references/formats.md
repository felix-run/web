# Format reference — skills, subagents, hooks

Companion to `toolkit-authoring`. Authoritative sources: the
[Agent Skills spec](https://agentskills.io/specification), the
[subagents](https://code.claude.com/docs/en/sub-agents) and
[hooks](https://code.claude.com/docs/en/hooks) docs.

## Skill frontmatter

### The Agent Skills spec — portable across clients

| Field | Required | Constraints |
|---|---|---|
| `name` | yes | ≤64 chars, lowercase `a-z0-9` and single hyphens, no leading/trailing hyphen, **must match the directory name** |
| `description` | yes | ≤1024 chars, non-empty; what it does *and* when to use it |
| `license` | no | License name, or the name of a bundled license file |
| `compatibility` | no | ≤500 chars; environment requirements. Most skills don't need it |
| `metadata` | no | Map of string → string, for your own tooling |
| `allowed-tools` | no | Space-separated pre-approved tools (experimental) |

Layout: `SKILL.md` required; `scripts/`, `references/`, `assets/` optional by convention. Reference
files stay one level deep. Target: metadata ~100 tokens, `SKILL.md` under ~5k tokens, everything
else loaded on demand.

### Claude Code extensions — non-portable, use deliberately

`when_to_use`, `argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable`,
`disallowed-tools`, `model`, `effort`, `context: fork`, `agent`, `background`, `hooks`, `paths`,
`shell`.

Notable behaviors:

- `disable-model-invocation: true` — only a human can invoke it. Correct for deploys, releases, and
  anything else with side effects.
- `user-invocable: false` — only Claude invokes it. For background knowledge that isn't a command.
- `paths: [...]` — auto-activates only when matching files are in play.
- `context: fork` (+ optional `agent:`) — runs the skill as a subagent with no conversation history.
- `allowed-tools` grants permission for the invoking turn only; it does not restrict anything.
- Body extras: `` !`cmd` `` injects command output at invocation time (pair it with `allowed-tools`
  or the invocation aborts on an unmatched permission rule); `$1`/`$ARGUMENTS`/`$name` substitute
  arguments; `${CLAUDE_SKILL_DIR}` and `${CLAUDE_PROJECT_DIR}` expand in both the body and Bash
  rules in `allowed-tools`.

Skills resolve enterprise > personal > project, and a project skill **overrides a bundled skill of
the same name** — which is why this repo names its security skill `threat-review` rather than
shadowing the bundled `/security-review`.

## Subagent frontmatter

| Field | Notes |
|---|---|
| `name` | required; lowercase and hyphens, no `:` |
| `description` | required; drives automatic delegation |
| `tools` | allowlist; omit to inherit. Accepts `mcp__<server>` patterns |
| `disallowedTools` | denylist, applied before `tools` |
| `model` | `sonnet` \| `opus` \| `haiku` \| `fable` \| full id \| `inherit` (default) |
| `permissionMode`, `maxTurns`, `effort`, `isolation: worktree`, `color`, `skills`, `memory`, `hooks` | optional |

Background subagents (the default) keep a reduced tool set: Read, Grep, Glob, Bash, Edit, Write,
WebFetch, WebSearch, TodoWrite, Skill, ToolSearch, plus MCP tools. `AskUserQuestion` is never
available to a subagent — an agent that needs a human decision must return and ask through its
report.

## Hooks

Events used in this repo: `SessionStart` (matchers `startup`/`resume`/`clear`/`compact`/`fork`),
`PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `SubagentStop`, `Stop`. Others available include
`UserPromptSubmit`, `PermissionRequest`, `PermissionDenied`, `PostToolBatch`, `SessionEnd`,
`PreCompact`/`PostCompact`, `Notification`, `FileChanged`, `TaskCreated`/`TaskCompleted`.

Matchers: `*` or omitted matches all; plain names and `|`-separated lists match exactly
(`Edit|Write`); anything containing other characters is an unanchored regex. MCP tools match as
`mcp__<server>__<tool>`.

Input arrives as JSON on stdin — always includes `session_id`, `cwd`, `transcript_path`,
`hook_event_name`, `permission_mode`; tool events add `tool_name`, `tool_input`, `tool_use_id`.

Output contracts used here:

```jsonc
// PreToolUse — can block
{"hookSpecificOutput":{"hookEventName":"PreToolUse",
  "permissionDecision":"deny","permissionDecisionReason":"why, and what to do instead"}}

// PostToolUse / PostToolUseFailure — cannot block, injects context
{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"…"}}

// Stop — can block once
{"decision":"block","reason":"what must happen before stopping"}

// Any event — a message shown to the user
{"systemMessage":"…"}
```

Exit codes: `0` = success (JSON parsed if present); `2` = blocking on blockable events
(`PreToolUse`, `UserPromptSubmit`, `Stop`, `SubagentStop`, `PreCompact`, …) and cannot be overridden
by JSON; anything else is a non-blocking error. `SessionStart` stdout is injected into context.

A `Stop` hook must check `stop_hook_active` and exit 0 when it is true, or the session loops forever.
