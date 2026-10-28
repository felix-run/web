# chat-ui

Guidance for `apps/chat-ui`, split out of the root `CLAUDE.md` (which still holds the proxy
contract, the wire protocol and the run flows). Paths are relative to `apps/chat-ui` unless they
name a package.

## The shell

**The shell is a layout route, and that is load-bearing.** `src/App.tsx` is now the route table
alone (react-router v7, declarative — a literal version in `apps/chat-ui`, single-use, so not the
catalog), mounted by `main.tsx` under a `createBrowserRouter` with one splat route rather than
`BrowserRouter`: still no loaders or actions (the skill editor's `useBlocker` guard that
needed it went when the editor moved into the side pane, whose store keeps the edit across
navigation). TanStack Query is the skill library's alone and loads with it:
`components/skills/query-root.tsx` creates one client lazily and each lazy skills entry point
wraps itself in it, unless a host (a test) already provided one; everything older polls through
`usePoll`; `src/app-shell.tsx` is the layout route that owns the engine, the thread, the `/approvals`
poll and `presence.ts`, and renders the matched route into an `<Outlet/>`. Everything below that
seam reads `src/shell-context.ts`. The engine is *above* the `<Outlet/>` on purpose: a run is alive
for as long as the tab is, so mounting `createChatEngine` inside a route would unmount it — and kill
a live run — on a visit to any other address.

**A run also outlives a change of thread** (2026-10-07). There is one engine *per thread*, not one
for the tab: `src/lib/engine-pool.ts` holds them, and each engine's `threadId` port is bound to
its own thread for life. Until then the one engine read "the thread on screen" at call time, so
`selectThread` and `newThread` called `stopRun` first — clicking another conversation posted
`/chat/abort` on the one that was working — and simply not stopping would have been worse: its
tool results and approvals would have gone to whichever thread was showing, and hanging up the
stream instead tears the run down on the harness. Now leaving a thread leaves its engine running
in the pool — reading its stream, answering `tool_request` for *its* thread, writing its own
`felix.turns:` cache — and coming back re-adopts that engine as it stands (no reset, no snapshot
rebuild; only labels and ratings are re-read). An engine with nothing in flight is dropped once its
thread is off screen, and a background run's engine once it settles, so the next visit rebuilds
from cache and snapshot exactly as before. Rules that are easy to break: a running thread keeps
its **exclusive lease** through the pool's own `attach` until the run ends (the shell's lease
effect detaches on the switch as before); the approvals poll and the liveness check run over
**every** live engine, and presence counts them all, so a background run still reads *working* —
or *blocked* — in the title; a background run's approval or question stays on its own engine and
never reaches the foreground banner. Its approval still shows in the attention line through the
tenant-wide `/approvals` row. A **question** never appears in `/approvals`, so the pool reports
open questions per thread and the shell passes the other threads' ones to the attention line as
`elsewhereQuestions`. The line then goes amber, says *on another thread* (never *on this
thread*) and links **Answer it** to that thread. A background engine adopts only `/approvals`
rows that **name its thread** (`syncApprovals({ attributedOnly: true })`); an unattributed row
stays the foreground's alone, or every live engine would hold a card for it. The gap **before**
a run starts counts too: an image upload or a regenerate's history reset can take seconds, and
switching threads then used to prune the engine the message was about to run on and release its
lease. `holdThread` pins both until the send is under way, and `streamInto` runs on the pool's
engine for the thread the message was written on, marking *that* thread sent rather than the one
on screen. A send that fails after its thread was left goes back into **that thread's** queue,
paused, not into the composer on screen. Returning to a live run keeps its own start time in
the run clock. **Stop** still stops, and **deleting** a thread aborts a run on it wherever it
is. The shell context exposes `runningThreads` (foreground included) and `blockedThreads`; the
sidebar groups the first under *Running* and folds the second into its *Waiting on you* group beside
the `/approvals` rows, since a background run's question appears nowhere else; collapsed, the
Threads icon's dot says the more urgent of the two. New chat is never
disabled by a run, because starting a thread no longer stops one.
`tests/run-survives-thread-switch.test.tsx` pins it at the wire.

**The address is the thread.** `/` mints a thread and *replaces* itself with `/t/:threadSuffix`, so
a thread is linkable the moment it exists and a reload resumes it; the URL carries the suffix alone,
never `{tenant}:{suffix}`. A thread change now has three ways to happen — the rail, Back/Forward and
a pasted link — which `loadThread` collapses into one idempotent path. Two traps came out of that,
and `tests/routing.test.tsx` pins the property both protect. `turns` **lags** a thread change driven
from outside the app's own handlers, so the persistence effect runs once with the new thread's id
and the previous thread's transcript still in hand: writing it there files one conversation under
another's key, and the load that follows reads it straight back. And the engine's render-time seed
used to come from a `felix.threadId` key — right while that key chose the thread, wrong once the URL
did, and the reason a fresh `/` inherited the previous thread's transcript on the first real page
load after the router went in. That key is no longer written at all. `StrictMode` is what surfaced
it: React re-runs a mount effect with the *first* render's closure, so the shell persists from
current engine state rather than from the captured value.

****Tabs come from `@felix/ui/tabs`, never hand-rolled.** Four strips carried
`role="tablist"`/`role="tab"`/`aria-selected` with no `tabpanel`, no `aria-controls` and no
arrow-key roving focus — which announces a widget and then does not behave like one, and is worse
than plain buttons. The run instrument uses the primitive now; `tests/workbench-layout.test.tsx`
asserts the association both ways rather than the roles. An inactive `TabsContent` renders its
element for the association and **not its children**, which is what keeps one section on screen to
one poll — `forceMount` would silently undo that and mount all three.

The Memory and Documents strips are deliberately *not* tabs. They switch the input above a list all
their modes share, so there is no panel per mode to point at; they are `role="group"` with
`aria-pressed` buttons, which promises only what they are.

**The shell is three zones, and they yield in a fixed order.** On the left, the **app sidebar**
(`src/components/app-sidebar.tsx`, 17rem, or 3.25rem collapsed to icons) belongs to the *shell*, not to
a route, so it is the same on `/t` and `/harness`. In the middle, `src/routes/workbench.tsx` renders
the transcript at reading width with the composer anchored. On the right is the run instrument
(`clamp(22rem,24vw,30rem)`). The three want 1200px of content before any chrome, so **1280** is
where they all fit. Below that the **instrument** becomes a drawer, and below **1024** the sidebar
becomes one too. The instrument goes first because it is reference material, and the half of it that
cannot wait is already in the attention line and the banner above the composer — neither of which
lives in a rail. The sidebar goes last because it holds every way to anywhere else.

**Everyday is the daily surface, and most of the above is harness view's** (2026-10-16). The View
setting is a three-step ladder, `ShellValue.view` (`felix.view`: `everyday` | `harness` | `debug`),
with `harnessView` (either level above everyday) and `debug` (the top one) derived from it. It was
one Debug switch until then, which hid half the product behind a word promising only diagnostics;
`felix.debug` and Verbose's `felix.verbose` migrate on to `debug`, so nobody loses what they had.
It is a ladder rather than two switches because debug's main piece is a tab inside the instrument.
Set from the menu's View radios on both addresses, `/view` (cycles), `/debug` (`/verbose` is an
alias in `slash-commands.tsx`) or the header badge; `/debug` and the badge go back to the level
debug was entered from. Everyday, the shell renders **no instrument** — `useRails({ enabled })`
reads it closed and refuses to open it, keeping the stored preference for when harness view
returns, and the `Mod+'` handler checks `harnessViewRef` — **one harness page** in the sidebar,
*Activity* with its failure glance (`useActivityGlance`), since it answers "what happened while I
was away" (2026-10-12), plus a *Skill drafts* row from `useDraftGlance` while drafts wait — the same
rows on `/harness` (2026-10-12: listing all nine there read as the mechanism leaking into the daily
surface), and the 768–1024 rail and the phone index list the same — no agent id or canary in the
header, no context meter below 90% full, and no tokens under turns. Approvals, questions, the
attention line, the run-state chip and failed/denied tool cards are never harness view's. **Debug
adds only the plumbing**: the header's *Debug* badge, the event ids under turns (`TurnDebugLine`'s
`ids`) and tool cards, tool I/O open with every plan call unfolded (`verbose`), the harness's
wording on a workspace note, and the instrument's fourth tab,
**Debug** (`components/inspector/debug-section.tsx`): `ShellValue.inspectClient()` reads the
pool (`EnginePool.entries()`), each engine's `inspect()` — a read-only copy of the resume token,
durable status, cursor and liveness proof the engine already keeps, never a new piece of state —
and the lease keeper, once a second while the tab is open; `/usage?thread_id=` is its one
request. **Tests that pin the instrument or the harness nav seed `felix.view` = `'debug'`** after
`localStorage.clear()`; `tests/debug-mode.test.tsx` pins each level and the migration.

**The sidebar runs full height, and its top row is the brand.** The header and the attention line
live in the `SidebarInset` beside it, so the sidebar's first row sits on the header's line — same
height, same safe-area inset, same rule — and carries the mark and wordmark. The mark is the
sidebar's **toggle** (`BrandToggle` in `src/components/brand-mark.tsx`, named *Sidebar*,
`aria-pressed`); there is no panel button in the header from 1024 and no slot held empty for one,
so the brand cannot move between addresses. Below 1024 the sidebar has no edge on screen, so the
brand and its toggle stand at the start of the header instead, and the drawer heads itself with the
same row (its mark named *Close sidebar*). Collapsed to the 52px rail the wordmark is at opacity 0
(fading over the narrowing's last 75ms), because its first glyph starts at x=50 and the rail's edge
left a 2px sliver of it; opacity rather than `invisible`, so it stays in the accessibility tree.
**The wordmark is the page's one `h1`** — in the sidebar
inline, in the header narrow, and a span in the drawer, which opens over a header already holding
one; `tests/harness-route.test.tsx` and `tests/workbench-layout.test.tsx` pin that there is exactly
one. New chat is in the header only where the sidebar is a drawer.

**The header names the thread on `/t`** (`src/components/thread-title.tsx`, 2026-10-10). Until
then the sheet never said which conversation it held: identity was the sidebar's highlighted row
alone, so collapsed or below 1024 nothing on screen told two "Use write_file to create notes.txt…"
threads apart before an approval. After the run-state chip (which keeps its first slot, so it does
not move between addresses) comes the title, from `threadLabel` over the same merged index the
sidebar lists, and the agent the newest turn ran under in mono. The title is an **`h2`**, never a
second `h1`, and is cut from the **middle** by CSS rather than by a character count — the head
truncates, the last ten characters never do — so it follows the header as it narrows; below `sm`
it is one end-cut, and under 23rem it goes `sr-only`. **A title already ending in `…` or `...`
is end-cut at every width**: the harness's preview truncation supplies that ellipsis, so the
kept tail was a fragment of a word ("for writi…") and told nothing apart. Clicking it renames in place through the
shell's `renameThread`, the sidebar's own action; not while the tab is **watching**, and not
before the thread is in the index (nothing to name yet). `/harness` shows none. **The title gives
way before the attention line**: the left cluster carries a shrink weight far above the line's,
down to a `sm:min-w-52` floor, so the line keeps its sentence. Below `sm` the wordmark goes
`sr-only` on `/t` for the title's room, and **the line gives way first**: at rest ("No
approvals", "Working", "Checking") it is its dot alone, the sentence still its live region, its
`title` and its name; only "N waiting" and "Unreachable" keep words there. With both drawn at
390px the title read "Create a …". `tests/thread-title.test.tsx` pins it.

**The sidebar is the one door to every other conversation** (2026-10-02). From top to bottom it holds
New chat; the **Needs-you band** (below); the threads, grouped as Pinned, Today, Yesterday, Previous 7 days
and Older (Older opens by default while the groups above it hold fewer than eight rows and folds
otherwise, the operator's choice remembered in `felix.sidebar.olderOpen`; it is cut by month when
open, and folded still draws the current thread if it is there — never the other fifty — in a group
named for it, its count reading *1 of N shown*); the Workspace row (`WorkspaceRow` in `src/components/workspace/workspace-section.tsx`);
and the harness destinations with their glances, grouped by the question each answers
(*What happened*, *What it knows*, *How it's set up*, `GROUPS`). It replaced three earlier things: a threads
popover off the workspace header, which had been the *only* way to switch threads; the workspace
zone; and `/harness`'s resident nav rail, which is drawn now only between 768 and 1024, where the
sidebar is a drawer, in the sidebar's row style on the ground. Inline, the sidebar lists the
destinations in debug (its Harness group does not fold on `/harness`, so a remembered fold cannot
strand a page) and Activity and Skill drafts with debug off, on every address. On `/harness` the tab's thread is drawn *held* in the
list (`heldId`: a hairline outline, never the current row's fill, *This tab*, no `aria-current`) and
the header's title slot is `ThreadReturn`, a link back to it drawn as a place (a chat glyph, no
arrow, beside pages that carry their own back arrow); below `sm` the narrow index leads with
`ThreadBack`, an arrowed row. A break here is not a degraded rail — it is a thread list nobody can open — so
`tests/workbench-layout.test.tsx` pins every collapsed icon as well as the list.

**The Needs-you band** (2026-10-24, `components/needs-you-band.tsx`, rows from `needsYouRows` in
`lib/needs-you.ts`) sits above the threads and lists what is live or ran unattended and asks
something of the operator: threads **waiting** on an approval (the tenant `/approvals` poll, by
`thread_id`) or a question (`askingThreads`, from the engine pool — `/approvals` never lists a
question), approvals naming no thread as one row that opens the attention line's queue; scheduled
jobs **failing** (`failing`, the Jobs glance's reading, once per job, disabled ones left out, each
linking `/harness/jobs?job=<name>`, which opens that job's runs and scrolls it into view once per
link); and
runs **going** in this tab. A conversation's failed or denied turn is *not* in it — it stays a mark
on the row; the band is for what nobody watched. So the list no longer has *Waiting on you* or
*Running* groups: a thread in the band keeps a plain row where recency put it, marked in words only in
search results. Three rows, then *N more* in place; clear it reads *none* and stays (nothing below
moves), and over an `/approvals` read that failed it keeps its rows and says *as of 3m ago* — never
*none* over a list nobody refreshed. It reads the Jobs poll on its shared key, which now runs
everyday too (30s), and the sidebar's Jobs row drops its `N failing` glance (the band lists those
jobs; `unchecked` stays). Collapsed, it is one icon (`NeedsYouIcon`) with the most urgent dot and a
spoken summary, which used to be a dot on Threads — and *checking* / *not refreshed* rather than
*nothing* over an approvals list that has not answered; clicking it expands onto the band's first row.
`tests/needs-you.test.ts` pins the rows, `tests/workbench-layout.test.tsx` the band's states. Pins live in
`felix.pinnedThreads` and are local, because the harness records which threads exist, not which
ones an operator keeps near. `removeThread` drops a deleted thread's pin. The primitive is
`@felix/ui/sidebar`, which is shadcn's Sidebar **adapted**: its state is controlled by `use-rails`
(`historyOpen` means expanded when inline, and the drawer below 1024); it sits in the page flow under
the header rather than fixed to the viewport; and there is no `Mod+B`, because Ctrl+B opens a Firefox
sidebar. The binding is `Mod+\`, and `Mod+K` lands in the thread search. Both work on `/harness`
too.

**The sidebar has two scroll regions, one above the other, and does not scroll as a whole**
(2026-10-08). The thread list scrolls its own rows under a heading and search that do not scroll;
the harness's pages and the workspace are one region below it (`data-slot="sidebar-lower"`), one
order everywhere: Harness, whose rows scroll on their own (`sidebar-lower-scroll`, `scroll-fade-b`),
then the Workspace row outside that scroll, so a scrolled region still shows it and the fade never
covers it; and the expanded `SidebarContent` is `overflow-y-hidden`. Before the list scrolled at all, an opened Older pushed the
workspace and the harness's pages fifty rows down. Then the list scrolled but the sidebar did too,
and on production a mounted folder's file tree — itself a third scroller — put three scrollbars
side by side, left the list eight rows and pushed the harness's pages off the bottom. The file
trees no longer scroll on their own for the same reason: they sit inside the lower region's scroll.
**The lower region sizes to its content, capped at 35svh, in harness view** (2026-10-16). It was a
fixed `h-[clamp(40svh,32.5rem,60svh)]` — 520px of a 997px window, which left the thread list four
rows and scrolled the Workspace row out of sight — and fixed for a reason that still binds: a
region sized to rows that change *with the address* grows upward on arrival and moves the row just
clicked. So the rows no longer change with the address. Each run of destinations folds on its own
(`felix.sidebar.harnessGroups`), *How it's set up* folded by default (`GROUP_FOLDED_BY_DEFAULT`)
and a remembered choice winning; the run holding the page on screen is always open, its toggle
disabled; and arriving on a page in a folded run unfolds it **for the rest of the visit** (state,
never storage), so leaving the page never folds rows back up under the pointer. The operator's own
folds are covered by `min-h-[min(35svh,26.25rem)]`, the default layout's height, so folding the
whole group leaves the rows where they were. **The two regions share the height by what they hold**
(2026-10-24): the 35svh cap scrolled the region by 11px at 997px tall beside ~250px of empty list.
Both start at their content (the list is `flex-auto`); when they do not fit, the lower region gives
way first (`shrink-[100]!`) down to its reservation, then the list down to its floor
(`min-h-[min(16rem,30svh)]`). A short list leaves the region whole; a long one keeps its rows while
the region scrolls under its fade. Everyday reserves 7.5rem for the harness rows alone (Activity, and
Skill drafts while drafts wait), so drafts coming and going move nothing — a fixed `13rem` left
~117px empty for an agent with no workspace. `tests/workbench-layout.test.tsx` pins the shape and the
default fold, `tests/harness-route.test.tsx` the current page's run and the everyday rows' missing run
labels (one row needs no second label).
**A thread row says *Failed* or *Denied*, and the call** (2026-10-16; denials and the call
2026-10-24) when its newest turn broke or had a call denied at an approval — unless it is waiting
or running, which the band says. Denied is muted with no dot (a decision, not a fault).
`threadOutcomes` → `rowOutcomes` (`lib/harness-glances.ts`) reads it off the audit read the Activity
glance already polls (`useRecentAudit`, one shared key), so the list asks nothing per row; a thread
outside that read is unmarked, which means unknown, not OK — so the Threads heading says how far
back the marks reach (*marks · last 7d*, `glanceWindow`'s span). **A title another row carries adds
the end of the id** (`thread-id-tail`, outside the line's truncation): the harness titles by a cut
preview of the first message, which already ends in `…`, so no cut of the title can tell two apart;
38 of 85 rows on the reference harness shared one.
**The workspace is one row, and its trees are the side pane's Files tab** (2026-10-12). Even
folded, a mounted repository's tree held ~880px above the harness's pages when open, and the file
it opened appeared on the far side of the screen. The row says what is mounted (or *on the
harness*), carries Reconnect beside it — never inside it — and opens Files; it is not drawn for an
agent whose `felix.workspace.tools` is `none` (`useWorkspaceTools`, `src/lib/workspace-tools.ts`;
absent means a harness older than the key, and keeps the browser's folder). The mount itself is
one store for both surfaces (`src/lib/mount-state.ts`). The list is **one Tab stop** (roving `tabIndex`, Older's toggle one place it can rest
(`OLDER_STOP`) rather than a second stop; arrows and Home/End over the rows and the toggle, → to a
row's ⋯ and ← back,
Shift+F10 or a right click for the menu, Delete with the toast's undo); Delete lives in the menu,
not as a one-click icon beside it. **A thread with a run going or something waiting asks before it
is deleted** — inline, *Stop and delete* / *Keep* — because the abort is immediate and Undo restores
the transcript, never the run. Undo also puts a pin back (`removeThread` drops it), the toast names
the thread, a delete the harness refuses is said (`deleteThreadHistory(id, { reportFailure: true })`,
which every other caller leaves best-effort), and deleting the thread on screen goes back to the one
the tab showed before it rather than to the newest. Group labels stick while their rows scroll under
them. Message search asks for 12 hits and says when it got that many, offering 50. **A message-search hit on a listed thread is a result**, drawn
with the matched words (`matchExcerpt`) as its second line: the merged list holds every thread the
harness returned, so the first version, which kept only hits on threads it did *not* list, showed
none and said "No matches". A failed message search says so rather than reading as an empty one.

The instrument is **tabs**, not the old accordion: one section on screen is one poll. The strip
carries no counts, because populating them would mean every section fetching for a label nobody is
reading — and the count that matters is in the attention line, tenant-wide. That is also why the
inspector's old "approvals always polls while the panel is open" exception is gone: the attention
line took that job. **And so is the Approvals tab.** It drew a second live `ApprovalDecision` for
every row the attention line was already offering — two Approve buttons and two countdowns a second
apart for one call — so the instrument is Changes, Plans and Tools, and decides nothing.
**Changes is first and open by default** (2026-10-06): it is derived from the transcript, so opening
the rail asks the harness for nothing until another tab is chosen. It moved there from the
sidebar's workspace section, now the pane's Files tab, which keeps *where* tools work — the mount,
the thread's repository, the files — while the instrument holds what this thread's calls did. The tabs no longer sit under a
"Harness" heading, since Changes reads no harness route; each tab's first line says its scope.
`tests/inspector-run.test.tsx` pins that it neither renders a decision nor asks `/approvals`.
**The panel is headed "This thread"** (2026-10-10), as is its drawer's dialog name. It was "This
run", which its own readout (tokens summed over the thread) and Tools (every thread's last 60
minutes, since `/audit/metrics` takes no thread filter) contradicted. The wider tab says so in its
**name** — *Tools · all threads*, the scope muted (`SECTIONS[].scope`) — and not only on its first
line, which was a click away under a heading that said otherwise (2026-10-16). The header's toggle and its shortcut (`shortcuts.ts`) say *This thread* too. A partial token sum reads `at least …` on the figure, not `Tokens (floor)`:
"floor" is the Activity page's word for unpriced cost. **The instrument starts closed over a thread
with no turns**, even from 1600px: `useRails({ emptyThread })` derives the unchosen default each
render (null pref, never written), so it opens once the thread has a turn and a stored choice
still wins; `useRails` is called below the engine's state in `app-shell.tsx` for that reason.
`tests/use-rails.test.tsx` pins it.

**The Changes tab is a workspace tool's path argument, and nothing else.** `ThreadChanges`
(`components/workspace/changes-list.tsx`) derives it from `Turn.tools[]` through `collectChanges` (`src/lib/changes.ts`), which is gated by
`collectTouchedPaths` in `@felix/cowork-client`: `path` for the harness's five workspace tools and
the client's five `local_*` file tools, `cwd` for `local_shell`, `target` for `local_open`, by an
allowlist of names. **The two file-tool families are one set by `fileToolOp`** (`@felix/client`,
`src/local-files.ts`): `write_file` and `local_write` are both `write`, and every place that cares
what a call did to a file — this list, the approval diff, the failure badge — asks it rather than
matching a name. `runLocalFileTool` there answers the `local_*` family over a `LocalFs` each client
supplies (the mount or the tab VFS; the terminal's cwd, behind `resolveWithin` and its write prompt),
so the browser and the terminal give the model the same answers. It used to run
`collectToolCallPaths` — the mention heuristic, which walks *every* string — and so listed the files
a `github__create_pull_request` body mentioned as files the agent had touched. That walker still
exists for what it was written for, resolving a prose mention; a shell command's text no longer
counts, because what a command touched is not something its text can say.
**A row's stat claims only what the call proves.** An `edit_file` is `+N −M` from the line counts of
`old_string` and `new_string` (times `replacements` when the result reports it) — the size of the
replacement, not a line diff of the file. A `write_file` is `+N written` and never a minus: once a
write has landed nothing holds the file's before-state — `PendingApproval.before` is read at decision
time and gone after — so a diff would be drawn against an invented empty file. A call
`classifyToolResult` marks as failed or refused changed nothing: it reads `failed`/`refused` and
counts towards no stat. During a durable run it fills as the run works: the harness tails the session log onto the
stream as `session_event` frames (`felix-run/felix#238`) — each assistant message with its tool
calls, and each tool result, as it lands — and the engine folds them into the in-flight turn.
Whole messages only, never deltas. Re-measured against `cowork` on 2026-10-01: a `calculator`
card appeared ~3s into the run, while the turn still read `Background · running`, and the answer
~2s later. (Before #238 the stream carried `run_accepted` → `run_status` → `final` and nothing
else, and calls appeared only on reload — the claim this paragraph used to make.) The section
says so rather than vanishing — *Changes appear when
the run finishes.* while `durableRunInFlight` (streaming, with the engine's `runStatus` status turn
last) holds and the run has reported no call. The same gap hides the tool *cards* from the
transcript, which is the bigger half of it.

**Everyday reaches the same list through a line under each reply** (2026-10-27,
`components/chat/reply-changes-line.tsx`). Everyday renders no instrument, so its Changes tab was
out of reach there. `changesByReply` (`lib/changes.ts`) takes each reply — every turn between one
operator message and the next — and keys it by its last assistant turn, so the line is drawn
once, under the reply's last turn, never under the tool call. It counts files a write, edit,
delete or rename **landed** on (`countChangedFiles`: a rename once, under its new name; a denial
none), and is not drawn while that reply is still streaming. *Review* opens a `kind: 'changes'`
pane item (`from`..`to`, by position like the rows), **one per thread**: `openInPane` re-scopes it
rather than adding a tab per reply — the one item whose key does not fix its content. The pane
draws `ReplyChanges`, the instrument's list over that slice, headed by the message it answered.
`TurnRow` takes the count as numbers (`changedFiles`, `replyFrom`) and a stable `reviewChanges`,
so a reply whose count did not move keeps its memo. `tests/reply-changes.test.tsx`.

**A message can become a job without the harness pages** (2026-10-27). *Repeat on a schedule*
on an operator turn's actions opens `components/jobs/repeat-job-dialog.tsx` (lazy, from
`routes/workbench.tsx`, only under a router — it navigates on success), which is the Jobs page's
own `JobCreateForm` (`components/jobs/job-create-form.tsx`, pulled out of `jobs-sheet.tsx` so the
two cannot drift) with the message as the prompt, the thread's agent and a slug name, and
`agentOnly` (no workflow switch). It reads the job list on the Needs-you band's `JOBS_POLL_KEY`,
so it costs no request of its own; that band is also where a failing job reaches Everyday, which
is why no Jobs row was added to the sidebar. **The dialog's description is load-bearing**: a job
runs on `job:<name>` (or a fresh thread each run), never the conversation it came from, and a
prompt like "do the same again" means nothing there. `tests/repeat-job.test.tsx` pins the request.

`/harness` is the second address, and the split is by lifetime.** The inspector's eight sections
divided into the three that describe the run on screen — approvals, plans, tool metrics, which stayed
in the right rail (approvals have since moved to the attention line alone) — and the five that outlive every run: memory, corpus, skills, and what the harness
did and what it cost. Those five are `/harness` pages now (`src/components/harness/`), joined by the
four workbenches that used to be slide-over sheets behind the header's ellipsis. Those were never
hard to find; they had no home, which is what an ellipsis menu means. `Section` grew a chrome mode
(`PanelModeProvider`) so a section is a disclosure row in the inspector and a page under `/harness`
**without being edited**, and the shared pieces both surfaces draw from live in
`src/components/inspector/primitives.tsx`.

Nine destinations, declared once as `HARNESS_DESTINATIONS` — the nav and the route table are built
from that one list, because a nav entry with no route is a dead link and a route with no nav entry is
a page nobody can reach, and both fail silently. **The list is light and the pages are not**:
`routes/harness.tsx` holds the destinations, the nav, its glances and the layout, because the app
sidebar imports them on every load; the nine pages are `routes/harness-pages.tsx`, loaded on the
first visit through one `lazy()` behind a `Suspense` around the layout's `<Outlet/>`. The glances'
shared constants (`JOBS_POLL_KEY`, `failing`, `AUDIT_POLL_KEY`, `recentFailures`, …) live in
`lib/harness-glances.ts` for the same reason — importing `failing` from `jobs-sheet.tsx` was enough
to put the whole Jobs workbench in the entry. The run instrument (`Inspector`) is lazy in
`routes/workbench.tsx` too, with a same-width placeholder so the transcript does not reflow.
**Measure the first load, not the entry file**: Rolldown moves shared modules into chunks the entry
imports statically, so this split took `index-*.js` from 652 to 508 kB while what a first load
actually fetches (the entry plus its static imports, ~1.7 MB raw) fell only ~23 kB gzipped. Audit and usage are **one** destination, Activity, a ledger with one entry per thread
(see **Usage** below). `SheetBoundary` became
`PanelBoundary` and wraps each destination individually — a panel throws during its *own* render, so
one boundary around the group would take the other seven down with it. Wide, the nav is a resident
rail; narrow there is no room for both, so `/harness` *is* the list and only redirects to
`/harness/activity` on a wide viewport — redirecting on a phone would mean the list could never be
seen.

**The shell must never treat a non-thread address as a thread.** `/t/:threadSuffix` is the truth when
it matches, `/` mints one and redirects (`NewThread` in `App.tsx`), and **every other address keeps
the thread the tab was already on**. Redirecting whenever the URL carried no thread was
indistinguishable from correct while `/` was the only such address; the moment `/harness` existed it
bounced the operator to a freshly minted thread, and minting one resets the engine, so a run in
flight died on the way out. *Across a reload* the tab has no "already", so a cold load on `/harness`
used to mint, and the way back to the conversation led to an empty thread. `src/lib/tab-thread.ts` keeps the
tab's last thread in **`sessionStorage`** (`felix.tabThread`) and the shell reads it only where the
address names no thread **and is not `/`** — without that second condition `/` renders once on the
remembered thread, and takes its lease, before `NewThread` replaces it. It is not the old
`felix.threadId` key coming back: that was `localStorage`, shared by every tab, and chose the thread;
this is one tab's, and never outranks an address. `tests/harness-route.test.tsx` pins it, along with every destination
rendering — the first version of that layout threw on mount for all eight because a `||` between two
`useMatch` calls made the second a conditional hook.

`apps/chat-ui/src/api.ts` supplies the browser's half of the arrangement and keeps the **write**
surface (eval datasets, manifest versions and canaries, scheduled jobs, the A2A card). That split is
not only taste: each of those areas goes through its own `evalFetch`/`manifestFetch`/`jobsFetch`
helper, and `check-api-drift` skips those helper *definitions* with a regex spelled for chat-ui's
`/api` prefix — rewritten harness-relative they are extracted as the phantom paths `/eval{}`,
`/manifests{}` and `/jobs{}` and fail against routes that are fine. `src/types.ts` re-exports both
packages and declares what is left.

**Two reads on the way in are answered once.** The gate checks the credential with
`GET /v1/models` and keeps the answer (`primeManifestEntries` in `api.ts`); the shell's first
`listManifestEntries` takes it, once and within 10s, rather than asking for the agent list a moment
later. And the canary check reuses the tenant's manifest rows for five minutes (`CANARY_ROWS_MS`):
a thread change asks only which side serves the thread (`getResolvedManifest`), where it used to
re-read the whole list, three times by the first new chat. The shell exposes the re-read that
leaving the Manifests page asks for as `refreshCanary`, **stable**: that page calls it from an
effect's cleanup, and as an inline closure it was new on every shell render, so the cleanup
re-checked the canary on every render while the page was open. `tests/startup-reads.test.tsx`.

## Unattended runs

A background run (`POST /chat` → `202 + resume_token`) has no stream to carry an approval frame, so
`src/lib/presence.ts` and the `/approvals` poll in `src/app-shell.tsx` exist to make an unwatched
tab honest: the poll surfaces an approval the durable run cannot deliver, and presence puts *working* /
*blocked* / *idle* into `document.title` plus an OS notification when the tab is hidden. Permission
is requested inside the background-run click, never on load.

**The attention line is the in-viewport half of that pair.** `src/components/attention-line.tsx`
is a pill in the header, before the instrument toggle and the menu, on **both** addresses, always — it says so when nothing is
waiting, because a line that only appears in trouble teaches the operator not to look at it, and
then it is not a signal but a surprise. It reads an always-on `/approvals` poll
(`src/hooks/use-pending-approvals.ts`), owned by the shell so the thread list's *Waiting on you*
row marker reads the same rows, and deliberately **not** through `usePoll`: that hook skips ticks
while the tab is hidden, which is right for a reference panel and exactly wrong here, since a hidden
tab is the case this exists for. **Both polls, and every live engine, read the list through
`readPendingApprovals`** (`src/lib/pending-approvals-read.ts`), which shares a read still in
flight — never a finished one, because a refresh after a refused decision wants the list as it is
now — so N engines' ticks, the load and a return to the page cost one request, not N+1. A
decision calls `forgetPendingApprovalsRead`. The shell's other approvals poll (`syncApprovals`) is gated on
`streaming`, i.e. on someone already watching — **but it is not the only way the engine adopts.**
It also runs on every thread change and whenever this poll lists a row for the open thread the
engine does not hold. Until it did, the line and everything else disagreed: title, favicon, header
chip, readout and banner read the engine's queue, which adopted only on mount and while streaming,
so the line's own *Open thread to review* landed on a thread with no banner, an Idle readout and
a plain title while the line said the call was waiting there. The engine also drops a list that
resolves after the thread changed (it was filtered for the thread that asked), and marks `seen`
only after that check, on a private copy merged back: marking the shared set as each list resolved
let the thread being left mark a row just before the thread being entered filtered against it, and
on a cold `/` — which mints a thread and moves — neither adopted it. `tests/blocked-route.test.tsx` pins the route end to end.

**It never says the all-clear on a list it could not refresh.** The hook keeps the last list on a
failed tick and reports `error` and `lastOkAt`; the line says *Checking approvals…* before the first
answer and keeps the last known count after a failed one. **Why it failed is the pill's to say only
when waiting will not cure it** (2026-10-16). A transient failure (429, 503/408, no answer) is a
source for the shell's harness-health line (below), which names the cause once for every read;
the pill drops its own cause words and says only that its list is not current, neutral and with
the age outside the live region: *2 calls were waiting on you across the harness* · *as of 3m
ago*, or *Approvals not refreshed* · *as of 3m ago* with none known, and *Checking approvals…* ·
*no answer yet* before any answer. It used to say *Approvals rate-limited* in red beside a second
line saying the same about the whole harness. A failure that is **not** transient (a 500) keeps
the old treatment: a **single** one straight after an answer reads *Rechecking approvals…* in
neutral, the hook counts `failures` in a row, and the second turns the pill red with *Can't reach
approvals* and *last answered …*. Its failures used to be swallowed, and it read "Nothing waiting
on you." with a green dot for as long as the harness answered the route with 429. The resting dot
is neutral, not `state-done`.

**A passing harness failure is one line in the shell, not a box per panel** (2026-10-16). Under a
live 429, `/harness/skills` drew six red boxes — each with its own raw `skill-library/review: 429`
and Try again — while the sidebar silently showed one thread of fifty. `src/lib/harness-health.ts`
is the store: `transientKind` names a **429** (`rate_limited`), a **503 or 408** (`unavailable`) and
`fetch`'s own network rejection (`unreachable` — not every `TypeError`, which is also what a client
bug throws); each reader reports under its own source id and withdraws it on an answer or an
unmount — `usePoll`, `useSharedPoll`, the always-on `/approvals` poll, the skill library's Query cache (`reportQueryHealth` in
`query-root.tsx`, reads only, observed queries only), the thread index, and `TransientRead` in
`inspector/primitives.tsx`, which `SectionBody`, `StaleNotice` and `ReadFailure` render for a
transient error in place of their red. `components/harness-health-line.tsx` draws it once, under
the header beside the attention line's queue slot, on both addresses: *The harness is shedding
load · showing what it said 2m ago · Retry* (or *nothing has loaded from it yet*), **neutral and
never red**, the raw text only in Debug; Retry re-runs every failing source. Panels keep their
last rows and say nothing louder than *Not loaded yet* when they have none. Red stays in the panel
for what waiting will not cure — any other 4xx, any other 5xx, a parse failure — and for a
*write*, which is the operator's own act and is answered where it was made. **A panel quieted
without reporting is the bug this exists to prevent**: render `TransientRead` (or one of the three
above), never a bare `null`, for a transient read error. The attention line is one indicator with
it, not a second: under a transient failure it says only that its count is not current (above).
`tests/harness-health.test.tsx` and `tests/attention-line.test.tsx` pin it.

It also counts **an agent's question** (`ask_user` → `ui_request`), which blocks the run as an
approval does but never appears in `/approvals`: the line said "Working. Nothing waiting on you."
under a `blocked` header while a live run waited on an answer. The engine's `uiPrompt` is passed in
as `question`, so the line goes amber and, off the workbench, links back with "Answer it"; a
question open on a run left going on another thread arrives as `elsewhereQuestions` and always
links to its own thread. The tab
title and notification say "Waiting on you" rather than "Approve" for the same reason, matched in
the TUI's `attention.ts`.

Two pieces of its copy are load-bearing. **"across the harness"** must not be edited out: a row
with no `thread_id` is unattributed, not "here", so the count stays tenant-wide unless every row is
provably this thread, and without the phrase it reads as "on the thread you are looking at". And the line **counts** an
approval the transcript banner already owns but does not re-offer it — an approval that reached the
banner came by frame, so the banner can draw the write's before/after diff, and a `/approvals` row
carries no `before` to build one from. Deciding from the line would mean deciding with strictly less
in front of you. The expanded queue opens under the header — the pill portals it into a slot the shell
renders there, so it pushes the page down rather than covering it — and is **one line per call** — tool, target, thread, a countdown —
and a line opens into `ApprovalDecision`, the same card the banner uses, rather than a smaller
decision surface: approving grants every byte-identical call until the deadline, and that
sentence has to be wherever the decision is made. One clock per call: the line's countdown hands
over to the card's chip when it opens. The queue is held to the transcript's measure (`max-w-3xl`),
because full-bleed its grant sentence ran ~580 characters to a line.

**A write from another thread is routed, not decided.** The same "strictly less" argument covers
any `write_file` whose `thread_id` names another thread: its banner, on that thread, can draw what
the write replaces and this line cannot, so its row offers **Open thread to review** and no
Approve (`NEEDS_ITS_THREAD`). An edit's arguments are the change and a command's are the whole of
it, so those stay decidable here; an *unattributed* write stays decidable too, because it has
nowhere to route to. And the queue opens itself only for a call on **this** thread — opening for
any new row put another thread's write between a fresh thread and the work it was opened for.
The dedupe has a second half: the banner lets go of an approval the instant it is decided, while
the line's list is up to a poll old, so for one tick the line used to open itself and offer
Approve on a call already answered. Every decision this tab makes — banner or line —
calls `markDecided` on the shell's poll first, which drops the row and keeps a lagging poll from
putting it back, for `DECIDED_GRACE_MS` or until the harness stops listing it; bounded because
`create_pending` can reuse an id for a genuinely new request.
`tests/attention-line.test.tsx` pins the hidden-tab poll, the phrase, the dedupe, the routing,
the this-thread-only auto-open and the one clock.

This was previously a second app (`apps/float`, removed 2026-08-23) that served the same operator at
lower density. What it actually contributed was the constraint above — assume no one is looking —
which is now a mode of chat-ui rather than a separate surface. See `PRODUCT.md`.

## Rendering

**A streaming reply is drawn once per frame, not once per delta** (`src/lib/frame-store.ts`).
The engine emits on every SSE frame, and the reader hands frames over one at a time, so a network
chunk of twenty deltas rendered the whole shell twenty times in one task, none of them painted. The
shell subscribes through `frameStoreFor(engine)`: a change that only grows text — a turn's
`content`, or the text of a reasoning block it already has — waits for the next animation frame (a
250ms timer while the page is hidden, which gets no frames); **anything else is drawn at once**,
including any change to the transcript's shape. That second half is load-bearing, not caution:
the Files tab opens on a write seen *while streaming*, and a thought is timed because it was
watched being written, so merging a `tool_end` or a new reasoning block into the end of the run
that followed it in the same chunk broke both (`tests/files-auto-open.test.tsx`,
`tests/app-stream.test.tsx`). Only what React draws lags; `engine.state` is exact for every
handler. The transcript cache follows the same rule from the other side: mid-stream the shell's
write is `scheduleSaveTurns` (`lib/threads.ts`, at most once per `TURNS_SAVE_MS`, read at write
time, flushed on `pagehide`, withdrawn by `saveTurns`/`clearTurns` for that thread and by
`forgetIdentityState`), because `JSON.stringify` of the whole thread per token cost more than
drawing it. The run's end writes at once. `tests/frame-store.test.ts`, `tests/turns-cache.test.ts`.

**A finished turn renders nothing while the next one streams.** Each turn is a memoised
`TurnRow` (`routes/workbench.tsx`) that takes only values steady through a stream — the shell's
verbs, the turn's own label, rating and branch — and builds `Message`'s closures itself; `Tool`
is memoised too, since a finished call keeps its object across the engine's patches. Two things
keep it holding: **pass a row nothing rebuilt per delta** (`regenerate` is, so only the turn it
acts on receives it), and **nothing under `Message` may read `useShell()` or
`useOptionalShell()`**, whose value is new on every render and would wake every row through the
memo — the code block's wrapper did, and every code block in the thread rendered each frame.
Read it with `useShellPick('field', …)` (or `useOptionalShellPick`), which re-renders only when a
picked field changes; `tests/shell-pick.test.tsx` fails on a whole-shell read in
`components/chat` or `components/ai-elements`.

**The same holds outside the transcript.** `ShellProvider` serves the value twice: as context
for `useShell()`, and as a store `useShellPick` subscribes to. `AppSidebar` and `Inspector` are
memoised pickers, because the sidebar — whose content no reply changes — was ~40% of render time
while one streamed. A pick holds only while the fields it names are stable, so a shell field
built inline is a regression even when it type-checks: `threadIndex` (now `threadIndexStatus`)
and `usePendingApprovals`' return were new objects per render, and the sidebar redrew every frame
until both were memoised. Find the culprit by measuring, not reading: one stale field looks
exactly like a pick that does not work. `lib/changes.ts` reads each call once
per call object (`factsOf`), relying on the same rule from the engine: a changed call is a new
object. `tests/finished-turns-memo.test.tsx` counts `interleaveTurn` per turn during a stream.

**Streamdown's rendered markup is an interface here.** Assistant messages go through it,
and the app has opinions about two parts of the result, styled two different ways for one
reason. Lists it *owns*: `components/chat/response.tsx` overrides `ul`/`ol`/`li`, because the
renderer's `list-style-position: inside` flattens nesting and wraps long lines under their own
markers, and because a component the type checker sees beats a selector aimed at someone
else's DOM. The code block's chrome it cannot own — taking over `pre` means giving up Shiki —
so those rules stay in `index.css` aimed at `[data-streamdown="code-block*"]`, and
`tests/response.test.tsx` reads those selectors back out of the stylesheet and asserts each
one still matches something rendered. That is the failure this repo keeps meeting: a rule that
compiles, matches nothing, and reports nothing. The dependency is pinned **exactly** in the
catalog for the same reason — a caret took it from 1.3 to 1.6 unannounced.

**KaTeX loads with the first reply that has math, and `rehype-raw` with the first that has raw
HTML, not with the app.** Streamdown imports both at the top of its bundle, which put ~75 kB and
(with parse5) ~53 kB gzipped in every first load. A build-only resolver in `vite.config.ts`
(`lazyReplyPlugins`) points those imports at a no-op (`src/lib/rehype-omitted.ts`);
`src/lib/reply-plugins.ts` is the one importer let through, and `Response` passes streamdown's
defaults minus whichever is not loaded until a reply needs it — `$$` for math (the same test
streamdown uses before loading KaTeX's CSS), a tag-like `<` for HTML (`needsRaw`, loose on purpose)
— keeping the order: raw before sanitize, sanitize and harden after KaTeX. Until `rehype-raw`
arrives, the reply's HTML reaches the sanitizer as `raw` nodes, which it drops: missing for a
moment, never unsanitized. The terminal that draws a shell call's output is a lazy chunk too
(`components/chat/tool-stream.tsx`), with its ANSI parser; until it loads the output is plain text
with the colour codes stripped. `pnpm check-bundle-budget` fails CI when the first load passes its
budget, because each of these arrived by one static import that changed nothing else anyone checks. The swap is a **remount** (`key`): streamdown's top-level `memo` compares
`children`, the theme, `mode` and `isAnimating` and nothing else, so a new `rehypePlugins` alone
never reaches the blocks and inline math stayed as `code.language-math`. `rehype-katex` and `katex`
are direct dependencies only so those imports resolve; keep them on the versions streamdown uses.
**Math did not render at all until 2026-10-03**, for two reasons that each looked like the other.
Streamdown's order runs `rehype-sanitize` *after* KaTeX, which stripped KaTeX's class names and
left a formula as MathML, TeX source and glyphs run together; KaTeX now runs straight after
sanitize instead — the model's HTML is sanitized as before, KaTeX's `trust` stays off so a formula
cannot carry a link or a class, and harden still runs last. And KaTeX's stylesheet was never loaded
in a production build: streamdown asks for it with a dynamic `import()` that the dev server
honours and the build never makes, so `loadMathPlugins` loads it with the plugin. Without the
stylesheet nothing hides the MathML, and every formula is followed by a plain-text copy.
`tests/response.test.tsx` pins the markup, the order, the sanitizing and the refused `\href`; the
stylesheet only by reading the source, because CSS imports are stubbed under Vitest. Shiki
is the same kind of fix, simpler: `ai-elements/code-block.tsx` imports it inside the highlighter
it already created asynchronously, rather than at the top of the module.

**A dependency can need one too.** `streamdown` — which renders every assistant message — styles
itself with Tailwind classes that live in its own `dist`, so `index.css` sources
`../node_modules/streamdown/dist` as well. The failure is partial and therefore easy to miss: a
class the app also uses elsewhere works, and one only the library emits does not, which is how
markdown lists lost their markers and code blocks lost their entire dark theme (the
`dark:text-(--shiki-dark)!` swap generated no rule, so tokens kept their *light* colours on a
near-black page). The block's own surface is ours: Shiki tries to pass its dark background as
`#fff;--shiki-dark-bg:#24292e`, a value React drops whole, so `index.css` defines
`--shiki-dark-bg` from a `--code-surface` token instead.

## AI Elements and the side pane


**AI Elements are vendored, not wired** (`apps/chat-ui/src/components/ai-elements/`, 48
components, 2026-10-03; `snippet` and `web-preview` were deleted unused on 2026-10-16, and the xyflow `canvas`, `connection`, `edge`, `node`, `panel` and `toolbar` on 2026-10-21 — the workflow canvas is its own, and uses `controls` alone). They are presentational shadcn components and **do not need the AI
SDK at runtime**: twelve import from `ai`, and only *types* (`UIMessage`, `ToolUIPart`, …), so
`ai` is a **dev** dependency pinned to `^6` — the version they are written against (v7 renamed
`LanguageModelUsage` fields). `tests/ai-elements.test.tsx` mocks `ai` with a module that throws,
so a component that starts importing it for real fails there. Using one with Felix means mapping
`Turn`/`ToolCall` into those shapes (e.g. `type` as `tool-<name>`, `state` as `'output-available'`),
not adopting `useChat`. `prompt-input.tsx` predates the rest and was **not** overwritten — it is
the ported composer, edited heavily since. Four things were changed on the way in: `message.tsx`
and `reasoning.tsx` drop Streamdown 2's `plugins` (this repo pins streamdown 1.6.11, where code,
math and mermaid are built in); `conversation.tsx` uses `appendChild` (the Worker types in scope
shadow DOM `append`); `jsx-preview.tsx` avoids ES2023's `toReversed`. `react-jsx-parser` ships
React 18's DOM types as a hard dependency, so `pnpm-workspace.yaml` **overrides** it to 19 —
without that a second `@types/react` broke JSX types in unrelated files. **`shadcn add` does not
work in this monorepo** for a registry like this one: it resolved `@felix/ui` to `packages/ui`,
installed every npm dependency there (plus a bogus `cn` package, the registry's import alias),
rewrote the catalog in `pnpm-workspace.yaml` stripping its comments, and hung. Install by reading
the registry JSON and writing files with imports rewritten, as this one was.

**Wired in (2026-10-03):** FileTree (below); **CodeBlock** and **Terminal** in the tool card —
JSON input/output highlighted with a copy control, a shell result's streams with ANSI colour;
**Plan**, drawn in the turn from the `deep` pattern's `plan_create`/`plan_update_step`/`plan_get`
calls, each of which returns the whole plan (`plansInTurn` in `@felix/client`; one card per plan where it
first appears, newest state, the later calls folded except in debug); a **version switcher** on
an edited message, from `branchPoints` in `@felix/client` (`MessageBranch` itself holds every
version client-side, so the selector is rebuilt from the same `ButtonGroup`); **Context**, the
meter's hover/focus breakdown, *without* its cost line — it prices from `tokenlens`, the harness
prices calls itself, and two prices for one call would disagree with the Activity page; and
**Checkpoint**, a restore point after a labelled turn. Two traps found on the way: `shiki` is
pinned to the 3.x line streamdown uses, or the bundle carries two; and `ansi-to-react` is
CommonJS whose default import Vite's dev bundle resolves to the module object — the app crashed
on opening any shell result while every test passed, so `terminal.tsx` unwraps it. StackTrace
stays unused: harness tool errors are `[tool error/<code>] message`, with no frames to parse. **Watch
the main chunk when wiring one in**: `context.tsx` imported `tokenlens` for its cost line and
`plan.tsx` rendered through the `motion`-based `Shimmer`, and between them the entry chunk grew
~290 KB for a price this app never shows and an animation the CSS `shimmer` utility already does.
Both are edited out (`tokenlens` is no longer a dependency), and the entry chunk ended smaller
than before. Compare `dist/assets/index-*.js` against main, not just the total.

**FileTree was the first wired in**, for the workspace's Files list, which was a flat column of
up to 200 paths (`buildTree` in `src/lib/file-tree.ts` reads both stores' `d <path>` / `f <path>`
entries — the old list printed those prefixes verbatim). Every other component either duplicates
something chat-ui already renders with Felix-specific behaviour — message, conversation, tool,
reasoning, attachments, confirmation (the approval card), context (the meter), model-selector
(the agent picker), suggestion (starters), queue (the queued-messages tray), test-results (the
eval run cards), speech-input — or has no Felix data to show (stack-trace, commit, package-info,
environment-variables). Adopting one of the first group means *replacing* a
component its tests pin, not filling a gap. `context.tsx` was edited too: its rows printed `$0.00`
with no model to price against, which reads as free rather than unpriced. `file-tree.tsx` was edited on the way in: folder icons
were `text-blue-500` (blue is `running` here), and each folder was three Tab stops — its wrapper,
an unlabelled chevron and a name button that did nothing without `onSelect` — so a folder is now
one stop, its name, which toggles it, and a file is a stop only when selecting does something.
A file opens in the **side pane** (below), read as **bytes**
through `readWorkspaceBytes` — `readExistingBytes`, with the same mount-first precedence as the
`readExisting` the approval diff uses, so the two never disagree about a file — and re-read when a
run settles. It reads bytes because `File.text()` turns an image into replacement characters:
`sniffMedia` (`src/lib/file-preview.ts`) recognises images, PDF, audio and video by **magic number,
never extension**, and the pane draws them through an object URL it revokes when the tab closes.
Markdown opens rendered through the lazy `SkillMarkdown` (no inline HTML, no remote images) with a
Source toggle. **HTML and SVG are only ever shown as source** — both can carry script, and rendering
either would run it in this origin. Anything else is decoded as text; a NUL in the first 8 KB is
binary, and over 200 KB shows the head; `languageFor` is a short extension table rather than Shiki's map, because a
language Shiki lacks makes `createHighlighter` reject and the code block does not catch it. (A
reply's code block asks Shiki itself, `useShikiKnows`, since its fence can name anything.)

**The side pane replaced that drawer** (2026-10-10, `components/pane/`, store `src/lib/side-pane.ts`).
Six things open in it, one tab each (`@felix/ui/tabs`, at most `PANE_LIMIT` = 6, the oldest
*clean* one dropped first): a workspace file (the file tree, a Changes row a write landed on, or
the agent's `local_open` — into the pane of the call's own thread, never a new window; a URL
still opens a tab — or its `open_file` for a harness-side file: the harness only checks the file
can be served, and the engine's `onOpenFile` fires once per call from a live `tool_end` or a
durable run's `tool_result` row, never from a snapshot rebuild or a replay, so a reload reopens
nothing; `tests/open-file-pane.test.tsx`), a
spilled tool output (`Open full output` in the tool card), a reply's code block (an Open control
`OpenablePre` adds to streamdown's header by wrapping the pass-through `pre`, so Shiki is kept),
a tool's image, a skill's editor (see **Skill library**), and a reply's changes (above). Opening goes through `ShellValue.openInPane`, which is **optional** — a test's
partial shell leaves every Open control out — and stays where it is: **the pane is drawn beside
every `/harness` page too** (`useHarnessPane` in `routes/harness.tsx`, through the shared
`PaneColumn`/`PaneOverlay` in `components/pane/pane-zone.tsx`), so a skill opened for editing from
its page sits beside that page. It is the tab's thread's pane, the same tabs and drafts, and there
the header toggle and `Mod+'` are the pane's even in debug (`/harness` has no instrument). It
used to send the operator back to the thread. Rules that are easy to break:
- **It takes the instrument's zone, never a fourth column.** From 1280 the shell reports the
  instrument closed while the pane holds the zone (`paneHoldsZone` in `app-shell.tsx`) and leaves
  `felix.inspectorOpen` alone, so closing the pane brings the instrument back as it stood; the
  instrument's toggle takes the zone back with the pane's tabs kept, closing the instrument hands
  it back, and `revealInspector` (a debug run's first tool call) never takes it from the pane.
  Below that the pane sits beside the transcript wherever the **row** fits 24rem + 22rem
  (`usePaneLayout`, measured, not a breakpoint — a collapsed sidebar buys the split back), and is a
  full-screen overlay with a Back control under that. The divider is a focusable ARIA splitter
  (arrows, Shift, Home/End, Enter or double-click resets); the share is `felix.pane.share`.
- **The store is a module, per thread, in `sessionStorage`** (`felix.pane:<thread>`), because an
  inactive tab renders no children: an edit held in the editor's state died on a tab switch, and
  the workbench unmounts on `/harness`. Drafts live there; `beforeunload` warns while any is unsaved.
- **A save is the operator's write** (`writeWorkspaceFile`, mount first): no approval. **The agent
  is told** (`ShellValue.tellAgentEdited` → `POST /chat/workspace/edited`, `felix-run/felix#577`):
  structured fields only, the harness writes the words; a live run reads it before its next model
  call without losing its tool batch (`workspace_note`, drawn as a note turn by `interjectNote` in
  the engine), an idle thread records it at once and the shell re-hydrates to show it. The save bar
  says which (`components/pane/edit-notice.ts`), and says plainly when the agent was *not* told:
  another tab drives the thread, the thread never ran, or a 404 from an older harness — after which
  it stops promising for the page. In the transcript the note is one line, *You edited `path` · the
  agent was told*, opening the file; the harness's wording is debug's. An edit records the text it started from (`base`); a
  re-read finding something else (`disk`) is a conflict that blocks Save until the operator takes
  the agent's version or keeps the edit, with the agent's write as a diff. Saving over a file the
  run in flight wrote (`landedPaths(turns, lastUser)`) asks first.
- **Content becomes a file only by the operator's hand.** A code block or a spilled output has
  *Save to the workspace* (`save-to-workspace.tsx`): the path is prefilled from the path a model
  writes on a block's first line (`// src/x.ts`, `# file: x.sh`) or `snippet.<ext>`, refused if
  absolute or containing `..`, and a path that already holds a file says so and asks again
  (Replace) — it never overwrites on the first press. The written file opens as a tab, and
  `WORKSPACE_WRITTEN` (`lib/workspace-events.ts`, not `lib/cowork`, which tests mock whole) makes
  the file tree re-read, since a save is not a run.
- **`Mod+'` is the right zone's binding.** In debug it is the instrument's, as before; off, there
  is no instrument, so it shows and hides the pane (tabs kept), as does a header *Side pane*
  toggle drawn only while something is open in it. The phone overlay is `data-shortcut-surface=
  "pane"` (`pane-drawer`), so the same key closes it.
- **A file lives in one of two workspaces, and saves back to the one it came from**
  (felix-run/felix#578). The browser's (the mount or the in-tab store) is where `local_*` tools
  work; the harness's (`/chat/workspace/{tree,file,write}`) is where `read_file`/`write_file` work,
  and an agent of that kind never reads the browser's — a pane save there reached it as a note
  about a file it could not find. A file item's `source: 'harness'` (key `harness:<path>`) reads
  through `workspaceRead`, keeps the hash, and saves through `workspaceWrite` with
  `expected_sha256`; a `409 workspace_changed` re-reads, which opens the same conflict choice as
  an agent's write under an edit. That write tells the agent itself, so the browser path's
  `tellAgentEdited` is not called too. The sidebar's *On the harness* tree
  (`components/workspace/harness-files.tsx`) is drawn only when the thread's agent's
  `/v1/models` entry says `felix.workspace.tools` is `server` or `both`, and not for a thread with
  a repository checkout, whose files the repository section now opens instead. Changes rows open
  the workspace their tool wrote to (`local_*` → browser, else harness). **So does a write
  approval's diff**: `readForDiff(path, {tool, threadId})` goes through `routedDiffReader`
  (`@felix/client`), which reads the client's own file for `local_*` and the harness's for any
  other tool — reading the browser's copy for a `write_file` drew a "replaces six lines" diff
  for a file the write was creating. Both clients use it.
- **Rename and delete are behind the file header's ⋯** (`components/pane/file-actions.tsx`),
  files only, each opening a strip that says what will happen first; both wait while the file
  holds an unsaved edit. They act on the store the file came from: the harness
  (`/chat/workspace/{delete,rename}`, `felix-run/felix#582`, conditional on the read hash and
  telling the agent itself) or the browser's (`removeExisting`/`renameExisting` in
  `@felix/cowork-client`, then `tellAgentEdited` with `op`). A rename never overwrites — the
  harness answers `409 target_exists`, the browser throws `TargetExistsError` — and a mount
  rename is write-then-remove, ordered so a failure leaves two copies, never none. The outcome is
  a toast (`outcomeLine`), since the tab is closed or replaced.
- **The sidebar's file trees have the same actions** (`components/workspace/file-row-menu.tsx`):
  a right click, or Shift+F10 / the context-menu key on a focused row, opens Open, Rename…,
  Delete… — one menu per tree, anchored at the pointer, never a control inside a `treeitem`.
  Rename and Delete do not act from the tree: they open the file in the pane and ask its view to
  open the strip (`requestFileAction` → `PaneState.request`, not persisted), so a tree delete has
  the pane's guards — the read hash, the hold while an edit is unsaved. The row's own Enter is
  kept: the menu's `onKeyDown` replaces `FileTreeFile`'s and re-implements it.
- **The agent can delete and rename too** (`felix-run/felix#584`): `delete_file`/`rename_file` on
  the harness, `local_delete`/`local_rename` on the client, gated by the same rule as writes.
  `fileToolOp` has `delete` and `rename`; `runLocalFileTool` answers both over `LocalFs.remove`
  and `.rename` (the browser's through #451's helpers, the terminal's behind `resolveWithin`,
  `assertWritable`, its prompt and a refusal of symlinks — `resolveWithin` follows a link, which
  is right for a read and would delete the target). Changes records a rename on both paths, each
  row saying which side it is, and `PathChange.gone` keeps Open off a deleted or moved-away
  path. `readsBefore` covers delete, so its approval card shows the file it removes.
- **Folders too, from the trees only** (`components/workspace/folder-action.tsx`,
  `felix-run/felix#594`): a folder row's menu offers Rename folder… and Delete folder…, which
  open a dialog — a folder is not a pane item, and a recursive delete earns the interruption.
  The delete names the files it takes and is confirmed **at that count** (`expected_count`;
  the browser stores' `removeDir`/`mountRemoveDir` take the same guard), so a folder that
  changed under the dialog is refused untouched. Both are held while a file under the folder
  has an unsaved edit, and close the pane's tabs under it after. The row menu ignores events
  from nested rows (`ownEvent`): a folder's `treeitem` wraps its children's. The agent's tools
  stay files-only.
- `?open=<path>` names the active **browser** file in the address; other kinds come back from
  session storage only. `tests/side-pane.test.tsx` pins all of it, including the zone handover on the real `App`.
