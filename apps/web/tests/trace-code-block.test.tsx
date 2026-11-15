// @vitest-environment happy-dom
import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockLine,
} from '@felix/ui/code-block';
import { useHighlightedCode } from '@felix/ui/hooks/use-highlighted-code';
import { highlightLanguage, loadHighlighter } from '@felix/ui/lib/highlighter';
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceLine,
  TraceTitle,
} from '@felix/ui/trace';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * shadcn's Trace and Code Block, installed by hand into `@felix/ui`. What is pinned here is what
 * the hand install changed or could have broken: the status a line carries, Radix's `data-state`
 * driving the collapsible (the registry keyed it on `data-open`, which Radix never sets), line
 * splitting and numbering, the copy button's announcement, and the highlighter's streaming
 * contract — a language off its table is plain text, and a growing string is tokenized only
 * from its last complete line.
 */

afterEach(cleanup);

describe('Trace', () => {
  it('marks a line with its status for the styles to read', () => {
    render(
      <Trace>
        <TraceLine status="running">
          <TraceTitle>Running pnpm build</TraceTitle>
        </TraceLine>
        <TraceLine status="error">
          <TraceTitle>Failed to read notes.txt</TraceTitle>
        </TraceLine>
        <TraceLine>
          <TraceTitle>Read README.md</TraceTitle>
        </TraceLine>
      </Trace>,
    );
    const lines = document.querySelectorAll('[data-slot=trace-line]');
    expect([...lines].map((l) => l.getAttribute('data-status'))).toEqual([
      'running',
      'error',
      null,
    ]);
  });

  it('opens a collapsible row from its trigger, through Radix data-state', () => {
    render(
      <Trace>
        <TraceCollapsible>
          <TraceCollapsibleTrigger>
            <TraceLine>
              <TraceTitle>Ran node --version</TraceTitle>
            </TraceLine>
          </TraceCollapsibleTrigger>
          <TraceCollapsibleContent>v24.18.0</TraceCollapsibleContent>
        </TraceCollapsible>
      </Trace>,
    );
    const trigger = screen.getByRole('button', { name: /Ran node --version/ });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('v24.18.0')).toBeNull();
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const content = screen.getByText('v24.18.0').closest('[data-slot=trace-collapsible-content]');
    expect(content?.getAttribute('data-state')).toBe('open');
    expect(content?.className).toContain('data-[state=open]:animate-collapsible-down');
  });
});

describe('CodeBlock', () => {
  it('splits a string into numbered lines, keeping blank ones copyable', () => {
    render(
      <CodeBlock>
        <CodeBlockContent lineNumbers startLine={10}>
          {'one\n\nthree\n'}
        </CodeBlockContent>
      </CodeBlock>,
    );
    const pre = document.querySelector('[data-slot=code-block-content]') as HTMLElement;
    expect(pre.hasAttribute('data-numbered')).toBe(true);
    expect(pre.style.counterReset).toBe('line 9');
    const lines = document.querySelectorAll('[data-slot=code-block-line-content]');
    // The trailing newline is not a fourth line; the empty one holds a newline.
    expect([...lines].map((l) => l.textContent)).toEqual(['one', '\n', 'three']);
  });

  it('marks diff lines by variant', () => {
    render(
      <CodeBlock>
        <CodeBlockContent>
          <CodeBlockLine variant="removed">old</CodeBlockLine>
          <CodeBlockLine variant="added">new</CodeBlockLine>
        </CodeBlockContent>
      </CodeBlock>,
    );
    const lines = document.querySelectorAll('[data-slot=code-block-line]');
    expect([...lines].map((l) => l.getAttribute('data-variant'))).toEqual(['removed', 'added']);
  });

  it('copies its value and announces it politely', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<CodeBlockCopyButton value="echo hi" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('echo hi');
    await screen.findByRole('button', { name: 'Copied' });
    expect(document.querySelector('[aria-live=polite]')?.textContent).toBe('Copied');
  });
});

describe('highlighter', () => {
  it('renders a language off its table as plain text', async () => {
    expect(highlightLanguage('cobol')).toBeNull();
    expect(highlightLanguage('TS')).toBe('typescript');
    expect(await loadHighlighter('cobol')).toBeNull();
  });

  it('highlights per line with both themes as variables', async () => {
    const h = await loadHighlighter('json');
    const { lines } = h?.highlight('{\n  "a": 1\n}') ?? { lines: [] };
    expect(lines).toHaveLength(3);
    render(<code>{lines[1]}</code>);
    const token = document.querySelector('span[style]') as HTMLElement;
    expect(token.getAttribute('style')).toContain('--shiki-light');
    expect(token.getAttribute('style')).toContain('--shiki-dark');
  });

  it('tokenizes only what a streaming string adds', async () => {
    const real = await loadHighlighter('typescript');
    if (!real) throw new Error('typescript should load');
    const highlight = vi.spyOn(real, 'highlight');
    // Hand the hook the spied instance: the module caches the Shiki instance, not this wrapper.
    vi.spyOn(await import('@felix/ui/lib/highlighter'), 'loadHighlighter').mockResolvedValue(real);

    const { result, rerender } = renderHook(({ code }) => useHighlightedCode(code, 'ts'), {
      initialProps: { code: 'const a = 1;\nconst b' },
    });
    // Plain lines until the language has loaded.
    expect(result.current).toEqual(['const a = 1;', 'const b']);
    await waitFor(() => expect(typeof result.current[0]).not.toBe('string'));

    highlight.mockClear();
    await act(async () => rerender({ code: 'const a = 1;\nconst b = 2;\nconst c' }));
    // The new complete line, then the tail — never the first line again.
    const sources = highlight.mock.calls.map(([code]) => code);
    expect(sources).not.toContain('const a = 1;');
    expect(sources).toContain('const b = 2;');
    expect(result.current).toHaveLength(3);
    vi.restoreAllMocks();
  });
});
