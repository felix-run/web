# Roadmap

Known, unaddressed work. Everything here has been **seen** — either measured in a running app or
read in the code, with the evidence recorded next to it. Nothing on this list is a guess about what
might be wrong.

Two rules keep it honest:

- **Cite the evidence.** A finding without a file, a line, or a measurement is a hunch, and hunches
  belong in an issue, not here.
- **Say what has not been checked.** The [Unverified](#unverified) section exists because "we did
  not look" and "we looked and it was fine" are different states, and conflating them is how a gap
  survives three reviews.

Items are removed when they ship, not when they are planned.

## Origin

The chat-ui sheets — jobs, eval, manifests, agent spec — were critiqued twice (`.impeccable/critique/`),
scoring 18/40 then 24/40. Four PRs closed the correctness, consistency, accessibility and
recognition findings: #48, #49, #51, #52. What follows is what those passes found and did not fix.

Four more closed in #139: the wire-key labels, the explanation on a disabled button that could never
fire, the badge that drew a failing run quieter than a passing one, and the canary that reported
itself absent while offering to clear itself.

The last entry from those passes — four workbenches reachable only from an unlabelled ellipsis —
shipped in #157 and has been removed. It was the one item here that was a *question* rather than a
defect, and the answer was that the sheets were standing in for a missing home: they are `/harness`
destinations now, alongside the tenant-durable half of the inspector.

---

## Cross-cutting

### Two harness routes nothing calls, both held back on purpose, and one duplicate

`pnpm check-api-drift` prints the advisory list; most of it is machine-facing (`/health`,
`/metrics`, `/mcp`, `/a2a`, `/v1/chat/completions`, and so on) and belongs there. `GET /usage/summary`
came off this list in #169 — the Ledger totalled a page of rows and called it the total, which the
route exists to fix.

- `PUT /plans/{}` — editing a plan. chat-ui reads plans and cannot change one.
- `POST /chat/sessions/custom` — no client writes one.

**`POST /eval/runs` is not one of them, and this entry said it was.** It has no caller, but the
feature is built: `/harness/eval` starts runs from `Run vs {manifest}`
(`components/eval/eval-sheet.tsx`), through `runEvalDataset`. That posts to
`POST /eval/datasets/{name}/run`, a second harness route whose own docstring reads *"Alias for
chat-ui"* and which differs only in taking the dataset name from the path rather than the body.

That is the failure mode of a list built from call sites: **it cannot tell a missing feature from a
redundant route.** Acting on it here would have added a second button for something the panel
already does. Whether the duplication should exist at all is a harness question, raised as
`felix-run/felix#247`.

**Both were read at the harness on 2026-09-25 (#178). Neither has an alias, and neither is worth a
button yet.**

- **Plan editing waits on the harness.** Nothing puts a plan into the prompt; the agent sees an
  edit only if it chooses to call `plan_get` (`felix/patterns/plan_tools.py`). `put_plan` replaces
  the whole row with no version check while `plan_update_step` does a read-modify-write, so an
  operator's save mid-run and the agent's step update erase each other, last one wins. And it
  overwrites `manifest_id` and `expires_at` on every call, so a client that sends only the plan
  orphans it from its manifest and exempts it from retention. The fix is a precondition on the
  write, which is harness work.
- **A custom-entry writer waits on a product decision.** With `in_context: true` the entry enters
  the model's context under whatever role the caller picks: `system` is a standing instruction
  stronger than steer, and `assistant` is a turn the model will believe it said. That is a lever,
  not a form field.

The **read** side of custom entries was a bug regardless and is fixed: the SDK's `append_custom`
writes them, and `eventsToTurns` used to fold them in by role — a `user` entry drew as a message
the person sent, even one the model never saw, and a `system` entry vanished, even one steering the
model. They are `note` turns now, named by role and by whether the model read them.

### `MemoryRecord.embedding_json` stays unmodelled, on purpose

`pnpm check-payload-shapes` reports it as a field the harness sends that nothing models. That is
expected rather than an omission, and it is recorded here so the advisory line does not read as work
nobody got to: the column is documented in the harness as **deprecated and never populated**,
superseded by the pgvector `embedding` column, and slated for removal once its backfill has run
everywhere. Modelling it would be modelling a `null` with a deletion date.

The other five — `updated_at`, `thread_id`, `tenant_id`, `embedding_dim`, `embedding_model` — were
modelled on 2026-09-11, and the embedding pair is rendered: a memory row says `lexical only` when no
embedder ran for it, which is the answer to "why did recall miss this". `UsageEvent` gained
`wire_model_id` and `cost_usd` in the same pass.

**Size:** nothing to do until the harness drops the column, at which point this entry goes too.

---

## Terminal client

### The keyboard is layers in all but name — and the case for adopting them has gone

**The prize is claimed; the dependency is not worth taking for what is left.**

Two of the three reasons this entry gave are spent. The precedence chain moved to
`apps/tui/src/keys.ts` as a pure `route(key, state) -> Action | null` (#133, #134), so the layers
exist in all but name, and the invariant that lived in a comment is a typed `Overlay` union plus
tests. And `/help` is generated now: `BINDINGS` in `keys.ts` describes every key grouped by the
surface that owns it, `commands.ts` renders it, and `tests/keys.test.ts` asserts every
`Action['kind']` is spoken for — with `ACTION_KINDS` typed so a kind added without a binding fails
to compile, naming the missing one.

What is left is replacing a tested pure function with a third-party resolver. That buys `enabled`
predicates this already expresses as an early return, and costs a dependency that pins
`@opentui/core` exactly — `@opentui/keymap@0.5.10` does match the pinned `0.5.10`, so the version
objection has gone too, but it means the renderer and the keymap can never move apart.

It still would not solve either thing the original note got right: no focus-traversal API, and no
way to express the picker's catch-all "every printable character is filter text".

So this is recorded as **decided against** rather than removed, because the next person will have
the same idea. Reopen it if the keyboard grows a case the pure chain cannot express — a fourth
overlay, or a binding that has to be rebound at runtime.

### Every code frame carries one empty row, and the obvious fix is wrong

`apps/tui/src/ui/transcript.tsx:61-65` documents it: `CodeRenderable` measures itself one line
taller than its content, which is invisible unframed and an obvious gap inside a border.

Pinning the box height *does* close it and is a regression — the buffer wraps, so a long line in a
narrow terminal needs more rows than it has lines, and a pinned height silently drops everything
past the fold. A two-line block rendered as one. That was tried, measured, and reverted.

Recorded so the next person does not re-attempt it. A real fix needs the wrapped line count, which
is not known until after layout, or a change upstream.

**Size:** small if upstream fixes the measurement; otherwise not worth it.

---

## Unverified

**Narrow viewports were measured on 2026-09-25, and the entry that stood here was wrong about
what it described.** It said the sheets were `w-full` below `sm` and so full-bleed by
construction. By then the four sheets were `/harness` pages, and the only sheets left — the
workspace and run-instrument drawers — carry fixed `w-[18rem]` / `w-[22rem]` with the primitive's
cap lifted. At 320px the instrument hung 32px off the left edge. Capped with `max-w-full`, pinned
in `tests/workbench-layout.test.tsx`. The eight `/harness` pages show no horizontal overflow at 320
or 390px — but only in their error states, since `/api/*` was stubbed; a long table with real rows
has not been seen at phone width.

The tooling limit that kept this open is specific to moving an OS window: a Playwright context
created with a `viewport` of the target width does move `innerWidth` and engage the breakpoints.
Stub `/api/**` in the page (`page.route`) and nothing reaches the harness.

**Both approval unknowns were closed on 2026-09-11** and are recorded here only so the next person
does not re-measure them. The screening gate (`apply_command_screening` → `_await_approval`, a
`decision: require_approval` command rule) fires ~1s after `tool_start` like the rule gate does, and
names itself differently: `rule_id` is the synthetic `command:<reason>` and `reason` repeats it
verbatim, which is why `approvalRuleLabel` exists. A durable run surfaced its approval **9.1s** after
`POST /chat` returned `202` — nearly all of it the worker reaching the gated call, since the row is
visible the moment it is written and a client polling every 2.5s adds at most that. The durable path
has no frame at all: side events are an in-process queue keyed by thread id, and the agent is in the
worker while the stream is served by the API.

---

## Environmental, not code

**The drift check cannot see the harness that is actually running.** `pnpm check-api-drift` diffs
the client against `harness-openapi.json`, a committed snapshot — so a snapshot *ahead of* the
deployed harness looks identical to one in sync with it, and every call the client makes to a route
the deployment does not have passes.

The instance that prompted this is resolved: the container on `:8080` was behind, `POST
/manifests/{name}/rollback` returned 404, and **Activate could not succeed locally** independent of
any client change. Rebuilt on 2026-09-11 at `c9bb10f` — rollback answers `200`, and the live
`/openapi.json` and the snapshot both carry 74 paths.

The gap it exposed is still open, and is why this stays: nothing in the pipeline compares the
snapshot to a deployment. Worth considering whether the drift check should take a live
`/openapi.json` as an optional second target, run against a dev harness rather than in CI — which
has none to point at.
