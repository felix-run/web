import { describe, expect, it } from 'bun:test';
import type { PendingApproval, Turn } from '@felix/client';
import type { PendingUiRequest } from '@felix/protocol';
import { RGBA } from '@opentui/core';
import { createElement, useState } from 'react';
import { resolveTheme } from '../src/theme';
import { Composer } from '../src/ui/composer';
import { ApprovalPrompt, UiPrompt } from '../src/ui/prompts';
import { pickerWidth } from '../src/ui/rails';
import { Table } from '../src/ui/table';
import { Transcript } from '../src/ui/transcript';
import { type Mounted, mount } from './render';

/**
 * Text this client did not colour must be the terminal's own colour.
 *
 * Every OpenTUI renderable that draws text defaults to the *literal* white, and
 * a literal is true-colour, not a reference into the user's palette — so the
 * whole conversation reached the terminal as `ESC[38;2;255;255;255m`, white on
 * white on a light terminal, the composer included. These read the colour's
 * *intent* off a captured span, which keeps it (`default`, `indexed`, `rgb`),
 * so a regression shows as `rgb` here rather than as an unreadable screen
 * someone has to be using a light theme to see.
 */

const light = resolveTheme({ themeMode: 'light', trueColor: true });

function span(ui: Mounted, needle: string) {
  for (const line of ui.spans().lines) {
    for (const s of line.spans) if (s.text.includes(needle)) return s;
  }
  return null;
}

const intentOf = (ui: Mounted, needle: string) => span(ui, needle)?.fg.intent;

describe('text nobody coloured', () => {
  it('is the terminal foreground on a plain <text>', async () => {
    const ui = await mount(createElement('text', null, 'PLAIN'), { width: 20, height: 2 });
    try {
      expect(intentOf(ui, 'PLAIN')).toBe('default');
    } finally {
      ui.stop();
    }
  });

  /**
   * The `fg` setter falls back to the renderable's own default when a prop goes
   * from a colour back to `undefined` — a thread row losing the selection.
   */
  it('stays the terminal foreground after a colour is taken away', async () => {
    let unselect: () => void = () => {};
    function Row() {
      const [selected, setSelected] = useState(true);
      unselect = () => setSelected(false);
      return createElement('text', { fg: selected ? RGBA.fromIndex(2) : undefined }, 'ROW');
    }
    const ui = await mount(createElement(Row), { width: 20, height: 2 });
    try {
      expect(intentOf(ui, 'ROW')).toBe('indexed');
      unselect();
      await ui.until(() => intentOf(ui, 'ROW') === 'default');
    } finally {
      ui.stop();
    }
  });

  it('is the terminal foreground in what you type', async () => {
    const ui = await mount(
      createElement(Composer, {
        theme: light,
        streaming: false,
        disabled: false,
        onSubmit: () => {},
      }),
      { width: 60, height: 6 },
    );
    try {
      await ui.keys.typeText('typed words');
      await ui.until(() => ui.frame().includes('typed words'));
      expect(intentOf(ui, 'typed')).toBe('default');
    } finally {
      ui.stop();
    }
  });

  it('is the terminal foreground in a reply, its code and a user turn', async () => {
    const turns = [
      { id: 'u', role: 'user', content: 'my question' },
      {
        id: 'a',
        role: 'assistant',
        content: 'Plain prose here.\n\n```ts\nconst answer = 42;\n```\n',
        tools: [],
      },
    ] as Turn[];
    const ui = await mount(createElement(Transcript, { turns, theme: light }), {
      width: 60,
      height: 12,
    });
    try {
      await ui.until(() => ui.frame().includes('answer') && ui.frame().includes('prose'));
      expect(intentOf(ui, 'question')).toBe('default');
      expect(intentOf(ui, 'prose')).toBe('default');
      expect(intentOf(ui, 'answer')).not.toBe('rgb');
    } finally {
      ui.stop();
    }
  });

  it('is the terminal foreground in a table cell', async () => {
    const ui = await mount(
      createElement(Table, { head: ['name'], rows: [[{ text: 'cellvalue' }]], theme: light }),
      { width: 40, height: 4 },
    );
    try {
      expect(intentOf(ui, 'cellvalue')).toBe('default');
    } finally {
      ui.stop();
    }
  });
});

describe('the agent asking a question', () => {
  it('types in the terminal foreground', async () => {
    const pending: PendingUiRequest = {
      requestId: 'ui-t',
      threadId: 't1',
      kind: 'input',
      prompt: 'Name?',
      options: [],
    };
    const ui = await mount(
      createElement(UiPrompt, {
        theme: light,
        pending,
        busy: false,
        onRespond: () => {},
        onCancel: () => {},
      }),
      { width: 50, height: 6 },
    );
    try {
      await ui.keys.typeText('an answer');
      await ui.until(() => ui.frame().includes('an answer'));
      expect(intentOf(ui, 'an answer')).toBe('default');
    } finally {
      ui.stop();
    }
  });

  it('paints no box of its own around the options', async () => {
    const pending: PendingUiRequest = {
      requestId: 'ui-s',
      threadId: 't1',
      kind: 'select',
      prompt: 'Pick',
      options: [
        { label: 'alpha', value: 'a' },
        { label: 'beta', value: 'b' },
      ],
    };
    const ui = await mount(
      createElement(UiPrompt, {
        theme: light,
        pending,
        busy: false,
        onRespond: () => {},
        onCancel: () => {},
      }),
      { width: 50, height: 8 },
    );
    try {
      // The library's own: #1a1a1a behind every row, #334455 behind the selection.
      for (const needle of ['alpha', 'beta']) {
        expect(span(ui, needle)?.bg.toInts()[3]).toBe(0);
      }
      expect(intentOf(ui, 'beta')).toBe('default');
      // The selection is the marker, not only the colour.
      expect(ui.frame()).toContain('▶ alpha');
    } finally {
      ui.stop();
    }
  });
});

describe("a write approval's patch", () => {
  const approval: PendingApproval = {
    approvalId: 'ap-c',
    toolName: 'write_file',
    args: { path: 'notes.txt', content: 'kept line\nnew line\n' },
    before: 'kept line\nold line\n',
  };

  it('tints its rows from the theme, not the dark-only defaults', async () => {
    const ui = await mount(
      createElement(ApprovalPrompt, { theme: light, pending: approval, onDecide: () => {} }),
      { width: 74, height: 16 },
    );
    try {
      await ui.until(() => ui.frame().includes('new line'));
      const hex = (c: { toInts(): number[] } | undefined) =>
        (c?.toInts() ?? [])
          .slice(0, 3)
          .map((v) => v.toString(16).padStart(2, '0'))
          .join('');
      expect(hex(span(ui, 'new line')?.bg)).not.toBe('1a4d1a');
      expect(hex(span(ui, 'old line')?.bg)).not.toBe('4d1a1a');
      expect(hex(span(ui, 'new line')?.bg)).toBe(hex(light.diff.addedBg as RGBA));
      expect(intentOf(ui, 'new line')).toBe('default');
    } finally {
      ui.stop();
    }
  });
});

describe('the thread picker', () => {
  it('keeps its width where there is room, and fits where there is not', () => {
    expect(pickerWidth(120)).toBe(46);
    expect(pickerWidth(80)).toBe(46);
    expect(pickerWidth(40)).toBe(36);
    expect(pickerWidth(10)).toBe(20);
  });
});
