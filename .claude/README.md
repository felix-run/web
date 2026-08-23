# felix-web Claude Code toolkit

Project-scoped agents, skills, rules, and hooks for this repo. Everything here is version-controlled
and reviewed like source. To add or change a piece, use the **`toolkit-authoring`** skill — it has
the formats, the conventions, and the wiring checklist.

## Subagents — `agents/`

Delegated by description; invoke explicitly by name when you want a specific one.

| Agent | Use it for |
|---|---|
| `workers-engineer` | The two proxy Workers, wrangler config, the `/api/*` contract, bindings and secrets |
| `ui-engineer` | React/Vite/Tailwind work in `apps/chat-ui`, streaming UI, `@felix/ui` |
| `python-harness-engineer` | Python work on the harness (felix-run/felix); requires that checkout in scope |
| `postgres-engineer` | Harness schema, migrations, indexing, query plans, tenant-scoped access |
| `devops-engineer` | CI, turbo/pnpm pipeline, wrangler deploys, secrets, release verification |
| `test-engineer` | Vitest suites, happy-dom component tests, and the shared `@felix/test-kit` suites |
| `refactor-engineer` | Behavior-preserving cleanups: dead code, indirection, loose types, catalog drift |
| `code-reviewer` | Read-only correctness review of a diff, tuned to this repo's real failure modes |
| `security-reviewer` | Read-only security review: proxy credentials, the key gate, client tools/VFS, rendered output |
| `code-quality-reviewer` | Read-only quality review: dead code, casts and `any`, export surfaces, dependency and bundle drift |
| `dx-engineer` | Repo ergonomics and this toolkit |
| `felix-docs-writer` | Documentation drift audits and repairs in `apps/docs` |

Reviewers have no `Edit`/`Write` — that is deliberate.

## Skills — `skills/`

Follow the [Agent Skills](https://agentskills.io/specification) spec, so they port to other clients.
Invoke with `/<name>`, or let Claude match them by description.

| Skill | Use it for |
|---|---|
| `preflight` | The verification loop, and what it does and does not cover |
| `code-quality` | The quality sweep: dead code, coverage gaps, type and export hygiene, dependency drift |
| `branch-pr-workflow` | Branch + PR procedure. Never commit to `main`, never stack PRs |
| `api-contract-change` | Changing the wire contract across the four hand-mirrored client files |
| `add-ui-primitive` | Adding a shadcn primitive to `packages/ui` and wiring exports + tsconfig paths |
| `docs-sync` | Keeping `apps/docs` true: content directory, manual sidebar, generated theme CSS |
| `deploy-runbook` | Shipping a Worker. Manual-invoke only (`disable-model-invocation`) |
| `python-harness` | Conventions and the unbreakable contract for harness work |
| `postgres-migration` | Expand/contract sequencing, lock profiles, tenant-first indexing, rollback |
| `threat-review` | Security review procedure for this architecture |
| `toolkit-authoring` | Extending this toolkit |

Deeper reference material sits in each skill's `references/` and loads only when needed:
`api-contract-change/references/wire-protocol.md`, `postgres-migration/references/lock-profiles.md`,
`threat-review/references/checklist.md`, `toolkit-authoring/references/formats.md`,
`code-quality/references/dimensions.md`.

## Rules — `rules/`

Path-scoped instructions, loaded only when matching files are in play.

- `git-workflow.md` (`**/*`) — branch + PR discipline, no stacked PRs.
- `protocol-parity.md` (client + worker files) — the three duplicated contracts and the
  `StreamEvent` hole.

## Hooks — `hooks/`, wired in `settings.json`

| Event | Script | Behavior |
|---|---|---|
| `SessionStart` | `session-start.sh` | Reports missing deps/config and whether the harness is up on `:8080`. Silent when fine |
| `SessionStart` (compact) | `compact-reminder.sh` | Re-pins constraints that a summary loses |
| `PreToolUse` (Edit/Write) | `block-generated.sh` | **Blocks** edits to generated files and build output |
| `PreToolUse` (Bash) | `block-main-commit.sh` | **Blocks** commits on `main` and direct pushes to `origin main` |
| `PostToolUse` (Edit/Write) | `format-touched.sh` | Runs Biome on the edited file; warns when it rewrote it |
| `PostToolUse` (Edit/Write) | `impact-reminder.sh` | Names the counterpart file for duplicated surfaces, and the catalog rule on manifest edits |
| `PostToolUseFailure` (Bash) | `failure-hint.sh` | Maps a failed build/lint command to this repo's known causes |
| `Stop` | `stop-gate.sh` | **Blocks once** on docs drift; rate-limited nudge to verify TS changes |
| `SubagentStop` | `subagent-log.sh` | Appends to the local audit trail in `logs/` (gitignored) |
| statusline | `statusline.sh` | Branch (⚠ on `main`), dirty count, harness reachability, model |

Hooks fail open — every script exits 0 unless it is deliberately blocking. Test one by piping it
JSON before wiring it:

```bash
echo '{"tool_input":{"file_path":"'"$PWD"'/apps/chat-ui/src/api.ts"}}' | .claude/hooks/impact-reminder.sh
```

**Editing `settings.json` requires a session restart.** Skills, agents, and rules hot-reload.

## Permissions

`settings.json` allows the read-only and build commands, **asks** for anything that ships or mutates
remote state (deploys, `wrangler secret`, `gh pr merge`, force pushes, staging/production
migrations), and denies reads of `.dev.vars` and `.secrets/`. If a gate denies something, stop and
report — do not re-spell the command to get around it.
