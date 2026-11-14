// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Tool } from '../src/components/chat/tool';

/**
 * A failed command's stack trace, drawn above its streams. Pinned: it appears only for a
 * failure, innermost frame first with paths relative to the command's directory, library
 * frames folded, and the raw streams still there underneath.
 */

afterEach(cleanup);

const tb = [
  'Traceback (most recent call last):',
  '  File "/work/app/main.py", line 8, in run',
  '    total = parse(rows)',
  '  File "/usr/lib/python3.12/site-packages/csvkit/parse.py", line 40, in parse',
  '    return int(value)',
  '  File "/usr/lib/python3.12/site-packages/csvkit/cast.py", line 3, in cast',
  "ValueError: invalid literal for int() with base 10: 'x'",
].join('\n');

const shell = (exit: number, stderr: string) => ({
  name: 'run',
  input: { command: 'python -m app' },
  done: true,
  output: JSON.stringify({
    argv: ['python', '-m', 'app'],
    cwd: '/work',
    exit_code: exit,
    timed_out: false,
    truncated: false,
    stdout: '',
    stderr,
  }),
});

describe('a failed command with a stack trace', () => {
  it('draws the error and the frames, innermost first, over the raw stream', () => {
    render(<Tool tool={shell(1, tb)} verbose />);
    const view = document.querySelector('[data-slot=stack-trace]') as HTMLElement;
    expect(view.textContent).toContain("ValueError: invalid literal for int() with base 10: 'x'");
    // The two library frames are one folded line; the project's frame reads relative to cwd.
    const fold = screen.getByRole('button', { name: /2 frames in libraries/ });
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    expect(view.textContent).toContain('app/main.py:8');
    expect(view.textContent).toContain('total = parse(rows)');
    // Under its frame, not beside it: `Trace` makes a line's wrapper a flex row unless told.
    const source = within(view).getByText('total = parse(rows)');
    expect(source.parentElement?.className).toContain('flex-col');
    // Innermost first: the library fold comes before the project's frame.
    expect(view.textContent?.indexOf('2 frames')).toBeLessThan(
      view.textContent?.indexOf('app/main.py') ?? -1,
    );
    fireEvent.click(fold);
    expect(view.textContent).toContain('cast');
    // The stream itself is still there.
    expect(document.querySelector('[data-language="ansi"]')).toBeTruthy();
  });

  it('draws nothing for a command that passed, whatever it printed', () => {
    render(<Tool tool={shell(0, tb)} verbose />);
    expect(document.querySelector('[data-slot=stack-trace]')).toBeNull();
  });
});
