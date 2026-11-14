import { useEffect, useRef, useState } from 'react';

/**
 * How long something this tab watched has been live, or ran for once it stopped.
 *
 * `null` when it was never live while mounted — a block rebuilt from the session
 * snapshot, say. The snapshot carries no start or end for reasoning or a run, so
 * there is no duration to quote, and a stand-in would be exact-looking and wrong.
 *
 * One re-render a second while live and none after, scoped to the caller.
 */
export function useElapsed(live: boolean): number | null {
  const startedAt = useRef<number | null>(live ? Date.now() : null);
  const endedAt = useRef<number | null>(null);
  if (live && startedAt.current === null) startedAt.current = Date.now();
  if (!live && startedAt.current !== null && endedAt.current === null) {
    endedAt.current = Date.now();
  }

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [live]);

  if (startedAt.current === null) return null;
  return (endedAt.current ?? now) - startedAt.current;
}
