/**
 * Multi-thread transcript persistence in localStorage, plus reconstruction of
 * a transcript from the server-side ConversationDO event log.
 *
 * Storage layout:
 *   felix.threads          → ThreadMeta[] (the index, newest-first)
 *   felix.turns:<threadId> → Turn[]       (one key per thread)
 *
 * The index is the source of truth for the sidebar; per-thread turn blobs keep
 * large transcripts out of the index read on every render. A one-time migration
 * folds the legacy single-thread keys (felix.turns / felix.threadId) into the
 * new layout so existing sessions don't lose their conversation.
 */

import type { SessionEvent, SessionSnapshot, SessionSummary, ToolCall, Turn } from '@/types';

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
 * - **A thread only in localStorage** is kept, not dropped. It may be a
 *   conversation that never reached the harness, or this harness may simply be
 *   a different deployment than the one it was created against. Dropping it
 *   would destroy the only copy of a transcript.
 */
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
      title: named ? (row.name as string) : (existing?.title ?? 'Untitled conversation'),
      manifest: existing?.manifest ?? '',
      updatedAt: row.updatedAt ?? existing?.updatedAt ?? 0,
      onServer: true,
      named,
    });
  }

  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

const INDEX_KEY = 'felix.threads';
const TURNS_PREFIX = 'felix.turns:';
const LEGACY_TURNS = 'felix.turns';
const LEGACY_THREAD = 'felix.threadId';

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function listThreads(): ThreadMeta[] {
  return readJSON<ThreadMeta[]>(INDEX_KEY, []).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadTurns(threadId: string): Turn[] {
  return readJSON<Turn[]>(TURNS_PREFIX + threadId, []);
}

/** A short conversation title from arbitrary text (e.g. the first user turn). */
export function titleFromText(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t ? t.slice(0, 48) : 'New conversation';
}

/** Persist a thread's transcript blob (cheap; called per streamed token). */
export function saveTurns(threadId: string, turns: Turn[]): void {
  if (turns.length === 0) return;
  localStorage.setItem(TURNS_PREFIX + threadId, JSON.stringify(turns));
}

/**
 * Upsert a thread's index entry (title + updatedAt). Separate from `saveTurns`
 * so the sidebar list only churns at conversation boundaries, not per token.
 */
export function indexThread(meta: ThreadMeta): void {
  const index = readJSON<ThreadMeta[]>(INDEX_KEY, []).filter((t) => t.id !== meta.id);
  index.push(meta);
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

export function removeThread(threadId: string): void {
  localStorage.removeItem(TURNS_PREFIX + threadId);
  const index = readJSON<ThreadMeta[]>(INDEX_KEY, []).filter((t) => t.id !== threadId);
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

/**
 * One-time migration of the legacy single-thread keys into the indexed layout.
 * Safe to call on every load — it no-ops once the legacy turns key is gone.
 */
export function migrateLegacy(now: number): void {
  const legacyTurns = readJSON<Turn[]>(LEGACY_TURNS, []);
  if (legacyTurns.length === 0) {
    localStorage.removeItem(LEGACY_TURNS);
    return;
  }
  const id = localStorage.getItem(LEGACY_THREAD) ?? crypto.randomUUID();
  const manifest = localStorage.getItem('felix.manifest')?.trim() || 'quick';
  const firstUser = legacyTurns.find((t) => t.role === 'user');
  saveTurns(id, legacyTurns);
  indexThread({ id, manifest, title: titleFromText(firstUser?.content ?? ''), updatedAt: now });
  localStorage.removeItem(LEGACY_TURNS);
}

/**
 * Rebuild a UI transcript from the ConversationDO event log. Assistant messages
 * that carry only `tool_calls` (no text) are merged into the next assistant
 * message with content, so the result mirrors the live streaming UI (tool cards
 * above the answer) rather than splitting into two bubbles. Tool outputs are
 * matched back to their calls by `tool_call_id`.
 */
export function eventsToTurns(events: SessionEvent[]): Turn[] {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const turns: Turn[] = [];
  const toolById = new Map<string, ToolCall>();
  let pendingTools: ToolCall[] = [];

  for (const ev of ordered) {
    if (ev.kind === 'tool_result' || ev.role === 'tool') {
      const t = ev.tool_call_id ? toolById.get(ev.tool_call_id) : undefined;
      if (t) {
        t.output = ev.content;
        t.done = true;
      }
      continue;
    }
    if (ev.kind !== 'message' && ev.kind !== 'custom') continue;

    if (ev.role === 'user') {
      // Flush any dangling tool-only assistant turn before the next user turn.
      if (pendingTools.length) {
        turns.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: '',
          tools: pendingTools,
        });
        pendingTools = [];
      }
      turns.push({
        id: ev.id ?? crypto.randomUUID(),
        role: 'user',
        content: ev.content ?? '',
        eventId: ev.id,
      });
      continue;
    }
    if (ev.role === 'assistant') {
      const newTools: ToolCall[] = (ev.tool_calls ?? []).map((tc) => {
        const t: ToolCall = { name: tc.name, input: tc.args, done: false };
        toolById.set(tc.id, t);
        return t;
      });
      const tools = [...pendingTools, ...newTools];
      pendingTools = [];
      const content = ev.content ?? '';
      if (!content && tools.length) {
        // Tool-only step — hold the tools and attach to the next answer.
        pendingTools = tools;
        continue;
      }
      turns.push({
        id: ev.id ?? crypto.randomUUID(),
        role: 'assistant',
        content,
        tools,
        eventId: ev.id,
      });
    }
  }
  if (pendingTools.length) {
    turns.push({ id: crypto.randomUUID(), role: 'assistant', content: '', tools: pendingTools });
  }
  return turns;
}
