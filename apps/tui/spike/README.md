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

## What is still unknown

The composer. It is the whole risk: `tests/composer.test.ts` deliberately pins
Ink 7 behaviour (stdin read in paused mode; a chunk carrying text *and* Enter
arriving with `key.return` **false**), and OpenTUI has `input`/`textarea`
renderables that may make the hand-rolled cursor unnecessary — or may impose
their own semantics. Nothing here touched it.
