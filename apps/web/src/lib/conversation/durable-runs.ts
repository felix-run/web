/**
 * The durable run in flight on each thread, as this browser started it.
 *
 * A durable run outlives its tab — that is the point of one — but nothing on the
 * harness lets a client find it again: the snapshot's phase reads `idle` while it
 * works, and the only route that knows it is `GET /chat/runs/{resume_token}`. So a
 * reload showed a thread that looked finished while the run went on writing to it,
 * and the operator's next message started a *second* run on the same thread beside
 * it, which the harness does not refuse: two runs, each re-doing what it could not
 * see the other doing.
 *
 * `localStorage`, unlike `felix.tabThread`, because the run is not one tab's:
 * closing the tab and opening the thread again should find it too. An entry is
 * dropped when the engine settles the run, and ignored after `MAX_AGE_MS` — a run
 * nobody came back to has long since ended, and the poll would only say so.
 */
const KEY = 'felix.durableRuns';
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

interface Entry {
  token: string;
  at: number;
}

function read(): Record<string, Entry> {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, Entry>) : {};
  } catch {
    return {};
  }
}

function write(runs: Record<string, Entry>): void {
  try {
    if (Object.keys(runs).length) localStorage.setItem(KEY, JSON.stringify(runs));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage disabled: a reload loses the run, as it did before this existed.
  }
}

export function rememberDurableRun(threadId: string, token: string, now = Date.now()): void {
  write({ ...read(), [threadId]: { token, at: now } });
}

export function forgetDurableRun(threadId: string): void {
  const runs = read();
  if (!(threadId in runs)) return;
  delete runs[threadId];
  write(runs);
}

/** The token of the run this browser left in flight on `threadId`, if one is recent. */
export function recallDurableRun(threadId: string, now = Date.now()): string | null {
  const entry = read()[threadId];
  if (!entry || typeof entry.token !== 'string' || !entry.token) return null;
  if (!(now - Number(entry.at) < MAX_AGE_MS)) {
    forgetDurableRun(threadId);
    return null;
  }
  return entry.token;
}
