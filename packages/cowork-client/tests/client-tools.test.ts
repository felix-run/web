import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CLIENT_TOOL_TIMEOUT_MS, executeClientTool } from '../src/client-tools';
import { getVfs } from '../src/vfs';

const vfs = getVfs('test.client-tools');

beforeEach(() => {
  vfs.reset();
});

describe('executeClientTool', () => {
  it('runs a shell command against the tab VFS', async () => {
    vfs.write('notes/todo.md', 'one\n');
    const result = await executeClientTool(
      { id: 't1', name: 'local_shell', args: { command: 'cat notes/todo.md' } },
      vfs,
    );
    expect(result).toEqual({ content: 'one\n' });
  });

  it('reports an unknown tool as an error rather than throwing', async () => {
    const result = await executeClientTool({ id: 't2', name: 'nope', args: {} }, vfs);
    expect(result.error).toBe(true);
    expect(result.content).toContain('unknown client tool');
  });

  // The harness blocks the model loop until this call is answered, so the one
  // outcome that must never happen is a promise that never settles.
  describe('always settles', () => {
    it('resolves with an error when the tool outruns its timeout', async () => {
      vi.useFakeTimers();
      try {
        const hang = new Promise<never>(() => {});
        const spy = vi.spyOn(vfs, 'read').mockReturnValue(hang as unknown as string);
        const pending = executeClientTool(
          { id: 't3', name: 'local_shell', args: { command: 'cat stuck' } },
          vfs,
          { timeoutMs: 50 },
        );
        await vi.advanceTimersByTimeAsync(50);
        const result = await pending;
        expect(result.error).toBe(true);
        expect(result.content).toContain('timed out after 50ms');
        spy.mockRestore();
      } finally {
        vi.useRealTimers();
      }
    });

    it('resolves with an error when the caller aborts mid-flight', async () => {
      const controller = new AbortController();
      const hang = new Promise<never>(() => {});
      const spy = vi.spyOn(vfs, 'read').mockReturnValue(hang as unknown as string);
      const pending = executeClientTool(
        { id: 't4', name: 'local_shell', args: { command: 'cat stuck' } },
        vfs,
        { signal: controller.signal },
      );
      controller.abort();
      const result = await pending;
      expect(result.error).toBe(true);
      expect(result.content).toContain('aborted');
      spy.mockRestore();
    });

    it('short-circuits when handed an already-aborted signal', async () => {
      const result = await executeClientTool(
        { id: 't5', name: 'local_shell', args: { command: 'pwd' } },
        vfs,
        { signal: AbortSignal.abort() },
      );
      expect(result).toEqual({ content: 'error: local_shell aborted', error: true });
    });
  });

  it('does not leave a timer armed after a tool finishes normally', async () => {
    vi.useFakeTimers();
    try {
      await executeClientTool({ id: 't6', name: 'local_shell', args: { command: 'pwd' } }, vfs);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('defaults to a bounded wait', () => {
    expect(DEFAULT_CLIENT_TOOL_TIMEOUT_MS).toBeGreaterThan(0);
    expect(Number.isFinite(DEFAULT_CLIENT_TOOL_TIMEOUT_MS)).toBe(true);
  });
});
