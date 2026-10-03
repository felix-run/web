/** @vitest-environment happy-dom */
import { TooltipProvider } from '@felix/ui/tooltip';
import { cleanup, fireEvent, render as rtlRender, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    // Rebuilt from history: no duration to quote, so it leads with the noun and the count.
    expect(container.textContent).toContain('Reasoning· 3 words');
    expect(container.textContent).not.toContain('Thought for');
    // Collapsed: reasoning read as the reply is worse than reasoning not shown.
    expect(container.textContent).not.toContain('my private notes');
  });

  it('opens the reasoning when its trigger is used', async () => {
    const { container, getByRole } = render(
      <Message
        turn={assistant({ content: 'a', reasoning: [{ text: 'my private notes', at: 0 }] })}
      />,
    );

    fireEvent.click(getByRole('button', { name: /Reasoning/ }));
    await waitFor(() => expect(container.textContent).toContain('my private notes'));
  });

  it('says it is still thinking only while the turn is streaming', async () => {
    const turn = assistant({ content: '', reasoning: [{ text: 'hmm', at: 0 }] });
    const { container, rerender } = render(<Message turn={turn} streaming />);
    await waitFor(() => expect(container.textContent).toContain('Thinking'));

    rerender(<Message turn={turn} />);
    // Watched from the start in this tab, so the settled row quotes a measured duration.
    expect(container.textContent).toMatch(/Thought for\s*0s · 1 word\b/);
  });

  /**
   * A static "Thinking…" looked the same at minute two as at second two, and the same as
   * a stalled stream. The live row carries the newest reasoning — the words arriving, not
   * the first ones — and drops it once the thought is done, when it would read as the reply.
   */
  it('shows the newest reasoning while thinking, and only then', async () => {
    const early = 'first I will look at the config. ';
    const turn = assistant({
      content: '',
      reasoning: [{ text: `${early}then the newest idea arrives`, at: 0 }],
    });
    const { container, rerender } = render(<Message turn={turn} streaming />);
    await waitFor(() => expect(container.textContent).toContain('then the newest idea arrives'));
    expect(container.textContent).toContain('12 words');

    rerender(<Message turn={turn} />);
    expect(container.textContent).not.toContain('newest idea');
  });
});

/**
 * A durable run's stream carries no deltas, so until `final` the engine's status line is the
 * whole turn. Drawn through the markdown path it read as the agent replying "Durable run
 * accepted…"; it is a status, and says so to assistive tech too.
 */
describe('a durable run in flight', () => {
  it('draws the status line as a status, not as the reply', () => {
    const { container, getByRole } = render(
      <Message
        turn={assistant({ content: 'Background · running…', runStatus: 'running' })}
        streaming
      />,
    );
    expect(getByRole('status').textContent).toBe('Background · running…');
    // The header's "streaming" claims deltas are arriving, which a durable stream never sends.
    expect(container.textContent).not.toContain('streaming');
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('holds still while it waits on a person', () => {
    const { container, getByRole } = render(
      <Message
        turn={assistant({
          content: 'Waiting on your approval · Write notes.txt',
          runStatus: 'blocked',
        })}
        streaming
      />,
    );
    expect(getByRole('status').className).toContain('text-state-blocked');
    expect(container.querySelector('.animate-pulse')).toBeNull();
  });
});

describe('a note', () => {
  const note = (inContext: boolean): Turn => ({
    id: 'n1',
    role: 'note',
    content: 'Prefer the staging bucket.',
    note: { role: 'system', inContext },
  });

  it('says whether the model read it, in words', () => {
    const seen = render(<Message turn={note(true)} />);
    expect(seen.container.textContent).toContain('in the model’s context');
    expect(seen.container.textContent).toContain('Prefer the staging bucket.');
    cleanup();
    const unseen = render(<Message turn={note(false)} />);
    expect(unseen.container.textContent).toContain('not sent to the model');
  });

  it('is not drawn as either side of the conversation', () => {
    const { container } = render(<Message turn={note(true)} />);
    // Each side is named in words now, so a note carrying neither name is one
    // that cannot be mistaken for either — the bubble this once checked is gone.
    expect(container.textContent).not.toContain('Felix');
    expect(container.textContent).not.toContain('You');
  });
});

/**
 * Whose turn it is, said in words.
 *
 * The operator's turn was an inverted bubble and the agent's carried an "F"
 * avatar — the two sides told apart by a filled block and a circle. Both are
 * gone, so the labels are what keeps them distinguishable without colour.
 */
describe('turn attribution', () => {
  it('labels the operator\x27s turn and the agent\x27s', async () => {
    const user = render(<Message turn={{ id: 'u1', role: 'user', content: 'list the files' }} />);
    expect(user.container.textContent).toContain('You');
    expect(user.container.textContent).toContain('list the files');
    cleanup();
    const agent = render(<Message turn={assistant({ content: 'here they are' })} />);
    await waitFor(() => expect(agent.container.textContent).toContain('here they are'));
    expect(agent.container.textContent).toContain('Felix');
  });

  it('says a sent turn is waiting, in a word, until something arrives', () => {
    const { getByRole, rerender, queryByRole } = render(<Message turn={assistant({})} streaming />);
    expect(getByRole('status').textContent).toBe('Waiting for the harness…');
    rerender(
      <Message turn={assistant({ tools: [{ name: 'read_file', done: false }] })} streaming />,
    );
    expect(queryByRole('status')).toBeNull();
  });
});

/**
 * A token with no space in it — a commit hash, a path, a URL — has nowhere to wrap,
 * and one that overflowed its turn gave the whole transcript a sideways scroll on a
 * phone: the scroll container measured 690px of content in a 368px column. What
 * wraps it is `overflow-wrap`, which only a laid-out page can show working; happy-dom
 * lays nothing out. So this pins the rule on each plain-text surface rather than the
 * geometry, and the geometry is a browser check at 390px.
 */
describe('long unbroken tokens', () => {
  const HASH = '9f1c2e7a4b8d0f3e6a5c1b2d4e8f0a3c5e7b9d1f';
  const PATH = '/Users/operator/Projects/felix-web/apps/chat-ui/src/components/chat/message.tsx';

  /** The innermost element holding exactly this text: its wrappers hold it too. */
  const textNode = (container: HTMLElement, needle: string) =>
    [...container.querySelectorAll('div')].filter((el) => el.textContent === needle).at(-1);

  it('wraps the operator’s turn anywhere, so a hash cannot widen the column', () => {
    const { container } = render(<Message turn={{ id: 'u1', role: 'user', content: HASH }} />);
    expect(textNode(container, HASH)?.className).toContain('wrap-anywhere');
  });

  it('wraps a note the same way', () => {
    const { container } = render(
      <Message
        turn={{ id: 'n1', role: 'note', content: PATH, note: { role: 'system', inContext: true } }}
      />,
    );
    expect(textNode(container, PATH)?.className).toContain('wrap-anywhere');
  });

  it('wraps reasoning once it is opened', async () => {
    const { container, getByRole } = render(
      <Message turn={assistant({ reasoning: [{ text: PATH, at: 0 }], content: 'ok' })} />,
    );
    fireEvent.click(getByRole('button', { name: /reasoning/i }));
    await waitFor(() => expect(textNode(container, PATH)).toBeDefined());
    expect(textNode(container, PATH)?.className).toContain('wrap-anywhere');
  });
});

describe('a message with other versions', () => {
  it('says which version it is, and asks for the right tip in each direction', () => {
    const onSwitchBranch = vi.fn();
    const turn: Turn = { id: 'u2', role: 'user', content: 'Edited question', eventId: 'u2b' };
    const { getByRole, getByText } = render(
      <Message
        turn={turn}
        branch={{ index: 1, tips: ['a2', 'a2b', 'a2c'] }}
        onSwitchBranch={onSwitchBranch}
      />,
    );
    expect(getByRole('group', { name: 'Versions of this message' })).toBeTruthy();
    expect(getByText('2 of 3')).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'Next version' }));
    expect(onSwitchBranch).toHaveBeenLastCalledWith('a2c');
    fireEvent.click(getByRole('button', { name: 'Previous version' }));
    expect(onSwitchBranch).toHaveBeenLastCalledWith('a2');
  });

  it('cannot switch while a run is live', () => {
    const turn: Turn = { id: 'u2', role: 'user', content: 'q', eventId: 'u2b' };
    const { getByRole } = render(<Message turn={turn} branch={{ index: 0, tips: ['x', 'y'] }} />);
    expect((getByRole('button', { name: 'Next version' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
