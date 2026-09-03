import { describe, expect, it } from 'bun:test';
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

function harness(options: { enabled?: boolean; attach?: boolean } = {}) {
  const written: string[] = [];
  const titles: string[] = [];
  const notifications: string[] = [];
  const attention = createAttention({
    stdout: { write: (chunk: string) => written.push(chunk) },
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
  });
  // The title and the notification belong to the renderer now; only the two
  // sequences it has no equivalent for — the title stack push and pop, and the
  // focus-reporting request — still go to stdout.
  if (options.attach !== false) {
    attention.attach({
      setTerminalTitle: (title: string) => titles.push(title),
      triggerNotification: (message: string) => {
        notifications.push(message);
        return true;
      },
    });
  }
  // Every test but the "before begin" ones starts from a live terminal.
  if (options.enabled !== false) attention.begin();

  return {
    attention,
    written,
    blur: () => attention.setFocus(false),
    focus: () => attention.setFocus(true),
    notifications: () => notifications,
    titles: () => titles,
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
    const titles: string[] = [];
    const attention = createAttention({
      stdout: { write: (c: string) => written.push(c) },
    });
    attention.attach({
      setTerminalTitle: (t: string) => titles.push(t),
      triggerNotification: () => true,
    });
    attention.set('working');
    expect(written).toEqual([]);
    expect(titles).toEqual([]);
  });

  /**
   * The renderer does not exist when this module is built — `main.tsx` has to
   * construct it first so `App` can be handed it. Until it arrives there is
   * nothing to write a title through, and the answer is to write nothing rather
   * than to fall back to raw sequences that would race the renderer's setup.
   */
  it('is quiet until the renderer arrives, then catches the title up', () => {
    const h = harness({ attach: false });
    h.attention.set('blocked');
    expect(h.titles()).toEqual([]);

    const titles: string[] = [];
    h.attention.attach({
      setTerminalTitle: (t: string) => titles.push(t),
      triggerNotification: () => true,
    });
    // The title is a level, not an edge: the state reached while it was absent
    // has to land now, or the window keeps the shell's title through the run.
    expect(titles).toHaveLength(1);
    expect(titles[0]).toContain('Approve');
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
    expect(h.titles()).toEqual([]);
    expect(h.notifications()).toEqual([]);
  });
});
