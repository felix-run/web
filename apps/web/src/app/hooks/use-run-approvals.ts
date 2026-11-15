import { type ChatEngine, isClosedApproval } from '@felix/client';
import type { RefObject } from 'react';
import { useCallback, useEffect, useRef } from 'react';
import { decideApproval } from '@/api/client';
import { usePendingApprovals } from '@/hooks/use-pending-approvals';
import type { EnginePool, PoolRuns } from '@/lib/conversation/engine-pool';
import { readPendingApprovals } from '@/lib/conversation/pending-approvals-read';
import { onResume } from '@/lib/conversation/resume';
import { useShellPresence } from './use-shell-notifications';

/** How often to ask the harness for approvals while a run is in flight. */
const APPROVAL_POLL_MS = 2_500;
/** How often to ask whether a live stream has stalled, while the page is on screen. */
const LIVENESS_CHECK_MS = 15_000;
/** How long past an approval's deadline to re-ask, so the harness has denied it by then. */
const LAPSE_GRACE_MS = 2_000;

interface RunApprovalsOptions {
  threadId: string;
  threadIdRef: RefObject<string>;
  unsentRef: RefObject<Set<string>>;
  engine: ChatEngine;
  pool: EnginePool;
  poolRuns: PoolRuns;
  pendingQueue: ChatEngine['state']['approvals'];
  uiPrompt: ChatEngine['state']['uiPrompt'];
  streaming: boolean;
  hydrateIfAhead(id: string, options?: { rejoin?: boolean }): Promise<void>;
}

export function useRunApprovals({
  threadId,
  threadIdRef,
  unsentRef,
  engine,
  pool,
  poolRuns,
  pendingQueue,
  uiPrompt,
  streaming,
  hydrateIfAhead,
}: RunApprovalsOptions) {
  const pending = pendingQueue[0] ?? null;
  /**
   * Approval ids the transcript banner owns, so every other surface that lists
   * `/approvals` — the attention line and the inspector — counts them without
   * re-offering them. Only the one the banner actually *draws*, not the whole
   * queue: `ApprovalBanner` renders `pendingQueue[0]` and reports the rest as a
   * count, so suppressing all of them left every approval after the first
   * visible nowhere but in a total. Computed once here so the two surfaces
   * cannot disagree about which one that is.
   */
  const bannerOwned = pending ? [pending.approvalId] : [];

  /**
   * The tenant's pending approvals, polled for the life of the tab — hidden or
   * not — and read by the attention line and the thread list's blocked marker.
   * Owned here rather than by either reader so the two cannot disagree about
   * which threads are waiting, and the tab pays for one poll rather than two.
   * Distinct from the 2.5s `syncApprovals` poll below, which adopts approvals
   * into the engine and runs only while this tab has a run in flight.
   */
  const tenantApprovals = usePendingApprovals();

  // Deliberately bare: `ApprovalDecision` owns the in-flight guard and both
  // toasts, so this does the work and lets a failure propagate to it.
  // The harness already decided a lapsed approval; this only takes the card down.
  const onDismiss = useCallback(() => engine.shiftApproval(), [engine]);

  const onDecide = useCallback(
    async (status: 'approved' | 'denied', editedArgs?: Record<string, unknown>) => {
      if (!pending) return;
      try {
        await decideApproval(pending.approvalId, {
          status,
          // Only when the operator actually changed something: `edited_args`
          // installs a substitution that stands for every identical call until
          // the grant expires, so sending the originals back would quietly create
          // one nobody asked for.
          ...(editedArgs ? { edited_args: editedArgs } : {}),
        });
      } catch (err) {
        // Decided elsewhere or timed out (`felix-run/felix#635`): nothing is left to
        // answer, so the banner lets go of it and the toast says why. Not `markDecided`
        // — this browser did not decide it.
        if (isClosedApproval(err)) engine.shiftApproval();
        throw err;
      }
      // Before the banner lets go of it: the moment `shiftApproval` drops the id
      // from `bannerOwned`, the attention line would otherwise re-offer it from a
      // list up to one poll old.
      tenantApprovals.markDecided(pending.approvalId);
      engine.shiftApproval();
    },
    [engine, pending, tenantApprovals.markDecided],
  );

  /**
   * Adopt any approval the harness is holding that is not already on screen.
   *
   * The merge, the dedupe and the `write_file` pre-read are the engine's, so
   * both delivery paths — the `approval_required` frame and this poll — agree
   * about what is already queued.
   */
  // Every engine reads the pending list through one shared read (`pending-approvals-read.ts`),
  // with the attention line's poll: it used to be one request per engine per tick.
  const syncApprovals = useCallback(
    () => engine.syncApprovals({ listPending: readPendingApprovals }),
    [engine],
  );

  /**
   * Adopt on every thread this tab lands on, not only the first.
   *
   * A run may already have been waiting before this tab loaded — and equally
   * before this tab *navigated*: the attention line's "Open thread to review"
   * exists to land on a thread whose banner can show a write's diff, and with
   * this keyed on mount alone that banner never appeared until a reload, so the
   * route led to an Idle readout and a welcome screen while the line said the
   * call was waiting on this very thread. `threadId` rather than a call inside
   * `loadThread`: the engine reads `threadIdRef`, which is current only after
   * the render the new address causes.
   */
  useEffect(() => {
    void syncApprovals();
  }, [threadId, syncApprovals]);

  /**
   * One "blocked here", fed by both polls.
   *
   * The tenant poll runs always — hidden tab, idle thread — and the engine's
   * own only while streaming. So a call on this thread could reach the attention
   * line and nothing else: title, favicon, header chip, readout and banner all
   * read the engine's queue, and said nothing was waiting while the line said it
   * was. When the tenant list carries a row for this thread the engine does not
   * hold, the engine adopts it; every surface then reads one set. Keyed on the
   * missing ids, so it asks once per new row rather than once per tick.
   */
  const queuedIds = new Set(pendingQueue.map((q) => q.approvalId));
  const unadoptedHere = tenantApprovals.pending
    .filter((a) => a.thread_id === threadId && !queuedIds.has(a.id))
    .map((a) => a.id)
    .join(',');
  useEffect(() => {
    if (unadoptedHere) void syncApprovals();
  }, [unadoptedHere, syncApprovals]);

  /**
   * Ask again while a run is live.
   *
   * A gated tool blocks the run until it is answered, and the harness does not
   * reliably announce it on the stream — leaving the tool card on 'running' and
   * the run looking hung, with the prompt appearing only after a reload. Polling
   * is the only way to notice, and it costs one request every few seconds for as
   * long as a run is actually in flight.
   *
   * A plain interval rather than `usePoll`: that hook holds the latest value and
   * toggles a loading flag, which would add two renders per tick during a
   * stream. This wants the side effect, not the data.
   */
  // Every live run in the tab, not only the one on screen: a run kept going in
  // the background blocks on an approval the same way, and its engine is what
  // prunes one decided elsewhere (the attention line, another tab).
  const anyRunning = poolRuns.running.size > 0;
  /**
   * The thread on screen adopts unattributed approvals, as it always has; a run
   * kept going in the background adopts only rows naming its own thread. An
   * unattributed row would otherwise land on every live engine at once, and
   * deciding it from one banner left the others holding a stale card.
   */
  const syncLive = useCallback(
    (live: ChatEngine) =>
      live === pool.peek(threadIdRef.current)
        ? live.syncApprovals({ listPending: readPendingApprovals })
        : live.syncApprovals({ attributedOnly: true, listPending: readPendingApprovals }),
    [pool],
  );
  useEffect(() => {
    if (!anyRunning) return;
    const timer = window.setInterval(() => {
      for (const live of pool.live()) void syncLive(live);
    }, APPROVAL_POLL_MS);
    return () => window.clearInterval(timer);
  }, [anyRunning, pool, syncLive]);

  /**
   * Re-ask once the head approval's deadline has passed.
   *
   * The harness denies a lapsed approval itself, and the sync drops what it no
   * longer lists — but the poll above runs only mid-stream, and a timeout lets
   * the run finish, so without this a lapsed card stayed on screen for the life
   * of the tab. The grace covers the harness's own wait returning.
   */
  const headDeadline = pending?.expiresAt ?? null;
  useEffect(() => {
    if (headDeadline == null) return;
    const timer = window.setTimeout(
      () => void syncApprovals(),
      Math.max(0, headDeadline - Date.now()) + LAPSE_GRACE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [headDeadline, syncApprovals]);

  /**
   * Coming back. A suspended page ran nothing while it was away — not the
   * approval polls, whose intervals are frozen with every other timer, and not a
   * live stream, whose connection may have died without telling its reader. So
   * on return: ask about approvals now rather than at the next tick, let the
   * engine cut a stream that has gone silent (it reattaches on its own), and pick
   * up a thread that moved on without this tab.
   */
  const refreshTenantApprovals = useRef(tenantApprovals.refresh);
  refreshTenantApprovals.current = tenantApprovals.refresh;
  useEffect(
    () =>
      onResume(({ hiddenForMs }) => {
        for (const live of pool.live()) live.checkLiveness();
        refreshTenantApprovals.current();
        void engine.syncApprovals({ listPending: readPendingApprovals });
        for (const live of pool.live()) if (live !== engine) void syncLive(live);
        if (
          hiddenForMs > 0 &&
          !engine.state.streaming &&
          !unsentRef.current.has(threadIdRef.current)
        ) {
          void hydrateIfAhead(threadIdRef.current, { rejoin: true });
        }
      }),
    [engine, pool, syncLive, hydrateIfAhead],
  );

  /**
   * The same check while the page is on screen.
   *
   * A stream can go silent without the page ever leaving: a proxy that dropped
   * its upstream, a half-open connection after a network switch. The reader is
   * never told, so the turn read *running* indefinitely — measured on 2026-10-03
   * by cutting the dev proxy's upstream mid-reply: a minute later the header
   * still said running and nothing had reattached. `checkLiveness` keeps its own
   * rule (a stream that has shown a keep-alive and then missed three), so a
   * quiet stream in a long tool call is still never cut on a guess; this only
   * makes sure someone asks.
   */
  useEffect(() => {
    if (!anyRunning) return;
    const id = window.setInterval(() => {
      for (const live of pool.live()) live.checkLiveness();
    }, LIVENESS_CHECK_MS);
    return () => window.clearInterval(id);
  }, [pool, anyRunning]);

  useShellPresence(
    pendingQueue.length > 0 || uiPrompt != null || poolRuns.blocked.size > 0,
    streaming || anyRunning,
  );
  return { pending, bannerOwned, tenantApprovals, onDecide, onDismiss };
}
