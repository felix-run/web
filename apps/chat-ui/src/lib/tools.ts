import type { ToolCall } from '@/types';

/**
 * Which card a `tool_end` or `tool_execution_update` belongs to.
 *
 * The id wins whenever the frame carries one, because it is the only thing that
 * tells two concurrent calls to the same tool apart — by name alone the newest
 * open card wins, and the wrong one closes. The `on_tool_start`/`on_tool_end`
 * pair carries no id, so the name scan stays as the fallback rather than
 * leaving those frames unhandled.
 *
 * Returns -1 when nothing matches, which happens for a `tool_end` whose start
 * never arrived.
 */
export function findOpenTool(tools: ToolCall[], name: string, callId?: string): number {
  if (callId) {
    const byId = tools.findIndex((tool) => tool.callId === callId);
    if (byId !== -1) return byId;
  }
  for (let i = tools.length - 1; i >= 0; i--) {
    if (tools[i].name === name && !tools[i].done) return i;
  }
  return -1;
}

export function closeTool(
  tools: ToolCall[] | undefined,
  name: string,
  output: unknown,
  callId?: string,
): ToolCall[] {
  const next = [...(tools ?? [])];
  const i = findOpenTool(next, name, callId);
  if (i === -1) return next;
  next[i] = { ...next[i], output, done: true };
  return next;
}

/** Record a running tool's latest phase. */
export function markToolPhase(
  tools: ToolCall[] | undefined,
  name: string,
  phase: string,
  callId?: string,
): ToolCall[] {
  const next = [...(tools ?? [])];
  const i = findOpenTool(next, name, callId);
  if (i === -1) return next;
  next[i] = { ...next[i], phase };
  return next;
}
