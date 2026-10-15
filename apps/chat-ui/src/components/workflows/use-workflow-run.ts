import { useCallback, useEffect, useRef, useState } from 'react';
import { getWorkflowRun, WorkflowRouteError, watchWorkflowRun } from '@/api';
import { RUN_LIVE } from '@/components/workflows/workflow-inspector';
import type { WorkflowRun } from '@/types';

/** Pauses before reconnecting a dropped stream, longer each time it drops without a frame. */
const RECONNECT_MS = [1_000, 2_000, 5_000, 15_000];
/** How often a harness without the stream route is asked instead. */
const POLL_MS = 2_000;

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** A 404 for the run itself (`not_found`), as against a harness with no such route at all. */
function runMissing(err: unknown): boolean {
  return err instanceof WorkflowRouteError && err.status === 404 && err.code === 'not_found';
}

/**
 * One run, kept current while `enabled`: read once, then watched over
 * `GET /workflows/{id}/runs/{run_id}/stream` until it is over.
 *
 * A dropped stream is read again (so the screen is current at once) and reconnected from the last
 * version it held, after a pause that grows while it keeps dropping. A harness older than the
 * stream route answers it 404 for a run it just returned; that one is polled instead, as the page
 * did before. A run that is not there (swept, mistyped in a link) is `gone`, and not asked again.
 */
export function useWorkflowRun(id: string, runId: string | null, enabled: boolean) {
  const [data, setData] = useState<WorkflowRun | undefined>();
  const [error, setError] = useState<unknown>(null);
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);
  const [gone, setGone] = useState(false);
  const held = useRef<{ run: string | null; version: number | null }>({ run: null, version: null });

  // A newer version replaces what is shown; an older one (a read that raced a frame) does not.
  const take = useCallback((run: WorkflowRun) => {
    const h = held.current;
    if (h.run === run.id && h.version !== null && run.version < h.version) return;
    held.current = { run: run.id, version: run.version };
    setData(run);
    setError(null);
    setLastOkAt(Date.now());
  }, []);

  const read = useCallback(async (): Promise<WorkflowRun | null> => {
    if (!runId) return null;
    try {
      const run = await getWorkflowRun(id, runId);
      take(run);
      return run;
    } catch (err) {
      if (runMissing(err)) setGone(true);
      else setError(err);
      return null;
    }
  }, [id, runId, take]);

  useEffect(() => {
    setGone(false);
    setError(null);
    held.current = { run: runId, version: null };
  }, [runId]);

  useEffect(() => {
    if (!enabled || !runId) return;
    const abort = new AbortController();
    const { signal } = abort;
    void (async () => {
      const first = await read();
      if (signal.aborted || !first) return;
      let drops = 0;
      while (!signal.aborted) {
        try {
          const over = await watchWorkflowRun(id, runId, {
            after: held.current.version,
            signal,
            onRun: (run) => {
              drops = 0;
              take(run);
            },
          });
          if (over) return;
        } catch (err) {
          if (signal.aborted) return;
          if (err instanceof WorkflowRouteError && err.status === 404) {
            if (runMissing(err)) {
              setGone(true);
              return;
            }
            // No stream route on this harness: ask, as before it had one.
            while (!signal.aborted) {
              const run = await read();
              if (run && !RUN_LIVE.has(run.status)) return;
              await pause(POLL_MS, signal);
            }
            return;
          }
          setError(err);
        }
        await pause(RECONNECT_MS[Math.min(drops, RECONNECT_MS.length - 1)], signal);
        drops += 1;
        if (signal.aborted) return;
        const run = await read();
        if (run && !RUN_LIVE.has(run.status)) return;
      }
    })();
    return () => abort.abort();
  }, [id, runId, enabled, read, take]);

  /** Read the run now: after a decision or a cancel, which the stream also brings, a moment later. */
  const refresh = useCallback(() => void read(), [read]);

  return { data, error, lastOkAt, gone, refresh };
}
