import { mergeSessions, type ThreadMeta } from '@felix/client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listSessions } from '@/api/client';
import {
  rememberThreadIndex,
  threadIndexAge,
  withRememberedIndex,
} from '@/lib/conversation/thread-index';
import { listThreads } from '@/lib/conversation/threads';
import { forgetHarnessRead, reportHarnessRead } from '@/lib/harness/harness-health';

/**
 * When a thread-index read that failed for a passing reason is asked again: soon
 * at first, since one 429 is usually one burst, then at most once a minute.
 */
const THREAD_INDEX_BACKOFF_MS = [2_000, 5_000, 15_000, 30_000];
const THREAD_INDEX_BACKOFF_MAX_MS = 60_000;

export function useThreadIndex() {
  const [threads, setThreads] = useState<ThreadMeta[]>([]);
  // Prefer authoritative snapshot; fall back to history events.
  /**
   * Rebuild the sidebar: the harness's thread list merged over the local index.
   *
   * Renders the local list first and upgrades it, so the rail is populated
   * immediately and a slow harness never shows an empty history. A failed fetch
   * leaves the list standing rather than emptying it — a sidebar that goes
   * blank because one request failed reads as data loss.
   *
   * **And it says so.** This catch used to be empty, so a 429 on a cold load left
   * the local subset ("Older 1") looking like the whole truth. Now the list falls
   * back to the index this tab last read (`lib/thread-index.ts`), the failure is
   * state the sidebar draws under Threads (`threadIndex`), a transient one is a
   * source for the shell's harness-health line, and the read is asked again on a
   * backoff until it answers.
   */
  const [threadIndex, setThreadIndex] = useState<{ error: unknown; failures: number }>({
    error: null,
    failures: 0,
  });
  const indexRetry = useRef<number | null>(null);
  const indexFailures = useRef(0);
  const refreshThreads = useCallback(async (): Promise<void> => {
    if (indexRetry.current != null) {
      window.clearTimeout(indexRetry.current);
      indexRetry.current = null;
    }
    const local = listThreads();
    setThreads(withRememberedIndex(local));
    try {
      const rows = await listSessions();
      rememberThreadIndex(rows);
      setThreads(mergeSessions(local, rows));
      indexFailures.current = 0;
      setThreadIndex({ error: null, failures: 0 });
      forgetHarnessRead('threads');
    } catch (err) {
      const failures = ++indexFailures.current;
      setThreadIndex({ error: err, failures });
      const transient = reportHarnessRead('threads', err, {
        lastOkAt: threadIndexAge(),
        retry: () => void refreshThreads(),
      });
      // A passing failure is asked again by itself, backing off; one that waiting
      // will not cure (a 403, a 500) waits for the operator's Retry.
      if (transient) {
        const delay = THREAD_INDEX_BACKOFF_MS[failures - 1] ?? THREAD_INDEX_BACKOFF_MAX_MS;
        indexRetry.current = window.setTimeout(() => void refreshThreads(), delay);
      }
    }
  }, []);
  useEffect(
    () => () => {
      if (indexRetry.current != null) window.clearTimeout(indexRetry.current);
      forgetHarnessRead('threads');
    },
    [],
  );

  // Built once per change rather than per render: the sidebar picks it and is memoised, and a
  // fresh object here redrew it on every streamed frame. `rememberedAt` moves only on a good
  // read, which changes `threadIndex` too.
  const threadIndexStatus = useMemo(
    () => ({
      error: threadIndex.error,
      failures: threadIndex.failures,
      rememberedAt: threadIndex.error != null ? threadIndexAge() : null,
      retry: () => void refreshThreads(),
    }),
    [threadIndex, refreshThreads],
  );

  return { threads, setThreads, refreshThreads, threadIndexStatus };
}
