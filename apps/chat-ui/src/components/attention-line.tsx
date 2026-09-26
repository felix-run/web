import { relativeTime, type ThreadMeta } from '@felix/client';
import { Button } from '@felix/ui/button';
import { ChevronRightIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { decideApproval } from '@/api';
import { ApprovalDecision } from '@/components/approval/approval-decision';
import type { PendingApprovals } from '@/hooks/use-pending-approvals';
import { ariaShortcut, isMacPlatform } from '@/lib/shortcuts';
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
 *
 * The poll itself is the shell's (`usePendingApprovals`), handed in, so the
 * thread list's blocked marker reads the same rows rather than a second poll.
 *
 * **It never claims the all-clear on a list it could not refresh.** "Nothing
 * waiting on you" is a statement about the harness, and it is only true when the
 * latest ask was answered. Before the first answer the line says it is checking;
 * after a failed one it says it cannot reach approvals and how old its last
 * answer is, keeping the last known count if there was one. It said all-clear
 * for as long as the harness was returning 429 on this route — the one failure a
 * line whose whole promise is "true without being looked at" cannot have.
 */

const OPEN_KEY = 'felix.attentionOpen';

export function AttentionLine({
  approvals,
  streaming,
  handled,
  threadId,
  threads,
}: {
  /** The shell's tenant-wide `/approvals` poll — see `usePendingApprovals`. */
  approvals: PendingApprovals;
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
  const { pending, error, lastOkAt, refresh } = approvals;
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
  /**
   * Whether the latest answer may be spoken as the present.
   *
   * `stale` is a failed latest tick; `unchecked` is before any tick has
   * answered. Neither may say "nothing waiting": an empty list nobody refreshed
   * is the absence of an answer, not a no.
   */
  const stale = error != null;
  const unchecked = !stale && lastOkAt === null;
  const where = allOnThisThread ? 'on this thread' : 'across the harness';
  const calls = `${count} ${count === 1 ? 'call' : 'calls'}`;
  const summary = stale
    ? waiting
      ? `Can't reach approvals · ${calls} ${count === 1 ? 'was' : 'were'} waiting on you ${where}`
      : "Can't reach approvals"
    : unchecked
      ? 'Checking approvals…'
      : waiting
        ? `${calls} ${count === 1 ? 'is' : 'are'} waiting on you ${where}`
        : streaming
          ? 'Working. Nothing waiting on you.'
          : 'Nothing waiting on you.';
  // Outside the live region: it changes on every failed tick, and a screen
  // reader re-reading the sentence for a clock would bury the change that matters.
  const age = stale
    ? lastOkAt === null
      ? 'not checked yet'
      : `last checked ${relativeTime(lastOkAt)}`
    : null;

  /**
   * The dot follows the meaning, and the words always say it too. A known
   * waiting call stays amber when the latest check failed — somebody was being
   * asked, and nothing says they stopped being asked. A failed check with nothing
   * known to be waiting is red: something went wrong and nobody is being asked.
   * Resting is neutral, matching the run readout's idle: idle is not on the ramp,
   * and green would claim a finished state this line has no evidence of.
   */
  const dot = waiting
    ? 'bg-state-blocked'
    : stale
      ? 'bg-state-failed'
      : streaming
        ? 'bg-state-running'
        : 'bg-muted-foreground/50';

  return (
    <section
      aria-label="What is waiting"
      className={cn(
        'shrink-0 border-b border-border/60 text-sm',
        waiting ? 'bg-state-blocked/10' : 'bg-muted/30',
      )}
    >
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span
          aria-hidden
          data-attention-dot
          className={cn('size-1.5 shrink-0 rounded-full', dot)}
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
            waiting ? 'text-state-blocked' : stale ? 'text-state-failed' : 'text-muted-foreground',
          )}
        >
          {summary}
        </p>
        {age && (
          <span
            className="shrink-0 text-xs tabular-nums text-muted-foreground"
            title={error instanceof Error ? error.message : undefined}
          >
            {age}
          </span>
        )}
        {reviewable.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 gap-1 px-2 text-xs"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            // The keyboard layer clicks this to expand the queue before focusing
            // it, so the shortcut and the pointer open it the same way.
            data-shortcut="review-approvals"
            aria-keyshortcuts={ariaShortcut('focus-approval', isMacPlatform())}
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

            A row names its originating thread (`thread_id`, since
            felix-run/felix@f679310), so one blocking another conversation links
            there. A row with none is unattributed rather than "here", which is
            why the summary keeps "across the harness" unless every row is
            provably this thread.
          */}
          {reviewable.map((a) => (
            // Focusable but out of the tab order: the keyboard layer lands on
            // the card rather than on Approve, for the reason the banner gives.
            <div
              key={a.id}
              tabIndex={-1}
              role="group"
              aria-label={`Approval waiting: ${a.tool_name}`}
              data-approval-focus="queue"
              className="space-y-1 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
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
    </section>
  );
}
