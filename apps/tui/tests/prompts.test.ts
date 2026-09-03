import { describe, expect, it } from 'bun:test';
import type { PendingApproval } from '@felix/client';
import type { PendingUiRequest } from '@felix/protocol';
import { createElement } from 'react';
import { ApprovalPrompt, UiPrompt, WritePrompt } from '../src/ui/prompts';
import { lines, mount, shows } from './render';

/**
 * The three things a run can block on.
 *
 * None of these had a test, and all three are the moment the client is least
 * forgiving: the run is stopped until one of them is answered, so a banner that
 * draws without its keys, or answers a key it should not have, hangs the
 * conversation with nothing on screen to explain it.
 *
 * Two of the assertions here pin behaviour that the next change replaces
 * outright — the select kind's hand-drawn cursor and the text kind's
 * character-at-a-time accumulator. They are written as characterization, not as
 * endorsement, and each says so.
 */

const approval: PendingApproval = {
  approvalId: 'ap-1',
  toolName: 'write_file',
  args: { path: 'apps/tui/src/app.tsx', content: 'export const a = 1;\n' },
  before: 'export const a = 0;\n',
};

describe('the approval banner', () => {
  it('names the tool and the keys that answer it', async () => {
    const ui = await mount(
      createElement(ApprovalPrompt, { pending: approval, onDecide: () => {} }),
      { width: 70, height: 12 },
    );
    try {
      const frame = ui.frame();
      expect(shows(frame, 'approval · write_file')).toBe(true);
      expect(shows(frame, 'y approve · n deny')).toBe(true);
    } finally {
      ui.stop();
    }
  });

  it('answers y and n, and nothing else', async () => {
    const decisions: string[] = [];
    const ui = await mount(
      createElement(ApprovalPrompt, {
        pending: approval,
        onDecide: (status: string) => decisions.push(status),
      }),
      { width: 70, height: 12 },
    );
    try {
      await ui.keys.typeText('q');
      await ui.settle();
      expect(decisions).toEqual([]);
      await ui.keys.typeText('y');
      await ui.settle();
      expect(decisions).toEqual(['approved']);
      await ui.keys.typeText('n');
      await ui.settle();
      expect(decisions).toEqual(['approved', 'denied']);
    } finally {
      ui.stop();
    }
  });

  /**
   * The evidence a person is given before authorizing a write to their own
   * disk. Today it is a character count — the file's actual before and after
   * are both available and neither is shown, which is what the diff view
   * replaces.
   */
  it('summarises the write as a CHARACTER COUNT rather than a diff', async () => {
    const ui = await mount(
      createElement(ApprovalPrompt, { pending: approval, onDecide: () => {} }),
      { width: 70, height: 12 },
    );
    try {
      const frame = ui.frame();
      expect(shows(frame, 'replaces 20 chars already in that file')).toBe(true);
      // Neither side of the change is on screen.
      expect(frame).not.toContain('export const a = 0;');
    } finally {
      ui.stop();
    }
  });
});

describe('the agent question', () => {
  const select: PendingUiRequest = {
    requestId: 'ui-1',
    kind: 'select',
    prompt: 'Which worker should I look at?',
    options: [
      { value: 'proxy', label: 'The proxy Worker' },
      { value: 'docs', label: 'The docs Worker' },
    ],
  };

  it('draws the question and its options', async () => {
    const ui = await mount(
      createElement(UiPrompt, {
        pending: select,
        busy: false,
        onRespond: () => {},
        onCancel: () => {},
      }),
      { width: 70, height: 12 },
    );
    try {
      const frame = ui.frame();
      expect(shows(frame, 'Which worker should I look at?')).toBe(true);
      expect(shows(frame, '❯ The proxy Worker')).toBe(true);
    } finally {
      ui.stop();
    }
  });

  it('moves the cursor and answers with the value, not the label', async () => {
    const answers: unknown[] = [];
    const ui = await mount(
      createElement(UiPrompt, {
        pending: select,
        busy: false,
        onRespond: (v: unknown) => answers.push(v),
        onCancel: () => {},
      }),
      { width: 70, height: 12 },
    );
    try {
      ui.keys.pressArrow('down');
      await ui.settle();
      expect(shows(ui.frame(), '❯ The docs Worker')).toBe(true);
      ui.keys.pressEnter();
      await ui.settle();
      expect(answers).toEqual(['docs']);
    } finally {
      ui.stop();
    }
  });

  it('is cancellable, so a run is never stuck behind it', async () => {
    let cancelled = false;
    const ui = await mount(
      createElement(UiPrompt, {
        pending: select,
        busy: false,
        onRespond: () => {},
        onCancel: () => {
          cancelled = true;
        },
      }),
      { width: 70, height: 12 },
    );
    try {
      ui.keys.pressEscape();
      await ui.settle();
      expect(cancelled).toBe(true);
    } finally {
      ui.stop();
    }
  });

  it('answers a confirm with a boolean', async () => {
    const answers: unknown[] = [];
    const ui = await mount(
      createElement(UiPrompt, {
        pending: {
          requestId: 'ui-2',
          kind: 'confirm',
          prompt: 'Deploy to production?',
          options: [],
        },
        busy: false,
        onRespond: (v: unknown) => answers.push(v),
        onCancel: () => {},
      }),
      { width: 70, height: 12 },
    );
    try {
      expect(shows(ui.frame(), 'y yes · n no · esc cancel')).toBe(true);
      await ui.keys.typeText('y');
      await ui.settle();
      expect(answers).toEqual([true]);
    } finally {
      ui.stop();
    }
  });

  /**
   * Characterization, not endorsement. The text kind accumulates characters
   * into a string with no cursor, no word motion, no undo and no paste — the
   * exact deficiency the composer was rebuilt on a `textarea` to fix, on the
   * one prompt that never got the same treatment.
   */
  it('TAKES INPUT ONE CHARACTER AT A TIME, with no cursor and no paste', async () => {
    const answers: unknown[] = [];
    const ui = await mount(
      createElement(UiPrompt, {
        pending: {
          requestId: 'ui-3',
          // `input`, not `text` — the wire spells the free-text kind this way,
          // and `UiPrompt` reaches it by falling past the other two.
          kind: 'input',
          prompt: 'Which branch?',
          options: [],
        },
        busy: false,
        onRespond: (v: unknown) => answers.push(v),
        onCancel: () => {},
      }),
      { width: 70, height: 12 },
    );
    try {
      await ui.keys.typeText('main');
      await ui.settle();
      expect(shows(ui.frame(), '> main')).toBe(true);

      // A paste puts nothing in: the handler only ever reads single-character
      // key names.
      await ui.keys.pasteBracketedText('feature/x');
      await ui.settle();
      expect(shows(ui.frame(), '> main')).toBe(true);
      expect(ui.frame()).not.toContain('feature/x');

      ui.keys.pressEnter();
      await ui.settle();
      expect(answers).toEqual(['main']);
    } finally {
      ui.stop();
    }
  });

  it('says when it is waiting on the harness', async () => {
    const ui = await mount(
      createElement(UiPrompt, {
        pending: select,
        busy: true,
        onRespond: () => {},
        onCancel: () => {},
      }),
      { width: 70, height: 12 },
    );
    try {
      expect(shows(ui.frame(), 'sending…')).toBe(true);
    } finally {
      ui.stop();
    }
  });
});

describe('the local write prompt', () => {
  it('shows the absolute target and the two keys, on one row', async () => {
    const ui = await mount(
      createElement(WritePrompt, {
        summary: 'write /Users/blake/Projects/felix-web/notes.md',
        onAnswer: () => {},
      }),
      { width: 80, height: 8 },
    );
    try {
      const frame = ui.frame();
      expect(shows(frame, 'write /Users/blake/Projects/felix-web/notes.md?')).toBe(true);
      expect(shows(frame, 'y allow · n refuse')).toBe(true);
      // border, the row, border.
      expect(lines(frame).length).toBe(3);
    } finally {
      ui.stop();
    }
  });

  it('refuses on n and allows on y', async () => {
    const answers: boolean[] = [];
    const ui = await mount(
      createElement(WritePrompt, {
        summary: 'write notes.md',
        onAnswer: (ok: boolean) => answers.push(ok),
      }),
      { width: 80, height: 8 },
    );
    try {
      await ui.keys.typeText('n');
      await ui.settle();
      expect(answers).toEqual([false]);
      await ui.keys.typeText('y');
      await ui.settle();
      expect(answers).toEqual([false, true]);
    } finally {
      ui.stop();
    }
  });
});
