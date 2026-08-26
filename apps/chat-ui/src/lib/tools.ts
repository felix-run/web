import type { ReasoningBlock, ToolCall } from '@/types';

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
  | { kind: 'reasoning'; text: string }
  | { kind: 'tool'; tool: ToolCall; index: number };

/**
 * Split a turn's prose at the points its tools fired and it stopped to think.
 *
 * `ToolCall.at` and `ReasoningBlock.at` are the length `content` had when each
 * was opened, so every offset is a real index into this same string and the walk
 * is a plain cursor.
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
export function interleaveTurn(
  content: string,
  tools: ToolCall[] | undefined,
  reasoning?: ReasoningBlock[],
): TurnSegment[] {
  const cards = tools ?? [];
  const thoughts = reasoning ?? [];
  if (cards.length === 0 && thoughts.length === 0) {
    return content ? [{ kind: 'text', text: content }] : [];
  }

  const clamp = (at: number) => Math.min(Math.max(at, 0), content.length);
  // `rank` breaks a tie at the same offset, and the order is not arbitrary: the
  // model reasons and *then* acts, so a thought recorded where a call was
  // announced came first. The sort is stable, so equal offset and equal rank keep
  // arrival order — for concurrent calls, the order they were announced in.
  const ordered = [
    ...thoughts.map((block) => ({ at: clamp(block.at), rank: 0, block, tool: null, index: -1 })),
    ...cards.map((tool, index) => ({ at: clamp(tool.at ?? 0), rank: 1, block: null, tool, index })),
  ].sort((a, b) => a.at - b.at || a.rank - b.rank);

  const segments: TurnSegment[] = [];
  let cursor = 0;
  for (const entry of ordered) {
    if (entry.at > cursor) {
      segments.push({ kind: 'text', text: content.slice(cursor, entry.at) });
      cursor = entry.at;
    }
    if (entry.tool) segments.push({ kind: 'tool', tool: entry.tool, index: entry.index });
    else if (entry.block) segments.push({ kind: 'reasoning', text: entry.block.text });
  }
  if (cursor < content.length) segments.push({ kind: 'text', text: content.slice(cursor) });
  return segments;
}
