import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createChatEngine } from '../src/engine';
import { openedPath } from '../src/open-file';
import { createFelixClient } from '../src/transport';

/**
 * `open_file` (felix-run/felix#620), at the wire: the result is the instruction, so what is
 * pinned is when the engine hands a path to `onOpenFile` — once per call, on a live `tool_end`
 * and on a durable run's `session_event` alike, never for a refusal, and never for a call that
 * is only in a transcript the engine was given rather than one it watched happen.
 */

function sse(frames: unknown[]) {
  const body = frames.map((f) => `data: ${JSON.stringify(f)}`).join('\n\n');
  return new Response(`${body}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function engineOn(frames: unknown[], onOpenFile: (path: string) => void) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) =>
      String(input).includes('/chat/stream') ? sse(frames) : new Response('{}'),
    ),
  );
  let n = 0;
  const engine = createChatEngine({
    client: createFelixClient({ baseUrl: '/api' }),
    threadId: () => 't1',
    newId: () => `id-${++n}`,
    onOpenFile,
  });
  engine.setTurns([
    { id: 'u1', role: 'user', content: 'open the readme' },
    { id: 'a1', role: 'assistant', content: '', tools: [] },
  ]);
  return engine;
}

const run = (engine: ReturnType<typeof createChatEngine>) =>
  engine.send({
    manifest: 'contributor',
    messages: [{ role: 'user', content: 'open the readme' }],
    assistantId: 'a1',
  });

const OPENED = JSON.stringify({ opened: 'README.md', kind: 'file', in: 'side_pane', size: 5 });

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('open_file', () => {
  it('opens a live call once, even when its result arrives twice', async () => {
    const onOpenFile = vi.fn();
    const engine = engineOn(
      [
        {
          event: 'tool_start',
          data: { name: 'open_file', id: 'c1', input: { path: 'README.md' } },
        },
        { event: 'tool_end', data: { name: 'open_file', id: 'c1', output: OPENED } },
        { event: 'tool_end', data: { name: 'open_file', id: 'c1', output: OPENED } },
        { event: 'done', data: {} },
      ],
      onOpenFile,
    );
    await run(engine);
    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(onOpenFile).toHaveBeenCalledWith('README.md');
  });

  it('opens nothing for a refusal, or for another tool that answers the same shape', async () => {
    const onOpenFile = vi.fn();
    const engine = engineOn(
      [
        { event: 'tool_start', data: { name: 'open_file', id: 'c1', input: { path: 'x.md' } } },
        {
          event: 'tool_end',
          data: {
            name: 'open_file',
            id: 'c1',
            output: '[tool error/invalid_arguments] not a file: x.md',
          },
        },
        { event: 'tool_start', data: { name: 'local_open', id: 'c2', input: { target: 'a' } } },
        { event: 'tool_end', data: { name: 'local_open', id: 'c2', output: OPENED } },
        { event: 'done', data: {} },
      ],
      onOpenFile,
    );
    await run(engine);
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  // A durable run's stream carries no `tool_end`: its calls arrive as session-log rows, and the
  // engine re-folds the whole run on every row. The call must open once, not once per re-fold.
  it("opens a durable run's call once, as its result row lands", async () => {
    const onOpenFile = vi.fn();
    const engine = engineOn(
      [
        { event: 'run_accepted', data: { resume_token: 'fib_1' } },
        { event: 'run_status', data: { status: 'running' } },
        {
          event: 'session_event',
          data: {
            id: 'e1',
            seq: 1,
            kind: 'message',
            role: 'assistant',
            content: 'opening it',
            tool_calls: [{ id: 'c1', name: 'open_file', args: { path: 'README.md' } }],
          },
        },
        {
          event: 'session_event',
          data: {
            id: 'e2',
            seq: 2,
            kind: 'tool_result',
            role: 'tool',
            content: OPENED,
            tool_call_id: 'c1',
          },
        },
        {
          event: 'session_event',
          data: { id: 'e3', seq: 3, kind: 'message', role: 'assistant', content: 'done' },
        },
        { event: 'final', data: { content: 'done' } },
      ],
      onOpenFile,
    );
    await run(engine);
    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(onOpenFile).toHaveBeenCalledWith('README.md');
  });

  // A reload rebuilds the transcript from the snapshot; reopening every file the thread ever
  // opened would bury what the operator came back to.
  it('opens nothing for a call that is only in a transcript it was given', () => {
    const onOpenFile = vi.fn();
    const engine = engineOn([], onOpenFile);
    engine.setTurns([
      { id: 'u1', role: 'user', content: 'open the readme' },
      {
        id: 'a1',
        role: 'assistant',
        content: 'opened',
        tools: [{ name: 'open_file', callId: 'c1', output: OPENED, done: true, at: 0 }],
      },
    ]);
    expect(onOpenFile).not.toHaveBeenCalled();
  });
});

describe('openedPath', () => {
  it('reads the path off a result, as text or parsed', () => {
    expect(openedPath(OPENED)).toBe('README.md');
    expect(openedPath({ opened: 'a/b.md', kind: 'file' })).toBe('a/b.md');
  });

  it('is null for anything that is not a successful open', () => {
    expect(openedPath('[tool error/invalid_arguments] not a file: x')).toBeNull();
    expect(openedPath('{"opened": ""}')).toBeNull();
    expect(openedPath({ opened: 'x', kind: 'url' })).toBeNull();
    expect(openedPath(null)).toBeNull();
    expect(openedPath(42)).toBeNull();
  });
});
