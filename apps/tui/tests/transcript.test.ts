import { describe, expect, it } from 'bun:test';
import type { Turn } from '@felix/client';
import { createTextAttributes } from '@opentui/core';
import { createElement } from 'react';
import { Transcript } from '../src/ui/transcript';
import { hasAttribute, lines, mount, shows, styleOf } from './render';

/**
 * What the conversation actually looks like.
 *
 * This is a characterization test before a rewrite, so a good half of it pins
 * behaviour that is **wrong** and says so. The transcript runs assistant
 * messages through a hand-rolled markdown stripper: `**bold**` arrives as
 * `bold`, an inline `` `span` `` loses its backticks, and a fenced block is
 * drawn as one flat colour with the language on a dim line above it. That is
 * the deliberate trade the module was written to make, and replacing it with
 * the renderer's own markdown is the point of the next change — so the
 * assertions below exist to make that diff legible rather than to defend the
 * current output.
 *
 * The parts that are simply correct — the user's marker, the tool card's two
 * states, the usage line, list markers that line up — are pinned as themselves.
 */

const DIM = createTextAttributes({ dim: true });

const user = (content: string): Turn => ({ id: `u-${content}`, role: 'user', content });

describe('a user turn', () => {
  it('is marked and set apart from the reply', async () => {
    const ui = await mount(createElement(Transcript, { turns: [user('explain the proxy')] }), {
      width: 60,
      height: 8,
    });
    try {
      expect(lines(ui.frame())[0]).toBe('› explain the proxy');
    } finally {
      ui.stop();
    }
  });
});

describe('an assistant turn', () => {
  const reply: Turn = {
    id: 'a1',
    role: 'assistant',
    content: 'Here is **bold** and `code`:\n\n```ts\nconst a = 1;\n```\n\n- one\n- two',
    tools: [],
    usage: { input: 120, output: 40 },
  };

  it('draws prose, the fence and the list', async () => {
    const ui = await mount(createElement(Transcript, { turns: [reply] }), {
      width: 60,
      height: 16,
    });
    try {
      const frame = ui.frame();
      expect(shows(frame, 'const a = 1;')).toBe(true);
      // Markers become glyphs that line up rather than staying as `-`.
      expect(shows(frame, '• one')).toBe(true);
      expect(shows(frame, '• two')).toBe(true);
    } finally {
      ui.stop();
    }
  });

  /**
   * The finding this whole change is for, stated as a test so the fix shows up
   * as an inversion rather than as a new file. Today the emphasis markers are
   * deleted and nothing takes their place: the word is drawn, the weight is not.
   */
  it('LOSES bold and inline code — the markers are stripped, not rendered', async () => {
    const ui = await mount(createElement(Transcript, { turns: [reply] }), {
      width: 60,
      height: 16,
    });
    try {
      const frame = ui.frame();
      expect(shows(frame, 'Here is bold and code:')).toBe(true);
      expect(frame).not.toContain('**');
      expect(frame).not.toContain('`');
      // And the word that asked to be bold is drawn at the same weight as the
      // rest of the line.
      const bold = styleOf(ui.spans(), 'Here is bold');
      expect(bold).not.toBeNull();
      expect(hasAttribute(bold?.attributes ?? 0, createTextAttributes({ bold: true }))).toBe(false);
    } finally {
      ui.stop();
    }
  });

  it('labels the fence with its language, dimly', async () => {
    const ui = await mount(createElement(Transcript, { turns: [reply] }), {
      width: 60,
      height: 16,
    });
    try {
      const label = styleOf(ui.spans(), 'ts');
      expect(label).not.toBeNull();
      expect(hasAttribute(label?.attributes ?? 0, DIM)).toBe(true);
    } finally {
      ui.stop();
    }
  });

  it('reports the turn cost when the harness sent one', async () => {
    const ui = await mount(createElement(Transcript, { turns: [reply] }), {
      width: 60,
      height: 16,
    });
    try {
      expect(shows(ui.frame(), '120 in / 40 out')).toBe(true);
    } finally {
      ui.stop();
    }
  });
});

describe('a tool card', () => {
  const withTool = (done: boolean, phase?: string): Turn => ({
    id: 'a2',
    role: 'assistant',
    content: '',
    tools: [
      {
        name: 'read_file',
        input: { path: 'worker/index.ts' },
        done,
        ...(phase ? { phase } : {}),
      },
    ],
  });

  it('says which tool and, in one line, what it was given', async () => {
    const ui = await mount(createElement(Transcript, { turns: [withTool(true)] }), {
      width: 60,
      height: 8,
    });
    try {
      expect(shows(ui.frame(), '⎿ read_file worker/index.ts')).toBe(true);
    } finally {
      ui.stop();
    }
  });

  /**
   * A run that is still working and a run that has finished must not look the
   * same. This is the only signal the transcript gives that anything is live.
   */
  it('uses a different glyph while it is still running, and names the phase', async () => {
    const ui = await mount(createElement(Transcript, { turns: [withTool(false, 'executing')] }), {
      width: 60,
      height: 8,
    });
    try {
      const frame = ui.frame();
      expect(shows(frame, '⠿ read_file')).toBe(true);
      expect(shows(frame, 'executing')).toBe(true);
    } finally {
      ui.stop();
    }
  });

  it('marks a tool the browser ran, and one waiting on a decision', async () => {
    const ui = await mount(
      createElement(Transcript, {
        turns: [
          {
            id: 'a3',
            role: 'assistant',
            content: '',
            tools: [
              { name: 'client · read_file', input: { path: 'a.ts' }, done: true },
              { name: 'approval · write_file', input: { path: 'b.ts' }, done: false },
            ],
          } as Turn,
        ],
      }),
      { width: 70, height: 8 },
    );
    try {
      const frame = ui.frame();
      expect(shows(frame, 'read_file a.ts · local')).toBe(true);
      expect(shows(frame, 'write_file b.ts · awaiting approval')).toBe(true);
    } finally {
      ui.stop();
    }
  });

  it('cuts a long argument to one line rather than wrapping it', async () => {
    const ui = await mount(
      createElement(Transcript, {
        turns: [
          {
            id: 'a4',
            role: 'assistant',
            content: '',
            tools: [{ name: 'bash', input: { command: 'x'.repeat(200) }, done: true }],
          } as Turn,
        ],
      }),
      { width: 100, height: 8 },
    );
    try {
      expect(ui.frame()).toContain('…');
      expect(lines(ui.frame()).length).toBe(1);
    } finally {
      ui.stop();
    }
  });
});

describe('reasoning', () => {
  it('is drawn quietly, and on one line', async () => {
    const ui = await mount(
      createElement(Transcript, {
        turns: [
          {
            id: 'a5',
            role: 'assistant',
            content: '',
            tools: [],
            reasoning: [{ text: 'The proxy strips the prefix\nthen forwards upstream.' }],
          } as unknown as Turn,
        ],
      }),
      { width: 70, height: 8 },
    );
    try {
      const style = styleOf(ui.spans(), 'The proxy strips');
      expect(style).not.toBeNull();
      expect(hasAttribute(style?.attributes ?? 0, DIM)).toBe(true);
      expect(lines(ui.frame()).length).toBe(1);
    } finally {
      ui.stop();
    }
  });
});
