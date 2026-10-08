import { useEffect, useRef, useSyncExternalStore } from 'react';

/**
 * `usePoll`, but one request for everyone asking the same question.
 *
 * The `/harness` rail's glances and the pages they summarise read the same
 * routes: the Jobs glance and the Jobs page both list jobs, and the Activity page glance
 * and the Activity half both read the last 60 audit events. Each polled on its
 * own, so on those pages every read went out twice — on a harness that answers
 * 429 when it is hammered, which it was, visibly, while this was being built.
 *
 * So a read is keyed. Every subscriber to a key shares one timer, one request in
 * flight and one answer, and the timer runs at the *fastest* interval any
 * subscriber asked for: on the Jobs page the rail's 30s glance rides the page's
 * 4s poll, and the two can no longer disagree about how many jobs are failing.
 * When the last subscriber leaves, the timer stops.
 *
 * Everything else is `usePoll`'s: ticks are skipped while the tab is hidden, a
 * fetch runs on the way back, a failed read keeps the last answer and reports
 * `lastOkAt`, and subscribing — including an `enabled` false→true edge — fetches
 * straight away.
 *
 * A key must always mean the same fetch. The latest subscriber's fetcher is the
 * one used, so two call sites under one key asking for different things would
 * silently get one of them.
 */

export interface PollSnapshot<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  lastOkAt: number | null;
}

interface Entry {
  snapshot: PollSnapshot<unknown>;
  listeners: Set<() => void>;
  /** Subscriber → the interval it asked for. */
  subscribers: Map<symbol, number>;
  fetcher: () => Promise<unknown>;
  timer: ReturnType<typeof setInterval> | null;
  intervalMs: number;
  inflight: Promise<void> | null;
  onVisible: (() => void) | null;
}

const registry = new Map<string, Entry>();

const EMPTY: PollSnapshot<unknown> = {
  data: undefined,
  error: null,
  loading: false,
  lastOkAt: null,
};

function entryFor(key: string, fetcher: () => Promise<unknown>): Entry {
  let entry = registry.get(key);
  if (!entry) {
    entry = {
      snapshot: EMPTY,
      listeners: new Set(),
      subscribers: new Map(),
      fetcher,
      timer: null,
      intervalMs: 0,
      inflight: null,
      onVisible: null,
    };
    registry.set(key, entry);
  }
  return entry;
}

function publish(entry: Entry, next: Partial<PollSnapshot<unknown>>) {
  entry.snapshot = { ...entry.snapshot, ...next };
  for (const l of entry.listeners) l();
}

const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

/** One fetch for the key; a second caller while one is in flight shares it. */
function run(entry: Entry): Promise<void> {
  if (entry.inflight) return entry.inflight;
  publish(entry, { loading: true });
  entry.inflight = entry
    .fetcher()
    .then(
      (data) => publish(entry, { data, error: null, lastOkAt: Date.now(), loading: false }),
      (error) => publish(entry, { error, loading: false }),
    )
    .finally(() => {
      entry.inflight = null;
    });
  return entry.inflight;
}

/** Re-arm the timer at the fastest interval any subscriber wants, or stop it. */
function schedule(entry: Entry) {
  const fastest = entry.subscribers.size ? Math.min(...entry.subscribers.values()) : 0;
  if (fastest === entry.intervalMs && (fastest === 0) === (entry.timer === null)) return;
  if (entry.timer) clearInterval(entry.timer);
  entry.timer = null;
  entry.intervalMs = fastest;
  if (fastest > 0) {
    entry.timer = setInterval(() => {
      if (!hidden()) void run(entry);
    }, fastest);
  }
  if (fastest > 0 && !entry.onVisible) {
    // Fetch on the way back rather than waiting out the rest of the interval.
    entry.onVisible = () => {
      if (!hidden()) void run(entry);
    };
    document.addEventListener('visibilitychange', entry.onVisible);
  } else if (fastest === 0 && entry.onVisible) {
    document.removeEventListener('visibilitychange', entry.onVisible);
    entry.onVisible = null;
  }
}

export function useSharedPoll<T>(
  key: string,
  fetcher: () => Promise<T>,
  { enabled = true, intervalMs = 3000 }: { enabled?: boolean; intervalMs?: number } = {},
): PollSnapshot<T> & { refresh: () => void } {
  const entry = entryFor(key, fetcher);
  // The newest closure wins, as `usePoll`'s ref does, so a fetcher that reads
  // props is never stale — see the key contract above.
  entry.fetcher = fetcher;

  const id = useRef(Symbol(key)).current;
  // `fetcher` is deliberately not a dependency: it changes every render, and a
  // fetch reads the newest one through `entry.fetcher`.
  useEffect(() => {
    if (!enabled) return;
    const e = entryFor(key, fetcher);
    e.subscribers.set(id, intervalMs);
    schedule(e);
    void run(e);
    return () => {
      e.subscribers.delete(id);
      schedule(e);
    };
  }, [key, enabled, intervalMs, id]);

  const snapshot = useSyncExternalStore(
    (onChange) => {
      entry.listeners.add(onChange);
      return () => entry.listeners.delete(onChange);
    },
    () => entry.snapshot,
    () => EMPTY,
  ) as PollSnapshot<T>;

  return { ...snapshot, refresh: () => void run(entry) };
}

/** Test seam: forget every key, stopping any timers. */
export function resetSharedPolls(): void {
  for (const entry of registry.values()) {
    if (entry.timer) clearInterval(entry.timer);
    if (entry.onVisible) document.removeEventListener('visibilitychange', entry.onVisible);
  }
  registry.clear();
}
