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

/** One piece of an assistant turn, in the order it happened. */
export type TurnSegment =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; tool: ToolCall; index: number };

/**
 * Split a turn's prose at the points its tools fired.
 *
 * `ToolCall.at` is the length `content` had when the card opened, so every
 * offset is a real index into this same string and the walk is a plain cursor.
 * Offsets are clamped and sorted rather than trusted: a snapshot-hydrated turn
 * carries none at all (they sort to 0, reproducing the old all-cards-first
 * layout), and the `done` handler can replace `content` wholesale with the
 * final answer when a run produced no deltas, which strands any offset past the
 * new end.
 *
 * The split is by character, so a tool that fires in the middle of a markdown
 * construct — mid-list, mid-fence — leaves each side to be parsed on its own
 * and the construct does not survive the cut. That is the honest rendering:
 * the model genuinely stopped there. It is also rare, because a call ends the
 * assistant's text block.
 */
export function interleaveTurn(content: string, tools: ToolCall[] | undefined): TurnSegment[] {
  const cards = tools ?? [];
  if (cards.length === 0) return content ? [{ kind: 'text', text: content }] : [];

  // Stable by construction: equal offsets keep arrival order, which is the order
  // concurrent calls were announced in.
  const ordered = cards
    .map((tool, index) => ({
      tool,
      index,
      at: Math.min(Math.max(tool.at ?? 0, 0), content.length),
    }))
    .sort((a, b) => a.at - b.at);

  const segments: TurnSegment[] = [];
  let cursor = 0;
  for (const { tool, index, at } of ordered) {
    if (at > cursor) {
      segments.push({ kind: 'text', text: content.slice(cursor, at) });
      cursor = at;
    }
    segments.push({ kind: 'tool', tool, index });
  }
  if (cursor < content.length) segments.push({ kind: 'text', text: content.slice(cursor) });
  return segments;
}
