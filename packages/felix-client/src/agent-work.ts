import { classifyToolResult } from './tool-results';
import type { SubagentCall, SubagentRun, TodoItem, ToolCall } from './turns';

/**
 * Two things an agent does that the stream announces beside its tool calls: the
 * checklist it keeps (`todo_write` → `todo_updated`) and the child agents it hands
 * jobs to (`task` → `subagent_start` / `subagent_end`). Both are also readable off
 * the calls themselves, which is all a transcript rebuilt from the log has — so the
 * frames refine a call already on screen rather than introducing state of their own.
 */

export const TODO_TOOL = 'todo_write';
export const TASK_TOOL = 'task';

// Every accepted write answers with one of these (`felix/tools/todos.py`); a refusal
// starts with `[`. The harness tells the two apart the same way.
const TODO_ACCEPTED = /^Todo list (updated:|cleared\.)/;

const TODO_STATUSES = new Set<TodoItem['status']>(['pending', 'in_progress', 'completed']);

/** A checklist as sent — the frame's `todos` or the call's `args.todos` — or null when unreadable. */
export function readTodos(raw: unknown): TodoItem[] | null {
  if (!Array.isArray(raw)) return null;
  const items: TodoItem[] = [];
  raw.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object') return;
    const t = entry as Record<string, unknown>;
    if (typeof t.content !== 'string' || !t.content) return;
    const status = TODO_STATUSES.has(t.status as TodoItem['status'])
      ? (t.status as TodoItem['status'])
      : 'pending';
    const activeForm = t.active_form ?? t.activeForm;
    items.push({
      // The harness numbers items from 1 in order; the arguments carry no id.
      id: typeof t.id === 'string' ? t.id : String(i + 1),
      content: t.content,
      status,
      activeForm: typeof activeForm === 'string' ? activeForm : '',
    });
  });
  return items;
}

/**
 * The list a `todo_write` call left, or null for any other call, one the harness
 * refused, or one still running that it has not confirmed.
 */
export function todosFromCall(tool: ToolCall): TodoItem[] | null {
  if (tool.name !== TODO_TOOL) return null;
  if (tool.todos) return tool.todos;
  if (!tool.done || typeof tool.output !== 'string' || !TODO_ACCEPTED.test(tool.output)) {
    return null;
  }
  return readTodos((tool.input as { todos?: unknown } | undefined)?.todos);
}

/**
 * Put a `todo_updated` list on the call it confirms: the newest `todo_write` still
 * open. The frame carries no call id, but the harness sends it from inside the
 * call, so the open one is the one that sent it.
 */
export function confirmTodos(tools: ToolCall[] | undefined, todos: TodoItem[]): ToolCall[] {
  const next = [...(tools ?? [])];
  for (let i = next.length - 1; i >= 0; i--) {
    const tool = next[i];
    if (tool && tool.name === TODO_TOOL && !tool.done) {
      next[i] = { ...tool, todos };
      break;
    }
  }
  return next;
}

/**
 * Mark the `task` call a `subagent_start` belongs to. Matched by the agent's name
 * among open calls not yet marked, oldest first — the order the harness starts
 * them in when a turn hands out several jobs at once.
 */
export function startSubagent(
  tools: ToolCall[] | undefined,
  data: { agent: string; background?: boolean; task_id?: string },
): ToolCall[] {
  const next = [...(tools ?? [])];
  const i = next.findIndex(
    (t) => t.name === TASK_TOOL && !t.done && !t.subagent && agentOf(t) === data.agent,
  );
  const tool = i === -1 ? undefined : next[i];
  if (!tool) return next;
  next[i] = {
    ...tool,
    subagent: {
      agent: data.agent,
      state: data.background ? 'background' : 'running',
      ...(data.task_id ? { taskId: data.task_id } : {}),
    },
  };
  return next;
}

/** Settle the running child a `subagent_end` names. */
export function endSubagent(
  tools: ToolCall[] | undefined,
  data: { agent: string; outcome?: string },
): ToolCall[] {
  const next = [...(tools ?? [])];
  const i = next.findIndex(
    (t) => t.subagent?.state === 'running' && t.subagent.agent === data.agent,
  );
  const tool = i === -1 ? undefined : next[i];
  if (!tool?.subagent) return next;
  next[i] = {
    ...tool,
    subagent: { ...tool.subagent, state: data.outcome === 'ok' ? 'ok' : 'failed' },
  };
  return next;
}

/**
 * Put a call a child made on the `task` call running that child. A `start` opens it on
 * the oldest running child of that name — the frame names the agent, not the `task`
 * call, so two children of one agent at once are told apart only by start order — and
 * an `end` settles whichever child holds its id. A frame for no running child (one
 * started before this stream was attached) is dropped.
 */
export function recordSubagentCall(
  tools: ToolCall[] | undefined,
  data: { agent: string; callId: string; name: string } & (
    | { phase: 'start'; input: unknown }
    | { phase: 'end'; result: string }
  ),
): ToolCall[] {
  const next = [...(tools ?? [])];
  const i =
    data.phase === 'start'
      ? next.findIndex((t) => t.subagent?.state === 'running' && t.subagent.agent === data.agent)
      : next.findIndex((t) => t.subagent?.calls?.some((c) => c.callId === data.callId));
  const tool = i === -1 ? undefined : next[i];
  if (!tool?.subagent) return next;
  const calls = tool.subagent.calls ?? [];
  const updated: SubagentCall[] =
    data.phase === 'start'
      ? [...calls, { callId: data.callId, name: data.name, input: data.input, done: false }]
      : calls.map((c) =>
          c.callId === data.callId ? { ...c, done: true, result: data.result } : c,
        );
  next[i] = { ...tool, subagent: { ...tool.subagent, calls: updated } };
  return next;
}

function agentOf(tool: ToolCall): string | null {
  const agent = (tool.input as { agent?: unknown } | undefined)?.agent;
  return typeof agent === 'string' && agent ? agent : null;
}

// `[task] agent 'x' is working in the background as task <id>.` (`_start_in_background`).
const BACKGROUND_STARTED = /working in the background as task (\S+?)\.(?:\s|$)/;

/**
 * The child agent a `task` call ran, or null for any other call. From the stream
 * when it reported one; otherwise from the call — its `agent` and `background`
 * arguments, and its result, which names a background child's task id.
 */
export function subagentOf(tool: ToolCall): SubagentRun | null {
  if (tool.name !== TASK_TOOL) return null;
  const agent = agentOf(tool);
  if (!agent) return tool.subagent ?? null;
  const background = (tool.input as { background?: unknown } | undefined)?.background === true;
  if (tool.done) {
    const failed = classifyToolResult(tool.name, tool.output) !== null;
    if (background && !failed) {
      const taskId =
        tool.subagent?.taskId ??
        (typeof tool.output === 'string' ? BACKGROUND_STARTED.exec(tool.output)?.[1] : undefined);
      return { agent, state: 'background', ...(taskId ? { taskId } : {}) };
    }
    const calls = tool.subagent?.calls;
    return { agent, state: failed ? 'failed' : 'ok', ...(calls ? { calls } : {}) };
  }
  return tool.subagent ?? { agent, state: background ? 'background' : 'running' };
}
