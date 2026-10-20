# Terminal client (`apps/tui`)

Split out of the root `CLAUDE.md`, which holds the wire protocol and run flows this client shares.

`apps/tui` is the same conversation without a browser, and the differences are all about what a
browser cannot do rather than about the chat:

- **No proxy, no shared key.** `/api/*` and `x-chat-key` exist because a page cannot reach the
  harness (no CORS, no static assets). This process calls `FELIX_ORIGIN` directly with
  `Authorization: Bearer`, resolved by `src/config.ts` narrowest first: flag, environment, the
  checkout's `apps/chat-ui/.dev.vars`, then `~/.config/felix/config.json`. `.dev.vars` is in that
  list on purpose — it is the repo's *one* local secrets file, and a second client ignoring it made
  that three. It is found from the module's own path, never by walking up from `cwd`, which would
  read whatever credentials an unrelated parent directory happened to hold.
- **Client tools hit the real filesystem** — the one surface here where the *model* drives the
  user's disk. `src/workspace.ts` answers `tool_request` against `process.cwd()`. Every path goes
  through `resolveWithin`, which compares **real** paths and refuses a *broken* symlink outright:
  a dangling link has no real path, so an earlier version walked past it and wrote wherever it
  pointed. Writes also refuse `.git/`, `.husky/`, `node_modules/` and any existing executable —
  in-root paths where writing a file means running a command — and otherwise wait on a prompt
  showing the **absolute** target. `confirm` is a required option, so a caller cannot get a silent
  writer by omitting it; `--yes` is a confirm that always agrees. Reads are *not* confirmed, which
  is the stated trade of running against a real cwd.
- **Every request settles, and nothing outlives its turn.** `settleClientTool` in `@felix/client` is
  the shared deadline. It resolves what the engine awaits but cannot cancel the work, so the write
  prompt carries its own shorter deadline and is cancelled on abort — otherwise a `y` pressed after
  the timeout still writes, long after the model was told the tool failed.
- **One prompt owns the keyboard.** `useKeyboard` is a global subscription, so two banners on screen
  means one `y` answers both — a local write and a gated harness-side tool. `App` renders exactly
  one. What a handler *can* do is `preventDefault`: a global handler runs before the focused
  renderable, so the banner that answers a key also stops it reaching the composer behind it. The
  same rule is why the composer is disabled while the thread rail has focus: otherwise `↑` would
  recall a prompt *and* move the rail cursor, and `enter` would send a message *and* switch threads. The rail takes plain text as well — it filters itself by title while focused —
  so it consumes every key it is handed and returns rather than falling through, which is why `esc`
  there clears the filter instead of stopping the run. Stopping stays on `ctrl+c`, handled above it.
  The rail is also **windowed**, not head-sliced: it drew its first twenty threads while the cursor
  ran the whole list, so past row twenty the selection moved with nothing on screen to show it and
  `enter` opened a thread that had never been drawn.
- **Looking away is a state.** `src/attention.ts` puts *working* / *blocked* / *idle* in the window
  title (always) and behind an `OSC 9` notification (only once the terminal has reported losing
  focus) — the terminal's half of chat-ui's `presence.ts`, states and messages matched. Focus comes
  from `DECSET 1004`, and **reading the reports is the renderer's job**: it parses `ESC [ I` /
  `ESC [ O` itself and emits `focus` / `blur`, which `App` forwards to `attention.setFocus`. Under
  Ink this module had to sniff raw stdin to keep the reports out of the prompt; that filter is gone.
  *Asking* for them is still ours, because the renderer only requests reporting when the terminal
  answers its capability query — and the request is still written from an `App` effect
  (`begin`/`end`), never at construction, because until the renderer has raw mode on the tty
  **echoes** the terminal's reply and a literal `^[[I` is printed into the first frame, where it
  stays for the session.
- **A paste is not typing, and not a send.** The paste event carries **bytes**, not a string, and it
  arrives with the newlines intact; left alone the edit buffer strips them and runs the last word of
  one line into the first of the next. It is preventable, which is the hook: intercept, `flattenPaste`
  to join the lines with spaces, insert that. Enter is still required, because what reaches the model
  has to be what was read on screen. The other half is `linefeed` bound to `newline` rather than
  `submit` — a terminal that ignores bracketed paste delivers a copied paragraph as raw bytes with LF
  in them, and a prompt that treats a bare linefeed as Enter sends half of it unseen. That is what
  `tests/composer.test.ts` pins.
- **Enter is a binding, not a fight.** The renderer's defaults are the opposite of a chat prompt —
  `return` inserts a newline, `meta+return` submits. `CHAT_BINDINGS` in the composer states what this
  prompt means instead: Enter sends, **shift+Enter opens a line**. Shift+Enter needs the kitty
  keyboard protocol (`useKittyKeyboard` in `main.tsx`), which is the only way a terminal reports that
  modifier on Enter at all; a terminal without it keeps Enter-sends and loses only the second line.
- **`ctrl+e` opens `$EDITOR`, and no longer has to.** The composer is a `textarea` over an edit buffer
  with word motion, line kills, selection and undo already on it, so a paragraph can be written in
  place. `src/editor.ts` still runs `$VISUAL`/`$EDITOR` on a temp file between `renderer.suspend()`
  and `renderer.resume()` — the `resume` is in a `finally`, because an editor that exits non-zero must
  not leave a client that has stopped drawing with no way back. An unchanged or emptied file returns
  nothing rather than sending an empty message.
- **The conversation grows from the bottom** (`justifyContent: 'flex-end'` on the transcript's
  content). Without it a short conversation floats at the top and the composer sits at the bottom
  with fifteen empty rows between them.
- **The inspector is the harness's read-only operator surface, on `shift+tab`.** Eight sections over
  a `<tab-select>` strip, one `<scrollbox>` panel, and **only the visible section polls** — with tabs
  rather than chat-ui's disclosure stack, exactly one is on screen, so the terminal costs one request
  where the browser's inspector costs one per expanded panel. (chat-ui reached the same economy from
  the other direction for the tenant-durable half: those are `/harness` pages now, one at a time.)
  It does *not* gate on terminal focus the way chat-ui gates on `visibilityState`: focus reporting
  is tri-state here because plenty of terminals
  never answer, so gating would silently freeze the panel on those. The approvals section reads the
  engine's existing queue rather than adding a second poll — that one runs unwatched by design.
  Three things about the widgets. `TextTableRenderable` is **not** a JSX intrinsic at 0.5.10 despite
  what the docs say, so `src/ui/table.tsx` registers it with `extend()` — and that registration lives
  in the module exporting the only wrapper that renders it, because tests mount components without
  `main.tsx` and a bare side-effect import is the one a tidy-up deletes. `<tab-select>` takes **no**
  `selectedIndex` prop (unlike `<select>`), so the strip is driven through a ref, and its defaults
  are hardcoded true-colour literals that must all be overridden or they paint over the user's
  palette. `TAB_WIDTH` is 9 because **eight** tabs have 72 columns to share at eighty —
  exactly the budget, with nothing left over; the default of 20 shows three, and 11 showed six with
  nothing on screen to say a seventh existed. Names truncate to `TAB_WIDTH - 2`, so 7 characters is
  the ceiling, which is why approvals is `Waiting` and the audit feed is `Audit` rather than
  chat-ui's `Activity`. A ninth section does not fit by shrinking this again: it needs a second row,
  or a section that has stopped earning its place. `Usage` is spend **by thread** over the last
  day (`threadSpendRows`, from `listUsageByThread`), the current thread marked `›`, falling back
  to the raw meter on a 404 — the same question the browser's Activity ledger answers, and "in"
  counts the whole prompt there too.
- **A tool card draws its result, and a spilled one carries a handle.** Until it did, `ToolCard`
  rendered the *call* and never the output, so a `[artifact:…]` marker was not a raw marker on
  screen — it was nothing on screen, and every tool ran and returned into silence. The card now
  carries one truncated result line, and a spilled output gets `· 48k more [a1]`; `/artifact 1`
  fetches it into `$PAGER` between `renderer.suspend()` and `resume()`, the same dance `ctrl+e`
  does, with `resume` in a `finally` for the same reason. (Until 2026-10-11 that command was in
  `/help` and documented but had **no `case` in `runCommand`**, so it printed the help; it is
  there now, beside `/skills` and `/skill <name>` — the read-only skill library as plain text from
  `src/skill-report.ts`, paged the same way rather than a ninth inspector tab, which would not
  fit. `tests/skill-commands.test.ts` drives all three through `runCommand` with a stubbed
  `show`, since the app's own runs a real pager.) Handles are numbered across the whole
  transcript in `src/artifacts.ts`, because the card and the command have to agree what `1` means.
  `parseArtifactMarker` matches only at the **end** of an output — one quoted mid-text is a tool
  talking *about* an artifact — and the id it validates is 32 hex characters, so a shorter one
  parses as absent rather than as a reference.
- **The status line says what the client believes about the harness**, in the columns the origin
  would have used: `unreachable` (a request that never arrived — usually the harness is not running)
  or `key rejected` (a 401). It **replaces** the host rather than joining it, because both words are
  shorter and an appended segment would compete with `basename(root)` for the columns the cut takes
  from the end. Both are latched on transition: `onReachability(true)` fires on every successful
  request and `onUnauthorized` on every 401, and the approvals poll runs every 2.5s during a run.
  There is no re-prompt — this process holds a bearer token and has nowhere to put a new one.
- **`ctrl+i` is not available for anything.** It *is* `0x09`, which *is* `tab`, on any terminal not
  speaking the kitty protocol — so binding it collides with the thread picker on exactly the
  terminals least able to tell them apart. `shift+tab` is `ESC [ Z` everywhere and parses as `tab`
  with the shift flag, which also means a branch matching only the *name* fires on both.
- **The thread picker is an absolutely-positioned overlay, not a column.** It was a permanent rail
  costing twenty-eight of a hundred cells, drawn only above ninety columns — so the client had two
  shapes depending on the terminal. `position: "absolute"` + `zIndex` means opening it does not
  reflow what is underneath.
- **Nothing below the transcript may shrink.** The transcript grows to fill, so the composer, the
  notice and the status line carry `flexShrink={0}`. Without it a conversation longer than the
  screen eats their rows — the input line vanishes and the marker is squashed into the bottom
  border, giving a box you cannot type in and no sign of why. Each component is correct alone; it
  only appears when they are rendered together against a long transcript.
- **The local write prompt is a column.** Its summary ends in an absolute path, and beside the
  keys in a row a long path wrapped *around* them — `write /Users/…/src/y allow · n` then
  `ui/some/nested/file.tsx?  refuse`. Unreadable, on the one prompt that authorizes a write to the
  user's disk. The keys stay an explicit row rather than a `bottomTitle`: a title too long for the
  border is dropped silently, and these must never be what disappears.
- **An empty thread says one thing, and it is not a key list.** `src/ui/greeting.tsx` — the
  composer's border and the status line already carry the keys, the manifest, the host and the
  directory, so restating them would make the first screen the densest. What it says instead is the
  fact that is nowhere else: the agent is pointed at a real working directory, reads it without
  asking, and asks before writing — or, under `--yes`, says in the danger colour that it does not.
  Around that sentence, and only when the manifest declares them (`felix.greeting` /
  `felix.starters` on `/v1/models`): its headline and subtitle above, its starters below as a
  numbered list of **titles**. `/start <n>` puts the full prompt in the composer rather than
  sending it — the greeting showed a title, and what reaches the model has to be what was read,
  the rule a paste follows too. The composer's `prefill` is an effect keyed on a counter, because
  the command runs inside `submit`, which clears the field after it. No fallback table here, unlike
  chat-ui: an agent that declares nothing gets the screen as it was.
- **The status line shortens before it cuts, and serves the state before the keys**, because cutting an absolute path takes the useful
  end and leaves `/Users/blake…`. Scheme stripped, path reduced to its last segment. The directory
  is what the model can write to, so it stays identifiable; the absolute path is shown in full on
  the write prompt, which is where it matters.
- **Fenced code is framed through `MarkdownOptions.renderNode`.** `defaultRender()` returns the
  renderable the markdown would have used, and a `Renderable` carries its own render context —
  which is the only way to obtain one, because `RenderNodeContext` exposes none. The empty row
  inside each frame is deliberate: the code buffer measures a line taller than its content, and
  pinning the box height to close it **clips wrapped lines**, because a long line needs more rows
  than it has lines.
- **`src/theme.ts` decides when this client may override the terminal's palette**, and the answer
  is "only when both halves of the question have an answer". `parseColor` resolves the *name*
  `"magenta"` to the literal `#FF00FF`, so a named colour is absolute true-colour painted over the
  user's scheme — which is what the sixteen literals it replaced were doing. The design tokens are
  used only when `capabilities.rgb` is true *and* `themeMode` is known; otherwise every role is an
  ANSI index via `RGBA.fromIndex`. The five hues live in `@felix/design` (`STATE_LIGHT` /
  `STATE_DARK`), which had only a neutral scale before — right for surfaces, useless for status.
  `src/syntax.ts` stays indexed on both paths, deliberately: a fenced block should look like the
  rest of the terminal's code. A harness approval is `blocked` and the local write prompt is
  `danger`, because a server asking permission and this process touching your disk are different
  risks.
- **`FELIX_DEBUG=1` turns on the renderer's console overlay** (`ctrl+d`), plus `openConsoleOnError`
  so a render failure opens it rather than freezing the frame. `console.log` in a full-screen app
  writes over the drawing; this is the only way to print anything here. The binding is only
  registered when the overlay exists, because a key that silently does nothing is worse than one
  that is not bound.
- **A write approval shows a diff, not a character count.** `src/approval.ts` builds the patch;
  `PendingApproval.before` has three states and they mean three different things — `undefined` is
  "not a write, nothing to diff", `null` is "the file does not exist yet", a string is an edit, and
  a `?? ''` that swallowed the first would offer a diff of every tool call against nothing. The
  patch is capped: the keys sit *below* the payload on purpose, so an uncapped diff is an approval
  whose `y`/`n` is off the bottom of the screen. The `---`/`+++` preamble is metadata the renderer
  never draws, so the path is named separately or the banner reports a change without saying what
  it changes. **The cap falls on a hunk boundary, never on a row count**: every `@@` hunk declares
  how many lines follow it, so a body cut part-way down contradicts its own header and
  `DiffRenderable` rejects the patch outright — `Error parsing diff:` plus the raw text, which is
  what a write to any two-hunk file rendered. A single over-budget hunk gets its header re-derived
  from the lines kept.
- **The agent's question prompt uses `<select>` and `<input>`.** It was the last surface here
  holding a `useState` cursor walked by hand on every arrow and a string appended to one character
  at a time — which meant a pasted answer put nothing in the field. `esc` stays on `useKeyboard`
  because a global handler runs *before* the focused renderable and can take the key outright,
  which is the only way to cancel out of an input that would otherwise consume it.
- **`/help` is generated, and tied to the router.** It was four hand-written lines and had already
  drifted — naming six inspector sections when there were eight, and listing no keys at all. The
  keys now come from `BINDINGS` in `src/keys.ts`, grouped by the surface that owns them because the
  same key means different things in each, and the section list from `SECTIONS`. What makes that
  more than a refactor is `ACTION_KINDS`: a `satisfies` plus an exhaustiveness type means an
  `Action` kind added without a binding **fails to compile**, naming the missing one, and
  `tests/keys.test.ts` asserts the coverage from the other side. Adopting `@opentui/keymap` was
  considered for this and decided against — ROADMAP.md says why.
- **A plan is a block, and an edited message says which version it is.** Both are read with the
  logic chat-ui uses, which is why `plansInTurn` moved into `@felix/client` (`src/plans.ts`, step
  type `PlanCallStep` beside the management half's `PlanStep`): the plan block sits at the first
  `plan_*` call and folds the rest, and the version line under a user turn is `branchPoints` off
  the last snapshot. That map is keyed by server event id, which only a hydrated turn carries, so
  it is set in `hydrate` (and mirrored in a ref, because `/version` reads it in the same tick the
  hydrate resolves) and cleared on every thread change. `/version <n>` acts on the newest edited
  message on the active branch and rewinds to `tips[n-1]`, never to the message itself.
- **The commands are the client's whole surface.** `@felix/client` reaches every chat verb the
  harness serves; a slash command is the only thing that exposes one here, so a verb with no `case`
  in `command()` — rename, fork, compact, export, rewind, search — is a verb this client does not
  have. `/rewind` hydrates first because `Turn.eventId` is only ever set from a snapshot.
- **A frame can be read back in process.** `apps/tui/tests/render.ts` mounts a component on a
  renderer that writes to memory rather than a tty (`testRender` from `@opentui/react/test-utils`);
  `frame()` returns what was drawn, `spans()` keeps its colour and attributes, and `keys` speaks the
  byte sequences. Three traps it absorbs. `waitForVisualIdle` answers for the *renderer*, which goes
  idle the instant a key is handled and before React has committed — so `settle()` yields a task
  first, and without that every state-driven component reads as one that ignores its keys. **A
  renderable that parses on a worker — `<markdown>`, `<code>` — is idle *before its content
  exists*,** so neither settling nor upstream's `waitForFrame` (which gives up as soon as the
  scheduler reports nothing scheduled) will wait for it: the first frames of a reply have the prose
  and list blocks missing entirely. `until(predicate)` polls the condition against a deadline
  instead. A fixed sleep looks like it works and does not — 400ms passed locally and failed on CI.
  **The same rule covers ordinary state, for the same reason:** `settle` gives React exactly one
  macrotask, which is enough on an idle laptop and is not a guarantee — `tests/write-gate.test.ts`
  went green here eight runs out of eight and failed its first assertion in Actions. So `settle` is
  for letting things happen and `until` is for asserting that they did; anything read after a key, a
  paste, a callback or a fetch belongs in `until`, including a check that something has *gone*
  (`until(() => !shows(f, 'x'))`). A bare read is right only for the frame `mount` already waited
  for, and for asserting that nothing happened at all.
  And the
  kitty protocol is on by default, matching `main.tsx`, because a lone `escape` without it is a
  possible sequence prefix the parser holds past the end of the test. Do **not** try to read a frame
  by stripping escapes from captured output: the renderer draws with absolute cursor moves, so
  removing them collapses the frame onto one line and unrelated components appear to overlap — every
  apparent corruption found while porting this client was that, and not the renderer.
- **A reply is markdown, and is rendered as such.** `<markdown>` from `@opentui/core` replaced a
  hand-rolled stripper that deleted `**` and `` ` ``, left tables as pipes and drew every fence in
  one flat colour. `streaming` is a prop and must be right: set, the trailing block stays unstable
  and is re-parsed on every delta — the normal state of a reply mid-flight — and only the *tail
  segment of the turn being written* gets it, because an earlier segment was closed by the tool call
  after it. `src/syntax.ts` holds the one `SyntaxStyle`, covering both vocabularies that arrive:
  `markup.*` for the markdown's own syntax (miss one and that piece renders as unstyled text with
  its markers gone) and tree-sitter captures for fenced code. Only the four bundled parsers
  (javascript, typescript, markdown, zig) are registered — any other language would be fetched over
  the network on first use, and this client talks to the harness and nothing else. Its colours are
  ANSI **indices** via `RGBA.fromIndex`, not names: `parseColor` resolves `"magenta"` to the literal
  `#FF00FF`, so a named colour silently overrides the user's terminal theme.
- **`pgup`/`pgdn` scroll the transcript, from anywhere and with no mode.** `ScrollBoxRenderable`
  already implements every scroll key; it just has to be focused to hear them, and focus would mean
  a mode you leave before typing. The page keys are the two the composer's textarea does not claim,
  so `App` drives the box through a ref instead. Sticky re-engages by itself at the bottom.
- **Selecting text copies it** (`src/clipboard.ts`, OSC 52). In an alt-screen app the terminal's own
  selection reads rows the renderer owns, so the renderer runs its own — which highlights correctly
  and otherwise has nowhere to put the result. Copy on mouse-*up*: every intermediate selection would
  otherwise reach the clipboard and the last to land would win by luck.
- Threads live in `$XDG_STATE_HOME/felix`. The transcript is a `scrollbox` with `viewportCulling`, so
  rows off screen take no part in layout — which is why it is no longer capped at a tail the way the
  Ink version had to be.
- **One layout rule that fails silently:** `<box>` defaults to `flexDirection="column"`. Ink's `<Box>`
  defaulted to `row`, so a box carried over from that era without an explicit direction lays out wrong
  rather than erroring.
- No build step for `dev` (`bun run`); `build` is `bun build --target=bun`, which inlines the raw-TS
  workspace packages and externalises `@opentui/*` and react — the renderer resolves a native binary
  per platform, so bundling it fails on every platform but the one building.
- **`apps/tui` runs on Bun, and only Bun.** The renderer reaches a native core over FFI, which Bun has
  first-class (`bun:ffi`) and Node has only as `node:ffi`, experimental and flag-gated behind
  `--experimental-ffi` from Node 26. The rest of the repo is unchanged and still Node.
