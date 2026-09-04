import { describe, expect, it } from 'bun:test';
import type { KeyEvent } from '@opentui/core';
import { type KeyState, route } from '../src/keys';

/**
 * The precedence chain, decided without a terminal.
 *
 * Every rung here used to be reachable only by mounting the whole app and
 * pressing a key, which is why the rule that matters most — a blocking prompt
 * owns the keyboard — went unpinned for as long as it did. The next overlay
 * added to this client will be one guard away from stealing `y` from an
 * approval banner, and these are what fail when it does.
 */

const key = (name: string, mod: Partial<KeyEvent> = {}): KeyEvent =>
  ({ name, ctrl: false, meta: false, shift: false, ...mod }) as KeyEvent;

const state = (over: Partial<KeyState> = {}): KeyState => ({
  blocked: false,
  streaming: false,
  quitArmed: false,
  railFocused: false,
  railFilter: '',
  consoleAvailable: false,
  ...over,
});

describe('a blocking prompt owns the keyboard', () => {
  // `useKeyboard` is global and a child's handler runs before the parent's, so
  // the banner has already seen the key by the time this function is asked.
  // This early return is the whole mechanism — not `preventDefault`, which only
  // gates the focused renderable.
  for (const k of ['tab', 'escape', 'up', 'down', 'return', 'y', 'n']) {
    it(`claims nothing on ${k} while a run waits on a person`, () => {
      expect(route(key(k), state({ blocked: true }))).toBeNull();
    });
  }

  it('still lets ctrl+c stop the run', () => {
    expect(route(key('c', { ctrl: true }), state({ blocked: true, streaming: true }))).toEqual({
      kind: 'stop',
    });
  });

  it('still lets the transcript be read', () => {
    // Reading back while an approval is on screen is a reasonable thing to want.
    expect(route(key('pageup'), state({ blocked: true }))).toEqual({ kind: 'scroll', by: -0.5 });
  });
});

describe('ctrl+c is stop, then quit', () => {
  it('stops a live run on the first press', () => {
    expect(route(key('c', { ctrl: true }), state({ streaming: true }))).toEqual({ kind: 'stop' });
  });

  it('quits on the second', () => {
    expect(route(key('c', { ctrl: true }), state({ streaming: true, quitArmed: true }))).toEqual({
      kind: 'quit',
    });
  });

  it('quits outright when nothing is running', () => {
    expect(route(key('c', { ctrl: true }), state())).toEqual({ kind: 'quit' });
  });
});

describe('the rail takes the keyboard whole', () => {
  const rail = (over: Partial<KeyState> = {}) => state({ railFocused: true, ...over });

  it('closes on tab, and on escape with no filter', () => {
    expect(route(key('tab'), rail())).toEqual({ kind: 'close-rail' });
    expect(route(key('escape'), rail())).toEqual({ kind: 'close-rail' });
  });

  it('escape clears the filter first, rather than stopping the run', () => {
    // esc means something different in here, which is the price of a mode that
    // reads plain text.
    expect(route(key('escape'), rail({ railFilter: 'pro', streaming: true }))).toEqual({
      kind: 'clear-filter',
    });
  });

  it('reads plain characters as filter text', () => {
    expect(route(key('p'), rail())).toEqual({ kind: 'filter-append', char: 'p' });
  });

  it('consumes what it cannot use rather than letting it through', () => {
    // Falling through would filter the list *and* type into the composer behind
    // it — the hazard the whole one-owner rule exists to prevent.
    expect(route(key('left'), rail())).toEqual({ kind: 'consume' });
    expect(route(key('f5'), rail())).toEqual({ kind: 'consume' });
    expect(route(key('a', { ctrl: true }), rail())).toEqual({ kind: 'consume' });
  });

  it('moves and opens', () => {
    expect(route(key('up'), rail())).toEqual({ kind: 'rail-move', by: -1 });
    expect(route(key('down'), rail())).toEqual({ kind: 'rail-move', by: 1 });
    expect(route(key('return'), rail())).toEqual({ kind: 'rail-open-selected' });
  });
});

describe('normal mode', () => {
  it('escape aborts only while streaming', () => {
    expect(route(key('escape'), state({ streaming: true }))).toEqual({ kind: 'abort' });
    expect(route(key('escape'), state())).toBeNull();
  });

  it('tab opens the rail, ctrl+n starts a thread', () => {
    expect(route(key('tab'), state())).toEqual({ kind: 'open-rail' });
    expect(route(key('n', { ctrl: true }), state())).toEqual({ kind: 'new-thread' });
  });

  it('leaves ctrl+d unbound when there is no overlay to toggle', () => {
    // A key that silently does nothing is worse than one that is not bound.
    expect(route(key('d', { ctrl: true }), state())).toBeNull();
    expect(route(key('d', { ctrl: true }), state({ consoleAvailable: true }))).toEqual({
      kind: 'toggle-console',
    });
  });

  it('claims nothing it does not own, so the composer can type', () => {
    expect(route(key('a'), state())).toBeNull();
    expect(route(key('return'), state())).toBeNull();
    expect(route(key('up'), state())).toBeNull();
  });
});
