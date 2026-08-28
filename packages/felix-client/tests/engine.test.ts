import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createChatEngine } from '../src/engine';
import { createFelixClient } from '../src/transport';

/**
 * The frame switch, driven at the wire.
 *
 * `check-protocol-parity` proves a handler *exists* for each event the harness
 * emits — it compares names, and says nothing about whether the handler is
 * right. chat-ui's `app-stream.test.tsx` closes that from the other end, through
 * rendered output. These sit in between: frames in, transcript out, with no view
 * involved, which is the only place the blocking frames can be checked at all.
 * A `tool_request` that goes unanswered does not look like a failure — it looks
 * like a run that is still thinking, for the two minutes until the tool times
 * out.
 */

/** One SSE body: an envelope per frame, terminated the way the harness does. */
function sse(frames: unknown[]) {
  const body = frames.map((f) => `data: ${JSON.stringify(f)}`).join('\n\n');
  return new Response(`${body}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

let posted: Array<{ url: string; body: unknown }>;

function stubFetch(handler: (url: string) => Response) {
  posted = [];
  const fn = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    posted.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return handler(url);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** An engine on a thread called `t1`, with ids that do not move between runs. */
function engineOn(frames: unknown[], ports: Parameters<typeof createChatEngine>[0] | null = null) {
  stubFetch((url) => (url.includes('/chat/stream') ? sse(frames) : new Response('{}')));
  let n = 0;
  const engine = createChatEngine({
    client: createFelixClient({ baseUrl: '/api' }),
    threadId: () => 't1',
    newId: () => `id-${++n}`,
    ...(ports ?? {}),
  } as Parameters<typeof createChatEngine>[0]);
  engine.setTurns([
    { id: 'u1', role: 'user', content: 'hello' },
    { id: 'a1', role: 'assistant', content: '', tools: [] },
  ]);
  return engine;
}

const run = (engine: ReturnType<typeof createChatEngine>) =>
  engine.send({
    manifest: 'quick',
    messages: [{ role: 'user', content: 'hello' }],
    assistantId: 'a1',
  });

const delta = (text: string) => ({ event: 'text_delta', data: { delta: text } });

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('streaming a turn', () => {
  it('appends deltas to the assistant turn the run opened', async () => {
    const engine = engineOn([delta('the '), delta('answer')]);
    await run(engine);

    expect(engine.state.turns.at(-1)?.content).toBe('the answer');
    expect(engine.state.streaming).toBe(false);
    expect(engine.state.phase).toBe('idle');
  });

  it('falls back to the final message when a turn produced no deltas', async () => {
    const engine = engineOn([{ event: 'done', data: { final: { content: '42' } } }]);
    await run(engine);

    expect(engine.state.turns.at(-1)?.content).toBe('42');
  });

  it('reports a mid-stream failure rather than ending quietly', async () => {
    const engine = engineOn([{ event: 'on_error', data: { message: 'model gateway said no' } }]);
    await run(engine);

    expect(engine.state.error).toBe('model gateway said no');
  });
});

describe('a drained steer', () => {
  /**
   * The harness appends the steer as a real user message and keeps going, so the
   * reply splits in two. Everything after it belongs to the *new* turn — landing
   * it on the old one silently discards whatever the assistant had already said.
   */
  it('opens a fresh assistant turn and sends later deltas there', async () => {
    const engine = engineOn([
      delta('first half'),
      { event: 'steer', data: { content: 'actually, the migration' } },
      delta('second half'),
    ]);
    await run(engine);

    expect(engine.state.turns.map((t) => [t.role, t.content])).toEqual([
      ['user', 'hello'],
      ['assistant', 'first half'],
      ['user', 'actually, the migration'],
      ['assistant', 'second half'],
    ]);
  });
});

describe('tool cards', () => {
  it('opens a card where the prose had got to, and closes it by id', async () => {
    const engine = engineOn([
      delta('let me check'),
      { event: 'tool_start', data: { name: 'read_file', input: { path: 'a.ts' }, id: 'c1' } },
      { event: 'tool_execution_update', data: { name: 'read_file', id: 'c1', status: 'running' } },
      { event: 'tool_end', data: { name: 'read_file', output: '42 lines', id: 'c1' } },
      delta(' — found it'),
    ]);
    await run(engine);

    const tools = engine.state.turns.at(-1)?.tools ?? [];
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      name: 'read_file',
      output: '42 lines',
      done: true,
      at: 'let me check'.length,
    });
  });

  /**
   * A spinner that outlives the run reads as work still going. An aborted run
   * sends no `done`, so nothing else settles these.
   */
  it('settles a card the run ended without closing', async () => {
    const engine = engineOn([{ event: 'tool_start', data: { name: 'slow_tool', id: 'c9' } }]);
    await run(engine);

    expect(engine.state.turns.at(-1)?.tools?.[0]).toMatchObject({ name: 'slow_tool', done: true });
  });
});

describe('client-executed tools', () => {
  it('runs the tool and posts the result back, which is what unblocks the run', async () => {
    const execute = vi.fn(async () => ({ content: 'total 4\nREADME.md' }));
    const engine = engineOn(
      [{ event: 'tool_request', data: { id: 'call_1', name: 'ls', args: {} } }],
      {
        clientTools: { execute },
      } as never,
    );
    await run(engine);

    expect(execute).toHaveBeenCalledWith({ id: 'call_1', name: 'ls', args: {} });
    const result = posted.find((p) => p.url.includes('/chat/tool_result'));
    expect(result?.body).toMatchObject({
      thread_id: 't1',
      tool_call_id: 'call_1',
      content: 'total 4\nREADME.md',
    });
    expect(engine.state.turns.at(-1)?.tools?.[0]).toMatchObject({
      name: 'client · ls',
      done: true,
    });
  });

  /**
   * Not answering is the one thing a client may never do: the harness blocks on
   * the waiter until the tool's timeout, default 120s, and the conversation looks
   * like it is still thinking the whole time.
   */
  it('answers with an error when it has no executor, instead of hanging the run', async () => {
    const engine = engineOn([
      { event: 'tool_request', data: { id: 'call_2', name: 'ls', args: {} } },
    ]);
    await run(engine);

    const result = posted.find((p) => p.url.includes('/chat/tool_result'));
    expect(result?.body).toMatchObject({ tool_call_id: 'call_2', error: true });
  });
});

describe('approvals', () => {
  it('queues a gated call once, however many times the harness announces it', async () => {
    const frame = {
      event: 'approval_required',
      data: { approval_id: 'ap_1', tool_name: 'write_file', args: { path: 'a.ts', content: 'x' } },
    };
    const readForDiff = vi.fn(async () => 'the old text');
    const engine = engineOn([frame, frame], {
      clientTools: { execute: async () => ({ content: '' }), readForDiff },
    } as never);
    await run(engine);

    expect(engine.state.approvals).toHaveLength(1);
    expect(engine.state.approvals[0]).toMatchObject({
      approvalId: 'ap_1',
      toolName: 'write_file',
      before: 'the old text',
    });
  });

  it('adopts one the stream never announced, from the poll', async () => {
    stubFetch((url) =>
      url.includes('/approvals')
        ? new Response(
            JSON.stringify({
              requests: [{ id: 'ap_2', tool_name: 'local_shell', args: { command: 'rm -rf /' } }],
            }),
          )
        : new Response('{}'),
    );
    const engine = createChatEngine({
      client: createFelixClient({ baseUrl: '/api' }),
      threadId: () => 't1',
    });

    await engine.syncApprovals();
    await engine.syncApprovals(); // the poll runs on a timer; twice must not double up

    expect(engine.state.approvals.map((a) => a.approvalId)).toEqual(['ap_2']);
  });
});

describe('a durable run', () => {
  /** No deltas ever arrive; the answer lands in `final`. */
  it('renders progress and then the answer', async () => {
    const engine = engineOn([
      { event: 'run_accepted', data: { resume_token: 'fib_1' } },
      { event: 'run_status', data: { status: 'running' } },
      { event: 'final', data: { content: 'the durable answer' } },
    ]);
    await run(engine);

    expect(engine.state.turns.at(-1)?.content).toBe('the durable answer');
  });
});

describe('reset', () => {
  it('forgets the thread, including approvals it has already shown', async () => {
    const engine = engineOn([
      delta('something'),
      {
        event: 'approval_required',
        data: { approval_id: 'ap_3', tool_name: 'local_shell', args: {} },
      },
    ]);
    await run(engine);
    expect(engine.state.approvals).toHaveLength(1);

    engine.reset();

    expect(engine.state).toMatchObject({ turns: [], approvals: [], error: null, phase: 'idle' });
  });
});
