import { useSyncExternalStore } from 'react';

/**
 * Whether the harness is answering reads, said once for the whole shell.
 *
 * Observed live while the harness answered 429 `rate_limited`: `/harness/skills`
 * drew six red bordered boxes — manifests, review, feedback, library, upstream,
 * policy — each with its own raw `skill-library/review: 429 rate_limited` and its
 * own Try again, and the sidebar silently showed one thread out of fifty. One
 * cause, six alarms, and one silence, which is the worst of both.
 *
 * So a read that failed for a reason that passes — the harness shedding load
 * (429), saying it is temporarily unavailable (503, 408), or not answering at
 * all — is reported **here**, by the poll, the query, the thread index or the
 * panel that made it, and the shell draws one neutral line for all of them
 * (`components/harness-health-line.tsx`). The panel keeps its last good rows and
 * draws no box of its own. A failure that will not pass by waiting — a 403, a
 * 404, a 500, a body that would not parse — is still the panel's to say, in red,
 * because only the panel knows what it means there.
 *
 * Each reporter is a **source** with its own id. The line shows while any source
 * is failing, and clears when the last one answers or goes away; a source that
 * unmounts must `forgetHarnessRead` or it would hold the line up for good.
 */

/** Why a read failed, when the reason is one that waiting cures. */
export type TransientKind = 'rate_limited' | 'unavailable' | 'unreachable';

/** The status a client error carries: `.status`, else the transport's `route: 429` spelling. */
function statusOf(err: unknown): number | null {
  const own = (err as { status?: unknown } | null)?.status;
  if (typeof own === 'number') return own;
  const m = String((err as Error)?.message ?? err).match(/:\s*(\d{3})\b/);
  return m ? Number(m[1]) : null;
}

/**
 * `fetch`'s own rejection when nothing answered — DNS, TLS, a refused connection.
 *
 * Stricter than `describeError`'s test, which reads every `TypeError` as offline:
 * a `TypeError` is also what a client's own bug throws ("cannot read properties
 * of undefined"), and quieting *that* into a neutral line would hide a fault
 * that no amount of waiting fixes.
 */
function isNetworkFailure(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'TimeoutError') return true;
  const text = String((err as Error)?.message ?? err);
  return (
    err instanceof TypeError &&
    /failed to fetch|networkerror|network error|load failed|fetch failed/i.test(text)
  );
}

/**
 * The kind of a transient failure, or `null` for one that is not — including an
 * abort, which is a caller changing its mind and no failure at all.
 */
export function transientKind(err: unknown): TransientKind | null {
  if (err == null) return null;
  if (err instanceof DOMException && err.name === 'AbortError') return null;
  const status = statusOf(err);
  if (status === 429) return 'rate_limited';
  if (status === 503 || status === 408) return 'unavailable';
  if (status == null && isNetworkFailure(err)) return 'unreachable';
  return null;
}

export const isTransientFailure = (err: unknown): boolean => transientKind(err) != null;

interface Source {
  kind: TransientKind;
  /** When this source's run of failures began. */
  since: number;
  /** When it last answered, or `null` if it never has. */
  lastOkAt: number | null;
  retry?: () => void;
}

export interface HarnessHealth {
  /** `ok`, or the worst transient kind any source is in. */
  state: 'ok' | TransientKind;
  /** When the earliest still-failing source began failing. */
  since: number | null;
  /**
   * The oldest last answer among failing sources that ever had one — the age of
   * the oldest thing on screen — or `null` when none of them has answered yet.
   */
  lastOkAt: number | null;
  /** The newest failure's raw text, shown only in Debug. */
  detail: string | null;
  /** How many reads are failing. */
  failing: number;
  /** Whether any failing source can be asked again. */
  retryable: boolean;
}

const OK: HarnessHealth = {
  state: 'ok',
  since: null,
  lastOkAt: null,
  detail: null,
  failing: 0,
  retryable: false,
};

/** Unreachable outranks unavailable outranks rate-limited: say the worst. */
const RANK: Record<TransientKind, number> = { rate_limited: 1, unavailable: 2, unreachable: 3 };

const sources = new Map<string, Source>();
const listeners = new Set<() => void>();
let snapshot: HarnessHealth = OK;
let newestDetail: string | null = null;

function publish(): void {
  if (sources.size === 0) {
    snapshot = OK;
    newestDetail = null;
  } else {
    let state: TransientKind = 'rate_limited';
    let since = Number.POSITIVE_INFINITY;
    let lastOkAt: number | null = null;
    let retryable = false;
    for (const s of sources.values()) {
      if (RANK[s.kind] > RANK[state]) state = s.kind;
      since = Math.min(since, s.since);
      if (s.lastOkAt != null)
        lastOkAt = lastOkAt == null ? s.lastOkAt : Math.min(lastOkAt, s.lastOkAt);
      if (s.retry) retryable = true;
    }
    snapshot = { state, since, lastOkAt, detail: newestDetail, failing: sources.size, retryable };
  }
  for (const l of listeners) l();
}

/**
 * Record a failed read. Returns whether it was transient — and so now the
 * shell's to say — or not, in which case the source is cleared and the caller
 * says it itself.
 */
export function reportHarnessRead(
  source: string,
  err: unknown,
  { lastOkAt = null, retry }: { lastOkAt?: number | null; retry?: () => void } = {},
): boolean {
  const kind = transientKind(err);
  if (!kind) {
    forgetHarnessRead(source);
    return false;
  }
  const prev = sources.get(source);
  newestDetail = String((err as Error)?.message ?? err);
  sources.set(source, {
    kind,
    since: prev?.since ?? Date.now(),
    // A source that cannot say when it last answered keeps the age it had.
    lastOkAt: lastOkAt ?? prev?.lastOkAt ?? null,
    retry,
  });
  publish();
  return true;
}

/** The read answered, or its reader went away: it holds the line up no longer. */
export function forgetHarnessRead(source: string): void {
  if (!sources.delete(source)) return;
  publish();
}

/** Ask every failing read again — the shell line's Retry. */
export function retryHarnessReads(): void {
  for (const s of [...sources.values()]) s.retry?.();
}

export function getHarnessHealth(): HarnessHealth {
  return snapshot;
}

export function subscribeHarnessHealth(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function useHarnessHealth(): HarnessHealth {
  return useSyncExternalStore(subscribeHarnessHealth, getHarnessHealth, () => OK);
}

/** Test seam: forget every source. */
export function resetHarnessHealth(): void {
  sources.clear();
  newestDetail = null;
  snapshot = OK;
  for (const l of listeners) l();
}
