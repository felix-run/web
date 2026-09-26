/**
 * Reconstruction of a transcript from the harness's session event log, and the
 * merge of its thread index with a client's own.
 *
 * Everything here is pure: it takes what `GET /chat/sessions{,/{id}}` returned
 * and produces what a client renders. Where a client *keeps* its copy — a
 * browser's localStorage, a CLI's state directory — is the client's business.
 */
import type { SessionEvent, SessionSnapshot, TokenUsage } from '@felix/protocol';
import type { ReasoningBlock, ToolCall, Turn } from './turns';

/**
 * One row from GET /chat/sessions — the tenant's threads, as the harness knows
 * them.
 *
 * `id` here is the *client* thread id: the wire spells it `{tenant}:{id}` and
 * `threadSuffix` strips the prefix, because a client only ever sends the suffix
 * back (the harness rejects one containing `:` outright, so a thread can never
 * be addressed across tenants).
 *
 * There is no manifest on this row. Which agent a thread was talked to is
 * client-side state, so the local index remains its only record.
 */
export interface SessionSummary {
  id: string;
  /** Server-set name from POST /chat/sessions/name; null until someone sets one. */
  name: string | null;
  /** Epoch ms. */
  createdAt?: number;
  updatedAt?: number;
  /** Set on a thread created by POST /chat/fork. */
  parentSessionId?: string | null;
}

/** A client's index entry for one thread. */
export interface ThreadMeta {
  id: string;
  title: string;
  manifest: string;
  updatedAt: number;
  /** True when the harness knows this thread. False means local-only — see `mergeSessions`. */
  onServer?: boolean;
  /** Set by the harness when the name came from POST /chat/sessions/name. */
  named?: boolean;
}

/** Map a session snapshot transcript onto SessionEvent rows for eventsToTurns. */
export function snapshotToEvents(snapshot: SessionSnapshot): SessionEvent[] {
  const events = (snapshot.transcript ?? []).map((item) => ({
    id: item.id,
    seq: item.seq,
    kind: item.kind,
    role: item.role ?? undefined,
    content: item.content,
    tool_call_id: item.toolCallId,
    name: item.toolName,
    tool_calls: item.toolCalls,
    ...(item.metadata ? { metadata: item.metadata } : {}),
  }));

  // `GET /chat/sessions/{id}` returns every event on the session, not the active
  // branch, and reports the branch separately as `leafId`. Rendering the raw list
  // makes a rewind invisible: verified against a live harness, moving the leaf to
  // the first of four events left all four on screen, so the action appeared to do
  // nothing while still changing where the next turn continues from.
  //
  // The client models a thread as linear, so the active branch is everything up to
  // and including the leaf. A leaf that is missing or already last leaves this a
  // no-op.
  const leaf = snapshot.leafId;
  if (!leaf) return events;
  const cut = events.findIndex((e) => e.id === leaf);
  return cut === -1 ? events : events.slice(0, cut + 1);
}

/**
 * `default:uuid` → `uuid`.
 *
 * The harness scopes every thread id as `{tenant}:{suffix}` and rejects a
 * suffix containing `:` or `#` outright, so a thread can never be addressed
 * across tenants. Clients send and store the suffix only. Split on the *last*
 * colon: the suffix is guaranteed not to contain one, a tenant id is not.
 */
export function threadSuffix(full: string): string {
  const i = full.lastIndexOf(':');
  return i >= 0 ? full.slice(i + 1) : full;
}

/** A short conversation title from arbitrary text (e.g. the first user turn). */
export function titleFromText(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t ? t.slice(0, 48) : 'New conversation';
}

/**
 * Fold the harness's thread list into the local index.
 *
 * The harness is authoritative for which threads exist and what they are
 * *named*; the local index is the only record of which manifest a thread used,
 * and holds a title derived from the first user turn for threads nobody has
 * named. Neither side is a superset, so this is a merge rather than a swap:
 *
 * - **Named on the server** wins over any local title, always. Someone typed it.
 * - **A thread only on the server** (another browser, another device) appears
 *   with no manifest — it is unknown until the thread is opened and hydrated.
 * - **A thread only in local storage** is kept, not dropped. It may be a
 *   conversation that never reached the harness, or this harness may simply be
 *   a different deployment than the one it was created against. Dropping it
 *   would destroy the only copy of a transcript.
 */
/**
 * The title `mergeSessions` gives a server thread nobody named and this client
 * has no local guess for. Exported so a renderer can recognise it as a
 * placeholder and say something more useful — a list where every row reads the
 * same words tells the operator nothing about which row is which.
 */
export const UNTITLED_THREAD_TITLE = 'Untitled conversation';

export function mergeSessions(local: ThreadMeta[], server: SessionSummary[]): ThreadMeta[] {
  const byId = new Map<string, ThreadMeta>();
  for (const t of local) byId.set(t.id, { ...t, onServer: false });

  for (const row of server) {
    if (!row.id) continue;
    const existing = byId.get(row.id);
    const named = Boolean(row.name?.trim());
    byId.set(row.id, {
      id: row.id,
      // A server name is a deliberate act; a local title is a guess from the
      // first message. The guess never overrides the act.
      title: named ? (row.name as string) : (existing?.title ?? UNTITLED_THREAD_TITLE),
      manifest: existing?.manifest ?? '',
      updatedAt: row.updatedAt ?? existing?.updatedAt ?? 0,
      onServer: true,
      named,
    });
  }

  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * The readable reasoning stored on an assistant message, one string per block.
 *
 * The harness keeps the provider's blocks verbatim in `metadata.thinking` so a
 * later turn can replay them (`felix_ai/wire/anthropic_messages.py`):
 * `{type: "thinking", thinking, signature}` for readable reasoning, and
 * `{type: "redacted_thinking", data}` for reasoning the provider encrypted. Only
 * the first has anything a person can read; the second, and the signature, are
 * opaque by design and are never rendered.
 */
export function readableThinking(metadata: Record<string, unknown> | undefined): string[] {
  const raw = metadata?.thinking;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const block of raw) {
    if (!block || typeof block !== 'object') continue;
    const b = block as { type?: unknown; thinking?: unknown };
    if (b.type === 'thinking' && typeof b.thinking === 'string' && b.thinking.trim()) {
      out.push(b.thinking);
    }
  }
  return out;
}

/**
 * The token usage the harness stored on an assistant message, when it did.
 *
 * The harness writes the model call's usage block into the message's metadata
 * (`patterns/react.py:_append_produced`), but only when the assistant message is
 * the *last* of what that step produced — so a step that called tools, whose
 * batch ends in tool results, stores none. That is why a turn rebuilt from the
 * log gets a figure only when it is exactly one step: merged with an earlier
 * tool-only step, the stored number would cover the final call alone while
 * reading as the turn's total. Such a turn carries no usage, and a sum over the
 * thread says `floor` for it rather than presenting a partial figure as whole.
 */
function storedUsage(metadata: Record<string, unknown> | undefined): TokenUsage | undefined {
  const raw = metadata?.usage;
  if (!raw || typeof raw !== 'object') return undefined;
  const { input, output } = raw as { input?: unknown; output?: unknown };
  if (typeof input !== 'number' || typeof output !== 'number') return undefined;
  if (!Number.isFinite(input) || !Number.isFinite(output)) return undefined;
  return { input, output };
}

/**
 * Rebuild a UI transcript from the session event log. Assistant messages
 * that carry only `tool_calls` (no text) are merged into the next assistant
 * message with content, so the result mirrors the live streaming UI (tool cards
 * above the answer) rather than splitting into two bubbles. Tool outputs are
 * matched back to their calls by `tool_call_id`.
 *
 * `newId` is injected because the ids it mints are for rows the log does not
 * identify; a caller under test can make them deterministic.
 */
export function eventsToTurns(
  events: SessionEvent[],
  newId: () => string = () => crypto.randomUUID(),
): Turn[] {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const turns: Turn[] = [];
  const toolById = new Map<string, ToolCall>();
  let pendingTools: ToolCall[] = [];
  // Reasoning from a tool-only step rides forward with its cards, for the same
  // reason they do: the step has no prose of its own to hang it on.
  let pendingReasoning: ReasoningBlock[] = [];

  for (const ev of ordered) {
    if (ev.kind === 'tool_result' || ev.role === 'tool') {
      const t = ev.tool_call_id ? toolById.get(ev.tool_call_id) : undefined;
      if (t) {
        t.output = ev.content;
        t.done = true;
      }
      continue;
    }
    // Appended from outside the conversation (`POST /chat/sessions/custom`), so
    // it is neither side of it. `metadata.in_context` is the flag the harness's
    // own `include_in_llm_context` reads; anything but `true` means the model
    // never saw it, which is the harness's default too.
    if (ev.kind === 'custom') {
      turns.push({
        id: ev.id ?? newId(),
        role: 'note',
        content: ev.content ?? '',
        note: { role: ev.role ?? 'system', inContext: ev.metadata?.in_context === true },
        eventId: ev.id,
      });
      continue;
    }
    if (ev.kind !== 'message') continue;

    if (ev.role === 'user') {
      // Flush any dangling tool-only assistant turn before the next user turn.
      if (pendingTools.length || pendingReasoning.length) {
        turns.push({
          id: newId(),
          role: 'assistant',
          content: '',
          tools: pendingTools,
          ...(pendingReasoning.length ? { reasoning: pendingReasoning } : {}),
        });
        pendingTools = [];
        pendingReasoning = [];
      }
      turns.push({
        id: ev.id ?? newId(),
        role: 'user',
        content: ev.content ?? '',
        eventId: ev.id,
      });
      continue;
    }
    if (ev.role === 'assistant') {
      const content = ev.content ?? '';
      const newTools: ToolCall[] = (ev.tool_calls ?? []).map((tc) => {
        // A message carries the calls it *decided on*, so they run after its prose
        // — "let me check" and then the call, never the other way round. Without
        // the offset a hydrated turn rendered every card above the text that
        // preceded it, which is not merely unordered but backwards.
        //
        // This also dates the tools carried over from a tool-only step correctly
        // and for free: that step's content is empty, so its cards are stamped 0
        // and stay ahead of the prose they were carried into.
        const t: ToolCall = { name: tc.name, input: tc.args, done: false, at: content.length };
        toolById.set(tc.id, t);
        return t;
      });
      // Whether this turn absorbed an earlier tool-only step. That step's usage is
      // not stored — see `storedUsage` — so this turn's own figure would describe
      // part of it while reading as the whole.
      const carried = pendingTools.length > 0 || pendingReasoning.length > 0;
      const tools = [...pendingTools, ...newTools];
      // A message's reasoning ran before anything it said or called, so it sits at
      // offset 0 and `interleaveTurn` puts it ahead of the prose and the cards.
      // One limit: every block in a merged turn lands at 0, so a turn that thought,
      // called a tool, then thought again shows both thoughts above both calls.
      // The offset model has nothing below 0 to tell them apart with.
      const reasoning = [
        ...pendingReasoning,
        ...readableThinking(ev.metadata).map((text) => ({ text, at: 0 })),
      ];
      pendingTools = [];
      pendingReasoning = [];
      if (!content && tools.length) {
        // Tool-only step — hold the tools and attach to the next answer.
        pendingTools = tools;
        pendingReasoning = reasoning;
        continue;
      }
      const usage = carried ? undefined : storedUsage(ev.metadata);
      turns.push({
        id: ev.id ?? newId(),
        role: 'assistant',
        content,
        tools,
        ...(reasoning.length ? { reasoning } : {}),
        ...(usage ? { usage } : {}),
        eventId: ev.id,
      });
    }
  }
  if (pendingTools.length || pendingReasoning.length) {
    turns.push({
      id: newId(),
      role: 'assistant',
      content: '',
      tools: pendingTools,
      ...(pendingReasoning.length ? { reasoning: pendingReasoning } : {}),
    });
  }
  return turns;
}
