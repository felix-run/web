import { useEffect, useMemo, useState } from 'react';
import { listApprovals } from '@/api';
import { setDenials } from '@/components/chat/denial-context';
import { askAgainText, askableDenials, deniedCalls, matchDenials } from '@/lib/denials';
import type { ApprovalRequest, Turn } from '@/types';

/** The most decided rows the route returns; a thread's denials are filtered from these. */
const DENIED_ROWS = 200;
/** How long to wait before asking once more after a failed read. */
const RETRY_MS = 15_000;

/**
 * Reads the decided approval rows a thread's denied cards need, once per thread
 * and again only when another denial appears, and publishes each card's record and
 * its "Ask again" (`setDenials`). Renders nothing.
 *
 * Nothing is asked of the harness for a thread with no denied call. A failed read
 * is not reported: the cards say *Denied* without a who or a when, which is true,
 * and a toast for a detail would be louder than the detail.
 */
export function DenialsSync({
  threadId,
  turns,
  onAskAgain,
}: {
  threadId: string;
  turns: readonly Turn[];
  /** Absent while this tab cannot drive the thread: there is no composer to fill. */
  onAskAgain?: (text: string) => void;
}) {
  const denied = useMemo(() => deniedCalls(turns).length, [turns]);
  const [rows, setRows] = useState<{ thread: string; rows: ApprovalRequest[] } | null>(null);

  useEffect(() => {
    if (denied === 0) return;
    let live = true;
    let retry: number | undefined;
    // Asked again once, a while later: the harness sheds bursts with 429, and a
    // thread load is a burst. After that the cards keep saying plain *Denied*.
    const read = (attempt: number) =>
      listApprovals('denied', { limit: DENIED_ROWS }).then(
        (list) => {
          if (live) setRows({ thread: threadId, rows: list });
        },
        () => {
          if (live && attempt === 0) retry = window.setTimeout(() => read(1), RETRY_MS);
        },
      );
    void read(0);
    return () => {
      live = false;
      window.clearTimeout(retry);
    };
  }, [threadId, denied]);

  useEffect(() => {
    const own = rows?.thread === threadId ? rows.rows : [];
    const records = matchDenials(turns, own, threadId);
    const askable = askableDenials(turns);
    setDenials({
      recordOf: (tool) => records.get(tool) ?? null,
      askAgainFor: (tool) =>
        onAskAgain && askable.has(tool) ? () => onAskAgain(askAgainText(tool.name)) : null,
    });
  }, [rows, threadId, turns, onAskAgain]);
  useEffect(() => () => setDenials(null), []);

  return null;
}
