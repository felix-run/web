/**
 * Reading a frame back, in process.
 *
 * The rendered components used to be verified by running the client, with the
 * composer as the one exception — and even that one built its own renderer over
 * a pair of `PassThrough` streams, fed it hand-assembled escape bytes, and slept
 * 300ms hoping the tree had mounted. What it could never do is look at the
 * result: reading a frame meant capturing a session under a pty and replaying
 * the escapes through a partial terminal emulator written for the purpose.
 *
 * OpenTUI ships the whole of that. `testRender` mounts a React tree on a
 * renderer that writes to memory rather than a tty, `captureCharFrame` hands
 * back what was drawn, and `mockInput` speaks the byte sequences so no test has
 * to know how a terminal spells shift+Enter.
 *
 * Two things this wrapper adds, both of which every caller would otherwise
 * repeat:
 *
 * **The act environment is turned off once the tree is mounted.** `testRender`
 * turns it on (`@opentui/react/test-utils`), which is right for the initial
 * render and wrong afterwards: input here goes through a real renderer's stdin
 * parser and comes back as asynchronous state updates that no `act()` call
 * encloses. Left on, every test prints a paragraph of React advice that does not
 * apply to it.
 *
 * **Waiting for a condition is not the same as settling.** `<markdown>` and
 * `<code>` parse and highlight on a worker, so a frame arrives, the renderer
 * goes idle, and *then* more of the content appears — the first frames of a
 * reply have the prose and list blocks missing entirely. Neither
 * `waitForVisualIdle` nor upstream's `waitForFrame` covers that: both give up
 * the moment the scheduler reports nothing scheduled, which is exactly the gap.
 * A fixed sleep does cover it, badly — 400ms was enough on this laptop and not
 * on CI, where two of these tests failed while a third that waited on different
 * content passed. `until()` polls the condition itself against a deadline, so
 * the test says what it is waiting for instead of guessing how long.
 *
 * **Settling yields to React first.** `waitForVisualIdle` answers for the
 * renderer, and the renderer is idle the instant a key is handled — React has
 * not committed yet, because it schedules that on a task of its own. Waiting on
 * the renderer alone reads the frame from *before* the update, which looks
 * exactly like a component that ignores its keys: the probe that found this saw
 * `count=0` after pressing the key that increments it, and `count=1` one tick
 * later. So `settle` yields the macrotask queue before it asks.
 */

import type { CapturedFrame } from '@opentui/core';
import { testRender } from '@opentui/react/test-utils';
import type { ReactNode } from 'react';
import { resolveTheme } from '../src/theme';

export interface MountOptions {
  width?: number;
  height?: number;
  /**
   * Speak the kitty keyboard protocol. **On by default, because the client
   * always asks for it** (`main.tsx` passes `useKittyKeyboard: {}`), and a test
   * bench that is quieter than the product is a test bench that lies.
   *
   * It also decides how fast `escape` arrives. Without the protocol a lone
   * `ESC` is a possible sequence prefix, so the stdin parser holds it until a
   * timeout says otherwise — long enough that a test which presses escape and
   * settles sees nothing at all, which reads as a component ignoring the key.
   * Turn it off only to assert what a terminal *without* it does.
   */
  kitty?: boolean;
}

export interface Mounted {
  /** What was drawn, as text. */
  frame(): string;
  /** What was drawn, with colour and attributes kept. */
  spans(): CapturedFrame;
  /** Type, press, paste. Sequences are the mock's problem, not the test's. */
  keys: Awaited<ReturnType<typeof testRender>>['mockInput'];
  mouse: Awaited<ReturnType<typeof testRender>>['mockMouse'];
  /** Let React commit, then wait until the renderer stops drawing. */
  settle(): Promise<void>;
  /**
   * Poll until `check` holds, settling between attempts. For content that
   * arrives from a worker — a highlighted fence, a parsed markdown block —
   * where the renderer is idle before the content exists.
   */
  until(check: () => boolean, timeoutMs?: number): Promise<void>;
  resize(width: number, height: number): void;
  renderer: Awaited<ReturnType<typeof testRender>>['renderer'];
  /**
   * Rows committed to the terminal's scrollback since the last call, as text.
   * Empty outside `screenMode: 'split-footer'`, where nothing is committed.
   */
  scrollback(): string;
  stop(): void;
}

export async function mount(node: ReactNode, options: MountOptions = {}): Promise<Mounted> {
  const setup = await testRender(node, {
    width: options.width ?? 80,
    height: options.height ?? 12,
    kittyKeyboard: options.kitty ?? true,
    exitOnCtrlC: false,
  });
  // See the header: right for the mount, wrong for everything after it.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await setup.waitForVisualIdle();

  return {
    frame: () => setup.captureCharFrame(),
    spans: () => setup.captureSpans(),
    keys: setup.mockInput,
    mouse: setup.mockMouse,
    settle: async () => {
      // See the header: the renderer is idle before React has committed.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await setup.waitForVisualIdle();
    },
    async until(check, timeoutMs = 5_000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        await setup.waitForVisualIdle();
        if (check()) return;
        if (Date.now() > deadline) {
          throw new Error(
            `until(): condition still false after ${timeoutMs}ms. Last frame:\n${setup.captureCharFrame()}`,
          );
        }
      }
    },
    resize: setup.resize,
    renderer: setup.renderer,
    scrollback: () => setup.externalOutput.takeText(),
    stop: () => setup.renderer.destroy(),
  };
}

/**
 * The frame as trimmed lines with the blank tail removed.
 *
 * `captureCharFrame` pads every row to the full width, so a raw comparison is
 * against trailing spaces rather than against what is on screen.
 */
export function lines(frame: string): string[] {
  const rows = frame.split('\n').map((row) => row.replace(/\s+$/, ''));
  while (rows.length && rows[rows.length - 1] === '') rows.pop();
  return rows;
}

/** Whether the frame contains this text, ignoring how it is spaced or wrapped. */
export function shows(frame: string, text: string): boolean {
  const flat = frame.replace(/\s+/g, ' ');
  return flat.includes(text.replace(/\s+/g, ' '));
}

/**
 * The style a piece of text was drawn with.
 *
 * `captureCharFrame` flattens everything to characters, which is enough for
 * layout and wrong for anything whose whole job is colour — a notice that is no
 * longer yellow, a rail border that no longer changes on focus, a dim line that
 * came out at full weight. `captureSpans` keeps the attributes, so those are
 * assertable rather than a thing someone has to notice by eye.
 *
 * Returns the first span whose text contains `needle`, or `null`.
 */
export function styleOf(
  frame: CapturedFrame,
  needle: string,
): { text: string; fg: [number, number, number]; attributes: number } | null {
  for (const line of frame.lines) {
    for (const span of line.spans) {
      if (!span.text.includes(needle)) continue;
      const [r, g, b] = span.fg.toInts();
      return { text: span.text, fg: [r, g, b], attributes: span.attributes };
    }
  }
  return null;
}

/** Whether a captured span carries a `createTextAttributes` bit. */
export function hasAttribute(attributes: number, bit: number): boolean {
  return (attributes & bit) === bit;
}

/**
 * A fixed theme for component tests.
 *
 * Pinned rather than resolved from the test renderer, so a component's colours
 * are the same in every test regardless of what capabilities the harness
 * happens to report — `resolveTheme` itself is tested directly, on both paths.
 */
export const testTheme = resolveTheme({ themeMode: 'dark', trueColor: true });
