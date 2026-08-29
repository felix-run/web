# TUI — Felix in the terminal

A full-screen chat client for the **self-hosted Python Felix** harness
([felix-run/felix](https://github.com/felix-run/felix)), rendered with
[OpenTUI](https://opentui.com) on [Bun](https://bun.sh).

It is a second client, and that is the point. The harness is the product; a client that is
not a browser is what proves the SDK underneath it is a real interface rather than a
description of whatever chat-ui happens to need. Everything the conversation *is* — the
frame switch, the transcript, durable runs, reattach, the approval queue — belongs to
[`@felix/client`](../../packages/felix-client) and is shared with the web app. What lives
here is only what a terminal has to answer for itself.

The user-facing guide is
[**Terminal client**](../docs/src/content/guide/terminal.mdx) on the docs site. This file is
for working on the code.

## Running it

```bash
pnpm tui:dev                              # from a checkout
pnpm tui:build && bun apps/tui/dist/felix.js
```

It needs a TTY and a running harness (`make up && make migrate` in the harness repo → `:8080`).
Without one it draws fine and every request fails.

**It needs Bun, and only this package does.** The renderer reaches a native core over FFI,
which Bun has built in (`bun:ffi`). Node has it as `node:ffi` — experimental, flag-gated
behind `--experimental-ffi`, and absent before Node 26. On Node the package installs,
typechecks, imports, and then throws at `createCliRenderer`. The rest of the monorepo is
unchanged and still runs on Node.

## Configuration

No proxy Worker and no shared key: unlike chat-ui, this process reaches the harness itself and
sends its own `Authorization: Bearer`. `src/config.ts` resolves each setting **narrowest
first**, in the sense of how many runs a source affects:

| Source | Affects |
|---|---|
| `--origin` / `--key` / `--manifest` / `--thread` | this run |
| `FELIX_ORIGIN` / `FELIX_API_KEY` | this shell |
| the checkout's `apps/chat-ui/.dev.vars` | this clone |
| `~/.config/felix/config.json` | this machine |

`.dev.vars` is in that list deliberately: it is the repo's *one* local secrets file, read by
`wrangler dev` and the Vite dev proxy, and a second client ignoring it made that three —
`pnpm tui:dev` used to 401 on every call until the key was exported by hand, for no reason a
person could see. It is found from **this module's own path**, never by walking up from `cwd`:
the client runs wherever you happen to be, and walking up from the working directory looking
for a file full of credentials would read whatever an unrelated parent happened to hold.

Prefer the environment or a file over `--key`, which is visible in `ps(1)` to every user on
the machine. Sending a key over plaintext HTTP to a non-loopback origin is refused unless you
pass `--insecure`.

## The keyboard

| Key | |
|---|---|
| `enter` | send — or **steer** the run while one is live |
| `shift+enter` | a second line (needs a terminal speaking the kitty keyboard protocol) |
| `ctrl+e` | hand the draft to `$VISUAL` / `$EDITOR` |
| `tab` | focus the thread rail; type to filter it, `enter` opens, `esc` clears |
| `ctrl+n` | new thread |
| `esc` | stop the run |
| `ctrl+c` | stop the run, then quit on a second press |

Slash commands are the client's whole surface. `@felix/client` reaches every chat verb the
harness serves, and a command is the only thing that exposes one here — so a verb with no
`case` in `command()` is a verb this client does not have:

```
/new /clear /continue /think <level> /manifest [name] /quit
/rename <name> /fork /compact /export [file] /rewind [n]
/search <text> /open <n|thread-id> /refresh
```

## Writing to your disk

This is the one surface in the monorepo where the *model* drives a real filesystem.
`src/workspace.ts` answers `tool_request` frames against `process.cwd()`, and the rules are
worth knowing before you change it:

- Every path goes through `resolveWithin`, which compares **real** paths and refuses a
  *broken* symlink outright — a dangling link has no real path, so an earlier version walked
  past it and wrote wherever it pointed.
- Writes refuse `.git/`, `.husky/`, `node_modules/` and any existing executable: in-root paths
  where writing a file means running a command.
- Everything else waits on a prompt showing the **absolute** target. `confirm` is a *required*
  option, so a caller cannot get a silent writer by omitting it; `--yes` is a confirm that
  always agrees, not an absent one.
- **Reads are not confirmed.** That is the stated trade of running against a real working
  directory.
- The write prompt carries its own deadline, shorter than the executor's. `settleClientTool`
  resolves what the engine awaits but cannot cancel the work, so without it a `y` pressed after
  the timeout still writes — long after the model was told the tool failed.

## Files

| Path | Purpose |
|---|---|
| `src/main.tsx` | Entry: resolve config, refuse a non-TTY, build the renderer, hand off to `App` |
| `src/app.tsx` | The shell — keyboard, commands, threads, leases, the prompts, and the exit |
| `src/config.ts` | Origin and credentials, resolved narrowest first |
| `src/workspace.ts` | Client tools against the real filesystem, and their containment |
| `src/attention.ts` | Window title always, `OSC 9` notification only once the terminal reports blur |
| `src/threads.ts` | The local thread cache in `$XDG_STATE_HOME/felix` |
| `src/history.ts` | The prompt history file, its cap and its self-healing |
| `src/editor.ts` | `$VISUAL` / `$EDITOR` on a temp file, between `suspend()` and `resume()` |
| `src/markdown.ts` | Just enough markdown for eighty columns; renderer-agnostic |
| `src/epilogue.ts` | The line printed after the screen is given back |
| `src/ui/composer.tsx` | The prompt: a `textarea`, the Enter bindings, the paste policy |
| `src/ui/transcript.tsx` | The conversation, in a `scrollbox` |
| `src/ui/rails.tsx` | The thread rail and the status line |
| `src/ui/prompts.tsx` | Approval, agent question, and local-write banners |
| `scripts/screen.py` | Replays a captured frame so a render can be read back |

## Tests

```bash
bun test                    # everything
bun test tests/rails.test.ts
```

One runner. The package is Bun-only, so a second runner for the pure half bought nothing but a
second test directory. Bun maps a `vitest` import onto its own runner, but these import
`bun:test`, because an import naming a runner that does not run them is a lie the next person
pays for. Two gaps in Bun's shim to know: `vi.advanceTimersByTimeAsync` does not exist
(advance synchronously, then await the promise), and `toHaveBeenCalledOnce` runs but is not
typed.

What is covered is what a terminal adds on its own — config precedence, the markdown splitter,
the history file, the attention gate, the editor round trip, the rail's window arithmetic, and
the workspace executor's containment and settle guarantees. The rendered components are
verified by running the client, with **one** exception: `tests/composer.test.ts` renders the
real composer, because what it pins is a keystroke sequence no hand-run reproduces reliably.

## Notes

- **`<box>` defaults to `flexDirection: column`.** Ink's `<Box>`, which this client used
  before, defaulted to `row`. A box that leans on the wrong default lays out silently wrong
  rather than erroring — it is the single largest source of diff in the port, and the first
  thing to check when something is stacked that should be beside.
- **A column taller than the screen is drawn *over* what is beneath it**, not scrolled or
  shrunk. Anything with a fixed row count needs to know how tall the terminal is.
- **`truncate` is not Ink's `wrap="truncate"`.** It needs a bounded width to cut against;
  setting it on a row that has none collapses that row's measurement.
- **Reading a frame back is possible, and not obvious.** Capture under a pty, then replay:

  ```bash
  perl -e 'alarm(8); exec("script", "-q", "/dev/null", "sh", "-c",
           "stty rows 40 cols 140; bun run src/main.tsx")' </dev/null > /tmp/tui.log 2>&1
  python3 scripts/screen.py /tmp/tui.log 40 140
  ```

  Stripping the escapes and reading the log instead does **not** work, and fails in a way that
  looks like a rendering bug: the renderer draws with absolute cursor moves, so removing them
  collapses the frame onto one line and unrelated components appear to overlap.
- **A paste is not typing.** The paste event carries bytes with the newlines intact; left alone
  the edit buffer strips them and runs the last word of one line into the first of the next.
  The event is preventable, which is the hook `flattenPaste` uses.
- **One prompt owns the keyboard.** `useKeyboard` is a global subscription, so two banners on
  screen means one `y` answers both. `App` renders exactly one, and a handler that answers a
  key calls `preventDefault` so it does not also reach the composer.
