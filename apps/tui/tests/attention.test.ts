import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createAttention } from '../src/attention';

/**
 * Two questions, and the second one is the trap.
 *
 * Does a signal fire when nobody is watching, and *only* then — a bell every
 * time a run ends in front of you is worse than no bell at all. And does the
 * price of asking the terminal about focus stay out of the prompt: the reports
 * come back as input, Ink hands them on as the plain text `[I` and `[O`, and
 * anything that does not recognise them types them into the message.
 */

const ESC = String.fromCharCode(27);
const FOCUS_OUT = `${ESC}[O`;
const FOCUS_IN = `${ESC}[I`;

function harness(options: { enabled?: boolean } = {}) {
  const stdin = new EventEmitter();
  const written: string[] = [];
  let clock = 1_000;
  const attention = createAttention({
    stdin,
    stdout: { write: (chunk: string) => written.push(chunk) },
    now: () => clock,
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
  });
  // Every test but the "before begin" ones starts from a live terminal.
  if (options.enabled !== false) attention.begin();

  return {
    attention,
    written,
    blur: () => stdin.emit('data', Buffer.from(FOCUS_OUT)),
    focus: () => stdin.emit('data', Buffer.from(FOCUS_IN)),
    type: (text: string) => stdin.emit('data', Buffer.from(text)),
    tick: (ms: number) => {
      clock += ms;
    },
    listeners: () => stdin.listenerCount('data'),
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
   * The terminal answers a focus request on stdin, and until Ink has raw mode
   * on the tty echoes that answer to the screen. Asking early prints `^[[I`
   * into the first frame, where it stays for the session.
   */
  it('writes nothing until it is told the terminal is ready', () => {
    const stdin = new EventEmitter();
    const written: string[] = [];
    const attention = createAttention({ stdin, stdout: { write: (c: string) => written.push(c) } });
    attention.set('working');
    expect(written).toEqual([]);
    // Listening, though: a report that arrives early is still worth knowing.
    expect(stdin.listenerCount('data')).toBe(1);
  });

  it('asks only once, however many times it is told', () => {
    const h = harness();
    const before = h.written.length;
    h.attention.begin();
    expect(h.written).toHaveLength(before);
  });

  it('gives the terminal back on end, while Ink still owns it', () => {
    const h = harness();
    h.attention.end();
    expect(h.written.slice(-2)).toEqual([`${ESC}[?1004l`, `${ESC}[23;2t`]);
    // The listener outlives the sequences; disposal is what detaches it.
    expect(h.listeners()).toBe(1);
    h.attention.dispose();
    expect(h.listeners()).toBe(0);
  });

  it('gives it back on dispose too, for a process going down another way', () => {
    const h = harness();
    h.attention.dispose();
    expect(h.written.slice(-2)).toEqual([`${ESC}[?1004l`, `${ESC}[23;2t`]);
    expect(h.listeners()).toBe(0);
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

  it('reports one net state for a blur and focus in the same chunk', () => {
    const h = harness();
    h.type(`${FOCUS_OUT}${FOCUS_IN}`);
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

  it('recognises a focus report the moment it arrives', () => {
    const h = harness();
    h.blur();
    expect(h.attention.isFocusReport('[O')).toBe(true);
    h.focus();
    expect(h.attention.isFocusReport('[I')).toBe(true);
  });

  it('treats the same text as typing once the report is old', () => {
    const h = harness();
    h.blur();
    h.tick(500);
    expect(h.attention.isFocusReport('[O')).toBe(false);
  });

  it('never mistakes ordinary text for a report', () => {
    const h = harness();
    h.blur();
    expect(h.attention.isFocusReport('[')).toBe(false);
    expect(h.attention.isFocusReport('hello')).toBe(false);
    expect(h.attention.isFocusReport('')).toBe(false);
  });

  it('is inert when disabled, down to the filter', () => {
    const h = harness({ enabled: false });
    h.attention.begin();
    h.blur();
    h.attention.set('blocked');
    h.attention.dispose();
    expect(h.written).toEqual([]);
    expect(h.listeners()).toBe(0);
    // Nothing was enabled, so nothing may be swallowed either.
    expect(h.attention.isFocusReport('[O')).toBe(false);
  });
});
