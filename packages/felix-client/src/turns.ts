/**
 * The transcript model, and the frame-to-card matching that maintains it.
 *
 * A `Turn` is what a client renders: prose, the tool calls that interrupted it,
 * and the reasoning that ran between them, all positioned against one string.
 * It is deliberately view-agnostic — the same shape backs a React transcript and
 * a terminal one — so nothing here knows about the DOM.
 */
import type { ImageAttachment, Role, TokenUsage } from '@felix/protocol';

/** A finished or in-flight tool call, rendered inline in the transcript. */
export interface ToolCall {
  name: string;
  /** Harness tool-call id, when the frame carried one. */
  callId?: string;
  input?: unknown;
  output?: unknown;
  done: boolean;
  /** Latest `tool_execution_update` phase while the call is still running. */
  phase?: string;
  /**
   * Where this call happened in the turn's prose: the length of `Turn.content`
   * at the moment the card was opened.
   *
   * A turn is not text-then-tools, it is text and tools alternating — "let me
   * check" / tool / "found it" / tool / the answer. Holding the two in separate
   * fields loses that order, and the transcript rendered every card above one
   * merged paragraph, which reads as though the agent decided everything before
   * saying anything.
   *
   * An offset rather than a single ordered `parts` array because `content`
   * stays whole: copy, rewind, the `done` handler's final-answer fallback and
   * every hydration path keep working on the string they already had. Absent
   * (a turn hydrated from a snapshot, which carries no such marker) sorts to 0,
   * which is exactly the old behaviour.
   */
  at?: number;
  /**
   * Images the tool returned beside its text — a browser screenshot, an MCP
   * server's image block, a generated picture. The harness stores each one and
   * hands back a `felix-file://` reference, so a renderer fetches it the way it
   * fetches an uploaded image. Only `toolImages` fills this, and it keeps only
   * what a client may draw without asking anyone else for it.
   */
  images?: ImageAttachment[];
}

/**
 * The images a tool result carried, as the harness sends them — the session log's
 * `metadata.attachments`, or the `attachments` on a `tool_end` frame — keeping
 * only what can be drawn without a request leaving for somewhere else: a stored
 * reference, or an inline raster `data:` URL. A remote URL is dropped rather
 * than drawn, because an `<img>` pointed at it is a request the tool's author
 * chose, made from the operator's browser the moment the card renders.
 */
export function toolImages(raw: unknown): ImageAttachment[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((a) => {
    if (!a || typeof a !== 'object') return [];
    const { url, media_type } = a as Record<string, unknown>;
    if (typeof url !== 'string' || !DRAWABLE.test(url)) return [];
    return [{ url, media_type: typeof media_type === 'string' ? media_type : 'image/png' }];
  });
}

const DRAWABLE = /^(felix-file:\/\/[^/\s]+$|data:image\/(png|jpeg|gif|webp)[;,])/i;

/**
 * A stretch of model reasoning, and where in the prose it happened.
 *
 * Blocks rather than one string because a turn can think more than once — before
 * an answer, and again between tool calls — and merging those into a single
 * block would claim the model reconsidered in one sitting. `at` is the offset
 * `ToolCall.at` uses, so the two interleave against the same string.
 */
export interface ReasoningBlock {
  text: string;
  at: number;
}

/** A turn in the UI transcript. Assistant turns may carry inline tool calls. */
export interface Turn {
  id: string;
  role: Exclude<Role, 'tool' | 'system'> | 'note';
  /**
   * Set on every `note` turn and nowhere else: an entry appended to the thread
   * through `POST /chat/sessions/custom` rather than said in the conversation.
   *
   * The harness stores these with a role of the caller's choosing and a flag
   * that decides whether the model ever sees them. Rendering one as an ordinary
   * turn claims both things wrongly — a `user` note looked like a message the
   * person sent and a `system` one vanished, whether or not it was steering the
   * model — so a note keeps its role here for the renderer to say, and
   * `inContext` for the renderer to say whether the model read it.
   */
  note?: { role: Role; inContext: boolean };
  content: string;
  tools?: ToolCall[];
  /** Reasoning the model streamed, if the harness is new enough to name it. */
  reasoning?: ReasoningBlock[];
  /**
   * Set while `content` is the engine's status line for a durable run in flight —
   * `Durable run accepted…`, `Background · running…`, `Waiting on your approval · …` —
   * rather than anything the model said, and which state of the ramp that line reports.
   *
   * A durable stream carries no deltas, so until `final` the status line is the only
   * thing in the turn, and without this a renderer cannot tell it from an answer: it
   * was drawn as the reply, at reading size, under the agent's name. Cleared when the
   * answer replaces it.
   */
  runStatus?: 'running' | 'blocked';
  /** Image attachments on a user turn (rendered as thumbnails). */
  attachments?: ImageAttachment[];
  /**
   * What this turn spent, when one model call is the whole of it: from the live
   * `done` frame, or from the snapshot's stored block. Left unset on a turn that
   * ran tools, where the final call's block covers only the last step — a sum
   * over the thread says `floor` for it instead.
   */
  usage?: TokenUsage;
  /**
   * How full the context window was once this turn ended: the final model call's
   * prompt, cached or not, plus its reply. Set whenever that call reported usage,
   * tools or no tools, because the final call's prompt already held the whole
   * active branch. What a context meter reads.
   */
  contextTokens?: number;
  /** Server event id when hydrated from a session snapshot (enables rewind). */
  eventId?: string;
  /**
   * The event this one continues from, on a hydrated user turn. Editing a message
   * rewinds the leaf here and sends the new text, so the edit becomes a sibling
   * branch of the original rather than a reply to it. Absent on the first message
   * of a thread, which has nothing before it to rewind to.
   */
  parentEventId?: string;
  /**
   * Why the run stopped short, when it did. Set from the `max_turns` frame: the
   * react loop ran out of `recursion_limit` steps with tool calls still pending,
   * so the content above is an answer cut off mid-thought, not a finished one.
   * Live only — the session log carries no such event, so a hydrated turn has
   * none.
   */
  stop?: { reason: 'max_turns'; limit?: number };
}

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
    const tool = tools[i];
    if (tool && tool.name === name && !tool.done) return i;
  }
  return -1;
}

export function closeTool(
  tools: ToolCall[] | undefined,
  name: string,
  output: unknown,
  callId?: string,
  images: ImageAttachment[] = [],
): ToolCall[] {
  const next = [...(tools ?? [])];
  const i = findOpenTool(next, name, callId);
  const open = i === -1 ? undefined : next[i];
  if (!open) return next;
  next[i] = { ...open, output, done: true, ...(images.length ? { images } : {}) };
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
  const open = i === -1 ? undefined : next[i];
  if (!open) return next;
  next[i] = { ...open, phase };
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

/**
 * How much reasoning a block holds, in words — the one measure a block rebuilt
 * from history still has, since the snapshot records no duration for it.
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}
