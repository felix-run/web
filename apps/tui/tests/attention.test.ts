import { describe, expect, it } from 'vitest';
import { createAttention } from '../src/attention';

/**
 * One question now, where there used to be two.
 *
 * Does a signal fire when nobody is watching, and *only* then — a bell every
 * time a run ends in front of you is worse than no bell at all.
 *
 * The second question is gone with the code that answered it. Telling a focus
 * report from typed text was this module's job while the reports arrived as
 * ordinary input; the renderer parses them itself and emits `focus` / `blur`,
 * so all that is left is being told. What that costs is stated rather than
 * tested: if a terminal never reports focus, `setFocus` is never called, and
 * the state stays `unknown` — which is treated as "you might be watching".
 */

const ESC = String.fromCharCode(27);

function harness(options: { enabled?: boolean } = {}) {
  const written: string[] = [];
  const attention = createAttention({
    stdout: { write: (chunk: string) => written.push(chunk) },
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
  });
  // Every test but the "before begin" ones starts from a live terminal.
  if (options.enabled !== false) attention.begin();

  return {
    attention,
    written,
    blur: () => attention.setFocus(false),
    focus: () => attention.setFocus(true),
    notifications: () => written.filter((chunk) => chunk.startsWith(`${ESC}]9;`)),
    titles: () => written.filter((chunk) => chunk.startsWith(`${ESC}]2;`)),
  };
}

describe('createAttention', () => {
  it('claims the title stack and turns focus reporting on', () => {
    const h = harness();
    expect(h.written[0]).toBe(`${ESC}[22;2t`);
    expect(h.written[1]).toBe(`${ESC}[?1004h`);
    expect(h.titles()).toHaveLength(1);
  });

  /**
   * The terminal answers a focus request on stdin, and until the renderer has
   * raw mode on the tty echoes that answer to the screen. Asking early prints
   * `^[[I` into the first frame, where it stays for the session.
   */
  it('writes nothing until it is told the terminal is ready', () => {
    const written: string[] = [];
    const attention = createAttention({ stdout: { write: (c: string) => written.push(c) } });
    attention.set('working');
    expect(written).toEqual([]);
  });

  it('asks only once, however many times it is told', () => {
    const h = harness();
    const before = h.written.length;
    h.attention.begin();
    expect(h.written).toHaveLength(before);
  });

  it('gives the terminal back on end, while the renderer still owns it', () => {
    const h = harness();
    h.attention.end();
    expect(h.written.slice(-2)).toEqual([`${ESC}[?1004l`, `${ESC}[23;2t`]);
  });

  it('gives it back on dispose too, for a process going down another way', () => {
    const h = harness();
    h.attention.dispose();
    expect(h.written.slice(-2)).toEqual([`${ESC}[?1004l`, `${ESC}[23;2t`]);
  });

  it('reflects the state in the title whether or not anyone is watching', () => {
    const h = harness();
    h.attention.set('working');
    h.attention.set('blocked');
    expect(h.titles()).toHaveLength(3);
    expect(h.titles()[2]).toContain('Approve');
  });

  it('stays silent while the terminal has never reported focus', () => {
    const h = harness();
    h.attention.set('working');
    h.attention.set('blocked');
    expect(h.notifications()).toEqual([]);
  });

  it('stays silent while the terminal is focused', () => {
    const h = harness();
    h.focus();
    h.attention.set('working');
    h.attention.set('blocked');
    expect(h.notifications()).toEqual([]);
  });

  it('speaks up when a run blocks and nobody is there', () => {
    const h = harness();
    h.blur();
    h.attention.set('blocked');
    expect(h.notifications()).toHaveLength(1);
    expect(h.notifications()[0]).toContain('waiting on your decision');
  });

  it('speaks up when a run finishes, but not when it was never running', () => {
    const h = harness();
    h.blur();
    h.attention.set('idle');
    expect(h.notifications()).toEqual([]);
    h.attention.set('working');
    h.attention.set('idle');
    expect(h.notifications()).toHaveLength(1);
    expect(h.notifications()[0]).toContain('finished');
  });

  it('goes quiet again when the terminal comes back', () => {
    const h = harness();
    h.blur();
    h.focus();
    h.attention.set('blocked');
    expect(h.notifications()).toEqual([]);
  });

  it('says nothing twice for the same state', () => {
    const h = harness();
    h.blur();
    h.attention.set('blocked');
    h.attention.set('blocked');
    expect(h.notifications()).toHaveLength(1);
  });

  it('is inert when disabled', () => {
    const h = harness({ enabled: false });
    h.attention.begin();
    h.blur();
    h.attention.set('blocked');
    h.attention.dispose();
    expect(h.written).toEqual([]);
  });
});
