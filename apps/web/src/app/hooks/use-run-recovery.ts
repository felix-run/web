import { useEffect, useState } from 'react';
import { lastResume } from '@/lib/conversation/resume';

/**
 * How soon after the page comes back a dropped stream still counts as one the
 * operator's leaving caused: the connection's failure surfaces on the first read
 * after resume, or when `checkLiveness` cuts it a beat later.
 */
const LEFT_APP_WINDOW_MS = 10_000;
export function useRunRecovery(threadId: string, reattaching: boolean) {
  /**
   * The drop that started this reattach happened because the operator left —
   * the page was hidden, or it had only just come back. On a phone that is the
   * usual reason a run dies: switching apps suspends the page, the connection
   * goes with it, and the harness tears down a run whose client hung up. Kept
   * after the reattach finishes, until the next send or thread, because the
   * reattach takes a moment and the person it is for has only just looked back.
   */
  const [leftApp, setLeftApp] = useState(false);
  /**
   * The same, for a drop with any other cause: a network switch, a proxy that lost
   * its upstream, a stream the liveness check cut. It has the same lifetime for the
   * same reason. The reattach after a dropped run is quick — the snapshot says the
   * thread is idle — and what it rebuilds often has no reply at all, because the
   * harness keeps none of a run it tore down. A notice that lived only as long as
   * the reattach flashed for half a second and left a question with no answer and
   * nothing to say why (measured live, 2026-10-03).
   */
  const [dropped, setDropped] = useState(false);
  useEffect(() => {
    if (!reattaching) return;
    if (document.visibilityState === 'hidden' || Date.now() - lastResume() < LEFT_APP_WINDOW_MS) {
      setLeftApp(true);
    } else {
      setDropped(true);
    }
  }, [reattaching]);
  // A notice about this thread's run says nothing about the next thread's.
  useEffect(() => {
    setLeftApp(false);
    setDropped(false);
  }, [threadId]);
  return { leftApp, dropped, setLeftApp, setDropped };
}
