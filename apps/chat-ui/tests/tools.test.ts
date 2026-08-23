import { describe, expect, it } from 'vitest';
import { closeTool, findOpenTool, markToolPhase } from '@/lib/tools';
import type { ToolCall } from '@/types';

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
    expect(out[0].output).toBe('old');
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
    expect(out[0].phase).toBeUndefined();
    expect(out[1].phase).toBe('running');
  });

  it('does not close the card it marks', () => {
    const [out] = markToolPhase([call({ callId: 'a' })], 'read_file', 'running', 'a');
    expect(out).toMatchObject({ phase: 'running', done: false });
  });

  it('replaces the phase rather than accumulating it', () => {
    let tools = [call({ callId: 'a' })];
    tools = markToolPhase(tools, 'read_file', 'running', 'a');
    tools = markToolPhase(tools, 'read_file', 'complete', 'a');
    expect(tools[0].phase).toBe('complete');
  });
});
