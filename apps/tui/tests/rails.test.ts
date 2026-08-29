import { describe, expect, it } from 'bun:test';
import { railWindow } from '../src/ui/rails';

/**
 * The rail's window, and not the rail.
 *
 * Ink components here are verified by running them — except where the failure
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
