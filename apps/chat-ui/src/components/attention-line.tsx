import {
  type ApprovalRequest,
  approvalRuleLabel,
  fileToolOp,
  formatCountdown,
  msUntilDecision,
  relativeTime,
  type ThreadMeta,
} from '@felix/client';
import { Button } from '@felix/ui/button';
import { ChevronRightIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { decideApproval } from '@/api';
import { ApprovalDecision } from '@/components/approval/approval-decision';
import type { PendingApprovals } from '@/hooks/use-pending-approvals';
import { callTarget } from '@/lib/call-target';
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
 *
 * **It is the one approvals surface outside the transcript.** The run instrument
 * used to carry an Approvals tab that drew the same rows again, so one call had
 * two live cards and two countdowns. That tab is gone; this line is where a
 * tenant-wide approval is decided or routed from.
 */

/**
 * Tools whose card needs the target's current contents to be decided honestly.
 *
 * A `/approvals` row carries the call's arguments and nothing about the file
 * they replace, so a `write_file` from another thread can only be shown here
 * without its before/after — the banner on its own thread draws both, because
 * that approval reached it by frame with `before` read at request time. The
 * line routes those rather than offering a weaker decision. An `edit_file`'s
 * arguments *are* the change (old text and new), and a shell command's are the
 * whole of it, so those stay decidable in place.
 */
const needsItsThread = (toolName: string) => fileToolOp(toolName) === 'write';

const OPEN_KEY = 'felix.attentionOpen';

export function AttentionLine({
  approvals,
  streaming,
  handled,
  bannerOnScreen,
  threadId,
  threads,
  reasons = {},
  question = null,
  elsewhereQuestions = [],
  queueHost = null,
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
  /**
   * Whether the transcript banner is on screen. Off the workbench (`/harness`)
   * it is not, so a call it owns would be counted here with no way to reach it —
   * an amber sentence with no verb, which teaches the operator to ignore amber.
   * There, an owned call gets a row that routes back to its thread.
   */
  bannerOnScreen: boolean;
  /** The thread on screen, so the line can tell "here" from "somewhere else". */
  threadId: string;
  /** The thread index, for naming an approval's thread rather than showing an id. */
  threads: ThreadMeta[];
  /**
   * The rule's reason for an approval this tab saw arrive by frame, keyed by id.
   * The `/approvals` row carries none, so it is recovered here when it exists
   * and left out when it does not.
   */
  reasons?: Record<string, string | undefined>;
  /**
   * The question an agent is waiting on (`ask_user` → a `ui_request` frame), or
   * `null`. It is this thread's — the engine holds only the open thread's prompt —
   * and it blocks the run exactly as an approval does, but it is not an approval,
   * so the `/approvals` poll never sees it. Without this the line said "Nothing
   * waiting on you" while the header said `blocked` and the run waited on an answer.
   */
  question?: string | null;
  /**
   * Questions open on runs this tab keeps going on **other** threads — the
   * operator switched away mid-run and the run carried on, then asked. The
   * engine on screen does not hold them and `/approvals` never lists them, so
   * without this the only sign was the tab title. Never this thread's: that one
   * is `question`. Named as elsewhere, and linked to, because the banner that
   * answers it is on its own thread.
   */
  elsewhereQuestions?: ReadonlyArray<{ threadId: string; prompt: string }>;
  /**
   * Where the expanded queue renders. The line itself sits in the header, which
   * has no room for a list of cards, so the shell hands it the slot under the
   * header and the queue opens there — in the flow, pushing the page down rather
   * than covering it. Without a host the queue renders after the line, which is
   * what a test mounting the line alone gets.
   */
  queueHost?: HTMLElement | null;
}) {
  const queueId = useId();
  const { pending, error, lastOkAt, failures, refresh, markDecided } = approvals;
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
  const reviewable = pending.filter((a) => !owned.has(a.id) || !bannerOnScreen);

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

  /**
   * Open itself only for a call on **this** thread, and only on the transition
   * into one. Opening for any new row meant a fresh thread opened onto another
   * thread's write, a card the height of the composer between the operator and
   * the work they came to start; the summary already says it is waiting, and the
   * Review button is one key away. Re-opening while a count merely stays
   * non-zero would fight an operator who deliberately collapsed it.
   */
  const hereCount = reviewable.filter((a) => a.thread_id === threadId).length;
  const hadHere = useRef(false);
  useEffect(() => {
    if (hereCount > 0 && !hadHere.current) setOpen(true);
    hadHere.current = hereCount > 0;
  }, [hereCount]);

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
  /**
   * One failed tick right after an answer. Not the all-clear — the line still
   * will not say "nothing waiting" over it — but not red either: a single 429
   * is the harness shedding a burst, the next tick nearly always answers, and a
   * line that flashed red on every one taught the operator to ignore the red.
   * A second failure in a row, or a failure with no answer ever, is red.
   */
  const rechecking = stale && failures < 2 && lastOkAt !== null;
  const where = allOnThisThread ? 'on this thread' : 'across the harness';
  const calls = `${count} ${count === 1 ? 'call' : 'calls'}`;
  // A 429 is the harness answering, just not with the list. "Can't reach"
  // reads as an outage; the operator's next move differs (wait, not restart),
  // so the words say which. The dot stays red either way: in both cases this
  // line cannot vouch that nothing is waiting.
  const limited = stale && /:\s*429\b/.test(String((error as Error)?.message ?? error));
  const failure = limited ? 'Approvals rate-limited' : "Can't reach approvals";
  const asking = question != null;
  const othersAsking = elsewhereQuestions.length;
  const anyAsking = asking || othersAsking > 0;
  /** The questions elsewhere, as a noun phrase: never "on this thread". */
  const elsewherePhrase =
    othersAsking === 1
      ? 'a question on another thread'
      : `${othersAsking} questions on other threads`;
  const questionPhrase = asking
    ? othersAsking > 0
      ? `a question on this thread and ${elsewherePhrase}`
      : 'a question on this thread'
    : elsewherePhrase;
  const alsoAsking = ` · and ${questionPhrase}`;
  /** The questions as a sentence of their own, for when no approval is waiting. */
  const questionsWaiting = asking
    ? othersAsking > 0
      ? `A question is waiting on you on this thread, and ${elsewherePhrase.replace(/^a question/, 'one')}`
      : 'A question is waiting on you on this thread'
    : othersAsking === 1
      ? 'A question is waiting on you on another thread'
      : `${othersAsking} questions are waiting on you on other threads`;
  const base = rechecking
    ? waiting
      ? `${calls} ${count === 1 ? 'was' : 'were'} waiting on you ${where} · rechecking`
      : 'Rechecking approvals…'
    : stale
      ? waiting
        ? `${failure} · ${calls} ${count === 1 ? 'was' : 'were'} waiting on you ${where}`
        : failure
      : unchecked
        ? 'Checking approvals…'
        : waiting
          ? `${calls} ${count === 1 ? 'is' : 'are'} waiting on you ${where}`
          : // Said for what this line counts — approvals and an agent's questions —
            // not as an all-clear: a skill draft waiting for review is on no poll
            // this line reads, and "Nothing waiting on you" sat above a page
            // saying one was. Drafts have their own glance on Skills.
            streaming
            ? 'Working. No approvals or questions waiting.'
            : 'No approvals or questions waiting.';
  // A question is known locally, from the stream, so it is said even when the
  // approvals poll has not answered — "Checking approvals…" over an open question
  // would hide the one thing this line is certain of.
  const summary = !anyAsking
    ? base
    : waiting
      ? `${base}${alsoAsking}`
      : stale && !rechecking
        ? `${failure} · ${questionsWaiting.charAt(0).toLowerCase()}${questionsWaiting.slice(1)}`
        : questionsWaiting;
  /**
   * The sentence in two words, for a phone's header. The full sentence stays the
   * live region and the `title`; this is what is drawn below `sm`, because the
   * dot alone would say the state in colour only.
   */
  const short =
    waiting || anyAsking
      ? `${count + (asking ? 1 : 0) + othersAsking} waiting`
      : stale && !rechecking
        ? limited
          ? 'Rate-limited'
          : 'Unreachable'
        : rechecking
          ? 'Rechecking'
          : unchecked
            ? 'Checking'
            : streaming
              ? 'Working'
              : 'No approvals';
  // Outside the live region: it changes on every failed tick, and a screen
  // reader re-reading the sentence for a clock would bury the change that matters.
  const age =
    stale && !rechecking
      ? lastOkAt === null
        ? // Not "not checked yet": the check ran, which is how it failed. What has
          // not happened is an answer, and that is the thing to say.
          'no answer yet'
        : `last answered ${relativeTime(lastOkAt)}`
      : null;

  /**
   * The dot follows the meaning, and the words always say it too. A known
   * waiting call stays amber when the latest check failed — somebody was being
   * asked, and nothing says they stopped being asked. A failed check with nothing
   * known to be waiting is red: something went wrong and nobody is being asked.
   * Resting is neutral, matching the run readout's idle: idle is not on the ramp,
   * and green would claim a finished state this line has no evidence of.
   */
  const blocked = waiting || anyAsking;
  /**
   * Where "Answer it" goes: this thread's question when its banner is off screen
   * (on `/harness`), otherwise the first question on another thread — whose
   * banner is never on screen here.
   */
  const answerAt = asking && !bannerOnScreen ? threadId : (elsewhereQuestions[0]?.threadId ?? null);
  const answerTitle =
    answerAt && answerAt !== threadId
      ? `Answer the question on ${threads.find((t) => t.id === answerAt)?.title ?? 'another thread'}`
      : undefined;
  const dot = blocked
    ? 'bg-state-blocked'
    : stale && !rechecking
      ? 'bg-state-failed'
      : streaming
        ? 'bg-state-running'
        : 'bg-muted-foreground/50';

  const queue = reviewable.length > 0 && open && (
    // Held to the transcript's reading measure and on its centre line, so the
    // queue reads as the same column the decision continues in. Full-bleed, a
    // grant sentence ran ~580 characters to a line and Approve was a 600px bar.
    // The tint and rule are full width: they belong to the line, not the list.
    <div
      id={queueId}
      data-slot="attention-queue"
      className={cn(
        'max-h-[40vh] shrink-0 overflow-y-auto border-b border-border/60',
        blocked ? 'bg-solid-state-blocked/5' : 'bg-solid-muted/30',
      )}
    >
      <ul className="mx-auto max-w-3xl divide-y divide-border/40">
        {reviewable.map((a) => (
          <QueueRow
            key={a.id}
            approval={a}
            inBanner={owned.has(a.id)}
            threadId={threadId}
            threads={threads}
            reason={reasons[a.id]}
            onDecided={() => {
              markDecided(a.id);
              refresh();
            }}
          />
        ))}
      </ul>
    </div>
  );

  return (
    <>
      {/*
        A pill in the header, before the controls: the answer to "is anything
        waiting on me" sits on the bar every address shares, rather than taking a
        row of its own under it. It shrinks before anything else in the header —
        the sentence truncates, then below `sm` gives way to two words — and the
        whole sentence stays the live region and the `title`.

        Tinted only when it has something to say: amber while a person is being
        asked, red while it cannot vouch for the list. At rest it is muted text on
        no surface, because a pill that is always filled stops being read.
      */}
      <section
        aria-label="What is waiting"
        data-slot="attention-line"
        title={summary}
        className={cn(
          'flex h-7 min-w-0 items-center gap-2 rounded-full px-2.5 text-sm',
          blocked
            ? 'bg-solid-state-blocked/10'
            : stale && !rechecking
              ? 'bg-solid-state-failed/10'
              : undefined,
          reviewable.length > 0 && 'pr-0.5',
        )}
      >
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
            'min-w-0 truncate max-sm:sr-only',
            blocked
              ? 'text-state-blocked'
              : stale && !rechecking
                ? 'text-state-failed'
                : 'text-muted-foreground',
          )}
        >
          {summary}
        </p>
        <span
          aria-hidden
          className={cn(
            'shrink-0 sm:hidden',
            blocked
              ? 'font-medium text-state-blocked'
              : stale && !rechecking
                ? 'font-medium text-state-failed'
                : 'text-muted-foreground',
          )}
        >
          {short}
        </span>
        {age && (
          <span
            className="hidden shrink-0 text-xs tabular-nums text-muted-foreground md:inline"
            title={error instanceof Error ? error.message : undefined}
          >
            {age}
          </span>
        )}
        {answerAt && (
          // A question whose banner is not on screen — this thread's, off the
          // workbench, or another thread's anywhere — needs a way to it, or the
          // sentence is amber with no verb.
          <Button asChild variant="ghost" size="sm" className="h-6 shrink-0 px-2 text-xs">
            <Link to={`/t/${answerAt}`} title={answerTitle}>
              Answer it
            </Link>
          </Button>
        )}
        {reviewable.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 gap-1 rounded-full px-2 text-xs"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls={open ? queueId : undefined}
            // The keyboard layer clicks this to expand the queue before focusing
            // it, so the shortcut and the pointer open it the same way.
            data-shortcut="review-approvals"
            aria-keyshortcuts={ariaShortcut('focus-approval', isMacPlatform())}
          >
            <ChevronRightIcon
              className={cn('size-3.5 transition-transform duration-150', open && 'rotate-90')}
            />
            {/* The chevron alone on a phone: the header has the brand, the
                count and three controls to fit in 390px, and the word is the
                part the count already implies. It stays the button's name. */}
            <span className="max-sm:sr-only">{open ? 'Hide' : 'Review'}</span>
          </Button>
        )}
      </section>
      {queue && (queueHost ? createPortal(queue, queueHost) : queue)}
    </>
  );
}

/**
 * One waiting call, as a line until someone asks for the card.
 *
 * The line says what is waiting, on what, for which thread and how long is
 * left; the card is still the only place a decision is made, because approving
 * grants every byte-identical call until the deadline and that is a sentence the
 * card says and a line cannot. A call on this thread opens as its card. A call
 * from another thread starts as its line, and a write from another thread never
 * becomes a card here at all — it links to its thread, where the banner can draw
 * what the write replaces (`needsItsThread`).
 *
 * One clock per call on screen: the line shows the countdown while it is
 * collapsed and hands it to the card's chip when expanded.
 */
function QueueRow({
  approval: a,
  inBanner = false,
  threadId,
  threads,
  reason,
  onDecided,
}: {
  approval: ApprovalRequest;
  /** The banner owns it but is not on screen: route to it rather than offer a weaker card. */
  inBanner?: boolean;
  threadId: string;
  threads: ThreadMeta[];
  reason?: string;
  onDecided: () => void;
}) {
  const elsewhere = Boolean(a.thread_id) && a.thread_id !== threadId;
  const [expanded, setExpanded] = useState(!elsewhere && !inBanner);
  const args = (a.args ?? {}) as Record<string, unknown>;
  const target = callTarget(a.tool_name, args);
  const threadTitle = elsewhere
    ? (threads.find((t) => t.id === a.thread_id)?.title ?? 'another thread')
    : null;
  // An unattributed write has nowhere to route to, so it stays decidable here:
  // refusing to offer it would leave a call nobody can answer from this tab.
  const route = inBanner || (elsewhere && needsItsThread(a.tool_name));
  // The banner's own call is this thread's, wherever its row says it came from.
  const routeTo = inBanner ? threadId : a.thread_id;
  const bodyId = `queue-${a.id}`;

  return (
    // Focusable but out of the tab order: the keyboard layer lands on the row
    // rather than on a button, for the reason the banner gives.
    <li
      tabIndex={-1}
      role="group"
      aria-label={`Approval waiting: ${a.tool_name}`}
      data-approval-focus="queue"
      className="px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <span className="shrink-0 font-mono text-foreground">{a.tool_name}</span>
        {target && (
          <span className="min-w-0 truncate font-mono text-muted-foreground" title={target}>
            {target}
          </span>
        )}
        {threadTitle && (
          <span className="hidden min-w-0 shrink truncate text-muted-foreground sm:inline">
            · {threadTitle}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {!expanded && <RowCountdown expiresAt={a.expires_at} />}
          {route ? (
            <Button asChild variant="outline" size="sm" className="h-6 px-2 text-xs">
              <Link to={`/t/${routeTo}`}>
                Open thread to review
                {threadTitle && <span className="sr-only">: {threadTitle}</span>}
              </Link>
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-xs"
              aria-expanded={expanded}
              aria-controls={bodyId}
              onClick={() => setExpanded((e) => !e)}
            >
              <ChevronRightIcon
                className={cn(
                  'size-3.5 transition-transform duration-150',
                  expanded && 'rotate-90',
                )}
              />
              {expanded ? 'Collapse' : 'Review'}
            </Button>
          )}
        </span>
      </div>
      {route && (
        <p className="mt-1 text-xs text-muted-foreground">
          {inBanner
            ? 'Open in the banner on its thread, which has the full card.'
            : 'A write is decided on its own thread, where the card can show what it replaces.'}
        </p>
      )}
      {!route && expanded && (
        <div id={bodyId} className="mt-2 space-y-1">
          {threadTitle && (
            <p className="text-xs text-muted-foreground">
              Blocking{' '}
              <Link
                to={`/t/${a.thread_id}`}
                className="font-medium text-foreground underline underline-offset-2"
              >
                {threadTitle}
              </Link>
            </p>
          )}
          <ApprovalDecision
            toolName={a.tool_name}
            args={args}
            // The rule that gated it, as the banner shows it: one word in this slot
            // for one call wherever it is decided. The manifest only when no rule
            // is named.
            context={approvalRuleLabel(a.rule_id, reason) ?? a.manifest_id}
            expiresAt={a.expires_at}
            reason={reason}
            onDecide={async (status) => {
              await decideApproval(a.id, { status });
              onDecided();
            }}
          />
        </div>
      )}
    </li>
  );
}

/**
 * The collapsed row's deadline: the countdown alone, in the card chip's colours.
 * Silent, like the chip: a clock that speaks every second is noise. The card's
 * own status line announces the last minute and the lapse once it is open; a
 * lapsed row is dropped by `listApprovals`, so this never has to say "denied".
 */
function RowCountdown({ expiresAt }: { expiresAt: number | null }) {
  const [left, setLeft] = useState(() => msUntilDecision({ expiresAt }));
  useEffect(() => {
    setLeft(msUntilDecision({ expiresAt }));
    if (expiresAt == null) return;
    const timer = setInterval(() => setLeft(msUntilDecision({ expiresAt })), 1_000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  if (left === null) return null;
  const countdown = formatCountdown(left);
  // The words, not only the clock: a bare `4:20` beside a call does not say what
  // happens at zero, and what happens is the harness denying it. Below `sm` the
  // row has no room for the sentence, and the chip's colour plus the card it
  // opens carry it.
  return (
    <span
      role="timer"
      aria-label={`Auto-denies in ${countdown}`}
      className="rounded-full bg-state-blocked/15 px-1.5 py-0.5 font-medium text-state-blocked"
    >
      <span className="hidden sm:inline">Auto-denies in </span>
      <span className="font-mono tabular-nums">{countdown}</span>
    </span>
  );
}
