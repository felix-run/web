import { PassThrough } from 'node:stream';
import { render } from 'ink';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createAttention } from '../src/attention';
import { Composer } from '../src/ui/composer';

/**
 * The one Ink component with a test, and this is why.
 *
 * Asking the terminal to report focus costs something: the reports arrive on
 * the same stdin Ink is reading, and Ink 7 hands them to `useInput` as the
 * ordinary text `[I` and `[O`. Unfiltered, the prompt reads `[Ohello[I` after
 * you tab away and back — which is not something anyone would catch by running
 * the client, because it only happens while you are looking at another window.
 *
 * So this renders the real composer against real Ink, with the same listener
 * ordering `main.tsx` establishes, and pins both halves: the reports never
 * reach the prompt, and ordinary typing still does.
 */

const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;?]*[a-zA-Z]`, 'g');

function mount(options: { filtered: boolean }) {
  const stdin = new PassThrough() as PassThrough & {
    isTTY: boolean;
    setRawMode: () => void;
    ref: () => void;
    unref: () => void;
  };
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  stdin.ref = () => {};
  stdin.unref = () => {};

  const frames: string[] = [];
  const stdout = new PassThrough() as PassThrough & {
    columns: number;
    rows: number;
    isTTY: boolean;
  };
  stdout.columns = 80;
  stdout.rows = 24;
  stdout.isTTY = true;
  stdout.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8').replace(ANSI, '').trim();
    if (text) frames.push(text);
  });

  // Before the render, exactly as main.tsx does it: this listener has to see a
  // report before Ink turns the same chunk into text.
  const attention = createAttention({ stdin, stdout: { write: () => {} } });

  const instance = render(
    createElement(Composer, {
      streaming: false,
      disabled: false,
      onSubmit: () => {},
      ...(options.filtered ? { isFocusReport: attention.isFocusReport } : {}),
    }),
    {
      // Ink wants the real TTY types; these are the parts of them it uses.
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );

  return {
    stdin,
    frames,
    last: () => frames[frames.length - 1] ?? '',
    stop: () => {
      instance.unmount();
      attention.dispose();
    },
  };
}

describe('the composer under terminal focus reporting', () => {
  it('keeps focus reports out of the prompt, and typing in it', async () => {
    const ui = mount({ filtered: true });
    try {
      ui.stdin.write(`${ESC}[O`);
      ui.stdin.write('hello');
      ui.stdin.write(`${ESC}[I`);
      await vi.waitFor(() => expect(ui.last()).toContain('hello'));
      expect(ui.last()).toBe('> hello');
    } finally {
      ui.stop();
    }
  });

  it('shows what the filter is for', async () => {
    const ui = mount({ filtered: false });
    try {
      ui.stdin.write(`${ESC}[O`);
      ui.stdin.write('hello');
      ui.stdin.write(`${ESC}[I`);
      await vi.waitFor(() => expect(ui.last()).toContain('hello'));
      expect(ui.last()).toBe('> [Ohello[I');
    } finally {
      ui.stop();
    }
  });
});
