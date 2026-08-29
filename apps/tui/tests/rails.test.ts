import { describe, expect, it } from 'bun:test';
import { RAIL_ROWS_MAX, railRows, railWindow } from '../src/ui/rails';

/**
 * The rail's window, and not the rail.
 *
 * Rendered components here are verified by running them — except where the failure
 * is invisible while you are running them, which this one was. The rail drew a
 * head slice, so a cursor past the last drawn row was a selection with nothing
 * on screen moving and an enter that opened a thread never shown. It looks
 * exactly like a dead keyboard, and only once you have more threads than rows.
 */
describe('railWindow', () => {
  it('draws the whole list when it fits', () => {
    expect(railWindow(6, 0, 20)).toEqual({ start: 0, end: 6 });
    expect(railWindow(6, 5, 20)).toEqual({ start: 0, end: 6 });
  });

  it('keeps the cursor inside the window at the end of a long list', () => {
    const { start, end } = railWindow(40, 39, 20);
    expect(end - start).toBe(20);
    expect(39).toBeGreaterThanOrEqual(start);
    expect(39).toBeLessThan(end);
    // Flush with the end: no empty rows below the last thread.
    expect(end).toBe(40);
  });

  it('does not scroll while the cursor is still near the top', () => {
    expect(railWindow(40, 0, 20)).toEqual({ start: 0, end: 20 });
    expect(railWindow(40, 9, 20)).toEqual({ start: 0, end: 20 });
  });

  it('holds the cursor in view everywhere in between', () => {
    for (let cursor = 0; cursor < 40; cursor += 1) {
      const { start, end } = railWindow(40, cursor, 20);
      expect(end - start).toBe(20);
      expect(cursor).toBeGreaterThanOrEqual(start);
      expect(cursor).toBeLessThan(end);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeLessThanOrEqual(40);
    }
  });

  it('survives an empty list and an out-of-range cursor', () => {
    expect(railWindow(0, 0, 20)).toEqual({ start: 0, end: 0 });
    expect(railWindow(0, 5, 20)).toEqual({ start: 0, end: 0 });
    expect(railWindow(40, -3, 20)).toEqual({ start: 0, end: 20 });
    expect(railWindow(40, 99, 20)).toEqual({ start: 20, end: 40 });
    expect(railWindow(40, 0, 0)).toEqual({ start: 0, end: 0 });
  });
});

/**
 * How tall the rail is allowed to be, which is a correctness question rather
 * than a cosmetic one.
 *
 * A column taller than the screen is not scrolled or shrunk here — it is drawn
 * *over* whatever is beneath it. At a flat twenty rows the rail covered the
 * composer and the status line in any terminal shorter than about 28, which
 * includes the 24 rows a terminal opens at by default: a client that looks
 * broken out of the box, on the size most likely to be used.
 */
describe('railRows', () => {
  it('leaves room for the composer and the status line', () => {
    // The rail's rows, plus its own chrome, plus what is drawn below it, has to
    // fit the screen — at every size a terminal is likely to open at.
    const CHROME_AND_PROMPT = 12;
    for (const height of [20, 24, 26, 28, 30, 40, 60]) {
      expect(railRows(height) + CHROME_AND_PROMPT).toBeLessThanOrEqual(height);
    }
  });

  it('stops growing once the list is as long as anyone reads', () => {
    expect(railRows(60)).toBe(RAIL_ROWS_MAX);
    expect(railRows(200)).toBe(RAIL_ROWS_MAX);
  });

  it('keeps a usable list in a terminal too short to deserve one', () => {
    // Three is the floor: fewer is not a list, and the alternative — letting it
    // shrink to nothing or overflow anyway — is worse than cramped.
    expect(railRows(10)).toBe(3);
    expect(railRows(1)).toBe(3);
    expect(railRows(0)).toBe(3);
    expect(railRows(-5)).toBe(3);
  });

  it('grows with the terminal in between', () => {
    expect(railRows(24)).toBeGreaterThan(railRows(20));
    expect(railRows(32)).toBeGreaterThan(railRows(24));
  });
});
