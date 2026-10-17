import { mergeSessions, type SessionSummary, type ThreadMeta } from '@felix/client';

/**
 * The harness's thread index as this tab last read it.
 *
 * The sidebar lists `mergeSessions(local, GET /chat/sessions)`, and neither half
 * is a superset: the harness owns which threads exist and what they are named,
 * this browser's `localStorage` only knows the threads it sent to. So when the
 * index read failed — a 429 on a cold load, observed live — the rail fell back to
 * the local half alone and showed "Older 1" for a tenant with fifty threads, the
 * header titled the thread with its raw suffix, and the composer said the
 * thread's agent "was not recorded". Nothing said a read had failed.
 *
 * Kept in **`sessionStorage`**, like `felix.tabThread`: one tab's, surviving that
 * tab's reloads, which is exactly the cold load that met the 429. It is a
 * fallback and never a source of truth — every good read replaces it, and it is
 * only merged in when a read did not answer (or between a delete and the next
 * read, so a deleted thread's neighbours do not vanish with it).
 */
const KEY = 'felix.threadIndex';

interface Cached {
  at: number;
  rows: SessionSummary[];
}

function read(): Cached | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Cached>;
    if (typeof parsed.at !== 'number' || !Array.isArray(parsed.rows)) return null;
    return { at: parsed.at, rows: parsed.rows };
  } catch {
    return null;
  }
}

function write(value: Cached): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // Storage full or disabled: the cost is the local list on the next failure.
  }
}

/** Record a good read of the index. */
export function rememberThreadIndex(rows: SessionSummary[], at: number = Date.now()): void {
  write({ at, rows });
}

/** When the remembered index was read, or `null` when this tab has none. */
export function threadIndexAge(): number | null {
  return read()?.at ?? null;
}

/** The local list with the remembered index merged over it — the local list alone without one. */
export function withRememberedIndex(local: ThreadMeta[]): ThreadMeta[] {
  const cached = read();
  return cached ? mergeSessions(local, cached.rows) : local;
}

/** A deleted thread leaves the remembered index too, or a failed read would put it back. */
export function forgetIndexedThread(id: string): void {
  const cached = read();
  if (!cached) return;
  write({ ...cached, rows: cached.rows.filter((r) => r.id !== id) });
}

/** Test seam. */
export function clearRememberedIndex(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
