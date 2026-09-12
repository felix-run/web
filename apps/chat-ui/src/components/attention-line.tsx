import type { ApprovalRequest, ThreadMeta } from '@felix/client';
import { Button } from '@felix/ui/button';
import { ChevronRightIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { decideApproval, listApprovals } from '@/api';
import { ApprovalDecision } from '@/components/approval/approval-decision';
import { cn } from '@/lib/utils';

/**
 * What is waiting on a person, always on screen.
 *
 * The rest of chat-ui answers questions you went looking for. This answers the
 * one you have before you have navigated anywhere: *is anything waiting on me*.
 * It is rendered unconditionally and says so when the answer is no — a line that
 * only appears in trouble teaches the operator not to look at it, and then it is
 * not a signal, it is a surprise.
 *
 * It exists because of the runs nobody is watching. A durable run's approval
 * cannot reach a stream: side events are an in-process queue keyed by thread id,
 * the agent is in the worker and the stream is served by the API, so no frame
 * crosses. `GET /approvals` is the only channel, and until now it was polled only
 * while *this tab* had a run in flight — exactly the case where someone is
 * already watching.
 */

/** Slow: a TTL is minutes long, and this runs for the life of the tab. */
const POLL_MS = 10_000;
const OPEN_KEY = 'felix.attentionOpen';

/**
 * Deliberately not `usePoll`.
 *
 * That hook skips ticks while the tab is hidden, which is right for a reference
 * panel nothing depends on while nobody is looking, and exactly wrong here: a
 * hidden tab is the case this line exists to serve. It is the in-viewport half of
 * a pair whose other half is `presence.ts`, and both have to keep counting.
 */
function usePendingApprovals(): { pending: ApprovalRequest[]; refresh: () => void } {
  const [pending, setPending] = useState<ApprovalRequest[]>([]);

  const refresh = useCallback(() => {
    void listApprovals('pending')
      .then(setPending)
      // Silent: the harness being unreachable is already reported by the
      // composer's connection hint and by every call the operator makes on
      // purpose. A toast per failed background tick would be a second, louder
      // channel for something they did not ask for.
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  return { pending, refresh };
}

export function AttentionLine({
  streaming,
  handled,
  threadId,
  threads,
}: {
  streaming: boolean;
  /**
   * Approval ids the transcript banner already owns.
   *
   * They still **count** — the number has to be the honest tenant-wide total —
   * but they are not re-offered here. Two Approve buttons for one call is bad on
   * its own, and worse in this direction: an approval that reached the banner
   * came by frame, so the banner can show the write's before/after diff, and a
   * `/approvals` row carries no `before` to build one from. Deciding from the
   * line would mean deciding with strictly less to go on.
   */
  handled: string[];
  /** The thread on screen, so the line can tell "here" from "somewhere else". */
  threadId: string;
  /** The thread index, for naming an approval's thread rather than showing an id. */
  threads: ThreadMeta[];
}) {
  const { pending, refresh } = usePendingApprovals();
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(OPEN_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, open ? '1' : '0');
    } catch {
      // A private window is not a reason to stop working.
    }
  }, [open]);

  const count = pending.length;
  const owned = new Set(handled);
  const reviewable = pending.filter((a) => !owned.has(a.id));

  /**
   * Whether the count is provably all on the thread in front of you.
   *
   * `thread_id` arrived with `felix-run/felix@f679310`; before it, every row was
   * unattributed and this line could only ever say "across the harness". It still
   * says that whenever *any* row is on another thread or carries no thread at all
   * — an unattributed row is not evidence of being here, and a phrase that
   * narrows the count on a guess is worse than one that does not narrow it.
   */
  const allOnThisThread = count > 0 && pending.every((a) => a.thread_id === threadId);

  // Open itself when something starts waiting, and only on that transition —
  // re-opening while a count merely stays non-zero would fight an operator who
  // deliberately collapsed it. Same rule the inspector's approvals section uses.
  const hadReviewable = useRef(false);
  useEffect(() => {
    if (reviewable.length > 0 && !hadReviewable.current) setOpen(true);
    hadReviewable.current = reviewable.length > 0;
  }, [reviewable.length]);

  const waiting = count > 0;
  const summary = waiting
    ? `${count} ${count === 1 ? 'call is' : 'calls are'} waiting on you ${
        allOnThisThread ? 'on this thread' : 'across the harness'
      }`
    : streaming
      ? 'Working. Nothing waiting on you.'
      : 'Nothing waiting on you.';

  return (
    <div
      className={cn(
        'shrink-0 border-b border-border/60 text-sm',
        waiting ? 'bg-state-blocked/10' : 'bg-muted/30',
      )}
    >
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span
          aria-hidden
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            waiting ? 'bg-state-blocked' : streaming ? 'bg-state-running' : 'bg-state-done',
          )}
        />
        {/*
          A live region, because the whole promise is that this is true without
          being looked at. `polite` rather than `assertive`: a screen reader
          should finish the sentence it is on before being told a count changed.
        */}
        <p
          role="status"
          aria-live="polite"
          className={cn(
            'min-w-0 flex-1 truncate',
            waiting ? 'text-state-blocked' : 'text-muted-foreground',
          )}
        >
          {summary}
        </p>
        {reviewable.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 gap-1 px-2 text-xs"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
          >
            <ChevronRightIcon
              className={cn('size-3.5 transition-transform duration-150', open && 'rotate-90')}
            />
            {open ? 'Hide' : 'Review'}
          </Button>
        )}
      </div>

      {reviewable.length > 0 && open && (
        <div className="max-h-[40vh] space-y-2.5 overflow-y-auto border-t border-border/40 px-3 py-2.5">
          {/*
            The same card the transcript banner and the inspector use, rather than
            a third, smaller decision surface. Approving is not approving one
            call — it grants every byte-identical call to that tool until the
            deadline — and that is a sentence the card already says. A compact
            triage row that omitted it would be the most dangerous control here.

            `/approvals` rows carry no `thread_id` (felix-run/felix#232), so these
            are not attributed to a conversation. That is why the summary above
            says "across the harness" rather than implying this thread.
          */}
          {reviewable.map((a) => (
            <div key={a.id} className="space-y-1">
              {a.thread_id && a.thread_id !== threadId ? (
                <p className="text-xs text-muted-foreground">
                  Blocking{' '}
                  <Link
                    to={`/t/${a.thread_id}`}
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    {threads.find((t) => t.id === a.thread_id)?.title ?? 'another conversation'}
                  </Link>
                </p>
              ) : null}
              <ApprovalDecision
                key={a.id}
                toolName={a.tool_name}
                args={(a.args ?? {}) as Record<string, unknown>}
                context={a.manifest_id}
                expiresAt={a.expires_at}
                onDecide={async (status) => {
                  await decideApproval(a.id, { status });
                  refresh();
                }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
