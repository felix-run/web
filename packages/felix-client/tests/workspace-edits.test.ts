import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createChatEngine } from '../src/engine';
import { LeaseRefusedError } from '../src/errors';
import { eventsToTurns } from '../src/session-log';
import { createFelixClient } from '../src/transport';
import { describeWorkspaceEdit, workspaceEditOf } from '../src/workspace-edits';

/**
 * The operator edits a workspace file and the harness tells the agent
 * (`POST /chat/workspace/edited`, felix-run/felix#577). Three things are pinned:
 * what the route is sent and what its answers mean, where a live run's
 * `workspace_note` frame lands in the transcript, and that a snapshot's custom
 * entry is read back as the same edit — and no other custom entry is.
 */

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
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      posted.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return handler(url);
    }),
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /chat/workspace/edited', () => {
  const client = () => createFelixClient({ baseUrl: '/api' });

  it('sends structured fields only, and reads queued and recorded', async () => {
    stubFetch(() => new Response(JSON.stringify({ status: 'queued', event_id: null })));
    await expect(
      client().workspaceEdited({ threadId: 't1', path: 'notes/plan.md', bytes: 120 }),
    ).resolves.toEqual({ status: 'queued', eventId: null });
    expect(posted[0]).toEqual({
      url: '/api/chat/workspace/edited',
      body: { thread_id: 't1', path: 'notes/plan.md', op: 'write', bytes: 120 },
    });

    stubFetch(() => new Response(JSON.stringify({ status: 'recorded', event_id: 'e9' })));
    await expect(
      client().workspaceEdited({ threadId: 't1', path: 'a', op: 'delete', bytes: 5 }),
    ).resolves.toEqual({ status: 'recorded', eventId: 'e9' });
    // The harness refuses bytes on a delete, so none is sent.
    expect(posted[0]?.body).toEqual({ thread_id: 't1', path: 'a', op: 'delete' });
  });

  it('answers null from a harness without the route, rather than throwing', async () => {
    stubFetch(() => new Response('{"detail":"Not Found"}', { status: 404 }));
    await expect(client().workspaceEdited({ threadId: 't1', path: 'a' })).resolves.toBeNull();
  });

  it('is refused like any driving request when another client holds the thread', async () => {
    stubFetch(() => new Response(JSON.stringify({ detail: 'lease_read_only' }), { status: 409 }));
    await expect(client().workspaceEdited({ threadId: 't1', path: 'a' })).rejects.toBeInstanceOf(
      LeaseRefusedError,
    );
  });
});

describe('a workspace_note on a live stream', () => {
  function engineOn(frames: unknown[]) {
    stubFetch((url) => (url.includes('/chat/stream') ? sse(frames) : new Response('{}')));
    let n = 0;
    const engine = createChatEngine({
      client: createFelixClient({ baseUrl: '/api' }),
      threadId: () => 't1',
      newId: () => `id-${++n}`,
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
  const note = { event: 'workspace_note', data: { path: 'notes/plan.md', op: 'write', bytes: 9 } };
  const delta = (text: string) => ({ event: 'text_delta', data: { delta: text } });

  it('splits the reply where the run read it, as a steer does', async () => {
    const engine = engineOn([delta('first'), note, delta('second')]);
    await run(engine);
    expect(engine.state.turns.map((t) => t.role)).toEqual([
      'user',
      'assistant',
      'note',
      'assistant',
    ]);
    const drawn = engine.state.turns[2];
    expect(drawn?.note).toEqual({
      role: 'user',
      inContext: true,
      workspaceEdit: { path: 'notes/plan.md', op: 'write', bytes: 9 },
    });
    expect(engine.state.turns[3]?.content).toBe('second');
  });

  it('goes in front of a reply that has not started, leaving no empty turn', async () => {
    const engine = engineOn([note, delta('answer')]);
    await run(engine);
    expect(engine.state.turns.map((t) => [t.role, t.content])).toEqual([
      ['user', 'hello'],
      ['note', 'You edited notes/plan.md in the workspace.'],
      ['assistant', 'answer'],
    ]);
  });
});

describe('the custom entry a snapshot carries', () => {
  it('is read back as the edit, and another custom entry is not', () => {
    const turns = eventsToTurns([
      {
        id: 'e1',
        kind: 'custom',
        role: 'user',
        content: 'The operator renamed `a` to `b` in the workspace.',
        metadata: {
          type: 'workspace_edit',
          path: 'a',
          op: 'rename',
          to_path: 'b',
          in_context: true,
        },
      },
      {
        id: 'e2',
        kind: 'custom',
        role: 'system',
        content: 'a client note',
        metadata: { path: 'looks/like/one.md', in_context: false },
      },
    ] as unknown as Parameters<typeof eventsToTurns>[0]);
    expect(turns[0]?.note?.workspaceEdit).toEqual({ path: 'a', op: 'rename', toPath: 'b' });
    expect(turns[1]?.note?.workspaceEdit).toBeUndefined();
  });

  it('says it in the operator’s terms', () => {
    expect(describeWorkspaceEdit({ path: 'x', op: 'delete' })).toBe(
      'You deleted x from the workspace.',
    );
    expect(workspaceEditOf({ path: '' })).toBeNull();
    expect(workspaceEditOf({ path: 'x', op: 'shred' })).toEqual({ path: 'x', op: 'write' });
  });
});
