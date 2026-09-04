import { describe, expect, it } from 'bun:test';
import { createElement, type ReactElement } from 'react';
import { useWriteGate, type WriteGate } from '../src/write-gate';
import { mount } from './render';

/**
 * The gate between the model and the disk.
 *
 * Every one of these was reachable before and pinned by nothing. The rules it
 * has to keep are all about a promise the run is blocked on: it must always
 * settle, it must never settle twice, and it must never be able to say yes
 * after the moment has passed — a `y` pressed after the deadline would write
 * long after the model was told the tool failed and moved on.
 */

/**
 * Mount the hook and hand the live gate back to the test.
 *
 * `prompt()` polls rather than reading once, and that is not defensiveness. The
 * renderer goes idle the instant a call is handled, *before* React has
 * committed — `render.ts` says so in its header — so `settle()` yields one
 * macrotask and asks again. One is enough on this laptop and was not enough on
 * CI: this file went green locally eight runs out of eight and failed the first
 * assertion in Actions. `until` polls the condition against a deadline, so the
 * test says what it is waiting for instead of guessing how long React needs.
 */
async function gate(timeoutMs?: number) {
  let current: WriteGate | undefined;
  const Probe = () => {
    current = useWriteGate(timeoutMs);
    return createElement('text', {}, current.prompt ?? 'idle');
  };
  const ui = await mount(createElement(Probe) as ReactElement, { width: 40, height: 4 });
  await ui.settle();
  const get = () => current as WriteGate;
  return {
    ui,
    get,
    /** Wait until the prompt on screen is `want`, or fail saying what it was. */
    async prompt(want: string | null) {
      await ui.until(() => get().prompt === want);
    },
  };
}

describe('the write gate', () => {
  it('resolves true when the write is allowed', async () => {
    const g = await gate();
    const asked = g.get().confirm('write /tmp/a.txt');
    await g.prompt('write /tmp/a.txt');
    g.get().answer(true);
    expect(await asked).toBe(true);
    await g.prompt(null);
    g.ui.stop();
  });

  it('resolves false when it is refused, and clears the prompt', async () => {
    const g = await gate();
    const asked = g.get().confirm('write /tmp/a.txt');
    await g.prompt('write /tmp/a.txt');
    g.get().answer(false);
    expect(await asked).toBe(false);
    await g.prompt(null);
    g.ui.stop();
  });

  it('refuses on its own deadline rather than standing forever', async () => {
    // Under the executor's 30s timeout on purpose: that one resolves the
    // engine's promise but cannot stop the write, so this has to fire first.
    const g = await gate(20);
    const asked = g.get().confirm('write /tmp/a.txt');
    expect(await asked).toBe(false);
    await g.prompt(null);
    g.ui.stop();
  });

  it('a second request refuses the first rather than orphaning its resolver', async () => {
    const g = await gate();
    const first = g.get().confirm('write /tmp/a.txt');
    await g.prompt('write /tmp/a.txt');
    const second = g.get().confirm('write /tmp/b.txt');
    // The first must settle — the run is blocked on it — and it must settle as
    // a refusal, because nobody answered it.
    expect(await first).toBe(false);
    await g.prompt('write /tmp/b.txt');
    g.get().answer(true);
    expect(await second).toBe(true);
    g.ui.stop();
  });

  it('cancelling refuses the standing prompt, and is safe with none', async () => {
    const g = await gate();
    // Stopping a run with nothing pending must not throw or settle anything.
    g.get().cancel();
    await g.prompt(null);
    const asked = g.get().confirm('write /tmp/a.txt');
    await g.prompt('write /tmp/a.txt');
    g.get().cancel();
    expect(await asked).toBe(false);
    await g.prompt(null);
    g.ui.stop();
  });

  it('does not answer twice when the deadline lands after a key', async () => {
    const g = await gate(20);
    const asked = g.get().confirm('write /tmp/a.txt');
    await g.prompt('write /tmp/a.txt');
    g.get().answer(true);
    expect(await asked).toBe(true);
    // Let the timer's moment pass. A second settle would be a resolved promise
    // being resolved again — harmless to await, fatal to the prompt state.
    await new Promise((r) => setTimeout(r, 40));
    await g.prompt(null);
    g.ui.stop();
  });
});
