/**
 * The spike harness.
 *
 * Answers four questions and nothing else:
 *
 *  1. Do the two ported components render at all on Bun, with no flags?
 *  2. Does a keyboard path equivalent to `useInput` exist and behave?
 *  3. What does a stream cost — the delta loop below appends to the last turn
 *     ~30×/s, which is the load that made Ink's transcript need a 30-turn cap.
 *  4. Is mouse real? The bottom strip is a `onMouseOver`/`onMouseDown` target,
 *     which is the entire class of feature Ink cannot do.
 *
 * It deliberately does NOT touch the composer, the engine, approvals, or the
 * transport. Those are the second spike, if this one passes.
 */

import { createCliRenderer, createTextAttributes } from '@opentui/core';
import { createRoot, useKeyboard } from '@opentui/react';
import { useEffect, useState } from 'react';
import { THREADS, TURNS } from './fixtures.ts';
import { StatusLine, ThreadRail } from './rails.tsx';
import { Transcript } from './transcript.tsx';

const DIM = createTextAttributes({ dim: true });

const TAIL =
  ' The loop returns while the phase still says working, and says what landed otherwise.';

function App({ onExit }: { onExit: () => void }) {
  const [cursor, setCursor] = useState(0);
  const [filter, setFilter] = useState('');
  const [focused, setFocused] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [grown, setGrown] = useState(0);
  const [frames, setFrames] = useState(0);
  const [mouse, setMouse] = useState('mouse: —');

  const visible = filter
    ? THREADS.filter((t) => t.title.toLowerCase().includes(filter.toLowerCase()))
    : THREADS;

  // Question 3: hammer the transcript the way a real stream does.
  useEffect(() => {
    if (!streaming) return;
    const id = setInterval(() => {
      setGrown((g) => (g + 1) % 400);
      setFrames((f) => f + 1);
    }, 33);
    return () => clearInterval(id);
  }, [streaming]);

  const turns = TURNS.map((t, i) =>
    i === TURNS.length - 1 && grown
      ? { ...t, content: t.content + TAIL.repeat(1 + (grown % 12)) }
      : t,
  );

  useKeyboard((key) => {
    const name = key.name ?? '';
    if (name === 'c' && key.ctrl) return onExit();
    if (name === 'q' && !filter) return onExit();
    if (name === 's') return setStreaming((s) => !s);
    if (name === 'tab') return setFocused((f) => !f);
    if (name === 'up') return setCursor((c) => Math.max(0, c - 1));
    if (name === 'down') return setCursor((c) => Math.min(visible.length - 1, c + 1));
    if (name === 'escape') {
      setFilter('');
      setCursor(0);
      return;
    }
    if (name === 'backspace') {
      setFilter((f) => f.slice(0, -1));
      setCursor(0);
      return;
    }
    if (key.ctrl || key.meta || !/^[a-z0-9 ]$/i.test(name)) return;
    setFilter((f) => f + name);
    setCursor(0);
  });

  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <box flexDirection="row">
        <ThreadRail
          threads={visible}
          activeId="t0"
          cursor={cursor}
          focused={focused}
          filter={filter}
          total={THREADS.length}
        />
        <box flexDirection="column" flexGrow={1}>
          <Transcript turns={turns} />
        </box>
      </box>

      {/* Question 4. Nothing in Ink can do this line. */}
      <box
        onMouseOver={() => setMouse('mouse: over — hit-testing is free')}
        onMouseDown={(e) => setMouse(`mouse: click at ${e.x},${e.y}`)}
        onMouseScroll={() => setMouse('mouse: wheel')}
        border
        borderStyle="rounded"
        borderColor="magenta"
        paddingLeft={1}
        paddingRight={1}
      >
        <text fg="magenta">{mouse}</text>
      </box>

      <StatusLine
        manifest="default"
        origin="http://127.0.0.1:8080"
        phase={streaming ? 'working' : 'idle'}
        reattaching={false}
        error={null}
        root="~/Projects/felix-web"
        hint="s stream · tab focus · ↑↓ move · type filter · q quit"
      />
      <text attributes={DIM}>
        spike · frames {frames} · turns {turns.length} · threads {visible.length}/{THREADS.length}
      </text>
    </box>
  );
}

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  // Both explicit: hover is the half Ink cannot do at all, and it is off by
  // default in some terminals unless movement tracking is asked for.
  useMouse: true,
  enableMouseMovement: true,
});
const root = createRoot(renderer);
const stop = () => {
  root.unmount();
  renderer.destroy();
  process.exit(0);
};
root.render(<App onExit={stop} />);
