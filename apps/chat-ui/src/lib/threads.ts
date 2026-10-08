/**
 * Multi-thread transcript persistence in localStorage.
 *
 * Storage layout:
 *   felix.threads          → ThreadMeta[] (the index, newest-first)
 *   felix.turns:<threadId> → Turn[]       (one key per thread)
 *
 * The index is the source of truth for the sidebar; per-thread turn blobs keep
 * large transcripts out of the index read on every render. A one-time migration
 * folds the legacy single-thread keys (felix.turns / felix.threadId) into the
 * new layout so existing sessions don't lose their conversation.
 *
 * Only the *storage* is here. Reconstructing a transcript from the harness's
 * event log, merging its thread list with this index, and the id and title
 * helpers are all in `@felix/client` — nothing about them is browser-specific,
 * and a second client needs them too.
 */

import { type ThreadMeta, titleFromText, UNTITLED_THREAD_TITLE } from '@felix/client';
import type { Turn } from '@/types';

const INDEX_KEY = 'felix.threads';
const TURNS_PREFIX = 'felix.turns:';
const LEGACY_TURNS = 'felix.turns';
const LEGACY_THREAD = 'felix.threadId';
const PINS_KEY = 'felix.pinnedThreads';

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

/** Titles that say nothing about which thread a row is. */
const PLACEHOLDER_TITLES = new Set([UNTITLED_THREAD_TITLE, titleFromText(''), '']);

/**
 * What to call a thread in a list, best evidence first.
 *
 * A name someone typed, then the title this client guessed from the first user
 * message, then that first message read out of the cached transcript, and last
 * the harness's own thread id. The id is not friendly, but it is *distinct* and
 * it is the harness's word for the thread — a list of fifteen rows all reading
 * "Untitled conversation" gave the operator no way to tell one from another, and
 * a returning operator's first question is which one they were in.
 *
 * `isId` is how the caller knows to set it in mono: it is a harness-emitted
 * value, not a sentence of ours. The cached-transcript read is a parse of one
 * localStorage blob, so it only happens for a row that has no better title, and
 * callers memoise on the thread list.
 */
export function threadLabel(meta: Pick<ThreadMeta, 'id' | 'title' | 'named'>): {
  text: string;
  isId: boolean;
} {
  const title = meta.title.trim();
  if (meta.named || !PLACEHOLDER_TITLES.has(title)) return { text: title, isId: false };
  const firstUser = loadTurns(meta.id).find((t) => t.role === 'user' && t.content.trim());
  if (firstUser) return { text: titleFromText(firstUser.content), isId: false };
  return { text: meta.id, isId: true };
}

export function removeThread(threadId: string): void {
  localStorage.removeItem(TURNS_PREFIX + threadId);
  // A pin outliving its thread would be a row nobody can see holding a slot
  // in a list someone can — and a thread minted later under the same id would
  // arrive pinned.
  writePins([...readPins()].filter((id) => id !== threadId));
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
 * Threads pinned to the top of the sidebar, by suffix.
 *
 * Local to this browser and said so where they are set: the harness records
 * which threads exist and what they are named, not which ones an operator keeps
 * near. Read defensively, because storage can be blocked or hold anything.
 */
export function readPins(): Set<string> {
  const raw = readJSON<unknown>(PINS_KEY, []);
  return new Set(Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []);
}

export function writePins(ids: Iterable<string>): void {
  try {
    localStorage.setItem(PINS_KEY, JSON.stringify([...ids]));
  } catch {
    // Storage full or blocked: the pin lasts for this page and no longer.
  }
}

export type ThreadGroupKey =
  | 'waiting'
  | 'running'
  | 'pinned'
  | 'today'
  | 'yesterday'
  | 'week'
  | 'older';

export interface ThreadGroup {
  key: ThreadGroupKey;
  label: string;
  threads: ThreadMeta[];
  /**
   * Older only: its threads again, by calendar month, newest first. On a harness
   * driven mostly by automation nearly every thread is older than a week, and one
   * undivided Older was a 2,700px list with nothing to land on.
   */
  months?: Array<{ key: string; label: string; threads: ThreadMeta[] }>;
}

const DAY_MS = 86_400_000;

/**
 * The sidebar's sections: what is waiting on a person, what is running, then
 * pinned, then by last activity.
 *
 * State comes before recency because an instrument ranks by state: sorted by
 * date alone, a thread blocked on an approval — or a run kept going after the
 * operator switched away — could sit under a folded Older and say nothing.
 * Waiting first, because it is the one state that asks something of the reader.
 * `waiting` is the shell's tenant-wide `/approvals` poll plus questions this
 * tab's runs are asking, and `running` the runs this tab carries, all by suffix
 * and positive evidence only.
 *
 * The rest is bucketed on `updatedAt` — the last time this client or the harness
 * saw the thread move — against local midnight, so "Today" means the operator's
 * day rather than the last twenty-four hours, and Older is cut again by calendar
 * month. A thread appears in one group only, the first that claims it. Empty
 * groups are left out rather than drawn with no rows under them.
 */
export function groupThreads(
  threads: readonly ThreadMeta[],
  pinned: ReadonlySet<string>,
  now: number = Date.now(),
  waiting: ReadonlySet<string> = new Set(),
  running: ReadonlySet<string> = new Set(),
): ThreadGroup[] {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const today = midnight.getTime();
  const yesterday = today - DAY_MS;
  const week = today - 7 * DAY_MS;

  const groups: ThreadGroup[] = [
    { key: 'waiting', label: 'Waiting on you', threads: [] },
    { key: 'running', label: 'Running', threads: [] },
    { key: 'pinned', label: 'Pinned', threads: [] },
    { key: 'today', label: 'Today', threads: [] },
    { key: 'yesterday', label: 'Yesterday', threads: [] },
    { key: 'week', label: 'Previous 7 days', threads: [] },
    { key: 'older', label: 'Older', threads: [] },
  ];
  const at = (key: ThreadGroupKey) => groups.find((g) => g.key === key)!.threads;

  for (const t of [...threads].sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (waiting.has(t.id)) at('waiting').push(t);
    else if (running.has(t.id)) at('running').push(t);
    else if (pinned.has(t.id)) at('pinned').push(t);
    else if (t.updatedAt >= today) at('today').push(t);
    else if (t.updatedAt >= yesterday) at('yesterday').push(t);
    else if (t.updatedAt >= week) at('week').push(t);
    else at('older').push(t);
  }

  const older = groups.find((g) => g.key === 'older')!;
  const thisYear = new Date(now).getFullYear();
  const months = new Map<string, { key: string; label: string; threads: ThreadMeta[] }>();
  for (const t of older.threads) {
    const d = new Date(t.updatedAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    let month = months.get(key);
    if (!month) {
      month = {
        key,
        // The year only when it is not this one: "September" is unambiguous
        // in October, "September 2025" is what a year-old thread needs.
        label: d.toLocaleString(undefined, {
          month: 'long',
          ...(d.getFullYear() === thisYear ? {} : { year: 'numeric' }),
        }),
        threads: [],
      };
      months.set(key, month);
    }
    month.threads.push(t);
  }
  older.months = [...months.values()];

  return groups.filter((g) => g.threads.length > 0);
}

/**
 * The stretch of a message-search hit around what was searched for, on one line.
 *
 * A hit is a whole message — often a tool's JSON — so its head says nothing about
 * why it matched; the row shows the words either side of the match instead.
 * JSON's escapes are read back (a hit inside a tool's JSON otherwise shows
 * `\\n` and `\\u2014` as text), whitespace is collapsed so a pretty-printed payload
 * reads as a line, and the cut ends say they are cuts. Falls back to the head when the query does not
 * occur verbatim (the index stems and tokenises; this does not).
 */
export function matchExcerpt(content: string, query: string, width = 64): string {
  const text = content
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .replace(/\\[nrt]/g, ' ')
    .replace(/\\(["\\/])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= width) return text;
  const at = text.toLowerCase().indexOf(query.trim().toLowerCase());
  const start = at < 0 ? 0 : Math.max(0, Math.min(at - 16, text.length - width));
  const end = Math.min(text.length, start + width);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}
