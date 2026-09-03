import { describe, expect, it } from 'bun:test';
import { createElement } from 'react';
import { Greeting } from '../src/ui/greeting';
import { lines, mount, shows, testTheme } from './render';

/**
 * A thread with nothing in it used to be nineteen blank rows above a composer,
 * which reads as a client that failed to load rather than one waiting for you.
 *
 * What it must *not* be is a wall of keys. The composer already carries its
 * hint along the bottom of its border and the status line already names the
 * manifest, the host and the directory — repeating them would make the first
 * screen the densest one. So what is asserted here is mostly restraint, plus
 * the one fact that is genuinely nowhere else.
 */

const props = { manifest: 'quick', workspace: 'felix-web', theme: testTheme };

describe('the empty thread', () => {
  it('says which agent, and where it is pointed', async () => {
    const ui = await mount(createElement(Greeting, { ...props, unattended: false }), {
      width: 78,
      height: 8,
    });
    try {
      const frame = ui.frame();
      expect(shows(frame, 'FELIX · quick')).toBe(true);
      expect(shows(frame, 'Working in felix-web')).toBe(true);
    } finally {
      ui.stop();
    }
  });

  /**
   * The most important fact about this client, and the only one not already on
   * screen: it is pointed at a real working directory. Reads are not confirmed
   * — the stated trade of running against your own files — and writes are.
   */
  it('states the read/write bargain', async () => {
    const ui = await mount(createElement(Greeting, { ...props, unattended: false }), {
      width: 78,
      height: 8,
    });
    try {
      expect(shows(ui.frame(), 'Reads it freely; asks before it writes')).toBe(true);
    } finally {
      ui.stop();
    }
  });

  /**
   * `--yes` removes the prompt entirely, which is a materially different and
   * more dangerous arrangement. The screen you see before typing anything is
   * exactly where that belongs, and it is not said quietly.
   */
  it('says plainly when --yes has removed the write prompt', async () => {
    const ui = await mount(createElement(Greeting, { ...props, unattended: true }), {
      width: 78,
      height: 8,
    });
    try {
      const frame = ui.frame();
      expect(shows(frame, 'Reads and writes it without asking (--yes)')).toBe(true);
      expect(frame).not.toContain('asks before');
      // In the danger colour, not the dim one the safe line uses.
      const style = ui
        .spans()
        .lines.flatMap((line) => line.spans)
        .find((span) => span.text.includes('without asking'));
      expect(style?.fg.toString()).toBe(testTheme.danger.toString());
    } finally {
      ui.stop();
    }
  });

  it('stays short — it is a greeting, not a manual', async () => {
    const ui = await mount(createElement(Greeting, { ...props, unattended: false }), {
      width: 78,
      height: 10,
    });
    try {
      // Wordmark, a blank, the bargain, the invitation.
      expect(lines(ui.frame()).length).toBeLessThanOrEqual(4);
      // And it does not restate what the composer and status line already say.
      expect(ui.frame()).not.toContain('ctrl+n');
      expect(ui.frame()).not.toContain('pgup');
    } finally {
      ui.stop();
    }
  });
});
