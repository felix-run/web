import { beforeEach, describe, expect, it, vi } from 'vitest';
import { durableRunFailure, isDurableRunOver } from '../src/durable-runs';
import { createChatEngine } from '../src/engine';
import { createFelixClient } from '../src/transport';

/**
 * A durable run, from the moment its stream stops being the way to watch it.
 *
 * Measured on a production `cowork` thread (2026-10-08): the harness closed the run's
 * stream at its 300s deadline with `run_expired:<token>` while the run went on; the
 * engine reported that string as the error, then polled `/chat/runs` for a status it
 * did not recognise as final (`expired`) for the rest of the tab's life; and a reload
 * had no way back to the run at all, so the next message started a second one beside
 * it. These pin each of those at the wire.
 */

function sse(frames: unknown[]) {
  const body = frames.map((f) => `data: ${JSON.stringify(f)}`).join('\n\n');
  return new Response(`${body}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 5));
  }
}

function engineWith(ports: Partial<Parameters<typeof createChatEngine>[0]> = {}) {
  let n = 0;
  const engine = createChatEngine({
    client: createFelixClient({ baseUrl: '/api' }),
    threadId: () => 't1',
    newId: () => `id-${++n}`,
    ...ports,
  } as Parameters<typeof createChatEngine>[0]);
  engine.setTurns([
    { id: 'u1', role: 'user', content: 'hello' },
    { id: 'a1', role: 'assistant', content: '', tools: [] },
  ]);
  return engine;
}

const send = (engine: ReturnType<typeof createChatEngine>) =>
  engine.send({
    manifest: 'cowork',
    messages: [{ role: 'user', content: 'hello' }],
    assistantId: 'a1',
  });

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('when a durable run is over', () => {
  it("is the harness's terminal set, expired and dead included", () => {
    for (const status of ['completed', 'failed', 'expired', 'dead', 'cancelled']) {
      expect(isDurableRunOver({ status })).toBe(true);
    }
    expect(isDurableRunOver({ status: 'running' })).toBe(false);
    expect(isDurableRunOver({ status: 'pending' })).toBe(false);
  });

  it('says why an expired run has no answer, which the run view does not', () => {
    expect(durableRunFailure({ status: 'expired', error: '' })).toMatch(/time limit/);
    expect(durableRunFailure({ status: 'dead', error: 'step failed 5 times' })).toBe(
      'step failed 5 times',
    );
    expect(durableRunFailure({ status: 'completed' })).toBeNull();
  });
});

describe('polling a durable run', () => {
  it('rides out a failed read rather than abandoning a run still working', async () => {
    const replies = [
      new Response('upstream', { status: 502 }),
      json({ status: 'running' }),
      json({ status: 'completed', final: { content: 'done' } }),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => replies.shift() ?? json({})),
    );
    const run = await createFelixClient({ baseUrl: '/api' }).pollDurableRun('fib_1', {
      intervalMs: 1,
    });
    expect(run.status).toBe('completed');
  });

  it('ends on a run the harness no longer knows, instead of polling forever', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"detail":"not found"}', { status: 404 })),
    );
    const run = await createFelixClient({ baseUrl: '/api' }).pollDurableRun('fib_gone', {
      intervalMs: 1,
    });
    expect(run.status).toBe('missing');
    expect(run.error).toBeTruthy();
  });
});

describe('a durable stream that closes at its deadline', () => {
  it('keeps watching the run instead of reporting the deadline as a failure', async () => {
    const settled = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes('/chat/stream')) {
          return sse([
            { event: 'run_accepted', data: { resume_token: 'fib_1' } },
            { event: 'run_status', data: { status: 'running' } },
            { event: 'on_error', data: { message: 'run_expired:fib_1' } },
          ]);
        }
        if (url.includes('/chat/runs/')) {
          return json({ status: 'completed', final: { content: 'wrote it' } });
        }
        return json({});
      }),
    );
    const engine = engineWith({ onRunSettled: settled });
    await send(engine);

    expect(engine.state.error).toBeNull();
    expect(engine.state.turns.find((t) => t.id === 'a1')?.content).toBe('wrote it');
    expect(settled).toHaveBeenCalledOnce();
  });

  it('says the run expired, and drops the status line, when the poll finds it so', async () => {
    const complete = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes('/chat/stream')) {
          return sse([{ event: 'run_accepted', data: { resume_token: 'fib_1' } }]);
        }
        if (url.includes('/chat/runs/')) return json({ status: 'expired', error: '' });
        return json({});
      }),
    );
    const engine = engineWith({ onDurableComplete: complete });
    await send(engine);

    expect(engine.state.error).toMatch(/time limit/);
    expect(engine.state.turns.some((t) => t.id === 'a1')).toBe(false);
    expect(engine.state.streaming).toBe(false);
    // What the run did before it stopped is in the log, so it is still re-read.
    expect(complete).toHaveBeenCalledOnce();
  });
});

describe('a durable run the tab can find again', () => {
  it('reports the token when the run is taken, and lets it go when it lands', async () => {
    const accepted = vi.fn();
    const settled = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sse([
          { event: 'run_accepted', data: { resume_token: 'fib_7' } },
          { event: 'final', data: { content: 'ok' } },
        ]),
      ),
    );
    const engine = engineWith({ onRunAccepted: accepted, onRunSettled: settled });
    await send(engine);

    expect(accepted).toHaveBeenCalledWith('fib_7');
    expect(settled).toHaveBeenCalledOnce();
  });

  it('keeps the token when the poll cannot reach the harness, so the next load retries', async () => {
    const settled = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('denied', { status: 403 })),
    );
    const engine = engineWith({ onRunSettled: settled });
    await engine.rejoinRun('fib_7');

    expect(settled).not.toHaveBeenCalled();
    expect(engine.state.error).toBeTruthy();
    expect(engine.state.streaming).toBe(false);
  });

  it('rejoins after a reload: running while the run works, answered when it lands', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const settled = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        if (String(input).includes('/chat/runs/fib_7')) {
          await gate;
          return json({ status: 'completed', final: { content: 'the answer' } });
        }
        return json({});
      }),
    );
    const engine = engineWith({ onRunSettled: settled });
    engine.setTurns([{ id: 'u1', role: 'user', content: 'proceed' }]);

    const rejoined = engine.rejoinRun('fib_7');
    await until(() => engine.state.streaming);
    expect(engine.state.phase).toBe('durable');
    expect(engine.state.turns.at(-1)?.content).toBe('Background · running…');

    // A transcript re-read mid-run carries no status turn; the engine keeps its own last.
    engine.setTurns([{ id: 'u1', role: 'user', content: 'proceed' }]);
    expect(engine.state.turns.at(-1)?.content).toBe('Background · running…');

    release();
    await rejoined;
    expect(engine.state.turns.at(-1)?.content).toBe('the answer');
    expect(engine.state.streaming).toBe(false);
    expect(settled).toHaveBeenCalledOnce();
  });
});

describe('a send the harness refuses for the run already on the thread', () => {
  /**
   * felix-run/felix#529: the harness refuses a second run on a thread whose durable run is
   * still going, naming that run. The message never landed — as with a lease refusal it goes
   * back to the caller — and the engine watches the run that refused it, so the thread reads
   * as running instead of idle, which is what invited the second send in the first place.
   */
  it('hands the message back and watches the run that refused it', async () => {
    let polled = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes('/chat/stream')) {
          return json({ detail: 'run_in_progress:fib_busy' }, 409);
        }
        if (url.includes('/chat/runs/')) {
          polled = url;
          return json({ status: 'completed', final: { content: 'the first run, finished' } });
        }
        return json({});
      }),
    );
    const engine = engineWith();

    const outcome = await send(engine);
    expect(outcome).toBe('run_in_progress');
    // The placeholder reply is gone; the status turn of the run being watched replaces it.
    expect(engine.state.turns.some((t) => t.id === 'a1')).toBe(false);
    expect(engine.state.error).toBeNull();

    await until(() => !engine.state.streaming && polled !== '');
    expect(polled).toContain('/chat/runs/fib_busy');
    expect(engine.state.turns.at(-1)?.content).toBe('the first run, finished');
  });

  it('is the same refusal from a background send', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.endsWith('/chat')) return json({ detail: 'run_in_progress:fib_busy' }, 409);
        if (url.includes('/chat/runs/'))
          return json({ status: 'completed', final: { content: 'ok' } });
        return json({});
      }),
    );
    const engine = engineWith();
    const outcome = await engine.send({
      manifest: 'cowork',
      messages: [{ role: 'user', content: 'hello' }],
      assistantId: 'a1',
      mode: 'background',
    });
    expect(outcome).toBe('run_in_progress');
  });

  it('reads no other 409 as a run to watch', async () => {
    const fetched: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        fetched.push(String(input));
        return json({ detail: 'manifest_drift' }, 409);
      }),
    );
    const engine = engineWith();
    expect(await send(engine)).toBe('done');
    expect(fetched.some((u) => u.includes('/chat/runs/'))).toBe(false);
  });
});

describe('what a durable run is blocked on, after its stream has closed', () => {
  /**
   * felix-run/felix#530. The poll that settles a durable run carries no frames, so a client
   * tool the run asked for after its stream closed reached no client and timed out. The
   * engine now holds the thread's reattach stream open while it polls, and the harness
   * announces the run's pending requests there.
   */
  it('runs the client tool the reattach asks for, and answers it', async () => {
    let answered = false;
    const posted: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/chat/tool_result')) {
          answered = true;
          posted.push(JSON.parse(String(init?.body)));
          return json({ ok: true });
        }
        if (url.includes('/chat/stream/t1')) {
          return sse([
            {
              event: 'tool_request',
              data: { id: 'call_w', name: 'local_write', args: { path: 'a.md' } },
            },
          ]);
        }
        if (url.includes('/chat/runs/fib_7')) {
          return json(
            answered
              ? { status: 'completed', final: { content: 'wrote it' } }
              : { status: 'running' },
          );
        }
        return json({});
      }),
    );
    const execute = vi.fn(async () => ({ content: 'wrote 5 chars to a.md' }));
    const engine = engineWith({ clientTools: { execute } });

    await engine.rejoinRun('fib_7');

    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith({
      id: 'call_w',
      name: 'local_write',
      args: { path: 'a.md' },
    });
    expect(posted).toEqual([
      expect.objectContaining({ tool_call_id: 'call_w', content: 'wrote 5 chars to a.md' }),
    ]);
    expect(engine.state.turns.at(-1)?.content).toBe('wrote it');
  }, 10_000);

  it('runs a request once, however many streams announce it', async () => {
    const answers: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        if (String(input).includes('/chat/tool_result')) answers.push(String(input));
        return json({ ok: true });
      }),
    );
    const execute = vi.fn(async () => ({ content: 'ok' }));
    const engine = engineWith({ clientTools: { execute } });
    const request = {
      event: 'tool_request',
      data: { id: 'call_once', name: 'local_write', args: { path: 'a.md' } },
    };

    // The run's own stream and a reattach, each announcing it once.
    await engine.applyEvent(request);
    await engine.applyEvent(request);

    expect(execute).toHaveBeenCalledOnce();
    expect(answers).toHaveLength(1);
  });
});
