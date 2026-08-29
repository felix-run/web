# OpenTUI spike

Throwaway. Ports **only** `src/ui/transcript.tsx` and `src/ui/rails.tsx` to
OpenTUI on Bun, and answers whether the rest is worth doing. It does not touch
the composer, the engine, approvals, or the transport — those are the second
spike, if this one passes.

```sh
cd apps/tui/spike && bun install && bun run main.tsx
# s stream · tab focus · ↑↓ move · type to filter · q quit
```

Excluded from `pnpm lint` (`biome.json`) and from `apps/tui`'s `tsconfig.json`,
so nothing here can affect the app's checks.

## Verdict: it passes

Both components render correctly, the keyboard path works, a stream at full
delta rate does not fall behind, and mouse hit-testing works with no code.

### What was verified, and how

| Question | Result |
|---|---|
| Renders on Bun with no flags? | Yes. `bun install` took 1.85s / 22 packages; no `--experimental-ffi`, no warning, no shim. |
| Keyboard equivalent to `useInput`? | Yes — `useKeyboard`. Filtering the rail to `/rail · 1/24` and toggling phase to `working` were driven by real keystrokes through a pty. |
| Cost of a stream? | **317 frames** over ~9s of appending to the last turn every 33ms, with the transcript growing to ~12× its length. Never fell behind. |
| Is mouse real? | Yes. `mouse-probe.tsx` feeds SGR sequences to a synthetic stdin and gets `OVER`, `DOWN 4,1`, `SCROLL` routed to the right box. No hit-testing code. |

Frames were read back with `screen.py`, which replays an alt-screen capture
into a grid. A TUI drawn with absolute cursor moves cannot be verified by
eyeballing a log — stripping the escapes collapses the frame into one line,
which cost this spike two false "corruption" findings before the emulator
existed. It is checked in for that reason.

## What porting actually costs

**The trap: `<Box>` defaults to `row` in Ink, `<box>` defaults to `column` in
OpenTUI.** Every box that leaned on Ink's default lays out silently wrong —
no error, no warning, just the thread rail stacked above the transcript instead
of beside it. It is greppable (`<Box>` with no `flexDirection`) and it was the
single largest source of diff here.

Everything else was mechanical:

| Ink | OpenTUI |
|---|---|
| `<Box>` / `<Text>` | `<box>` / `<text>` — same flexbox props, same names |
| `color="green"` | `fg="green"` |
| `dimColor` | `attributes={createTextAttributes({ dim: true })}` |
| `<Text>` inside `<Text>` | `<span>` inside `<text>` |
| `wrap="truncate"` | `truncate` / `wrapMode="none" \| "char" \| "word"` |
| `render()` | `createRoot(await createCliRenderer()).render()` |
| `useInput` | `useKeyboard` |

`markdown.ts` ported with **zero** changes — `main.tsx` imports it straight out
of `../src/`. `railWindow` likewise: it is arithmetic, and it survives any
renderer.

**A cost the diff does not show:** lowercase intrinsics change which lint rules
fire. `apps/tui/src/ui/transcript.tsx` passes Biome today; the identical file
with `<box>` instead of `<Box>` reports four `noArrayIndexKey` errors, and every
mouse handler trips `a11y/noStaticElementInteractions` and
`a11y/useKeyWithMouseEvents` — DOM rules with no meaning in a terminal. A real
port needs `apps/tui/**` added to the `overrides` block in `biome.json`, next to
`packages/ui/src/**`.

## What the port would delete

- **`WINDOW = 30`** in the transcript. It exists because Ink re-lays-out every
  turn on every delta. OpenTUI ships a native `scrollbox`, so the cap goes and
  the transcript gains scrollback it has never had.
- **`railWindow`** — `scrollbox` windows natively.
- **Most of `attention.ts`.** OpenTUI queries the terminal background (OSC 11)
  and negotiates focus reporting itself, which is the machinery `isFocusReport`
  exists to work around.
- The JS `truncate` helper added to `rails.tsx` here — `truncate` is a prop.

# Spike 2: the composer

`composer-probe.tsx` re-asks every scenario `tests/composer.test.ts` pins, the
same way that test asks Ink: bytes into a synthetic stdin, asserting the message
that would be **sent**, never the frame drawn. One scenario per process, chosen
by argv, so none can leak state into the next.

```sh
for s in focus-reports bracketed-paste raw-paste cursor-motion word-motion \
         burst textarea-raw-paste textarea-enter textarea-submit; do
  bun run composer-probe.tsx "$s"
done; cat composer.out
```

```
PASS focus-reports      — submitted="hello" focus/blur events=2
PASS bracketed-paste    — not-sent-on-paste=true sent="explain the proxy worker and the dev copy of it"
FAIL raw-paste          — not-sent=false held="onetwo" sent=["one","onetwo"]
PASS cursor-motion      — value="hello Xworld"
PASS word-motion        — value="alpha beta Zgamma"
PASS burst              — len=396/396 exact=true
PASS textarea-raw-paste — not-sent=true held="one\ntwo\n" sent=[]
PASS textarea-enter     — value="first\nsecond"
PASS textarea-submit    — submitted=["send me"] value="send me"
```

## The one failure is the design decision

`raw-paste` fails on `<input>` (single-line): a terminal that ignores bracketed
paste sends `one\ntwo\n` raw, and the bare LF **submits mid-paste** — the same
class of bug `flattenPaste` was written for, in a new shape. `<input>` binds
`linefeed` to submit and strips newlines.

`textarea-raw-paste` is the same bytes against `<textarea>` with the bindings a
chat prompt actually wants, and it passes. **So: use `textarea`, never
`input`.** That is the whole finding.

## What deletes, what survives, what changes

**`isFocusReport` deletes, and so does most of `attention.ts`.** The core parses
`ESC[I` / `ESC[O` itself and emits `focus` / `blur` on the renderer — the probe
counted 2 events while the text stayed `"hello"`. It also restores terminal
modes on refocus, which is work `attention.ts` does not currently do at all.

**`flattenPaste` survives, and it still has to.** `PasteEvent` carries no
`.text` — the payload is `bytes`, and it arrives with the newlines **intact**.
Left alone, the buffer strips them and runs the words together
(`"…proxy workerand the dev copy…"`). The event is preventable, which is the
hook:

```tsx
usePaste((e) => {
  const raw = new TextDecoder().decode(Uint8Array.from(Array.from(e.bytes)));
  e.preventDefault();
  insert(flattenPaste(raw));
});
```

That reproduces the Ink test's assertion exactly, and a paste is still never a
send.

**The hand-rolled cursor deletes.** `<textarea>` is backed by an edit buffer
with `deleteWordBackward/Forward`, `deleteToLineEnd/Start`, `gotoLine`,
selection, and undo/redo already on it. `cursor-motion` and `word-motion` pass
with no code of ours — `←` and `ctrl+←` just work. This is the Tier-2 keystone,
free.

**Enter is a binding, not a fight.** The defaults are the opposite of a chat
prompt — `defaultTextareaKeyBindings` maps `return`→`newline` and
`meta+return`→`submit`. They are a plain array:

```tsx
keyBindings={[
  { name: 'return', action: 'submit' },
  { name: 'return', shift: true, action: 'newline' },
  { name: 'linefeed', action: 'newline' },
]}
```

`textarea-submit` and `textarea-enter` pass with that — Enter sends,
**Shift+Enter opens a line**, which the current composer cannot do at all. The
Tier-1 delivery split (Enter steers / Tab queues / Ctrl+Enter interrupts) is the
same mechanism. Shift+Enter needs the kitty keyboard protocol
(`useKittyKeyboard`), because that is the only way a terminal reports the
modifier on Enter at all.

**The update-depth failure does not return.** 400 characters pushed with no gaps
came back exact. The nested-update limit this repo has already paid for is a
React-state-per-keystroke problem, and the edit buffer is not React state.

## A policy question the port has to answer

With a one-line prompt, flattening a raw multi-line paste was obviously right.
With a real multi-line composer, `textarea-raw-paste` keeps `one\ntwo\n` as two
lines — which may now be the better answer. The bracketed-paste path should
still flatten (it is a paste, not typing); the raw path is a decision, not a
bug.

## What is still unknown

Nothing load-bearing in the composer. What is untested is everything downstream
of it: the engine wiring, approval and UI prompts fighting over the keyboard
(Ink's "exactly one prompt is mounted" rule may be replaceable by real focus
management here), `suspendTerminal` for the `$EDITOR` hand-off, and how the
build ships as a Bun binary.
