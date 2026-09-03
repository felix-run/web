import { describe, expect, it } from 'bun:test';
import type { ThreadMeta } from '@felix/client';
import { createElement } from 'react';
import { RAIL_ROWS_MAX, railRows, railWindow, StatusLine, ThreadPicker } from '../src/ui/rails';
import { lines, mount, shows, testTheme } from './render';

/**
 * The rail's arithmetic, and now the rail.
 *
 * `railWindow` was tested on its own because the failure it guards is invisible
 * while you are running the client: a head slice puts the cursor past the last
 * drawn row, so the selection moves with nothing on screen changing and `enter`
 * opens a thread that was never shown. It looks exactly like a dead keyboard,
 * and only once there are more threads than rows.
 *
 * The arithmetic tests stay — they are cheap and they say what the function
 * means. What is new is that the same claim is now made against a drawn frame,
 * which is the level the bug actually lived at.
 */

const threads = (count: number): ThreadMeta[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `t${i}`,
    title: `Thread ${i}`,
    manifest: 'quick',
    updatedAt: 1_700_000_000_000 - i,
  }));

describe('railWindow', () => {
  it('draws the whole list when it fits', () => {
    expect(railWindow(6, 0, 20)).toEqual({ start: 0, end: 6 });
  });

  it('keeps the cursor inside the window once the list outgrows it', () => {
    const { start, end } = railWindow(40, 30, 10);
    expect(30).toBeGreaterThanOrEqual(start);
    expect(30).toBeLessThan(end);
  });

  it('does not slide past either end', () => {
    expect(railWindow(40, 0, 10)).toEqual({ start: 0, end: 10 });
    expect(railWindow(40, 39, 10)).toEqual({ start: 30, end: 40 });
  });

  it('is empty when there is nothing, or no room', () => {
    expect(railWindow(0, 0, 10)).toEqual({ start: 0, end: 0 });
    expect(railWindow(10, 0, 0)).toEqual({ start: 0, end: 0 });
  });
});

describe('railRows', () => {
  it('never asks for more rows than the terminal has', () => {
    expect(railRows(24)).toBeLessThan(24);
  });

  it('stops growing past the cap', () => {
    expect(railRows(200)).toBe(RAIL_ROWS_MAX);
  });

  it('keeps at least three rows however short the terminal is', () => {
    expect(railRows(10)).toBe(3);
  });
});

describe('the thread picker as drawn', () => {
  it('marks the open thread and the cursor row separately', async () => {
    const ui = await mount(
      createElement(ThreadPicker, {
        theme: testTheme,
        threads: threads(4),
        activeId: 't1',
        cursor: 2,
        total: 4,
        rows: 10,
      }),
      { width: 40, height: 14 },
    );
    try {
      const frame = ui.frame();
      // The open thread carries the bullet wherever the cursor happens to be.
      expect(shows(frame, '• Thread 1')).toBe(true);
      expect(shows(frame, 'Thread 2')).toBe(true);
    } finally {
      ui.stop();
    }
  });

  /**
   * The regression the window exists for, at the level it broke: with a head
   * slice the cursor at row 30 is off the bottom of a twenty-row rail, and
   * nothing on screen says which thread `enter` would open.
   */
  it('draws the cursor row even when it is far down a long list', async () => {
    const ui = await mount(
      createElement(ThreadPicker, {
        theme: testTheme,
        threads: threads(40),
        activeId: 't0',
        cursor: 30,
        total: 40,
        rows: 10,
      }),
      { width: 40, height: 20 },
    );
    try {
      const frame = ui.frame();
      expect(shows(frame, 'Thread 30')).toBe(true);
      // And it says what is out of view in both directions.
      expect(frame).toContain('↑');
      expect(frame).toContain('↓');
    } finally {
      ui.stop();
    }
  });

  it('says how much the filter narrowed things to, and that nothing matched', async () => {
    const narrowed = await mount(
      createElement(ThreadPicker, {
        theme: testTheme,
        threads: threads(3),
        activeId: 't0',
        cursor: 0,
        filter: 'thr',
        total: 40,
        rows: 10,
      }),
      { width: 40, height: 14 },
    );
    try {
      expect(shows(narrowed.frame(), '/thr · 3/40')).toBe(true);
    } finally {
      narrowed.stop();
    }

    const empty = await mount(
      createElement(ThreadPicker, {
        theme: testTheme,
        threads: [],
        activeId: 't0',
        cursor: 0,
        filter: 'zzz',
        total: 40,
        rows: 10,
      }),
      { width: 40, height: 14 },
    );
    try {
      expect(shows(empty.frame(), 'no match · esc clears')).toBe(true);
    } finally {
      empty.stop();
    }
  });

  it('says so when there are no threads at all', async () => {
    const ui = await mount(
      createElement(ThreadPicker, {
        theme: testTheme,
        threads: [],
        activeId: '',
        cursor: 0,
        total: 0,
        rows: 10,
      }),
      { width: 40, height: 14 },
    );
    try {
      expect(shows(ui.frame(), '(none yet)')).toBe(true);
    } finally {
      ui.stop();
    }
  });

  /**
   * The rail is sized to its rows, not to the row it sits in. A flex child
   * stretches by default, which drew the border down the whole screen with a
   * dozen empty rows under the last thread.
   */
  it('is only as tall as it needs to be', async () => {
    const ui = await mount(
      createElement(ThreadPicker, {
        theme: testTheme,
        threads: threads(3),
        activeId: 't0',
        cursor: 0,
        total: 3,
        rows: 10,
      }),
      { width: 40, height: 20 },
    );
    try {
      // border + header + three rows + border, and nothing past it.
      expect(lines(ui.frame()).length).toBeLessThanOrEqual(7);
    } finally {
      ui.stop();
    }
  });
});

describe('the status line', () => {
  const base = {
    manifest: 'quick',
    origin: 'http://localhost:8080',
    phase: 'idle',
    reattaching: false,
    error: null,
    root: '/Users/blake/Projects/felix-web',
  };

  /**
   * It has to stay one row. A status line that wraps pushes the composer up the
   * screen every time the working directory is long.
   */
  it('cuts rather than wraps, however narrow the terminal', async () => {
    const ui = await mount(
      createElement(StatusLine, {
        theme: testTheme,
        ...base,
        root: '/a/very/long/working/directory/that/will/not/fit/anywhere',
        hint: 'tab threads · ctrl+n new · ctrl+e editor · /help',
        width: 60,
      }),
      { width: 60, height: 6 },
    );
    try {
      expect(lines(ui.frame()).length).toBe(1);
      expect(ui.frame()).toContain('…');
    } finally {
      ui.stop();
    }
  });

  /**
   * Both halves are shortened *before* the cut, not after. An absolute path and
   * a full origin spend forty columns on two things whose useful part is at the
   * end — and then the cut takes the end, leaving `/Users/blake…`, which names
   * no directory at all.
   */
  it('names the manifest, the host and the directory, without the parts nobody reads', async () => {
    const ui = await mount(
      createElement(StatusLine, {
        theme: testTheme,
        ...base,
        hint: 'tab threads',
        width: 100,
      }),
      { width: 100, height: 6 },
    );
    try {
      const frame = ui.frame();
      expect(shows(frame, 'quick · localhost:8080 · felix-web')).toBe(true);
      // The scheme is the same on every line of every terminal.
      expect(frame).not.toContain('http://');
      // And the directory is identifiable rather than cut back to its root.
      expect(frame).not.toContain('/Users');
      expect(shows(frame, 'tab threads')).toBe(true);
    } finally {
      ui.stop();
    }
  });

  /**
   * Which directory the agent is pointed at is not discoverable anywhere else
   * on a thread that has messages in it; the keys are also in `/help` and on
   * the composer's own border. Serving the keys first is what cut `felix-web`
   * back to `fel…` on an eighty-four column terminal.
   */
  it('gives the state its room before the keys, and keeps a gap between them', async () => {
    const ui = await mount(
      createElement(StatusLine, {
        theme: testTheme,
        ...base,
        hint: 'tab threads · ctrl+n new · pgup/pgdn scroll · /help',
        width: 84,
      }),
      { width: 84, height: 6 },
    );
    try {
      const row = lines(ui.frame())[0] ?? '';
      expect(row).toContain('felix-web');
      // Cut from the keys' tail, which is written in falling usefulness.
      expect(row).toContain('tab threads');
      expect(row).toContain('…');
      // `space-between` gives no gap when the halves add up to exactly the row.
      expect(row).toMatch(/felix-web {2,}tab/);
    } finally {
      ui.stop();
    }
  });

  /** However narrow it gets, the pair worth knowing on a first run survives. */
  it('keeps the opening keys even when the state has to give way', async () => {
    const ui = await mount(
      createElement(StatusLine, {
        theme: testTheme,
        ...base,
        hint: 'tab threads · ctrl+n new · pgup/pgdn scroll · /help',
        width: 44,
      }),
      { width: 44, height: 6 },
    );
    try {
      const row = lines(ui.frame())[0] ?? '';
      expect(row).toContain('tab threads');
      expect(lines(ui.frame()).length).toBe(1);
    } finally {
      ui.stop();
    }
  });

  it('shows the phase only while it is something other than idle', async () => {
    const idle = await mount(createElement(StatusLine, { theme: testTheme, ...base, width: 100 }), {
      width: 100,
      height: 6,
    });
    try {
      expect(idle.frame()).not.toContain('idle');
    } finally {
      idle.stop();
    }

    const busy = await mount(
      createElement(StatusLine, {
        theme: testTheme,
        ...base,
        phase: 'turn',
        width: 100,
      }),
      {
        width: 100,
        height: 6,
      },
    );
    try {
      expect(shows(busy.frame(), '· turn')).toBe(true);
    } finally {
      busy.stop();
    }
  });

  /**
   * A reattach is a materially different claim from a live run — the original
   * was torn down, so this is showing what landed rather than a reply still
   * being written.
   */
  it('separates an error and a reattach from the state line', async () => {
    const ui = await mount(
      createElement(StatusLine, {
        theme: testTheme,
        ...base,
        reattaching: true,
        error: 'the harness refused that',
        width: 100,
      }),
      { width: 100, height: 6 },
    );
    try {
      const rows = lines(ui.frame());
      expect(rows[0]).toBe('the harness refused that');
      expect(rows[1]).toBe('rejoining the thread…');
    } finally {
      ui.stop();
    }
  });
});
