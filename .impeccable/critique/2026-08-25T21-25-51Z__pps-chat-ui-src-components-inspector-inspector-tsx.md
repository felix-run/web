---
target: inspector activity
total_score: 22
p0_count: 0
p1_count: 3
timestamp: 2026-08-25T21-25-51Z
slug: pps-chat-ui-src-components-inspector-inspector-tsx
---
# Design Critique — Inspector › Activity

**Target**: `apps/chat-ui/src/components/inspector/inspector.tsx` (lines 46–523: `ActivitySection`, `StatusDot`, `toolOf`, `summary`, `relTime`, and the `Section` / `SectionBody` shell it inherits)
**Register**: product · **Assessment A**: source review against PRODUCT.md · **Assessment B**: deterministic detector

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Header count pinned to the fetch cap, so it reads `60` forever; the polite live region derives from that same number and stops announcing after first load. `--state-running` exists and is unused here — an in-flight call looks identical to an unknown one. |
| 2 | Match System / Real World | 2 | Raw harness status strings rendered through CSS `capitalize` (`ok` → "Ok"). Subject line falls back to a lowercased event type ("model", "judge"). |
| 3 | User Control and Freedom | 2 | Collapse and "Try again" exist. No filter, no way past the 12-row cap, no exit from a `line-clamp-2` summary. |
| 4 | Consistency and Standards | 3 | The `Section`/`SectionBody` grammar is genuinely shared. Drift: the failure dot paints `bg-destructive` (line 481) while its label paints `text-state-failed`; `index.css:113` documents these as deliberately different values. |
| 5 | Error Prevention | 3 | Read-only surface. `SectionBoundary` wrapping the whole section rather than its children is right and documented. |
| 6 | Recognition Rather Than Recall | 2 | Help is a native `title` on 3 of 7 event types. No absolute timestamp, so log correlation is from memory. |
| 7 | Flexibility and Efficiency | 1 | No filter, no search, no keyboard path into a row, no way to raise the cap. `listAudit` already accepts `status` (`api.ts:174`) and Activity never passes it. |
| 8 | Aesthetic and Minimalist Design | 3 | Restrained and well-argued. Uniform row treatment leaves the eye nowhere to land. |
| 9 | Error Recovery | 3 | `describeError` + alert + "Try again" is solid. A failed row offers no recovery or detail path. |
| 10 | Help and Documentation | 1 | `EVENT_HELP` has 7 entries; 4 can never render. No legend for the status vocabulary or dot colors. |
| **Total** | | **22/40** | **Below the middle of the normal band — the shell is strong, the content layer is thin** |

## Anti-Patterns Verdict

**Does this look AI-generated? No.** The `EVENT_TONE` block (line 74) explicitly rejects the six-hues-for-six-categories reflex and argues the reduction to two states, with `tool_call` deliberately unbadged so exceptions still read as exceptions. That is a designer's decision with a stated cost. The rail is stacked disclosure with a written justification for not using tabs.

What limits it: the row is the generic feed row — badge, bold subject, muted two-line clamp, right-aligned status and time — applied identically to seven event types carrying very different information. Uninflected rather than generated.

**Deterministic scan**: `detect.mjs --json` on the target returned `[]` — zero findings, exit 0. No gradient text, side-stripe borders, eyebrow scaffolding, glassmorphism, or banned type scale. Every issue below is a judgment finding the detector cannot see.

**Visual overlays**: not available this run. The Python harness is listening on `:8080` (Docker) but no Vite dev server is up on `:5173`, and the shell commands needed to check `.dev.vars` and probe the harness were denied, so none was started. No user-visible overlay exists in a browser tab; every finding is read from source and the token file, not measured on screen. `index.css` shows `--muted-foreground` already measured at 5.27:1 on `--background`, so metadata contrast is very likely compliant, but that is unverified here.

## Overall Impression

The container is better designed than the contents. `Section`, `SectionBody`, `SectionBoundary`, and `Truncated` form a real system — loading, error, empty, retry, truncation-honesty, and a scoped error boundary handled once, correctly, with reasoning written down. Then `ActivitySection` fills that frame with a list that treats a guardrail block and a routine tool call as the same object.

Biggest opportunity: the 12-row cap can hide exactly the events the color system exists to highlight. `EVENT_TONE` spends its whole budget marking `guardrail_block` and `approval_request` as worth interrupting a scan for, and `rows = data.slice(0, 12)` (line 403) will silently drop them behind twelve routine tool calls. `Truncated` reports "Showing 12 of 60 recent events" and says nothing about what kind of events were left out.

## What's Working

1. **The `EVENT_TONE` reduction and its defending comment.** Two states instead of six hues, `tool_call` excluded so it cannot flatten the exceptions. PRODUCT.md principle 4 applied, including the discipline to spend less color than available.
2. **`SectionBody`'s live-region reasoning.** Only a short `status` string marked `aria-live`, not the repainting list, with the tradeoff written out. The implementation undercuts it (P1 #2) but the design is right.
3. **Status is never color-alone.** `StatusDot` renders the literal status text with the dot `aria-hidden` — PRODUCT.md's stated accessibility commitment met where it would be easiest to skip.

## Priority Issues

### [P1] The row for `guardrail_block` has no "why"

**What**: `summary()` (line 503) has arms for `judge_score`, `approval_request`, `approval_decision`, then falls through to `p.output_preview`. `guardrail_block`, `plan_step`, `model_switch` have no arm. A blocked call carries no `output_preview` — it never ran — so the row renders as tool name + amber "Guardrail" badge + status dot, reason omitted. `model_switch` renders subject "model", empty summary, a dot; which model it moved from and to never reaches the screen.

**Why it matters**: Inverts design principle 1, "the mechanism is the interface." The highest-signal event in the feed is the one the operator cannot act on without a database console — the failure mode the inspector exists to prevent. Also breaks principle 5.

**Fix**: Add `summary()` arms for the three unhandled types. `guardrail_block` → rule/policy name plus blocked tool. `model_switch` → `from → to`. `plan_step` → step label plus new status. Verify payload keys against the harness.

**Suggested command**: `/impeccable clarify apps/chat-ui/src/components/inspector/inspector.tsx`

### [P1] The header count and the screen-reader announcement are both the fetch cap

**What**: `listAudit({ limit: 60 })` (line 400) feeds both `meta={String(data.length)}` (409) and `status={...data.length} recent harness events}` (420). Once the harness has 60+ audit rows both are permanently `60`. `Truncated` then presents 60 as the total.

**Why it matters**: Three failures from one root. (a) The header meta is dead pixels — `Section`'s doc says meta should make expanding unnecessary, and a frozen constant makes it mandatory. (b) The `aria-live` status never changes after first load, so a screen-reader user is never told new events landed. (c) `Truncated` exists so "the list never lies by omission" and currently misreports a cap as a total.

**Fix**: Make the header meta a signal — count of failed/blocked events in the window with `metaTone="attention"` when non-zero, falling back to the newest event's age when clean. Request `limit: 61` and render `60+`, or relabel the footer "Showing 12 of the last 60". Derive the live-region string from something that moves.

**Suggested command**: `/impeccable harden apps/chat-ui/src/components/inspector/inspector.tsx`

### [P1] Twelve rows, no filter, no drill-down — and the API already supports the filter

**What**: 60 events fetched, 12 rendered, 48 unreachable by any interaction. No filter control, no "show more", rows not activatable, `summary()` output `line-clamp-2` (441) with no way to read the rest. `listAudit` takes a `status` parameter (`api.ts:174`) this section never passes.

**Why it matters**: Principle 2 is "rank before you render," and names undifferentiated density as "the house bug." The operator's job is "know what the agent just did"; the answer terminates in a clamped paragraph.

**Fix**: Failures-only toggle in the section header wired to the existing `status` parameter. Expandable rows in place (`Collapsible` is already imported) or route to the agent sheet. Raise or make the 12-row cap adjustable once the footer tells the truth.

**Suggested command**: `/impeccable layout apps/chat-ui/src/components/inspector/inspector.tsx`

### [P2] Status vocabulary is passed through raw, and `capitalize`d

**What**: `StatusDot` (line 470) classifies `ok|success|completed` good and `error|failed|denied` bad — proving it knows they are synonyms — then renders whichever raw string arrived, styled `capitalize`. `ok` displays as "Ok"; two rows meaning the same read as "Ok" and "Success". Anything outside both sets (`pending`, `running`) gets the gray unknown treatment, so an in-flight call is indistinguishable from an unrecognized one, and `--state-running` is defined and unused here.

**Why it matters**: Consistency and Standards, plus principle 5. "Ok" is a CSS artifact, not a word anyone chose. In an instrument panel *running* is the state the operator most wants to see.

**Fix**: Map raw status onto a display vocabulary — Succeeded / Failed / Denied / Running / Pending — with an explicit `running` branch painting `--state-running`; keep the raw string in a `title`. Drop `capitalize`.

**Suggested command**: `/impeccable clarify apps/chat-ui/src/components/inspector/inspector.tsx`

### [P2] Four of seven help strings can never render, and the three that can need a mouse

**What**: `EVENT_HELP` (line 65) defines explanations for all seven event types, read only at the badge's `title` (432), and the badge only renders when `EVENT_TONE[e.event_type]` exists — true for three types. Entries for `tool_call`, `judge_score`, `plan_step`, `model_switch` are unreachable. The three that render use a native `title`: no keyboard access, no touch access, delayed, unstyleable.

**Why it matters**: PRODUCT.md's second audience is the demo viewer who should read the screen without narration. Seven good explanations were written for exactly that reader and four ship as dead code. Also a keyboard-accessibility gap in a repo that treats those as defects.

**Fix**: Either surface the type on every row (quiet unbadged label for routine types, tonal badge for exceptions) so all seven strings have somewhere to live, or move help out of `title` into a real tooltip primitive with focus and touch support. Delete entries that genuinely have no place.

**Suggested command**: `/impeccable polish apps/chat-ui/src/components/inspector/inspector.tsx`

## Persona Red Flags

**Alex (impatient power user — the operator who wrote the harness)**: Wants failures only; no filter, though `listAudit` accepts one. Wants the 13th event; no path to it. Wants the full payload of a blocked call; gets two clamped lines. Wants to correlate a row with a harness log line; no absolute timestamp anywhere, only `relTime`'s rounded "3h". No keyboard path to a row — the `<li>` elements are not focusable, so tabbing skips the entire feed. Falls back to `docker logs`, PRODUCT.md's named definition of failure.

**Jordan (cold viewer, over someone's shoulder)**: A column of near-identical rows and a word like "Ok" or "model". No legend for green dot versus amber badge. The four help strings written for this person never render. Cannot tell a guardrail block is more serious than a tool call — same object, same volume, amber badge reading as decoration without a key. Can tell this is a control surface for something autonomous; cannot tell whether it is healthy.

**Priya (project-specific: the unattended operator returning to a tab)** — from "Do not assume attention": `usePoll` skipped every tick while hidden, so on return the panel refetches correctly via the `visibilitychange` handler, but every `relTime` in the pre-refresh frame was frozen. More seriously, the collapsed Activity header never carries `metaTone="attention"`, unlike Approvals — so if she collapsed Activity, a burst of failures during the unwatched run leaves the header reading exactly as it did when everything was fine. A signal that only exists inside an expanded section does not survive an unwatched tab.

## Minor Observations

- **Dot/label color drift** (line 481): failure dot uses `bg-destructive`, its label `text-state-failed`. `index.css:112` documents these as deliberately different values. Dot should be `bg-state-failed`.
- **Skeleton shape mismatch**: two `h-8` skeletons stand in for variable-height rows with a 2-line clamp, so first paint jumps.
- **No absolute time**: `title={new Date(ms).toISOString()}` on the `relTime` span costs one line and closes Alex's log-correlation gap.
- **`relTime` under 60s returns "now"** for every row, so during a burst a dozen rows carry identical timestamps; sequence is conveyed only by list order. A seconds tier would cost nothing.
- **`toolOf`'s last resort** returns a lowercased event type rather than the literal "event" — an improvement, but "model" and "judge" as subject lines still do little work. Largely absorbed by P1 #1.

## Questions to Consider

- The `EVENT_TONE` comment argues exceptions must stay visually rare. If that is right, why is the list ordered strictly by time rather than pinning unresolved exceptions to the top? Rarity is only useful if the rare thing is on screen.
- `Section`'s `meta` is documented as "the thing that should make expanding unnecessary most of the time." What is the one number that would make expanding Activity unnecessary? Almost certainly not "how many events exist."
- Approvals opens itself when a run is blocked. Should Activity do anything at all when a `guardrail_block` lands, or is the deliberate answer no?
- What would this panel look like if designed for the operator who has already decided something went wrong, rather than the one browsing?
