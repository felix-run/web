import { afterEach, describe, expect, it, vi } from 'vitest';
import { syncApprovals } from '../src/approvals';
import { routedDiffReader } from '../src/diff-before';
import { createChatEngine } from '../src/engine';
import { createFelixClient } from '../src/transport';

/**
 * A write approval's "before" is read from the file the write will replace.
 * Found live on :8080: a `write_file` creating `notes/plan.md` on a fresh thread
 * was shown replacing six lines — the browser's copy, left from another test,
 * which that write never touches. `local_*` writes the client's files;
 * everything else writes the thread's workspace on the harness.
 */

describe('routedDiffReader', () => {
  const enc = (s: string) => new TextEncoder().encode(s);

  it("reads a local_* write's file locally, and a harness write's on the harness", async () => {
    const local = vi.fn(async () => 'browser copy');
    const workspaceRead = vi.fn(async () => ({
      path: 'a',
      bytes: enc('harness copy'),
      sha256: 'x',
    }));
    const read = routedDiffReader({ workspaceRead }, local);

    await expect(read('a', { tool: 'local_write', threadId: 't1' })).resolves.toBe('browser copy');
    await expect(read('a', { tool: 'write_file', threadId: 't1' })).resolves.toBe('harness copy');
    expect(workspaceRead).toHaveBeenCalledWith({ threadId: 't1', path: 'a' });
    expect(local).toHaveBeenCalledTimes(1);
  });

  it('says nothing is there when the harness has no such file, or it is not text', async () => {
    const local = vi.fn(async () => 'browser copy');
    const missing = routedDiffReader(
      { workspaceRead: vi.fn(async () => Promise.reject(new Error('not_found'))) },
      local,
    );
    await expect(missing('a', { tool: 'write_file', threadId: 't1' })).resolves.toBeNull();
    const binary = routedDiffReader(
      {
        workspaceRead: vi.fn(async () => ({
          path: 'a',
          bytes: new Uint8Array([0xff, 0xfe, 0x00]),
          sha256: 'x',
        })),
      },
      local,
    );
    await expect(binary('a', { tool: 'write_file', threadId: 't1' })).resolves.toBeNull();
    expect(local).not.toHaveBeenCalled();
  });

  it('keeps the local read for a caller that names no call (an older port)', async () => {
    const local = vi.fn(async () => 'browser copy');
    const read = routedDiffReader({ workspaceRead: vi.fn() }, local);
    await expect(read('a')).resolves.toBe('browser copy');
  });
});

describe('an approval adopted from /approvals', () => {
  it("asks for the before of the row's own tool, on the row's own thread", async () => {
    const readForDiff = vi.fn(async () => 'x');
    await syncApprovals({
      listPending: async () => [
        { id: 'ap1', tool_name: 'write_file', args: { path: 'notes/plan.md' }, thread_id: 't9' },
      ],
      threadId: 't9',
      seen: new Set(),
      readForDiff,
    } as unknown as Parameters<typeof syncApprovals>[0]);
    expect(readForDiff).toHaveBeenCalledWith('notes/plan.md', {
      tool: 'write_file',
      threadId: 't9',
    });
  });
});

describe('an approval announced by frame', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks for the before of the gated tool, on the engine\u2019s thread', async () => {
    const frames = [
      {
        event: 'approval_required',
        data: { approval_id: 'ap2', tool_name: 'write_file', args: { path: 'notes/plan.md' } },
      },
    ];
    const body = frames.map((f) => `data: ${JSON.stringify(f)}`).join('\n\n');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) =>
        String(input).includes('/chat/stream')
          ? new Response(`${body}\n\ndata: [DONE]\n\n`, {
              headers: { 'content-type': 'text/event-stream' },
            })
          : new Response('{}'),
      ),
    );
    const readForDiff = vi.fn(async () => 'before');
    let n = 0;
    const engine = createChatEngine({
      client: createFelixClient({ baseUrl: '/api' }),
      threadId: () => 't3',
      newId: () => `id-${++n}`,
      clientTools: { execute: vi.fn(), readForDiff },
    } as unknown as Parameters<typeof createChatEngine>[0]);
    engine.setTurns([{ id: 'a1', role: 'assistant', content: '', tools: [] }]);
    await engine.send({
      manifest: 'm',
      messages: [{ role: 'user', content: 'go' }],
      assistantId: 'a1',
    });
    expect(readForDiff).toHaveBeenCalledWith('notes/plan.md', {
      tool: 'write_file',
      threadId: 't3',
    });
    expect(engine.state.approvals[0]?.before).toBe('before');
  });
});
