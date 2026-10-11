import { beforeEach, describe, expect, it, vi } from 'vitest';
import { subagentOf, todosFromCall } from '../src/agent-work';
import { createChatEngine } from '../src/engine';
import { CHECKLIST_ID, plansInTurn } from '../src/plans';
import { createFelixClient } from '../src/transport';
import type { ToolCall } from '../src/turns';

/**
 * The four frames that report what an agent does beside its tool calls:
 * `todo_updated` (its checklist), `subagent_start` / `subagent_end` (a `task`
 * call's child agent) and `permission_mode_changed`. Each is pinned at the wire —
 * frames in, transcript or state out — and the first two also from the call alone,
 * which is all a transcript rebuilt from the log has.
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

function engineOn(frames: unknown[]) {
  stubFetch((url) => (url.includes('/chat/stream') ? sse(frames) : new Response('{}')));
  let n = 0;
  const engine = createChatEngine({
    client: createFelixClient({ baseUrl: '/api' }),
    threadId: () => 't1',
    newId: () => `id-${++n}`,
  });
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

const LIST = [
  { content: 'Read the config', status: 'completed' },
  { content: 'Fix the parser', status: 'in_progress', active_form: 'Fixing the parser' },
  { content: 'Run the tests', status: 'pending' },
];
const NORMALISED = LIST.map((t, i) => ({ id: String(i + 1), active_form: '', ...t }));

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('the checklist', () => {
  it('shows a write the harness confirmed before the call has returned', async () => {
    const engine = engineOn([
      { event: 'tool_start', data: { name: 'todo_write', input: { todos: LIST }, id: 'c1' } },
      { event: 'todo_updated', data: { todos: NORMALISED } },
    ]);
    // Read as the frame lands: the stream's end closes any call still open.
    let tools: ToolCall[] = [];
    engine.subscribe((st) => {
      const open = st.turns.at(-1)?.tools ?? [];
      if (open[0]?.todos && !open[0].done && tools.length === 0) tools = open;
    });
    await run(engine);

    expect(tools[0]?.done).toBe(false);
    const checklist = plansInTurn(tools).latest.get(CHECKLIST_ID);
    expect(checklist?.title).toBe('Checklist');
    expect(checklist?.steps.map((s) => [s.title, s.state])).toEqual([
      ['Read the config', 'done'],
      // The item under way reads as the agent said it would while doing it.
      ['Fixing the parser', 'running'],
      ['Run the tests', 'pending'],
    ]);
  });

  it('draws one card per turn at the first write, showing the newest list', async () => {
    const later = NORMALISED.map((t) => ({ ...t, status: 'completed' }));
    const engine = engineOn([
      { event: 'tool_start', data: { name: 'todo_write', input: { todos: LIST }, id: 'c1' } },
      { event: 'todo_updated', data: { todos: NORMALISED } },
      {
        event: 'tool_end',
        data: { name: 'todo_write', output: 'Todo list updated: 1/3', id: 'c1' },
      },
      { event: 'tool_start', data: { name: 'read_file', input: { path: 'a' }, id: 'c2' } },
      { event: 'tool_end', data: { name: 'read_file', output: 'x', id: 'c2' } },
      { event: 'tool_start', data: { name: 'todo_write', input: { todos: later }, id: 'c3' } },
      { event: 'todo_updated', data: { todos: later } },
      {
        event: 'tool_end',
        data: { name: 'todo_write', output: 'Todo list updated: 3/3', id: 'c3' },
      },
    ]);
    await run(engine);

    const { anchorOf, folded, latest } = plansInTurn(engine.state.turns.at(-1)?.tools);
    expect(anchorOf.get(0)).toBe(CHECKLIST_ID);
    expect(folded).toEqual(new Set([2]));
    expect(latest.get(CHECKLIST_ID)?.steps.every((s) => s.state === 'done')).toBe(true);
  });

  it('is read back from a logged call, and a refused write is not a checklist', () => {
    const logged: ToolCall = {
      name: 'todo_write',
      input: { todos: LIST },
      output: 'Todo list updated: 1/3 completed.\nIn progress: Fix the parser',
      done: true,
    };
    expect(todosFromCall(logged)?.map((t) => t.status)).toEqual([
      'completed',
      'in_progress',
      'pending',
    ]);
    const refused = { ...logged, output: '[tool error/invalid_arguments] at most one item…' };
    expect(todosFromCall(refused)).toBeNull();
    // Unconfirmed and still running: nothing yet says the harness took it.
    expect(todosFromCall({ ...logged, done: false, output: undefined })).toBeNull();
    expect(
      todosFromCall({ ...logged, output: 'Todo list cleared.', input: { todos: [] } }),
    ).toEqual([]);
  });
});

describe('a task call’s child agent', () => {
  const task = (id: string, agent: string, extra: Record<string, unknown> = {}) => ({
    event: 'tool_start',
    data: { name: 'task', input: { agent, prompt: 'go', ...extra }, id },
  });

  it('runs between subagent_start and subagent_end, and says how it ended', async () => {
    const engine = engineOn([
      task('c1', 'researcher'),
      task('c2', 'reviewer'),
      { event: 'subagent_start', data: { agent: 'researcher', background: false } },
      { event: 'subagent_start', data: { agent: 'reviewer', background: false } },
      { event: 'subagent_end', data: { agent: 'reviewer', outcome: 'error' } },
    ]);
    await run(engine);

    const tools = engine.state.turns.at(-1)?.tools ?? [];
    expect(tools.map((t) => t.subagent)).toEqual([
      { agent: 'researcher', state: 'running' },
      { agent: 'reviewer', state: 'failed' },
    ]);
  });

  it('keeps a background child’s task id, from the frame or from the result', async () => {
    const engine = engineOn([
      task('c1', 'researcher', { background: true }),
      {
        event: 'subagent_start',
        data: { agent: 'researcher', background: true, task_id: 'tok1', thread_id: 't1:task:x' },
      },
    ]);
    await run(engine);
    const live = engine.state.turns.at(-1)?.tools?.[0];
    expect(live && subagentOf(live)).toEqual({
      agent: 'researcher',
      state: 'background',
      taskId: 'tok1',
    });

    const logged: ToolCall = {
      name: 'task',
      input: { agent: 'researcher', prompt: 'go', background: true },
      output:
        "[task] agent 'researcher' is working in the background as task tok2. Call task_result with this id to read its answer.",
      done: true,
    };
    expect(subagentOf(logged)).toEqual({
      agent: 'researcher',
      state: 'background',
      taskId: 'tok2',
    });
    expect(
      subagentOf({ ...logged, input: { agent: 'researcher', prompt: 'go' }, output: 'answer' }),
    ).toEqual({ agent: 'researcher', state: 'ok' });
    expect(subagentOf({ ...logged, name: 'read_file' })).toBeNull();
  });
});

describe('the permission mode', () => {
  it('follows an approved plan out of plan mode, and is thread state', async () => {
    const engine = engineOn([{ event: 'permission_mode_changed', data: { mode: 'default' } }]);
    engine.setPermissionMode('plan');
    expect(engine.state.permissionMode).toBe('plan');
    await run(engine);
    // `default` is what null means.
    expect(engine.state.permissionMode).toBeNull();

    engine.setPermissionMode('accept_edits');
    engine.reset();
    expect(engine.state.permissionMode).toBeNull();
  });

  it('is set through POST /chat/mode', async () => {
    stubFetch(() => new Response(JSON.stringify({ ok: true, mode: 'plan' })));
    await createFelixClient({ baseUrl: '/api' }).setPermissionMode({
      threadId: 't1',
      mode: 'plan',
    });
    expect(posted[0]).toEqual({ url: '/api/chat/mode', body: { thread_id: 't1', mode: 'plan' } });

    stubFetch(
      () =>
        new Response(JSON.stringify({ detail: 'missing_scope:approvals:bypass' }), { status: 403 }),
    );
    await expect(
      createFelixClient({ baseUrl: '/api' }).setPermissionMode({ threadId: 't1', mode: 'bypass' }),
    ).rejects.toThrow(/missing_scope:approvals:bypass/);
  });
});
