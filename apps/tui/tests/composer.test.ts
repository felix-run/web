import { describe, expect, it } from 'bun:test';
import { PassThrough } from 'node:stream';
import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { createElement } from 'react';
import { Composer, flattenPaste } from '../src/ui/composer';

/**
 * The one component with a test, and this is why.
 *
 * It runs under Bun rather than Vitest because it renders: the renderer reaches
 * its native core through FFI, which Node has only behind an experimental flag.
 * Everything else in this package is pure and stays on Vitest — see
 * `package.json`, where `test` is both.
 *
 * What is asserted is the message the composer *sends*, not the frame it draws.
 * The failure this pins is a paste that submits itself: a terminal that ignores
 * bracketed paste delivers a copied paragraph as raw bytes with newlines in
 * them, and a prompt that treats a bare linefeed as Enter sends half of it
 * before anyone has read it.
 */

const ESC = String.fromCharCode(27);
const ENTER = '\r';
const LF = '\n';
/** How a terminal in bracketed paste mode delivers a paste. */
const paste = (text: string) => `${ESC}[200~${text}${ESC}[201~`;
/** Shift+Enter, which only a terminal speaking the kitty protocol can say. */
const SHIFT_ENTER = `${ESC}[13;2u`;

async function mount(props: { history?: string[] } = {}) {
  const stdin = new PassThrough() as unknown as NodeJS.ReadStream;
  Object.assign(stdin, { isTTY: true, setRawMode: () => stdin, ref: () => {}, unref: () => {} });
  const stdout = new PassThrough() as unknown as NodeJS.WriteStream;
  stdout.resume();

  const submitted: string[] = [];
  const renderer = await createCliRenderer({
    stdin,
    stdout,
    width: 80,
    height: 12,
    exitOnCtrlC: false,
    useKittyKeyboard: {},
  });
  const root = createRoot(renderer);
  root.render(
    createElement(Composer, {
      streaming: false,
      disabled: false,
      onSubmit: (text: string) => submitted.push(text),
      ...(props.history ? { history: props.history } : {}),
    }),
  );
  // The renderable has to exist and take focus before bytes mean anything.
  await new Promise((r) => setTimeout(r, 300));

  /** One chunk, then a tick — a keyboard does not arrive all at once. */
  const feed = async (...chunks: string[]) => {
    for (const chunk of chunks) {
      (stdin as unknown as PassThrough).push(chunk);
      await new Promise((r) => setTimeout(r, 20));
    }
  };

  return {
    feed,
    submitted,
    stop: () => {
      root.unmount();
      renderer.destroy();
    },
  };
}

describe('the composer under a paste', () => {
  it('sends a pasted paragraph as one line, once Enter is pressed', async () => {
    const ui = await mount();
    try {
      await ui.feed(paste(`explain the proxy worker${LF}and the dev copy of it${LF}`));
      // A paste is never a send: what reaches the model is what was read.
      expect(ui.submitted).toEqual([]);
      await ui.feed(ENTER);
      expect(ui.submitted).toEqual(['explain the proxy worker and the dev copy of it']);
    } finally {
      ui.stop();
    }
  });

  /**
   * The regression this file exists for. With a bare linefeed bound to submit —
   * which is what a single-line input does — this paste sends `one` on its own
   * and leaves `two` behind.
   */
  it('does not send itself when the terminal does not bracket the paste', async () => {
    const ui = await mount();
    try {
      await ui.feed(`one${LF}two${LF}`);
      expect(ui.submitted).toEqual([]);
    } finally {
      ui.stop();
    }
  });
});

describe('the composer keys', () => {
  it('sends on Enter', async () => {
    const ui = await mount();
    try {
      await ui.feed('hello', ENTER);
      expect(ui.submitted).toEqual(['hello']);
    } finally {
      ui.stop();
    }
  });

  it('opens a second line on shift+Enter rather than sending', async () => {
    const ui = await mount();
    try {
      await ui.feed('first', SHIFT_ENTER, 'second');
      expect(ui.submitted).toEqual([]);
      await ui.feed(ENTER);
      expect(ui.submitted).toEqual([`first${LF}second`]);
    } finally {
      ui.stop();
    }
  });

  it('recalls the last prompt on up, while the draft is one line', async () => {
    const ui = await mount({ history: ['the first thing', 'the last thing'] });
    try {
      await ui.feed(`${ESC}[A`, ENTER);
      expect(ui.submitted).toEqual(['the last thing']);
    } finally {
      ui.stop();
    }
  });

  /**
   * Once there is a second line, the cursor has the better claim on ↑ than the
   * history does — there is somewhere to move to.
   */
  it('leaves up to the cursor once the draft has a second line', async () => {
    const ui = await mount({ history: ['the last thing'] });
    try {
      await ui.feed('typed', SHIFT_ENTER, 'more', `${ESC}[A`, ENTER);
      expect(ui.submitted).toEqual([`typed${LF}more`]);
    } finally {
      ui.stop();
    }
  });
});

describe('flattenPaste', () => {
  it('joins lines with a space rather than running the words together', () => {
    expect(flattenPaste(`one${LF}two`)).toBe('one two');
  });

  it('drops the trailing newline a copied block carries', () => {
    expect(flattenPaste(`one${LF}two${LF}`)).toBe('one two');
  });

  it('reads a blank line between paragraphs as one space', () => {
    expect(flattenPaste(`one${LF}${LF}two`)).toBe('one two');
  });

  it('handles the carriage-return spelling', () => {
    expect(flattenPaste(`one${ENTER}${LF}two${ENTER}${LF}`)).toBe('one two');
  });

  it('leaves a line with no newlines exactly as it is, spaces included', () => {
    expect(flattenPaste('trailing space ')).toBe('trailing space ');
  });
});
