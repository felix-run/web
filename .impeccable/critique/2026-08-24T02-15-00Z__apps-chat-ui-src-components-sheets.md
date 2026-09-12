---
target: the four slide-over sheets
total_score: 18
p0_count: 2
p1_count: 6
timestamp: 2026-08-24T02-15-00Z
slug: apps-chat-ui-src-components-sheets
---
# Critique: the sheets

Target: `agent-sheet.tsx` (280), `eval-sheet.tsx` (341), `jobs-sheet.tsx` (228),
`manifests-sheet.tsx` (371) — 1,220 lines reached from one ellipsis menu in the toolbar.
Driven live against the harness on `:8080` at 1700×907, dark.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 1 | "No runs recorded." is shown *while loading*; the agent sheet crashes rather than reports |
| 2 | Match System / Real World | 3 | Domain copy is accurate and specific; the descriptions genuinely explain the mechanism |
| 3 | User Control and Freedom | 1 | Four irreversible operations, zero confirmations, zero undo |
| 4 | Consistency and Standards | 1 | Raw `<select>`, the last raw Tailwind hue, three widths for four sheets, a third `rel()` |
| 5 | Error Prevention | 1 | Live traffic routing flips from a free-text field with no confirmation step |
| 6 | Recognition Rather Than Recall | 2 | You retype a version number from memory to move production traffic |
| 7 | Flexibility and Efficiency | 3 | Dense, keyboard-reachable, fast |
| 8 | Aesthetic and Minimalist Design | 3 | Restrained and consistent with the app; zero contrast failures measured |
| 9 | Error Recovery | 0 | 14 raw exception strings; `describeError` reaches no sheet; one sheet takes the app down |
| 10 | Help and Documentation | 3 | Good `SheetDescription`s; the cron field carries a real format hint |
| **Total** | | **18/40** | **Needs work** |

The sheets are the least-tended surface in the product, and it shows in a specific way: the
*visual* craft is fine (three of four sheets measured clean on contrast, spacing matches the
app, copy is better than average), while the *behaviour* is unfinished. Every improvement the
last seven PRs made to the transcript, the composer and the inspector — `describeError`,
`role="alert"`, section boundaries, the state palette, confirmations on irreversible actions —
stopped at the sheet boundary and was never carried across.

## Anti-Patterns Verdict

**Deterministic scan:** `detect.mjs` over all four files returns **0 findings**.

**LLM assessment:** no generated-looking tells. These are hand-built operator panels. The
problems are omissions, not slop.

**Measured craft**, 1700×907, dark, canvas-composited OKLCH (method validated at 7.59:1 for
`muted-foreground` on `background`):

- Jobs: **0** contrast failures. Eval: **0**. Manifests: **0** (the two apparent failures were
  disabled buttons, WCAG 1.4.3-exempt).
- Sheet widths: `max-w-md` (512px), `max-w-lg`, `max-w-xl` (576px) — three for four sheets.
- Target sizes below WCAG 2.5.8's 24×24: the shared close button at **16×16** (every sheet),
  and the canary weight slider at **373×16**.

## P0 — Opening the Agent spec sheet destroys the app

Reproduced twice from a clean reload:

```
TypeError: Cannot convert undefined or null to object
  at Object.entries (<anonymous>)
  at AgentSheet (agent-sheet.tsx:179)
```

`agent-sheet.tsx:179` runs `Object.entries(card.endpoints)`. `card` is guarded; `card.endpoints`
is not, and it does not exist. The harness serves a standard A2A card:

```json
{"name","description","url","version","capabilities":{"streaming":true,"mcp":true},"skills":[]}
```

`AgentCard` in `types.ts:313` declares ten fields. **Seven do not exist on the wire**
(`protocols`, `endpoints`, `auth`, `containers`, `queues`, `federation`, and `endpoints` is the
one that throws), and `capabilities` is declared `Array<{id}>` while the harness sends an object
`{streaming, mcp}` — so `.map` would throw next even if `endpoints` were fixed. Three fields are
real. TypeScript reports nothing, because the type is hand-mirrored and asserts what it likes;
`check-api-drift` reports nothing, because the route exists and the verb matches. This is exactly
the gap CLAUDE.md documents: *"it says nothing about payload shapes."*

Two things make it worse than one broken panel:

1. **The four sheets are mounted bare at app root** (`App.tsx:1352-1367`), siblings of the
   transcript. The inspector got per-section `SectionBoundary` wrapping in an earlier PR; the
   sheets never did. So the throw escapes to the root boundary and the entire application is
   replaced by "Felix hit an error it can't recover". The recovery copy is good and the
   transcript survives in `localStorage`, but the run in flight is gone from view and only a
   reload gets it back.
2. **The failure is inverted.** `getAgentCard()` has `.catch(() => {})` — a card fetch that
   *fails* is silently ignored, while a card fetch that *succeeds* crashes the app.

## P0 — Four irreversible operations, no confirmation, no undo

Across all four files: `grep -cE 'confirm\(' → 0`, and no undo affordance anywhere.

| Operation | Effect |
|---|---|
| `deleteJob` (`jobs-sheet.tsx:87`) | Deletes a scheduled job record |
| `activateManifestVersion` (`manifests-sheet.tsx:255`) | **Flips which manifest version serves live traffic** |
| `setManifestCanary` (`manifests-sheet.tsx:301`) | Starts a weighted rollout to a fraction of traffic |
| `clearManifestCanary` (`manifests-sheet.tsx:312`) | Ends a rollout in flight |

The activate control is the sharpest: a free-text `Input` with `placeholder="version number"`
sits beside a button that immediately re-points production traffic. A typo is a deploy. There is
validation that the value parses (`targetValid`), and nothing else. The trash button in the jobs
list is a 24×24 ghost icon whose only warning is `title="Delete this job"`.

The transcript's tool approvals were rebuilt around exactly this principle two PRs ago
(evidence before decision, deny not subordinate, synchronous in-flight guard). None of it
reached the sheets, where the consequences are larger and less reversible.

## P1 — `describeError` reaches none of these sheets

Fourteen call sites render `String((err as Error)?.message ?? err)` straight to the user:
eval 5, jobs 4, manifests 4, agent 1. `grep -c describeError → 0` in all four files. The
operator sees whatever the exception happened to carry — `agent-card: 500`, or a bare
`Failed to fetch` — while the rest of the app has translated those into offline / 401 / 409 /
429 / 5xx sentences since PR #47.

None of the four uses `role="alert"`, so a failure is silent to assistive technology. All four
render the error as `⚠ {error}` with a literal emoji where the app's vocabulary is
`CircleAlertIcon`.

## P1 — The jobs poll ignores tab visibility

`jobs-sheet.tsx:52` is a bare `setInterval(refresh, 4000)`. `usePoll` exists precisely to gate
polling on visibility and is used by `App.tsx` and `inspector.tsx`; this is the one poll in the
app that never learned. A backgrounded tab with the sheet open hits the harness every four
seconds indefinitely.

## P1 — "No runs recorded." is a lie during loading

```ts
setExpanded(jobName);
setRuns([]);                          // ← renders the empty state
setRuns(await listJobRuns(jobName));  // ← then the truth arrives
```

Expanding a job with real history shows "No runs recorded." until the request returns. There is
no separate loading state, so an empty result and a pending one are indistinguishable — the one
case where the answer matters most.

## P1 — The last raw Tailwind hue

`manifests-sheet.tsx:292`: `className="flex-1 accent-amber-500"`, measured as
`oklch(0.769 0.188 70.08)`. It is the only raw hue left in the application after the state
palette landed, and it is actively misleading: amber now means **blocked** in that vocabulary,
so the canary weight slider is painted the colour of "something is waiting on you".

## P1 — Two targets under WCAG 2.5.8

The shared `SheetContent` close button (`packages/ui/src/sheet.tsx:70`) is a bare 16px `XIcon`
with no padding — a **16×16** hit target on every sheet in the app. The canary slider is
**373×16**. Both need 24×24.

## P2 — Consistency drift

- `jobs-sheet.tsx:130` uses a raw `<select>` while the app has a shadcn `Select`. It renders at
  136×32 with OS-drawn options that ignore the app's theme entirely.
- Four sheets, three widths (`md`, `lg`, `xl`, `xl`), with no evident rule.
- `jobs-sheet.tsx:220` defines a third `rel()` relative-time helper (`thread-list.tsx:201` has
  the second), with its own output format.

## Recommended sequence

1. Fix `AgentCard` against the real payload, and wrap all four sheets in the existing boundary
   so a bad payload costs one panel rather than the app.
2. Put a confirmation on the four irreversible operations, reusing the approval pattern.
3. Route every sheet error through `describeError`, with `role="alert"` and `CircleAlertIcon`.
4. Move the jobs poll onto `usePoll`; add a real loading state for runs.
5. Retire `accent-amber-500`; fix the two undersized targets; adopt the `Select` primitive;
   settle on one or two sheet widths; collapse `rel()`.
