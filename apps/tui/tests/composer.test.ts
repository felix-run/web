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
 * What is asserted is the message the composer *sends*, not the frame it draws:
 * Ink suppresses incremental rendering under CI, so a test that read frames
 * would pass here and fail in the pipeline. Input handling does not care.
 */

const ESC = String.fromCharCode(27);
const ENTER = '\r';

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

  const stdout = new PassThrough() as PassThrough & {
    columns: number;
    rows: number;
    isTTY: boolean;
  };
  stdout.columns = 80;
  stdout.rows = 24;
  stdout.isTTY = true;
  stdout.resume();

  // Before the render, exactly as main.tsx does it: this listener has to see a
  // report before Ink turns the same chunk into text.
  const attention = createAttention({ stdin, stdout: { write: () => {} } });

  const submitted: string[] = [];
  const instance = render(
    createElement(Composer, {
      streaming: false,
      disabled: false,
      onSubmit: (text: string) => submitted.push(text),
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

  /**
   * Ink subscribes when the component's effects flush, a tick after `render`
   * returns, and it does so with `readable` rather than `data` — writing before
   * that reaches nothing.
   */
  const ready = () =>
    vi.waitFor(() => {
      expect(stdin.listenerCount('readable')).toBeGreaterThan(0);
    });

  /**
   * Tab away, type, come back, send — with a tick between each, because that
   * is how a keyboard arrives. Ink hands a chunk holding both text and Enter to
   * `useInput` whole (`input: 'hello\r'`, `key.return` false), so writing the
   * four at once would test something no terminal does.
   */
  const exercise = async () => {
    for (const chunk of [`${ESC}[O`, 'hello', `${ESC}[I`, ENTER]) {
      stdin.write(chunk);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };

  return {
    ready,
    exercise,
    submitted,
    stop: () => {
      instance.unmount();
      attention.dispose();
    },
  };
}

describe('the composer under terminal focus reporting', () => {
  it('keeps focus reports out of the message, and typing in it', async () => {
    const ui = mount({ filtered: true });
    try {
      await ui.ready();
      await ui.exercise();
      await vi.waitFor(() => expect(ui.submitted).toHaveLength(1));
      expect(ui.submitted[0]).toBe('hello');
    } finally {
      ui.stop();
    }
  });

  it('shows what the filter is for', async () => {
    const ui = mount({ filtered: false });
    try {
      await ui.ready();
      await ui.exercise();
      await vi.waitFor(() => expect(ui.submitted).toHaveLength(1));
      expect(ui.submitted[0]).toBe('[Ohello[I');
    } finally {
      ui.stop();
    }
  });
});
