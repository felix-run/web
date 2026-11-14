import type { RefObject } from 'react';
import { useEffect, useState } from 'react';
import { NO_RUN, type RunClock } from '@/app/shell-context';
import type { EnginePool } from '@/lib/conversation/engine-pool';

export function useRunClock({
  streaming,
  threadId,
  threadIdRef,
  pool,
  runStartsRef,
}: {
  streaming: boolean;
  threadId: string;
  threadIdRef: RefObject<string>;
  pool: EnginePool;
  runStartsRef: RefObject<Map<string, number>>;
}) {
  /**
   * When the current (or last) run started and stopped, for the inspector's
   * readout. The engine keeps no clock, and the inspector is mounted only while
   * it is open, so the transition has to be observed up here or a run already in
   * flight when the rail opens would report an elapsed time of zero.
   *
   * Measured by this tab: it is when *this client* started and stopped waiting,
   * not a harness timestamp, and a thread switch forgets it rather than
   * attributing one conversation's run to another.
   */
  const [runClock, setRunClock] = useState<RunClock>(NO_RUN);
  useEffect(() => {
    if (streaming) {
      setRunClock({
        startedAt: runStartsRef.current.get(threadIdRef.current) ?? Date.now(),
        endedAt: null,
      });
    } else
      setRunClock((c) =>
        c.startedAt !== null && c.endedAt === null ? { ...c, endedAt: Date.now() } : c,
      );
  }, [streaming]);
  // A thread switch forgets the clock — unless the thread arrived at has a run
  // still going (one left running in the background), which keeps its own start.
  useEffect(() => {
    if (pool.peek(threadId)?.state.streaming) {
      setRunClock({ startedAt: runStartsRef.current.get(threadId) ?? Date.now(), endedAt: null });
    } else {
      setRunClock((c) => (c.startedAt === null ? c : NO_RUN));
    }
  }, [pool, threadId]);

  return runClock;
}
