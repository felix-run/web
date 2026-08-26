/** @vitest-environment happy-dom */
import { TooltipProvider } from '@felix/ui/tooltip';
import { cleanup, fireEvent, render as rtlRender, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Message } from '../src/components/chat/message';
import type { Turn } from '../src/types';

/**
 * `interleaveTurn` is unit-tested next door; this covers the half that suite
 * cannot reach — that the segments it returns actually reach the DOM in that
 * order. The two were separable enough to get out of step: the helper could be
 * correct while the component still rendered `turn.tools` and `turn.content` as
 * two blocks, which is precisely the bug being fixed.
 *
 * Assistant prose renders through a third-party markdown renderer, so order is
 * read off the document rather than off any markup that renderer owns: walk the
 * turn's text content and check the pieces appear in sequence.
 */

afterEach(cleanup);

/**
 * The turn's per-message actions are tooltip-triggered, and Radix throws rather
 * than degrading when no provider is above them. main.tsx mounts one at the root,
 * so this mirrors the tree the component is actually rendered in.
 */
const render = (ui: React.ReactElement) => {
  const wrap = (node: React.ReactElement) => <TooltipProvider>{node}</TooltipProvider>;
  const result = rtlRender(wrap(ui));
  // Re-wrap on rerender too. Without this a rerender swaps in a bare tree, and the
  // streaming test below survives only because the actions row happens to render
  // nothing for an empty turn — green for a reason unrelated to its assertion.
  return { ...result, rerender: (node: React.ReactElement) => result.rerender(wrap(node)) };
};

const assistant = (over: Partial<Turn>): Turn => ({
  id: 't1',
  role: 'assistant',
  content: '',
  ...over,
});

/** Index of each needle in the rendered turn, in document order. */
function positions(container: HTMLElement, needles: string[]): number[] {
  const text = container.textContent ?? '';
  return needles.map((needle) => text.indexOf(needle));
}

describe('Message interleaving', () => {
  it('renders prose and tool cards in the order they happened', async () => {
    const content = 'let me check found it here it is';
    const { container } = render(
      <Message
        turn={assistant({
          content,
          tools: [
            { name: 'search_docs', done: true, at: content.indexOf('found') },
            { name: 'read_file', done: true, at: content.indexOf('here') },
          ],
        })}
      />,
    );

    await waitFor(() => expect(container.textContent).toContain('let me check'));

    const seen = positions(container, [
      'let me check',
      'search_docs',
      'found it',
      'read_file',
      'here it is',
    ]);
    expect(seen.every((i) => i !== -1)).toBe(true);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });

  it('keeps offset-less cards ahead of the prose, as a hydrated turn renders', async () => {
    const { container } = render(
      <Message
        turn={assistant({ content: 'the answer', tools: [{ name: 'read_file', done: true }] })}
      />,
    );

    await waitFor(() => expect(container.textContent).toContain('the answer'));
    const [tool, prose] = positions(container, ['read_file', 'the answer']);
    expect(tool).toBeGreaterThan(-1);
    expect(tool).toBeLessThan(prose);
  });

  it('still renders a turn that is prose alone, and one that is tools alone', async () => {
    const { container: prose } = render(<Message turn={assistant({ content: 'no tools here' })} />);
    await waitFor(() => expect(prose.textContent).toContain('no tools here'));

    const { container: tools } = render(
      <Message
        turn={assistant({ id: 't2', tools: [{ name: 'read_file', done: false, at: 0 }] })}
      />,
    );
    expect(tools.textContent).toContain('read_file');
    expect(tools.textContent).toContain('running');
  });
});

describe('Message reasoning', () => {
  it('shows that thinking happened without showing it as the answer', async () => {
    const { container } = render(
      <Message
        turn={assistant({
          content: 'the answer',
          reasoning: [{ text: 'my private notes', at: 0 }],
        })}
      />,
    );

    await waitFor(() => expect(container.textContent).toContain('the answer'));
    expect(container.textContent).toContain('Thought for a moment');
    // Collapsed: reasoning read as the reply is worse than reasoning not shown.
    expect(container.textContent).not.toContain('my private notes');
  });

  it('opens the reasoning when its trigger is used', async () => {
    const { container, getByRole } = render(
      <Message
        turn={assistant({ content: 'a', reasoning: [{ text: 'my private notes', at: 0 }] })}
      />,
    );

    fireEvent.click(getByRole('button', { name: /Thought for a moment/ }));
    await waitFor(() => expect(container.textContent).toContain('my private notes'));
  });

  it('says it is still thinking only while the turn is streaming', async () => {
    const turn = assistant({ content: '', reasoning: [{ text: 'hmm', at: 0 }] });
    const { container, rerender } = render(<Message turn={turn} streaming />);
    await waitFor(() => expect(container.textContent).toContain('Thinking'));

    rerender(<Message turn={turn} />);
    expect(container.textContent).toContain('Thought for a moment');
  });
});
