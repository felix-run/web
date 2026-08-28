import { describe, expect, it } from 'vitest';
import type { ToolCall } from '../src/turns';
import { closeTool, findOpenTool, interleaveTurn, markToolPhase } from '../src/turns';

const call = (over: Partial<ToolCall>): ToolCall => ({ name: 'read_file', done: false, ...over });

/**
 * Two concurrent calls to the same tool are the reason this exists. By name
 * alone the newest open card wins, so a `tool_end` for the *first* call closed
 * the *second* one — the output landed on the wrong card and the real one
 * spun forever.
 */
describe('findOpenTool', () => {
  it('prefers the id when the frame carries one', () => {
    const tools = [call({ callId: 'a' }), call({ callId: 'b' })];
    expect(findOpenTool(tools, 'read_file', 'a')).toBe(0);
    expect(findOpenTool(tools, 'read_file', 'b')).toBe(1);
  });

  // The `on_tool_start` / `on_tool_end` pair carries no id.
  it('falls back to the newest open card of that name', () => {
    const tools = [call({ done: true }), call({}), call({ name: 'write_file' })];
    expect(findOpenTool(tools, 'read_file')).toBe(1);
  });

  it('falls back to the name when the id matches nothing', () => {
    expect(findOpenTool([call({ callId: 'a' })], 'read_file', 'unknown')).toBe(0);
  });

  it('reports no match when the start never arrived', () => {
    expect(findOpenTool([], 'read_file', 'a')).toBe(-1);
    expect(findOpenTool([call({ name: 'other' })], 'read_file')).toBe(-1);
  });

  it('ignores cards that already closed when matching by name', () => {
    expect(findOpenTool([call({ done: true })], 'read_file')).toBe(-1);
  });
});

describe('closeTool', () => {
  it('closes the card the id names, not the newest', () => {
    const tools = [call({ callId: 'first' }), call({ callId: 'second' })];
    const out = closeTool(tools, 'read_file', 'A', 'first');
    expect(out[0]).toMatchObject({ callId: 'first', output: 'A', done: true });
    expect(out[1]).toMatchObject({ callId: 'second', done: false });
  });

  it('settles two concurrent calls independently and correctly', () => {
    let tools = [call({ callId: 'x' }), call({ callId: 'y' })];
    tools = closeTool(tools, 'read_file', 'Y-result', 'y');
    tools = closeTool(tools, 'read_file', 'X-result', 'x');
    expect(tools.map((t) => t.output)).toEqual(['X-result', 'Y-result']);
    expect(tools.every((t) => t.done)).toBe(true);
  });

  it('closes the newest open card when there is no id', () => {
    const tools = [call({ done: true, output: 'old' }), call({})];
    const out = closeTool(tools, 'read_file', 'new');
    expect(out[0]?.output).toBe('old');
    expect(out[1]).toMatchObject({ output: 'new', done: true });
  });

  it('leaves the list alone when nothing matches', () => {
    const tools = [call({ name: 'other', done: true })];
    expect(closeTool(tools, 'read_file', 'x', 'nope')).toEqual(tools);
  });

  it('tolerates no tools at all', () => {
    expect(closeTool(undefined, 'read_file', 'x')).toEqual([]);
  });
});

describe('markToolPhase', () => {
  it('marks the card the id names', () => {
    const tools = [call({ callId: 'a' }), call({ callId: 'b' })];
    const out = markToolPhase(tools, 'read_file', 'running', 'b');
    expect(out[0]?.phase).toBeUndefined();
    expect(out[1]?.phase).toBe('running');
  });

  it('does not close the card it marks', () => {
    const [out] = markToolPhase([call({ callId: 'a' })], 'read_file', 'running', 'a');
    expect(out).toMatchObject({ phase: 'running', done: false });
  });

  it('replaces the phase rather than accumulating it', () => {
    let tools = [call({ callId: 'a' })];
    tools = markToolPhase(tools, 'read_file', 'running', 'a');
    tools = markToolPhase(tools, 'read_file', 'complete', 'a');
    expect(tools[0]?.phase).toBe('complete');
  });
});

/**
 * The transcript used to render every tool card above the turn's prose, whatever
 * order the two actually arrived in. A turn that said "let me check", called a
 * tool, said "found it", called another, then answered came out as two stacked
 * cards over one merged paragraph — the agent reading as though it had decided
 * everything before saying anything.
 */
describe('interleaveTurn', () => {
  it('puts each card where the prose stopped', () => {
    const segments = interleaveTurn('let me check found it here it is', [
      call({ name: 'a', at: 13 }),
      call({ name: 'b', at: 22 }),
    ]);
    expect(segments).toEqual([
      { kind: 'text', text: 'let me check ' },
      { kind: 'tool', tool: expect.objectContaining({ name: 'a' }), index: 0 },
      { kind: 'text', text: 'found it ' },
      { kind: 'tool', tool: expect.objectContaining({ name: 'b' }), index: 1 },
      { kind: 'text', text: 'here it is' },
    ]);
  });

  it('keeps a card opened before any text ahead of it', () => {
    const segments = interleaveTurn('the answer', [call({ at: 0 })]);
    expect(segments.map((s) => s.kind)).toEqual(['tool', 'text']);
  });

  it('reproduces the old layout for a turn carrying no offsets', () => {
    // Hydration from a session snapshot has no offsets to record, so every card
    // sorts to 0 and lands ahead of the prose exactly as it used to.
    const segments = interleaveTurn('the answer', [call({ name: 'a' }), call({ name: 'b' })]);
    expect(segments.map((s) => s.kind)).toEqual(['tool', 'tool', 'text']);
  });

  it('holds arrival order for cards opened at the same point', () => {
    const segments = interleaveTurn('x', [
      call({ name: 'first', at: 1 }),
      call({ name: 'second', at: 1 }),
    ]);
    expect(segments.map((s) => (s.kind === 'tool' ? s.tool.name : s.text))).toEqual([
      'x',
      'first',
      'second',
    ]);
  });

  it('clamps an offset past the end rather than dropping the card', () => {
    // `done` replaces empty content with the final answer, stranding any offset
    // recorded against the text that never arrived.
    const segments = interleaveTurn('short', [call({ at: 999 })]);
    expect(segments).toEqual([
      { kind: 'text', text: 'short' },
      { kind: 'tool', tool: expect.objectContaining({ at: 999 }), index: 0 },
    ]);
  });

  it('emits nothing for an empty turn, and text alone when there are no tools', () => {
    expect(interleaveTurn('', undefined)).toEqual([]);
    expect(interleaveTurn('', [])).toEqual([]);
    expect(interleaveTurn('just prose', [])).toEqual([{ kind: 'text', text: 'just prose' }]);
  });

  it('emits only cards when a turn produced no prose at all', () => {
    expect(interleaveTurn('', [call({ at: 0 })]).map((s) => s.kind)).toEqual(['tool']);
  });
});

/**
 * Reasoning is positioned the same way a tool card is, and against the same string,
 * so the two have to sort into one sequence rather than each into its own band.
 */
describe('interleaveTurn — reasoning', () => {
  it('places a thought where the model stopped to have it', () => {
    const segments = interleaveTurn('setup answer', [], [{ text: 'hmm', at: 6 }]);
    expect(segments).toEqual([
      { kind: 'text', text: 'setup ' },
      { kind: 'reasoning', text: 'hmm' },
      { kind: 'text', text: 'answer' },
    ]);
  });

  it('puts a thought ahead of a call made at the same point', () => {
    // Reasoning precedes acting. Both are recorded at the same offset because no
    // prose separates them, so the tie has to break deliberately.
    const segments = interleaveTurn(
      '',
      [call({ name: 'search', at: 0 })],
      [{ text: 'plan', at: 0 }],
    );
    expect(segments.map((s) => (s.kind === 'tool' ? s.tool.name : s.text))).toEqual([
      'plan',
      'search',
    ]);
  });

  it('interleaves several thoughts and calls into one sequence', () => {
    const content = 'first second';
    const segments = interleaveTurn(
      content,
      [call({ name: 'a', at: 5 }), call({ name: 'b', at: 12 })],
      [
        { text: 'before a', at: 5 },
        { text: 'before b', at: 12 },
      ],
    );
    expect(segments.map((s) => s.kind)).toEqual([
      'text',
      'reasoning',
      'tool',
      'text',
      'reasoning',
      'tool',
    ]);
  });

  it('renders a turn that only ever thought', () => {
    expect(interleaveTurn('', undefined, [{ text: 'hmm', at: 0 }])).toEqual([
      { kind: 'reasoning', text: 'hmm' },
    ]);
  });

  it('is unchanged for a turn with no reasoning at all', () => {
    // The old harness sends none, so this is the shape most turns still have.
    expect(interleaveTurn('answer', [call({ at: 0 })])).toEqual(
      interleaveTurn('answer', [call({ at: 0 })], []),
    );
  });

  it('clamps a thought recorded past the end', () => {
    expect(interleaveTurn('short', [], [{ text: 'hmm', at: 999 }])).toEqual([
      { kind: 'text', text: 'short' },
      { kind: 'reasoning', text: 'hmm' },
    ]);
  });
});
