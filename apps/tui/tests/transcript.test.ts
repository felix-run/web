import { describe, expect, it } from 'bun:test';
import type { Turn } from '@felix/client';
import { createTextAttributes, type ScrollBoxRenderable } from '@opentui/core';
import { createElement } from 'react';
import { Transcript } from '../src/ui/transcript';
import { hasAttribute, lines, mount, shows, styleOf, testTheme } from './render';

/**
 * What the conversation actually looks like.
 *
 * Two of these were written the other way round one commit ago, when assistant
 * messages went through a hand-rolled stripper that deleted `**` and `` ` ``
 * and drew every fence in one flat colour. They are kept, inverted, because
 * what they assert now is precisely what was lost then: emphasis that carries
 * weight, an inline span that is distinguishable from prose, and a fence whose
 * keywords and literals are told apart.
 *
 * Colour is asserted through `spans()` rather than `frame()`, because the whole
 * failure mode here is text that is *present and unstyled* — a character frame
 * cannot tell that apart from text that is right.
 */

const DIM = createTextAttributes({ dim: true });
const BOLD = createTextAttributes({ bold: true });

const user = (content: string): Turn => ({
  id: `u-${content}`,
  role: 'user',
  content,
});

describe('a user turn', () => {
  it('is marked and set apart from the reply', async () => {
    const ui = await mount(
      createElement(Transcript, {
        theme: testTheme,
        turns: [user('explain the proxy')],
      }),
      {
        width: 60,
        height: 8,
      },
    );
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
    const ui = await mount(createElement(Transcript, { theme: testTheme, turns: [reply] }), {
      width: 60,
      height: 16,
    });
    try {
      await ui.until(() => shows(ui.frame(), '- two'));
      const frame = ui.frame();
      expect(shows(frame, 'const a = 1;')).toBe(true);
      expect(shows(frame, '- one')).toBe(true);
      expect(shows(frame, '- two')).toBe(true);
    } finally {
      ui.stop();
    }
  });

  /**
   * The markers are still hidden — `conceal` is on, and nobody wants to read
   * asterisks — but the word now carries the weight they asked for. Asserting
   * only the text would pass against the stripper this replaced.
   */
  it('renders bold as weight and inline code as its own colour', async () => {
    const ui = await mount(createElement(Transcript, { theme: testTheme, turns: [reply] }), {
      width: 60,
      height: 16,
    });
    try {
      await ui.until(() => shows(ui.frame(), 'Here is bold and code:'));
      const frame = ui.frame();
      expect(shows(frame, 'Here is bold and code:')).toBe(true);
      expect(frame).not.toContain('**');

      const bold = styleOf(ui.spans(), 'bold');
      expect(bold?.text).toBe('bold');
      expect(hasAttribute(bold?.attributes ?? 0, BOLD)).toBe(true);

      // And the inline span is told apart from the prose around it by colour,
      // which is the only signal left once the backticks are concealed.
      const code = styleOf(ui.spans(), 'code');
      expect(code?.text).toBe('code');
      expect(code?.fg).not.toEqual(styleOf(ui.spans(), 'Here is ')?.fg);
    } finally {
      ui.stop();
    }
  });

  /**
   * A fence is parsed, not printed. `const` is a keyword and `1` is a literal,
   * and they are drawn differently — where every language used to arrive in one
   * flat colour.
   */
  it('highlights a fenced block with tree-sitter', async () => {
    const ui = await mount(createElement(Transcript, { theme: testTheme, turns: [reply] }), {
      width: 60,
      height: 16,
    });
    try {
      // Highlighting is what is being asserted, so wait for the colour rather
      // than for the text — the unhighlighted frame has the text already.
      await ui.until(() => {
        const span = styleOf(ui.spans(), 'const');
        return span?.text === 'const';
      });
      const keyword = styleOf(ui.spans(), 'const');
      const literal = styleOf(ui.spans(), '1');
      expect(keyword?.text).toBe('const');
      expect(literal).not.toBeNull();
      expect(keyword?.fg).not.toEqual(literal?.fg);
    } finally {
      ui.stop();
    }
  });

  it('reports the turn cost when the harness sent one', async () => {
    const ui = await mount(createElement(Transcript, { theme: testTheme, turns: [reply] }), {
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

/**
 * A reply arrives a character at a time, and the state that matters is the one
 * halfway through a fence. This is what `tests/markdown.test.ts` used to pin on
 * the hand-rolled splitter; the renderer's `streaming` flag is what carries it
 * now, and getting it backwards either hard-parses an unclosed fence or leaves
 * a finished message permanently provisional.
 */
describe('a reply still being written', () => {
  const halfway: Turn = {
    id: 'a-live',
    role: 'assistant',
    content: 'Let me show you:\n\n```ts\nconst partial = ',
    tools: [],
  };

  it('renders an unterminated fence as code rather than as prose', async () => {
    const ui = await mount(
      createElement(Transcript, {
        theme: testTheme,
        turns: [halfway],
        streaming: true,
      }),
      {
        width: 60,
        height: 14,
      },
    );
    try {
      await ui.until(() => styleOf(ui.spans(), 'const')?.text === 'const');
      // The fence markers are concealed, the contents are kept, and `const` is
      // still a keyword rather than a word in a paragraph.
      expect(ui.frame()).not.toContain('```');
      expect(shows(ui.frame(), 'const partial =')).toBe(true);
      const keyword = styleOf(ui.spans(), 'const');
      expect(keyword?.fg).not.toEqual(styleOf(ui.spans(), 'Let me show you')?.fg);
    } finally {
      ui.stop();
    }
  });

  /**
   * Only the turn being written is live. A turn with a later one after it was
   * finished by whatever produced that one.
   */
  it('treats an earlier turn as settled even while a run is streaming', async () => {
    const ui = await mount(
      createElement(Transcript, {
        theme: testTheme,
        turns: [
          halfway,
          {
            id: 'a-next',
            role: 'assistant',
            content: 'done',
            tools: [],
          } as Turn,
        ],
        streaming: true,
      }),
      { width: 60, height: 14 },
    );
    try {
      await ui.until(() => shows(ui.frame(), 'done'));
      expect(shows(ui.frame(), 'done')).toBe(true);
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
    const ui = await mount(
      createElement(Transcript, { theme: testTheme, turns: [withTool(true)] }),
      {
        width: 60,
        height: 8,
      },
    );
    try {
      expect(shows(ui.frame(), '⎿ read_file worker/index.ts')).toBe(true);
    } finally {
      ui.stop();
    }
  });

  /**
   * A run that is still working and a run that has finished must not look the
   * same. A card frozen on one glyph for thirty seconds and a card whose
   * process died look identical, which is why the running one turns.
   */
  it('turns a spinner while it is still running, and names the phase', async () => {
    const ui = await mount(
      createElement(Transcript, {
        theme: testTheme,
        turns: [withTool(false, 'executing')],
      }),
      {
        width: 60,
        height: 8,
      },
    );
    try {
      const frame = ui.frame();
      expect(shows(frame, 'read_file')).toBe(true);
      expect(shows(frame, 'executing')).toBe(true);
      // Not the finished marker, and one of the spinner's frames.
      expect(frame).not.toContain('⎿');
      expect(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(frame)).toBe(true);
    } finally {
      ui.stop();
    }
  });

  it('marks a tool the browser ran, and one waiting on a decision', async () => {
    const ui = await mount(
      createElement(Transcript, {
        theme: testTheme,
        turns: [
          {
            id: 'a3',
            role: 'assistant',
            content: '',
            tools: [
              {
                name: 'client · read_file',
                input: { path: 'a.ts' },
                done: true,
              },
              {
                name: 'approval · write_file',
                input: { path: 'b.ts' },
                done: false,
              },
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
        theme: testTheme,
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

/**
 * Reading back through a conversation that has outgrown the screen.
 *
 * Before this, the scroll box was there and nothing could reach it: it is
 * focusable and implements every scroll key already, but the composer holds
 * focus and no binding handed it anything. Everything above the fold was
 * unreachable without a mouse — and a mouse is exactly what an ssh session or a
 * tmux window with reporting off does not have.
 */
describe('scrolling the transcript', () => {
  const many = Array.from(
    { length: 40 },
    (_, i) => ({ id: `u${i}`, role: 'user', content: `line ${i}` }) as Turn,
  );

  it('starts at the live end of the conversation', async () => {
    const ui = await mount(createElement(Transcript, { theme: testTheme, turns: many }), {
      width: 40,
      height: 10,
    });
    try {
      expect(shows(ui.frame(), 'line 39')).toBe(true);
      expect(ui.frame()).not.toContain('line 0 ');
    } finally {
      ui.stop();
    }
  });

  it('scrolls back to what has gone off the top, and returns', async () => {
    const box: { current: ScrollBoxRenderable | null } = { current: null };
    const ui = await mount(
      createElement(Transcript, {
        theme: testTheme,
        turns: many,
        scrollRef: box,
      }),
      {
        width: 40,
        height: 10,
      },
    );
    try {
      expect(box.current).not.toBeNull();
      const bottom = box.current?.scrollTop ?? 0;
      expect(bottom).toBeGreaterThan(0);

      // Half a viewport a press, which is what `App` binds pgup/pgdn to.
      box.current?.scrollBy(-1 / 2, 'viewport');
      await ui.settle();
      expect(box.current?.scrollTop).toBeLessThan(bottom);

      box.current?.scrollTo({ x: 0, y: Number.MAX_SAFE_INTEGER });
      await ui.settle();
      expect(shows(ui.frame(), 'line 39')).toBe(true);
    } finally {
      ui.stop();
    }
  });
});

describe('reasoning', () => {
  it('is drawn quietly, and on one line', async () => {
    const ui = await mount(
      createElement(Transcript, {
        theme: testTheme,
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
