import { describe, expect, it } from 'bun:test';
import type { PendingApproval } from '@felix/client';
import type { PendingUiRequest } from '@felix/protocol';
import { createElement } from 'react';
import { ApprovalPrompt, UiPrompt, WritePrompt } from '../src/ui/prompts';
import { lines, mount, shows, testTheme } from './render';

/**
 * The three things a run can block on.
 *
 * None of these had a test, and all three are the moment the client is least
 * forgiving: the run is stopped until one of them is answered, so a banner that
 * draws without its keys, or answers a key it should not have, hangs the
 * conversation with nothing on screen to explain it.
 *
 * Three of these were written the other way round one commit ago, against a
 * banner that summarised a file write as a character count, a select kind with
 * a `useState` cursor walked by hand, and an input kind that appended
 * characters one at a time and dropped a paste on the floor. They are kept and
 * inverted, because what they assert now is what was missing then.
 */

const approval: PendingApproval = {
  approvalId: 'ap-1',
  toolName: 'write_file',
  args: { path: 'apps/tui/src/app.tsx', content: 'export const a = 1;\n' },
  before: 'export const a = 0;\n',
};

describe('the approval banner', () => {
  it('names the tool, the file, and the keys that answer it', async () => {
    const ui = await mount(
      createElement(ApprovalPrompt, {
        theme: testTheme,
        pending: approval,
        onDecide: () => {},
      }),
      { width: 74, height: 16 },
    );
    try {
      const frame = ui.frame();
      expect(shows(frame, 'approval · write_file')).toBe(true);
      expect(shows(frame, 'changes apps/tui/src/app.tsx')).toBe(true);
      expect(shows(frame, 'y approve · n deny')).toBe(true);
    } finally {
      ui.stop();
    }
  });

  it('answers y and n, and nothing else', async () => {
    const decisions: string[] = [];
    const ui = await mount(
      createElement(ApprovalPrompt, {
        theme: testTheme,
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
   * disk. It used to be a character count, with both sides of the change
   * available and neither on screen.
   */
  it('shows both sides of the change', async () => {
    const ui = await mount(
      createElement(ApprovalPrompt, {
        theme: testTheme,
        pending: approval,
        onDecide: () => {},
      }),
      { width: 74, height: 16 },
    );
    try {
      const frame = ui.frame();
      expect(shows(frame, '- export const a = 0;')).toBe(true);
      expect(shows(frame, '+ export const a = 1;')).toBe(true);
      expect(frame).not.toContain('replaces 20 chars');
    } finally {
      ui.stop();
    }
  });

  /**
   * The keys sit below the payload on purpose — approving a write you have not
   * read is the failure this arrangement is against — which makes an unbounded
   * diff an approval you cannot answer, because the decision is off the bottom
   * of the screen.
   */
  it('caps a large diff so the decision stays reachable', async () => {
    const huge = Array.from({ length: 400 }, (_, i) => `line ${i};`).join('\n');
    const ui = await mount(
      createElement(ApprovalPrompt, {
        theme: testTheme,
        pending: {
          ...approval,
          before: '',
          args: { path: 'big.ts', content: huge },
        },
        onDecide: () => {},
      }),
      { width: 74, height: 30 },
    );
    try {
      const frame = ui.frame();
      expect(shows(frame, 'more line(s) not shown')).toBe(true);
      expect(shows(frame, 'y approve · n deny')).toBe(true);
    } finally {
      ui.stop();
    }
  });

  it('falls back to a summary for a tool that is not a write', async () => {
    const ui = await mount(
      createElement(ApprovalPrompt, {
        theme: testTheme,
        pending: {
          approvalId: 'ap-2',
          toolName: 'run_command',
          args: { command: 'rm -rf build' },
        },
        onDecide: () => {},
      }),
      { width: 74, height: 12 },
    );
    try {
      expect(shows(ui.frame(), 'rm -rf build')).toBe(true);
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
        theme: testTheme,
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
      expect(shows(frame, '▶ The proxy Worker')).toBe(true);
    } finally {
      ui.stop();
    }
  });

  it('moves the cursor and answers with the value, not the label', async () => {
    const answers: unknown[] = [];
    const ui = await mount(
      createElement(UiPrompt, {
        theme: testTheme,
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
      expect(shows(ui.frame(), '▶ The docs Worker')).toBe(true);
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
        theme: testTheme,
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
        theme: testTheme,
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
   * The inversion. This prompt read single-character key names and appended
   * them to a string, so a pasted branch name put nothing in the field at all —
   * the exact deficiency the composer was rebuilt on a `textarea` to fix, on
   * the one prompt that never got the same treatment.
   */
  it('takes a paste whole, like any other editor', async () => {
    const answers: unknown[] = [];
    const ui = await mount(
      createElement(UiPrompt, {
        theme: testTheme,
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
      await ui.keys.typeText('release/');
      await ui.keys.pasteBracketedText('2026-09');
      await ui.settle();
      expect(shows(ui.frame(), 'release/2026-09')).toBe(true);

      ui.keys.pressEnter();
      await ui.settle();
      expect(answers).toEqual(['release/2026-09']);
    } finally {
      ui.stop();
    }
  });

  it('says when it is waiting on the harness', async () => {
    const ui = await mount(
      createElement(UiPrompt, {
        theme: testTheme,
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
        theme: testTheme,
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
        theme: testTheme,
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
