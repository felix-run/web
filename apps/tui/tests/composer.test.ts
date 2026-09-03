import { describe, expect, it } from 'bun:test';
import { createElement } from 'react';
import { Composer, flattenPaste } from '../src/ui/composer';
import { mount, shows, testTheme } from './render';

/**
 * The composer, driven the way a terminal drives it.
 *
 * What is asserted here is mostly the message the composer *sends*, not the
 * frame it draws — the failure this file exists for is a paste that submits
 * itself. A terminal that ignores bracketed paste delivers a copied paragraph
 * as raw bytes with newlines in them, and a prompt that treats a bare linefeed
 * as Enter sends half of it before anyone has read it. No hand-run reproduces
 * that reliably, which is why it is pinned.
 *
 * The bytes are the mock's problem now. This used to spell out `ESC [ 200 ~`
 * and `ESC [ 13 ; 2 u` inline and sleep 300ms per mount hoping React had got
 * there; `mockInput` knows the sequences and `settle()` knows when the frame has
 * stopped moving.
 */

const LF = '\n';

async function composer(props: { history?: string[]; streaming?: boolean } = {}) {
  const submitted: string[] = [];
  const ui = await mount(
    createElement(Composer, {
      theme: testTheme,
      streaming: props.streaming ?? false,
      disabled: false,
      onSubmit: (text: string) => submitted.push(text),
      ...(props.history ? { history: props.history } : {}),
    }),
    { width: 60, height: 6 },
  );
  return { ...ui, submitted };
}

describe('the composer under a paste', () => {
  it('sends a pasted paragraph as one line, once Enter is pressed', async () => {
    const ui = await composer();
    try {
      await ui.keys.pasteBracketedText(`explain the proxy worker${LF}and the dev copy of it${LF}`);
      await ui.settle();
      // A paste is never a send: what reaches the model is what was read.
      expect(ui.submitted).toEqual([]);
      ui.keys.pressEnter();
      await ui.settle();
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
    const ui = await composer();
    try {
      await ui.keys.typeText(`one${LF}two${LF}`);
      await ui.settle();
      expect(ui.submitted).toEqual([]);
    } finally {
      ui.stop();
    }
  });
});

describe('the composer keys', () => {
  it('sends on Enter', async () => {
    const ui = await composer();
    try {
      await ui.keys.typeText('hello');
      ui.keys.pressEnter();
      await ui.settle();
      expect(ui.submitted).toEqual(['hello']);
    } finally {
      ui.stop();
    }
  });

  it('opens a second line on shift+Enter rather than sending', async () => {
    const ui = await composer();
    try {
      await ui.keys.typeText('first');
      ui.keys.pressEnter({ shift: true });
      await ui.keys.typeText('second');
      await ui.settle();
      expect(ui.submitted).toEqual([]);
      ui.keys.pressEnter();
      await ui.settle();
      expect(ui.submitted).toEqual([`first${LF}second`]);
    } finally {
      ui.stop();
    }
  });

  it('recalls the last prompt on up, while the draft is one line', async () => {
    const ui = await composer({
      history: ['the first thing', 'the last thing'],
    });
    try {
      ui.keys.pressArrow('up');
      await ui.settle();
      ui.keys.pressEnter();
      await ui.settle();
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
    const ui = await composer({ history: ['the last thing'] });
    try {
      await ui.keys.typeText('typed');
      ui.keys.pressEnter({ shift: true });
      await ui.keys.typeText('more');
      ui.keys.pressArrow('up');
      await ui.settle();
      ui.keys.pressEnter();
      await ui.settle();
      expect(ui.submitted).toEqual([`typed${LF}more`]);
    } finally {
      ui.stop();
    }
  });
});

/**
 * The frame, now that it can be read.
 *
 * The marker and the placeholder are the composer's whole account of what Enter
 * will do — typing into a busy agent and having nothing happen is the failure
 * people report as "it froze", and the only thing standing between a user and
 * that impression is these two characters changing.
 */
describe('what the composer says it will do', () => {
  it('draws the ready marker and the hint', async () => {
    const ui = await mount(
      createElement(Composer, {
        theme: testTheme,
        streaming: false,
        disabled: false,
        onSubmit: () => {},
        hint: 'ask, /help, ctrl+e to open $EDITOR',
      }),
      { width: 60, height: 6 },
    );
    try {
      expect(ui.frame()).toContain('>');
      expect(shows(ui.frame(), 'ask, /help, ctrl+e to open $EDITOR')).toBe(true);
    } finally {
      ui.stop();
    }
  });

  it('swaps the marker and the hint while a run is live', async () => {
    const ui = await mount(
      createElement(Composer, {
        theme: testTheme,
        streaming: true,
        disabled: false,
        onSubmit: () => {},
        hint: 'steer the run…',
      }),
      { width: 60, height: 6 },
    );
    try {
      expect(ui.frame()).toContain('⇥');
      expect(shows(ui.frame(), 'steer the run')).toBe(true);
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
    expect(flattenPaste('one\r\ntwo\r\n')).toBe('one two');
  });

  it('leaves a line with no newlines exactly as it is, spaces included', () => {
    expect(flattenPaste('trailing space ')).toBe('trailing space ');
  });
});
