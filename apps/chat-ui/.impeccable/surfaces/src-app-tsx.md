---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/components/inspector/inspector.tsx","src/components/chat/thread-list.tsx","src/components/chat/workspace-strip.tsx","src/components/eval/eval-sheet.tsx","src/components/jobs/jobs-sheet.tsx","src/components/manifests/manifests-sheet.tsx","src/components/agent/agent-sheet.tsx"]
---

# Surface brief — the chat-ui shell as a daily cowork surface

## Scope and mode

The application shell: header, attention line, the three working zones, and the second
top-level address. Governs `src/App.tsx`, the inspector, the thread rail, the workspace
strip, and the four sheets. Does **not** govern the transcript's internals, the engine,
or the `/api` proxy contract.

Visitor mode: **Operate**.

## Audience and job

One operator, daily, in three postures the shell serves without becoming three apps:
triage (what needs me, what landed overnight), session (a long steered run against a
mounted folder), launch-and-leave (start a durable run or a job, close the tab).

The demo-viewer audience is retired for this surface — density, learned affordances, and
labels that assume the operator configured the harness are permitted. PRODUCT.md §Users
was amended for this on 2026-09-12: the demo-viewer audience is dropped, and principle 5
became *Legible on return* — readable by someone who knows the system and has lost the
thread of this run, which is the bar a daily surface actually has to clear.

Success: opening the tab cold answers "is anything waiting on me, what ran while I was
gone, which folder am I pointed at" before any navigation. Failure: the attention line
becomes wallpaper.

## Chosen direction — The Workbench

Surface concept round, mode Operate, seed key `f02e0077`, dealt 3/4/7 with 3 leading;
locked from the lead. Code-led: no image generation was available, so each card carried a
drawn schematic. Alternates were The Day Ledger and The Run Board.

The mounted folder is the subject; the thread is how you talk to it. Three resident zones
under one full-width attention line — refusing the current arrangement of a thread rail, a
transcript, and an eight-section accordion holding everything the harness knows, with four
workbenches behind an unlabelled ellipsis.

- **Attention line**, full width under the header. Always rendered, never conditional;
  empty it says so. Collapsed, one row of counts in the existing state ramp. Expanded, the
  triage queue.
- **Left ~18rem — the workspace.** Mount label, tree, files this session's writes touched.
  Threads become a popover off the workspace header, not a peer rail: pick a folder, then a
  thread within it.
- **Centre — transcript at reading width, composer anchored.** Approval and `ui_request`
  banners keep their place directly above the composer.
- **Right `clamp(22rem,24vw,30rem)` — the run instrument, scoped to the live run.** Tabs,
  not a stacked accordion: one section on screen, one poll.

The inspector's eight sections divide by **lifetime**, not topic — this-run material to the
right rail, blocking material to the line and the banner, tenant-durable material to a
second address. That second address is what ROADMAP.md's open question was asking for: the
four sheets were not hard to find, they had no home.

**Memorable moment:** the attention line reporting when nothing is wrong. A line that only
appears in trouble teaches the operator not to look at it.

## Constraints

Binding, and read off the wire rather than assumed:

1. **An approval row carries no `thread_id`.** `ApprovalRequest` has tenant, manifest, tool,
   rule and deadline. Resolved for now as tenant-wide copy: an approval arriving by *frame*
   knows its thread and is lifted into the banner, attributed; one arriving by *poll* stays
   in the line, unattributed. They dedupe on approval id via `syncApprovals`' `seen` set.
   The line's phrase `across the harness` is load-bearing and must not be edited out — it is
   what stops the count reading as "on the thread you are looking at". Reversible: when the
   harness sends `thread_id`, the line gains a thread column and drops the phrase. Worth an
   upstream issue.
2. **`/audit`, `/usage`, `/plans` and `/approvals` are none of them thread-scoped**
   (`/audit` filters status and event_type, `/usage` manifest_id, `/plans` limit only). A
   rail headed "this run" must be built from what the stream already carries — tool cards
   from `on_tool_start`/`on_tool_end`, per-turn usage from `on_chain_end` — or be labelled
   as the tenant feed. Never both.
3. **Workspace→thread association is a purely local fact.** The harness does not record
   which manifest a thread used, let alone which folder; it lives in `localStorage`
   (`src/lib/threads.ts`), is invisible to another browser, and is lost when storage clears.
   The popover degrades to a flat thread list.
4. **A restored mount needs a user gesture.** `restoreMount()` can return
   `needs-permission`, and boot may not ask, so the workspace zone's first state on many
   mornings is "reconnect <name>", not a tree.
5. **The attention line's approvals poll must not gate on `visibilityState`.** `usePoll`
   skips hidden ticks, which is correct for panels and wrong here. The line is the
   in-viewport half of a pair whose other half is `presence.ts`.
6. WCAG 2.2 AA as PRODUCT.md already binds it, including the rails' keyboard reachability.

## Routing

**react-router v7, declarative** (`<BrowserRouter>`, no data APIs), literal version in this
package — single-use, so not the catalog.

```
/                    Workbench, fresh thread
/t/:threadSuffix     Workbench, that thread
/harness             -> /harness/memory
/harness/{memory|corpus|skills|manifests|jobs|eval|agent|audit|usage}
```

- **The engine lives in the root layout route, above the `<Outlet/>`** — with the header,
  the attention line, the `/approvals` poll and `presence.ts`. Mounting `createChatEngine`
  inside `/t/:suffix` unmounts it on a visit to Harness and kills a live run.
- The URL carries `threadSuffix` only, never `{tenant}:{suffix}`.
- The four sheets re-parent into a `/harness` layout route with a left nav of the nine
  destinations; `SheetBoundary` becomes the route error boundary.
- No Worker change: `not_found_handling` is already `single-page-application`, and no new
  fetch call sites means `check-api-drift` is untouched.
- A linkable thread makes a 409 lease conflict a first-class route state, not a toast.
- `tests/app-stream.test.tsx` needs a `MemoryRouter` wrapper; it is the only existing test
  the router touches.
- Below the rail breakpoints nothing changes: workspace and instrument stay Sheets, Harness
  is nav-list -> panel -> back.

## Anti-goals

A kanban of runs. A notification centre. Any state that exists only while the tab is
visible. A fifth sheet. Onboarding chrome.

## Resolved since

- **`/harness/audit` and `/harness/usage` are one "Ledger"** (decided 2026-09-12). One nav
  destination holding both halves as a segmented pair, not a merged feed — an audit event and a
  usage row are different shapes and reading them interleaved answers no question either one does.
  Segmented rather than stacked so **one panel polls at a time**, which is the same economy the
  terminal's tab strip already buys; two stacked panels would cost two polls for a surface where
  only one is being read. That brings the nav to **eight** destinations, not nine.

## Direction contract

**THESIS.** The mounted folder is the subject; the thread is how you talk to it. Refuses the
chat-app arrangement this surface currently is — a conversation list beside a transcript, with
everything the harness knows folded into one rail and four workbenches behind an ellipsis.

**OWN-WORLD.** Flat neutral surfaces separated by rules, not stacked bordered cards. The four-state
ramp (`blocked` / `done` / `running` / `failed`) is the only colour; nothing decorative is tinted.
One header grammar everywhere: icon, title, one at-a-glance meta value, and the meta is the thing
that makes opening the panel unnecessary. Tabular numerals on every count.

**STORY.** The operator learns what is waiting before navigating anywhere, sees which folder the
agent is pointed at, and decides whether to let a run continue. They believe the mechanism is on
display rather than summarised. They approve, steer, or close the tab knowing what it will do
without them.

**FIRST VIEWPORT.** Attention line full width under the header, stating rest or a count. Left
~18rem workspace: mount label, tree, files this session touched; threads a popover off its header.
Centre transcript at reading width, composer anchored bottom — the primary action — with approval
and `ui_request` banners directly above it. Right `clamp(22rem,24vw,30rem)` run instrument, tabbed
to one section.

**FORM.** The Workbench: lead of three dealt 3/4/7, locked from the lead over The Day Ledger and
The Run Board. Seed key `f02e0077`.

**FINISH.** unreviewed and undocumented is unfinished; this build ends with the finish review, the
verdict, DESIGN.md, and every shipping raster carrying its provenance.

### Discharged so far

The contract covers the whole direction, not one PR. Shipped: the attention line (#158), the second
address and the lifetime split (#157), and the routing the two depend on (#156). Outstanding: the
left workspace zone, threads as a popover, and the right rail as tabs rather than an accordion —
and the FINISH line itself, which no PR has discharged. **There is no DESIGN.md in this repo yet**,
so that clause is a real debt and not a formality: the palette and header grammar above are
recorded here and nowhere a later agent would look first.

- **Which zone yields first below 1280px: the instrument** (decided 2026-09-12, by building it).
  Three zones want 18rem + a ~560px reading column + 22rem — 1200px of content before any chrome,
  so 1280 is where all three fit. Below it the instrument becomes a drawer; below 1024 the
  workspace follows and the transcript takes the width. The instrument goes first because it is
  reference material about the run, and the half of it that cannot wait — an approval, a
  `ui_request` — is already in the attention line and the banner above the composer, neither of
  which lives in a rail. The workspace yields last of the two because it is the subject.
- **The right rail keeps its tabs** (decided 2026-09-12). Three sections fit a 22rem strip where
  eight did not, so the question was whether tabs still earn their place — and they do, for the
  reason that survived the cut: one section on screen is one poll rather than one per expanded
  section. The strip carries **no counts**, because populating them would mean every section
  fetching for a label nobody is reading, which is the cost tabs exist to avoid. The count that
  matters is in the attention line, always and tenant-wide, which is also why the inspector's old
  "approvals always polls while the panel is open" exception could be retired: #158 took that job.

## Unresolved

*Nothing outstanding.* The durable-run gap that stood here — a run's tool calls never reaching the
transcript live — is closed: the engine settles a stream that ended without `final` (#165), the
harness tails the session log between status frames (felix-run/felix#238), and the engine folds
those `session_event` frames on the durable path (#167). Verified end to end on 2026-09-12 once a
thread-id collision was ruled out.

## Amendment 2026-10-02 — the app sidebar

The operator asked for a TypingMind-shaped sidebar built on shadcn's Sidebar, and chose a
**single app sidebar** (Shape round, 2026-10-02) over an icon rail with a switching panel, and
over keeping the workspace zone with a primitive swapped in. This reverses two decisions above:
"threads become a popover off the workspace header", and the workspace as the left zone. The
reason is the one the popover made unavoidable: it was the only way to reach another thread at any
width, which put the most frequent navigation in this app two clicks deep.

- **One sidebar on both addresses**, owned by the shell, holding New chat, then Threads (Pinned,
  then by last activity), then Workspace, then Harness. `/harness` drops its resident nav while
  the sidebar is inline.
- **Structure only from the references.** The references supplied collapse-to-icons, grouped
  menus and the mobile sheet. Colour, type and density stay this document's: a zinc field, colour
  only for state, and no avatar, no tinted brand surface, no folders.
- **The folder is still the subject, but it is no longer the door.** The workspace section sits
  below the threads and folds. Where it sits relative to Threads was left open at confirmation;
  it went below them because the thread list is what is opened most often.
- `Mod+\` and `Mod+K` are unchanged. The references' `Mod+B` was not taken (see `lib/shortcuts.ts`).

## Direction contract — Warm Workbench (redesign, 2026-10-10)

Supersedes the visual world (OWN-WORLD, palette, type) of the Workbench contract above. The
zones, their breakpoints and yield order, and every pinned behaviour stand. Kept by the
operator: the cat-prompt mark, and colour meaning run state. Webfonts are allowed now.

**THESIS.** A tool the operator wants to open every day: warm, soft, plainly worded, with the
harness's real states never hidden. It replaces the stock shadcn zinc look (flat hierarchy,
system font, no identity) without hiding the mechanism.

**OWN-WORLD.** Light by default: a warm stone ground (never cream) with white surfaces one
step up. Dark is a warm charcoal. Large soft radii on what you touch (composer, cards,
approvals, thread tiles). An engineered grotesk (Geist, replacing Onest the same day) carries prose and UI,
and a mono (JetBrains Mono) marks harness quotations. The four-hue ramp is the only hue. "You can act here" is a warm-ink pill,
never a fifth colour. Separation comes from tone and one confident scale step, not hairline
boxes.

**STORY.** The operator opens it cold and sees, in plain words, what is waiting and what ran.
They read the conversation at a comfortable size, see every call as a soft card titled in
plain language over the raw call, and decide approvals on the largest object on screen.

**FIRST VIEWPORT.** Left 17rem sidebar on the stone ground: brand row, New chat as an ink pill,
thread tiles (rounded, with the current tile on white), then workspace and harness. Centre
transcript on white at reading measure, with the composer as a large white rounded card
anchored at the bottom, the primary action. Right: the instrument as soft tabs.

**FORM.** Warm consumer app surface (user steer, round 2, adopted over the roll). Raises:
nothing disappears, it cancels (ticket wallet); hierarchy by scale step, not boxes (type
specimen); a waiting approval owns attention (vertical feed). Seed key `7726f8dc`.

**FINISH.** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

Staging: PR 1 is foundation + shell (tokens, fonts, primitives, header, sidebar). PR 2 is the
transcript and composer. PR 3 is the instrument and the /harness pages. One branch per stage,
never stacked.
