import {
  type BranchPoint,
  branchPoints,
  createChatEngine,
  describeCompaction,
  describeRestoredFiles,
  eventsToTurns,
  LeaseRefusedError,
  type RestoredFiles,
  recordedFileChanges,
  routedDiffReader,
  snapshotToEvents,
  titleFromText,
} from '@felix/client';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useMatch, useNavigate } from 'react-router';
import { toast } from 'sonner';
import {
  abortChat,
  acquireSessionLease,
  addEvalItem,
  bindLeases,
  compactSession,
  continueChat,
  deleteThreadHistory,
  exportSession,
  felix,
  forkSession,
  getEvalDataset,
  getSessionLease,
  getSessionSnapshot,
  getThreadHistory,
  putEvalDataset,
  releaseSessionLease,
  renameSession,
  respondUiRequest,
  rewindChat,
  setOutputStyle,
  setPermissionMode,
  setSessionFeedback,
  setSessionLabel,
  setThinkingLevel,
  steerChat,
  workspaceEdited,
} from '@/api/client';
import type {
  ChatMessage,
  ImageAttachment,
  SessionSnapshot,
  ThinkingLevel,
  Turn,
  TurnFeedback,
} from '@/api/types';
import type { ClientDiagnostics, ShellValue } from '@/app/shell-context';
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input';
import {
  KEPT_NOTICE,
  type KeptMessage,
  REATTACHING_REFUSAL,
  REFUSED_NOTICE,
  REKEYED_NOTICE,
  RESEND_NOTICE,
  RUN_BUSY_NOTICE,
} from '@/components/chat/multimodal-input';
import type { RewindFilesAnswer } from '@/components/chat/rewind-files-dialog';
import type { SlashCommand } from '@/components/chat/slash-commands';
import type { Driver } from '@/components/chat/watching-banner';
import { useTheme } from '@/components/theme-provider';
import { useMediaQuery } from '@/hooks/use-media-query';
import { useMessageQueue } from '@/hooks/use-message-queue';
import { WORKSPACE_INLINE } from '@/hooks/use-rails';
import { useShortcuts } from '@/hooks/use-shortcuts';
import { useVisualViewport } from '@/hooks/use-visual-viewport';
import { continueOffer } from '@/lib/conversation/continue-run';
import {
  forgetDurableRun,
  recallDurableRun,
  rememberDurableRun,
} from '@/lib/conversation/durable-runs';
import { createEnginePool, type EnginePool } from '@/lib/conversation/engine-pool';
import { frameStoreFor } from '@/lib/conversation/frame-store';
import { ImageUploadError, uploadImages } from '@/lib/conversation/image-upload';
import { onLeave } from '@/lib/conversation/leave';
import { armNotifications } from '@/lib/conversation/presence';
import {
  createLeaseKeeper,
  LEASE_RENEW_MS,
  releaseOnPageExit,
} from '@/lib/conversation/session-lease';
import { recallTabThread, rememberTabThread } from '@/lib/conversation/tab-thread';
import { forgetIndexedThread, withRememberedIndex } from '@/lib/conversation/thread-index';
import {
  clearTurns,
  indexThread,
  listThreads,
  loadTurns,
  migrateLegacy,
  readPins,
  removeThread,
  saveTurns,
  scheduleSaveTurns,
  threadLabel,
  writePins,
} from '@/lib/conversation/threads';
import { toastError, toastProblem } from '@/lib/error-toast';
import { useHarnessReachable } from '@/lib/harness/connection';
import { isMacPlatform, whenMounted } from '@/lib/navigation/shortcuts';
import {
  openInPane as openPaneItem,
  type PaneItemInput,
  paneState,
  setPaneShown,
} from '@/lib/navigation/side-pane';
import { executeClientTool, readWorkspaceFile } from '@/lib/workspace/cowork';
import { saveText } from '@/lib/workspace/save-text';
import { WORKSPACE_WRITTEN } from '@/lib/workspace/workspace-events';
import { useManifestCanary, useManifestSelection } from './hooks/use-manifests';
import { useRunApprovals } from './hooks/use-run-approvals';
import { useRunClock } from './hooks/use-run-clock';
import { useRunRecovery } from './hooks/use-run-recovery';
import { usePushNavigation } from './hooks/use-shell-notifications';
import { useShellPreferences } from './hooks/use-shell-preferences';
import { useSideQuestion } from './hooks/use-side-question';
import { useThreadIndex } from './hooks/use-thread-index';
import { useWorkspacePane } from './hooks/use-workspace-pane';

/** How long a deleted conversation can be restored, and how long the server delete waits. */
const DELETE_UNDO_MS = 7000;
const HOLDER_KEY = 'felix.holderId';
const THINKING_LEVELS: ThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];
/** A composer or queued message, with the `Idempotency-Key` it goes out under when it has one. */
type KeyedMessage = PromptInputMessage & { key?: string };

/** Why a message came back: the lease, a send that failed, or a key the harness refused. */
type KeptReason = 'lease' | 'run' | 'failed' | 'key_reused' | 'refused';

/** What a failed streamed send carried, so a resend under its key is the same body. */
interface UnsettledSend {
  threadId: string;
  manifest: string;
  text: string;
  /** The composer's own file parts, by data URL: how an unchanged resend is recognised. */
  fileUrls: string[];
  /** What the upload returned, which a resend sends again rather than uploading anew. */
  attachments: ImageAttachment[];
}

function sameFiles(urls: string[], files: PromptInputMessage['files']): boolean {
  return urls.length === files.length && files.every((f, i) => f.url === urls[i]);
}

function tabHolderId(): string {
  try {
    let id = sessionStorage.getItem(HOLDER_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(HOLDER_KEY, id);
    }
    return id;
  } catch {
    return 'anonymous';
  }
}

/**
 * How often a hold is renewed — and so how soon a watching tab takes over once
 * the driver leaves. `VITE_LEASE_RENEW_MS` shortens it for a live check; a build
 * without it renews at half the TTL.
 */
function leaseRenewMs(): number {
  const override = Number(import.meta.env.VITE_LEASE_RENEW_MS);
  return Number.isFinite(override) && override > 0 ? override : LEASE_RENEW_MS;
}

/** How often a watching tab asks whether the thread has moved on. */
const WATCH_POLL_MS = 5_000;

/** One keeper for the tab, so a remounted shell finds the holds the last one left. */
const sessionLeases = createLeaseKeeper(
  { acquire: acquireSessionLease, release: releaseSessionLease },
  tabHolderId,
  leaseRenewMs(),
);
// Every driving request carries this tab's token for its thread, and a refusal
// means the tab is watching, whatever the keeper last believed.
bindLeases({
  token: (threadId) => sessionLeases.token(threadId),
  refused: (threadId) => sessionLeases.demote(threadId),
});
// Closing the tab unmounts nothing, so the keeper's own releases never run then.
// Module scope, like the keeper: one pair of listeners for the life of the page.
if (typeof window !== 'undefined') releaseOnPageExit(sessionLeases);
// Signing out lets go of this tab's leases while the session can still ask (`lib/leave.ts`).
onLeave(() => sessionLeases.releaseAllNow());

/** A restore's outcome. What it left undone stays on screen: it is what someone has to act on. */
function reportRestoredFiles(said: string, files: RestoredFiles | undefined) {
  const { done, problem } = describeRestoredFiles(files);
  toast.message(
    `${said} ${done}`,
    problem
      ? { description: problem, duration: Number.POSITIVE_INFINITY, closeButton: true }
      : undefined,
  );
}

export function useAppController() {
  const { manifestEntries, manifests, manifest, setManifest } = useManifestSelection();
  // For callbacks the composer's memo can hold across an agent change.
  const manifestRef = useRef(manifest);
  manifestRef.current = manifest;
  /**
   * The address is the thread — but only the addresses that name one.
   *
   * `/t/:threadSuffix` is the truth when it matches. `/` mints a fresh thread and
   * redirects (see `NewThread` in `App.tsx`). **Any other address keeps whatever
   * thread this tab was already on**, which is the whole reason the engine lives
   * up here: visiting `/harness` must not change the thread, because changing it
   * resets the engine and a live run dies with it.
   *
   * This used to redirect to a fresh thread whenever the URL carried none, which
   * was indistinguishable from correct while `/` was the only such address.
   *
   * The URL carries the suffix alone, never `{tenant}:{suffix}` — the harness
   * rejects a suffix containing `:` outright.
   */
  const navigate = useNavigate();
  const threadRoute = useMatch('/t/:threadSuffix');
  const routeThread = threadRoute?.params.threadSuffix ?? null;
  // `/` is the one address that asks for a new thread, so it never recalls one.
  const freshRoute = useMatch('/') !== null;
  const activeThread = useRef<string | null>(null);
  /**
   * Thread ids this tab made up and has not yet sent a message to.
   *
   * The harness has never heard of one, and must not until a message goes: on a
   * `memory://` store any lease or snapshot request for an unknown thread files
   * it as a session (and `/chat/abort` does on any store), and every page load
   * used to do that twice — once for an id the shell minted for its first render
   * on `/`, once for the different id `NewThread` then redirected to — leaving
   * two empty, UUID-titled threads in the rail. The shell is now the only place
   * an id is minted, `/` redirects to that same id, and nothing asks the harness
   * about it until `streamInto` sends.
   */
  const unsentRef = useRef<Set<string>>(new Set());
  const mint = useCallback(() => {
    const id = crypto.randomUUID();
    unsentRef.current.add(id);
    return id;
  }, []);
  if (routeThread) activeThread.current = routeThread;
  // `/` asks for a new thread — unless the tab is already on one it has not used.
  else if (freshRoute && !unsentRef.current.has(activeThread.current ?? '')) {
    activeThread.current = mint();
  }
  // A cold load on `/harness` has no thread yet; the tab's last one is the one
  // "keeps the thread the tab was already on" means after a reload.
  activeThread.current ??= recallTabThread() ?? mint();
  const threadId = activeThread.current;
  /** Bumped when an unsent thread gets its first message, so the lease effect sees it. */
  const [, setSentEpoch] = useState(0);
  const leaseable = !unsentRef.current.has(threadId);
  const markSent = useCallback((id: string) => {
    if (unsentRef.current.delete(id)) setSentEpoch((n) => n + 1);
  }, []);
  /**
   * Another client drives this thread and this tab only watches it: the keeper
   * holds an observer lease here, because the harness said `held_by_other` or
   * refused one of this tab's writes. The composer and every driving action go
   * read-only, and the keeper takes the thread over on its own once it is free.
   */
  const leaseState = useSyncExternalStore(sessionLeases.subscribe, () =>
    sessionLeases.state(threadId),
  );
  const watching = leaseable && leaseState.mode === 'shared';
  const watchingRef = useRef(watching);
  watchingRef.current = watching;
  /** Who is driving, for the banner's wording — read once per watch, never shown as an id. */
  const [driver, setDriver] = useState<Driver>('other');
  useEffect(() => {
    if (!watching) return;
    let current = true;
    getSessionLease(threadId).then(
      (status) => {
        // The terminal client's holder ids are `tui-<pid>`; a browser tab's are UUIDs.
        if (current) setDriver(status.holder_id?.startsWith('tui-') ? 'terminal' : 'other');
      },
      () => {},
    );
    return () => {
      current = false;
    };
  }, [watching, threadId]);
  useEffect(() => {
    if (routeThread) rememberTabThread(routeThread);
  }, [routeThread]);
  /**
   * The workbench's own chrome does nothing on the harness address.
   *
   * Both matches are read unconditionally and combined afterwards. Written as
   * `useMatch(a) !== null || useMatch(b) !== null` the `||` short-circuits, so
   * the second hook is skipped on exactly the renders where the first matches —
   * the hook order changes and React throws the whole app away.
   */
  const harnessRoot = useMatch('/harness');
  const harnessPanel = useMatch('/harness/*');
  const onHarness = harnessRoot !== null || harnessPanel !== null;
  const sidebarInline = useMediaQuery(WORKSPACE_INLINE);
  /** The slot under the header the attention line's queue renders into. */
  const [attentionHost, setAttentionHost] = useState<HTMLDivElement | null>(null);
  const { threads, setThreads, refreshThreads, threadIndexStatus } = useThreadIndex();
  const { canary, recheckCanary } = useManifestCanary(manifest, threadId);
  const [uiResolving, setUiResolving] = useState(false);
  const [thinkingLevel, setThinkingLevelState] = useState<ThinkingLevel>('off');
  // Keyed by thread, so a thread with no snapshot yet (a new one) never shows the style the
  // last thread was set to: it reads as the default until the harness says otherwise.
  const [storedStyle, setStoredStyle] = useState<{ thread: string; style: string | null }>({
    thread: '',
    style: null,
  });
  const { view, harnessView, debug, chooseView, stepView, toggleDebug } = useShellPreferences();
  const { theme, resolved, setTheme } = useTheme();
  /** Where focus lands when the Debug badge turns debug off and unmounts. */
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  /** Which thread the shell last loaded — see `loadThread`. */
  const loadedThreadRef = useRef<string | null>(null);
  /**
   * `hydrateFromServer`, for the engine's callbacks.
   *
   * The pool is built once, above the callback's own declaration, and must not
   * be rebuilt when it changes — a new engine mid-run is a lost run.
   */
  const hydrateFromServerRef = useRef<(id: string, opts?: { transcript?: boolean }) => void>(
    () => {},
  );
  const harnessViewRef = useRef(harnessView);
  /**
   * Mirrored at render rather than from an effect. The engine pool reads this to
   * tell the thread on screen from a run kept going in the background, and
   * `hydrateFromServer` compares a slow response against it to decide whether
   * that response still belongs to the thread on screen. An effect leaves it one
   * render behind, which on a thread change driven by Back or a pasted link is
   * long enough to matter.
   */
  const threadIdRef = useRef(threadId);
  threadIdRef.current = threadId;

  /**
   * The conversation itself — every SSE frame, the durable-run and reattach
   * paths, the approval queue and the UI prompt — lives in `@felix/client`, so
   * this component renders it rather than implementing it. One engine per
   * thread, so a run outlives the operator switching away from it: the pool
   * keeps the ones still running and drops the rest. The one on screen is
   * mirrored below; the ports are the three things only a browser can do.
   */
  const poolRef = useRef<EnginePool | null>(null);
  /**
   * When each thread's current or last run started, as this tab saw it. Kept per
   * thread so returning to a run still going reads its real elapsed time rather
   * than starting the clock again at the moment of return.
   */
  const runStartsRef = useRef(new Map<string, number>());
  if (!poolRef.current) {
    poolRef.current = createEnginePool({
      // Bound to `id` for the engine's whole life, never to "the thread on
      // screen": a run kept going after the operator left its thread must post
      // its tool results, take its approvals and write its transcript to its
      // own thread, not to whichever one is showing now (`engine-pool.ts`).
      create: (id) => {
        // The run stays alive on navigation; Stop/disposal cancels only this
        // engine's local tools, never the ones another thread is running.
        let toolController = new AbortController();
        const created = createChatEngine({
          client: felix,
          threadId: () => id,
          clientTools: {
            cancel: () => {
              toolController.abort();
              toolController = new AbortController();
            },
            // `local_open` on a file opens it in this thread's side pane: the
            // engine's own thread, so a run on another thread fills that one's.
            execute: (req) =>
              executeClientTool(
                req,
                (path) => openPaneItem(id, { kind: 'file', path }),
                toolController.signal,
              ),
            // A `local_*` write's before is the browser's file; any other write's
            // is the harness's, on the thread the write is on.
            readForDiff: routedDiffReader(felix, readWorkspaceFile),
          },
          onToolStart: () => {
            if (harnessViewRef.current && threadIdRef.current === id) revealInspector();
          },
          // `open_file`: the agent showing the operator a file from the harness's workspace,
          // opened as the sidebar's *On the harness* tree opens one — in this engine's own
          // thread's pane, so a run on another thread fills that thread's.
          onOpenFile: (path) => openPaneItem(id, { kind: 'file', path, source: 'harness' }),
          /**
           * Re-read the session once a durable run lands.
           *
           * Its stream carried the answer and nothing else — no deltas, no tool
           * frames — so the tool cards, and the workspace zone's "touched this
           * session" list that is derived from them, are empty until something
           * re-reads the harness's own transcript. Before this they stayed empty
           * until the operator happened to reload.
           */
          onDurableComplete: () => hydrateFromServerRef.current(id),
          // Kept so a reload can rejoin the run (`lib/durable-runs.ts`).
          onRunAccepted: (token) => rememberDurableRun(id, token),
          onRunSettled: () => forgetDurableRun(id),
        });
        // Seeded from the thread *the address names*, so the first paint is this
        // thread's transcript rather than an empty one — and, on a deep link, not
        // some other thread's. It used to read a `felix.threadId` key holding the
        // last thread this tab was on, which was the same answer back when that
        // key chose the thread and is the wrong one now that the URL does. That
        // key is no longer written at all: the address is where a thread is
        // remembered, and `migrateLegacy` reads only what a pre-multi-thread
        // build left behind.
        created.setTurns(loadTurns(id));
        return created;
      },
      // A run keeps its thread's exclusive lease until it settles, whether or
      // not the thread is still on screen. The foreground hold is taken by the
      // effect below as before; this second reference is what outlives it.
      onRunStart: (id) => {
        runStartsRef.current.set(id, Date.now());
        return sessionLeases.attach(id);
      },
      onRunEnd: (id, e) => {
        if (id === threadIdRef.current) return;
        // Its last delta was cached on a delay (`onTurns`, below), and the run ending
        // changes no turn to write it sooner: write it now, as the foreground does.
        saveTurns(id, e.state.turns);
        // A run that finished after the operator left: nothing keeps its engine
        // now. Pruned a task later, so the send's own `.then` — which can still
        // rewrite the transcript on a failed outcome — lands before it goes, and
        // through `prune` so a send still on its way to that thread (a pin)
        // keeps it.
        window.setTimeout(() => poolRef.current?.prune(threadIdRef.current), 0);
      },
      // The foreground thread is persisted by the effect below; a run in the
      // background has nobody rendering it, so it writes its own cache.
      onTurns: (id, e) => {
        if (id === threadIdRef.current) return;
        if (e.state.streaming) scheduleSaveTurns(id, () => e.state.turns);
        else saveTurns(id, e.state.turns);
      },
    });
  }
  const pool = poolRef.current;
  const engine = pool.get(threadId);
  /** Threads with a run in flight in this tab, the foreground's included. */
  const poolRuns = useSyncExternalStore(pool.subscribe, pool.runs);
  const askingThreads = useMemo(
    () => new Set(poolRuns.questions.map((q) => q.threadId)),
    [poolRuns.questions],
  );
  const {
    turns,
    error,
    streaming,
    // The stream dropped and we are rejoining the thread. Distinct from
    // `streaming` because it is a materially different claim: the original run
    // was torn down, so this is showing what landed, not a reply still being
    // written.
    reattaching,
    approvals: pendingQueue,
    uiPrompt,
    permissionMode,
  } = useSyncExternalStore(
    // Per frame, not per delta: see `frame-store.ts`. `engine.state` is exact for handlers.
    frameStoreFor(engine).subscribe,
    frameStoreFor(engine).getSnapshot,
  );
  const {
    historyOpen,
    setHistoryOpen,
    inspectorOpen,
    setInspectorOpen,
    pane,
    paneHasItems,
    paneZone,
    revealInspector,
  } = useWorkspacePane({
    threadId,
    threadIdRef,
    turns,
    streaming,
    harnessView,
    threads,
    manifest,
    manifestEntries,
  });
  const onHarnessRef = useRef(onHarness);
  onHarnessRef.current = onHarness;
  // The pane is drawn beside every `/harness` page too (`HarnessLayout`), so opening something
  // there — a skill's editor from its page — stays on that page, in the thread's pane.
  const openInPane = useCallback((item: PaneItemInput) => {
    openPaneItem(threadIdRef.current, item);
  }, []);
  // A note the harness recorded at once (the thread was idle) is in the log, not
  // in this tab's transcript: re-read it so the note shows where it now is —
  // unless a run started meanwhile, whose own frames will carry it.
  const showRecordedNote = useCallback((id: string) => {
    if (threadIdRef.current !== id) return;
    if (!poolRef.current?.get(id)?.state.streaming) hydrateFromServerRef.current(id);
  }, []);

  // The operator's own save, told to the agent so it does not go on working from
  // what it read before. The harness writes the words; the pane says what came of it.
  const tellAgentEdited = useCallback(
    async (edit: {
      path: string;
      op?: 'write' | 'delete' | 'rename';
      bytes?: number;
      toPath?: string;
    }) => {
      const id = threadIdRef.current;
      // A thread that never reached the harness has no agent to tell.
      if (unsentRef.current.has(id)) return 'no-thread' as const;
      try {
        const told = await workspaceEdited({ threadId: id, ...edit });
        if (!told) return 'unsupported' as const;
        if (told.status === 'recorded') showRecordedNote(id);
        return told.status;
      } catch (err) {
        if (err instanceof LeaseRefusedError) return 'watching' as const;
        return 'failed' as const;
      }
    },
    [showRecordedNote],
  );
  // `idle` is the engine's resting value and this renders a chip, so the chip
  // asks for the same thing the old nullable state did: a phase worth showing.
  const sessionPhase = engine.state.phase === 'idle' ? null : engine.state.phase;

  /** Latest turns, for callbacks that must not be rebuilt on every streamed delta. */
  const turnsRef = useRef(turns);
  turnsRef.current = turns;
  /** What `/v1/models` listed, for `loadThread`, which must not rebuild on it. */
  const manifestsRef = useRef(manifests);
  manifestsRef.current = manifests;
  /**
   * Read inside `send`, which is memoised on other things — a ref keeps the
   * "no steering during a reattach" guard correct without rebuilding it.
   */
  const reattachingRef = useRef(reattaching);
  reattachingRef.current = reattaching;
  const { leftApp, dropped, setLeftApp, setDropped } = useRunRecovery(threadId, reattaching);
  const queue = useMessageQueue(threadId);
  useEffect(() => {
    harnessViewRef.current = harnessView;
  }, [harnessView]);

  // Whether the harness answered the last request, for the composer's connection
  // hint. The rails' breakpoints moved to the workbench route with the rails.
  const harnessReachable = useHarnessReachable();

  useEffect(() => {
    // `turns` lags a thread change that came from outside this app's own
    // handlers — Back, or a pasted link — because the engine is not reset until
    // the effect below runs. Writing here would file the *previous* thread's
    // transcript under the new thread's key, and `loadThread` would then read it
    // straight back out as if it belonged there.
    if (loadedThreadRef.current !== threadId) return;
    // Read through the engine rather than through `turns`, which is only the
    // trigger here. React re-runs this effect on mount under StrictMode, and it
    // re-runs the *first* render's closure — so whatever `turns` held then would
    // be written out now, after the guard above has opened. Current state cannot
    // be stale by construction; the captured value can.
    //
    // Empty is written too, as a removal. A refused first message is dropped
    // from the engine, leaving `[]`; skipping that write kept the refused turn
    // and its empty reply in the cache, and a reload put both back on screen.
    //
    // Mid-stream the write is deferred (`scheduleSaveTurns`): this runs per delta,
    // and serialising the whole thread each time cost more than drawing it. The
    // run's end — `streaming` dropping — writes at once and withdraws it.
    if (engine.state.streaming) {
      scheduleSaveTurns(threadId, () => engine.state.turns);
      return;
    }
    const current = engine.state.turns;
    if (current.length) saveTurns(threadId, current);
    else clearTurns(threadId);
  }, [threadId, turns, streaming, engine]);

  /**
   * Operator labels for this thread, keyed by event id — the snapshot's own map.
   * Server-owned like the rest of session state, so switching threads clears it
   * and hydration refills it rather than merging.
   */
  const [labels, setLabels] = useState<Record<string, string>>({});
  /** Ratings of assistant turns, keyed by event id — the snapshot's `feedback`, managed like labels. */
  const [feedback, setFeedback] = useState<Record<string, TurnFeedback>>({});
  /** Edited messages' other versions, by user event id — read off every snapshot. */
  const [branches, setBranches] = useState<Map<string, BranchPoint>>(() => new Map());

  /**
   * Re-read a thread from the harness. With `transcript: false` only the
   * snapshot's side maps (labels, ratings, versions) are taken — for a thread
   * re-adopted with its run still going, whose transcript the snapshot would
   * replace with one missing the reply being written.
   *
   * The transcript goes to that thread's own engine, which may no longer be the
   * one on screen (a durable run that finished in the background); the shell's
   * own state is touched only while the thread is still the one showing.
   */
  /**
   * Pick up the durable run in flight on `id`, if there is one and its engine is idle.
   *
   * The harness says, when it is new enough to (`felix-run/felix#533`): `activeRun` is the
   * run, or null for none — and null also clears this browser's own record, which can only
   * be stale by then. A harness that sends no `activeRun` key cannot say, and the record of
   * a run this browser started is the only answer (`lib/durable-runs.ts`); so is a snapshot
   * that could not be read. Rejoining marks the thread running, so the composer queues
   * rather than sending a message the harness would refuse.
   */
  const rejoinActiveRun = useCallback((id: string, snap: SessionSnapshot | null) => {
    const target = poolRef.current?.peek(id);
    if (!target || target.state.streaming) return;
    let token: string | null;
    if (snap && 'activeRun' in snap) {
      token = snap.activeRun?.resumeToken || null;
      if (!token) forgetDurableRun(id);
    } else {
      token = recallDurableRun(id);
    }
    if (token) void target.rejoinRun(token);
  }, []);

  /** Fold a snapshot (or, without one, the history) into `id`'s engine and side maps. */
  const applySnapshot = useCallback(
    async (id: string, snap: SessionSnapshot | null, withTranscript: boolean): Promise<void> => {
      try {
        // Absent from a harness older than permission modes, which leaves the engine's
        // value (null, the default) alone rather than claiming one.
        if (snap && 'permissionMode' in snap) {
          poolRef.current?.peek(id)?.setPermissionMode(snap.permissionMode ?? null);
        }
        if (snap && id === threadIdRef.current) {
          // Absent from an older harness, which offers no styles: null is the same answer.
          setStoredStyle({ thread: id, style: snap.outputStyle ?? null });
          setLabels(snap.labels ?? {});
          setFeedback(snap.feedback ?? {});
          setBranches(branchPoints(snap));
        }
        if (!withTranscript) return;
        const target = poolRef.current?.peek(id);
        if (snap?.transcript?.length) {
          const rebuilt = eventsToTurns(snapshotToEvents(snap));
          if (rebuilt.length && target) {
            target.setTurns(rebuilt);
            saveTurns(id, rebuilt);
          }
          if (
            id === threadIdRef.current &&
            snap.thinkingLevel &&
            THINKING_LEVELS.includes(snap.thinkingLevel as ThinkingLevel)
          ) {
            setThinkingLevelState(snap.thinkingLevel as ThinkingLevel);
          }
          if (snap.phase) target?.setPhase(snap.phase);
          return;
        }
        const h = await getThreadHistory(id);
        if (!h || h.events.length === 0) return;
        const rebuilt = eventsToTurns(h.events);
        const later = poolRef.current?.peek(id);
        if (rebuilt.length && later) {
          later.setTurns(rebuilt);
          saveTurns(id, rebuilt);
        }
      } catch {
        // local cache remains source of truth
      }
    },
    [],
  );

  const hydrateFromServer = useCallback(
    (id: string, opts: { transcript?: boolean; rejoin?: boolean } = {}) => {
      const withTranscript = opts.transcript ?? true;
      void (async () => {
        const snap = await getSessionSnapshot(id).catch(() => null);
        await applySnapshot(id, snap, withTranscript);
        // After the transcript, so the run's status turn lands below it.
        if (opts.rejoin) rejoinActiveRun(id, snap);
      })();
    },
    [applySnapshot, rejoinActiveRun],
  );
  hydrateFromServerRef.current = hydrateFromServer;

  /**
   * Hydrate on return, but only when the harness holds more of the thread than
   * this tab does — a run that finished somewhere else while the page was away.
   * A rebuild from the snapshot drops local detail the snapshot does not carry
   * (a turn's usage, among others), so an unconditional one on every return
   * would cost the tab what it already had to learn nothing new.
   */
  const hydrateIfAhead = useCallback(
    async (id: string, opts: { rejoin?: boolean } = {}) => {
      const snap = await getSessionSnapshot(id).catch(() => null);
      const target = poolRef.current?.peek(id);
      if (snap?.transcript?.length && id === threadIdRef.current && target) {
        const rebuilt = eventsToTurns(snapshotToEvents(snap));
        if (rebuilt.length > target.state.turns.length && !target.state.streaming) {
          target.setTurns(rebuilt);
          saveTurns(id, rebuilt);
          if (snap.phase) target.setPhase(snap.phase);
        }
      }
      // Coming back to a thread a run started on while the page was away — from another
      // tab, or the terminal — is the same as loading it: watch the run rather than offer
      // to send. After the rebuild, so the run's status turn lands below it.
      if (opts.rejoin && snap && id === threadIdRef.current) rejoinActiveRun(id, snap);
    },
    [rejoinActiveRun],
  );

  /**
   * Re-read the thread when this tab starts or stops watching it. Starting: what
   * is on screen may be this tab's own idea of a thread another client has since
   * moved on. Stopping is the takeover, and the driver may have written a reply
   * since the last poll below.
   */
  const watchedRef = useRef<{ threadId: string; watching: boolean } | null>(null);
  useEffect(() => {
    const previous = watchedRef.current;
    watchedRef.current = { threadId, watching };
    if (previous?.threadId === threadId && previous.watching !== watching) {
      hydrateFromServer(threadId);
    }
  }, [threadId, watching, hydrateFromServer]);
  /** Follow the driver while watching: only when the harness holds more than this tab shows. */
  useEffect(() => {
    if (!watching) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') void hydrateIfAhead(threadIdRef.current);
    }, WATCH_POLL_MS);
    return () => window.clearInterval(timer);
  }, [watching, hydrateIfAhead]);

  // Mount-only: storage migration and the thread index. Everything thread-scoped
  // is `loadThread`'s, below, because it now has more than one way to happen.
  useEffect(() => {
    migrateLegacy(Date.now());
    void refreshThreads();
  }, []);

  // Exclusive lease while this tab is attached to a thread — but not to one it
  // made up and has not sent to: the harness has never heard of that thread, and
  // asking for its lease is what files it as a session (see `unsentRef`).
  useEffect(() => {
    if (!leaseable) return;
    return sessionLeases.attach(threadId);
  }, [threadId, leaseable]);

  const stopRun = useCallback(() => {
    const tid = threadIdRef.current;
    // Nothing runs on a thread nothing was sent to, and `/chat/abort` writes the
    // thread's phase — so aborting one would file it as an empty session.
    if (!unsentRef.current.has(tid)) void abortChat(tid).catch(() => {});
    engine.abort();
    engine.setPhase('aborted');
    // Stop means stop: the next queued message must not go out on its own the
    // moment the run it was queued behind has been ended on purpose.
    queue.setPaused(true);
  }, [engine, queue.setPaused]);

  /**
   * Point the engine at a thread: local cache first, server snapshot behind it.
   *
   * A thread change now has three ways to happen — the rail, Back/Forward, and a
   * pasted link — so the work lives here once rather than in the handler for the
   * one of them that used to exist. `loadedThreadRef` is what makes it idempotent:
   * the handlers below call it synchronously so the transcript never renders a
   * frame of the previous thread under the new address, and the effect that
   * catches the other two paths then finds the work already done.
   */
  const loadThread = useCallback(
    (id: string, hydrate = true) => {
      if (loadedThreadRef.current === id) return;
      loadedThreadRef.current = id;
      const target = pool.get(id);
      // A run still going on this thread from before the operator left it is
      // re-adopted as it stands: its engine has been reading the stream all
      // along, and a reset or a snapshot rebuild would throw away the reply
      // being written.
      const running = target.state.streaming;
      if (!running) {
        target.reset();
        target.setTurns(loadTurns(id));
      }
      // The picker is where the next message goes, so on a thread this browser
      // has sent to it names the agent the thread last ran on rather than
      // whichever one the previous thread used. The local index is the only
      // record: the harness keeps no manifest per thread, so a thread first seen
      // from elsewhere has none and keeps the current selection (the composer
      // says so). A recorded agent this harness does not list is not restored —
      // the picker would draw its first option while the send carried the other.
      const recorded = (listThreads().find((t) => t.id === id)?.manifest ?? '').trim();
      const served = manifestsRef.current;
      if (recorded && (served.length === 0 || served.includes(recorded))) {
        setManifest(recorded);
      }
      // Server-owned like the rest of session state, so this clears and
      // hydration refills it rather than merging.
      setLabels({});
      setFeedback({});
      setBranches(new Map());
      // A durable run still going on this thread — after a reload, or started by another
      // tab or client — is rejoined once the snapshot says so (`rejoinActiveRun`).
      if (hydrate || running) hydrateFromServer(id, { transcript: !running, rejoin: !running });
    },
    [pool, hydrateFromServer],
  );

  useEffect(() => {
    // A thread reached by link or by Back has server state worth asking for; one
    // `/` minted a moment ago does not.
    loadThread(threadId, routeThread !== null);
  }, [threadId, routeThread, loadThread]);

  /**
   * Engines with nothing in flight go as soon as their thread is off screen; a
   * live run stays in the pool, still streaming and answering, until it settles.
   */
  useEffect(() => {
    pool.prune(threadId);
  }, [pool, threadId]);

  /**
   * Hold a thread through the gap before its run starts — an image upload, a
   * regenerate's history reset — so leaving it meanwhile neither drops its
   * engine (the run would start on an orphan nothing tracks) nor lets go of its
   * lease (the run would start unleased while the pool re-acquired one). Once
   * the run is streaming the pool holds both itself. Idempotent release.
   */
  const holdThread = useCallback(
    (id: string) => {
      const unpin = pool.pin(id);
      // A thread nothing has been sent to is not leased yet, and must not be:
      // asking about it is what files it on the harness (`unsentRef`).
      const unlease = unsentRef.current.has(id) ? () => {} : sessionLeases.attach(id);
      let done = false;
      return () => {
        if (done) return;
        done = true;
        unlease();
        unpin();
      };
    },
    [pool],
  );

  /**
   * Leaving a thread does not stop its run. It used to — both of these called
   * `stopRun` first, so clicking another conversation in the sidebar posted
   * `/chat/abort` on the one that was working — and merely hanging up would be
   * no better, because the harness tears down a run whose client closes the
   * stream. The run's engine stays in the pool instead, bound to its thread;
   * Stop is the only thing that stops it.
   */
  const newThread = useCallback(() => {
    const id = mint();
    // Nothing to hydrate: the id was minted a line ago, so the snapshot request
    // would be a round trip to be told the thread does not exist yet.
    loadThread(id, false);
    navigate(`/t/${id}`);
  }, [mint, loadThread, navigate]);

  /**
   * The threads this tab has shown, most recent last — so deleting the one on
   * screen goes back to where the operator came from, not to whichever thread
   * happens to be newest.
   */
  const visitedRef = useRef<string[]>([]);
  useEffect(() => {
    if (!threadId) return;
    visitedRef.current = [...visitedRef.current.filter((v) => v !== threadId), threadId].slice(-20);
  }, [threadId]);

  const selectThread = useCallback(
    (id: string) => {
      if (id === threadId) return;
      loadThread(id);
      navigate(`/t/${id}`);
    },
    [threadId, loadThread, navigate],
  );

  /** POST /chat/sessions/name — a durable name, replacing the derived title. */
  const renameThread = useCallback(
    (id: string, name: string) => {
      void renameSession(id, name)
        .then(() => refreshThreads())
        .catch((err) =>
          toastError(err, 'rename this thread', { retry: () => renameThread(id, name) }),
        );
    },
    [refreshThreads],
  );

  /**
   * POST /chat/fork — copy this thread into a new one and switch to it.
   *
   * Unlike rewind, the original is untouched: this is for taking a conversation
   * in a second direction while keeping the first.
   */
  const forkThread = useCallback(
    (id: string) => {
      const newId = crypto.randomUUID();
      void forkSession({ threadId: id, newThreadId: newId })
        .then(async () => {
          const meta = threads.find((t) => t.id === id);
          indexThread({
            id: newId,
            manifest: meta?.manifest || manifest,
            title: `${meta?.title ?? 'Conversation'} (copy)`,
            updatedAt: Date.now(),
          });
          await refreshThreads();
          // No toast: `selectThread` moves the whole surface to the copy, and the
          // rail shows it selected and named. Announcing a change of view on top
          // of performing one is the redundancy this pass is removing.
          selectThread(newId);
        })
        // A failed fork leaves nothing behind, so retrying is safe; it mints a
        // fresh id rather than reusing the one that failed.
        .catch((err) => toastError(err, 'fork this thread', { retry: () => forkThread(id) }));
    },
    [threads, manifest, refreshThreads, selectThread],
  );

  /**
   * POST /chat/compact — summarise older context now instead of waiting for the
   * loop to do it when the window fills.
   */
  const compactThread = useCallback(
    (id: string) => {
      const target = threads.find((t) => t.id === id);
      // Driven by hand rather than through `toast.promise`, which takes one
      // `duration` for all three of its states: the only way to let the failure
      // persist there is to leave the success on screen forever too. The failure
      // is the state worth reading, and it is the one that carries a detail
      // string, so it goes through the same reporter as every other error.
      const pending = toast.loading('Compacting…');
      void compactSession(id, target?.manifest || manifest)
        .then((outcome) => {
          const said = describeCompaction(outcome);
          if (outcome === 'compacted') toast.success(said, { id: pending });
          else toast.message(said, { id: pending });
        })
        .catch((err) => {
          toast.dismiss(pending);
          // No retry: a compact that failed part-way may still have written a
          // summary, and running it again would summarise the summary.
          toastError(err, 'compact this thread');
        });
    },
    [threads, manifest],
  );

  /** GET /chat/sessions/{id}/export — hand the active branch to the user as a file. */
  const exportThread = useCallback((id: string) => {
    void exportSession(id)
      .then((jsonl) => saveText(jsonl, `${id}.jsonl`))
      .catch((err) => toastError(err, 'export this thread', { retry: () => exportThread(id) }));
  }, []);

  const deleteThread = useCallback(
    (id: string) => {
      // Capture enough to put it back before anything is destroyed.
      const meta = listThreads().find((t) => t.id === id);
      const turns = loadTurns(id);
      // `removeThread` drops the pin, so Undo has to know there was one.
      const wasPinned = readPins().has(id);
      const label = meta ? threadLabel(meta) : null;
      const name = label && !label.isId ? `“${label.text.slice(0, 40)}”` : 'Thread';

      // Deleting a conversation does stop its run, wherever it is: on screen,
      // or kept going in the background after the operator left it. Dropped
      // from the pool first, so the abort's last emits do not write the deleted
      // transcript back into the cache.
      const running = pool.peek(id);
      if (running?.state.streaming) {
        pool.drop(id);
        void abortChat(id).catch(() => {});
        running.abort();
      }

      removeThread(id);
      forgetIndexedThread(id);
      const remaining = withRememberedIndex(listThreads());
      setThreads(remaining);
      if (id === threadId) {
        const back = [...visitedRef.current]
          .reverse()
          .find((v) => v !== id && remaining.some((t) => t.id === v));
        if (back) selectThread(back);
        else if (remaining.length) selectThread(remaining[0].id);
        else newThread();
      }

      // The server copy is the part that cannot be undone, so it is held back for
      // the length of the toast rather than fired now. Undo cancels it; letting the
      // window elapse commits it. A tab closed mid-window leaves the server
      // transcript behind, which is the safe direction to fail in.
      //
      // `committed` is set by the very timer Undo is racing, rather than compared
      // against a deadline, because the two clocks do not run together: sonner
      // pauses a toast's dismiss timer while the pointer is over it, and this one
      // does not pause. Hovering the toast for a moment and then clicking Undo
      // therefore landed *after* the delete had already gone to the harness. The
      // thread came back in the rail from the local copy with its server
      // transcript gone, and nothing on screen said so.
      let committed = false;
      const commit = window.setTimeout(() => {
        committed = true;
        // Said, not swallowed: a delete the harness refused leaves the thread
        // there, and it would come back in the rail on the next refresh with
        // nothing to say why.
        void deleteThreadHistory(id, { reportFailure: true }).catch((err) => {
          toastError(err, 'delete this thread on the harness', {
            retry: () => void deleteThreadHistory(id).catch(() => {}),
          });
          void refreshThreads();
        });
      }, DELETE_UNDO_MS);

      toast(`${name} deleted`, {
        duration: DELETE_UNDO_MS,
        action: {
          label: 'Undo',
          onClick: () => {
            if (committed) {
              toastProblem('Too late to undo. This thread was already deleted on the harness.');
              return;
            }
            window.clearTimeout(commit);
            if (meta) indexThread(meta);
            if (turns.length) saveTurns(id, turns);
            if (wasPinned) writePins([...readPins(), id]);
            void refreshThreads();
          },
        },
      });
    },
    [pool, threadId, selectThread, newThread],
  );

  /**
   * Open one turn: stream model deltas and tool events into the assistant turn
   * identified by `assistantId`. Shared by `send` (a new user message) and
   * `regenerate` (replays prior history).
   *
   * Everything this used to do inline — the frame switch, the durable-run
   * fallback, the reattach after a dropped stream — is the engine's, and the
   * engine is not rebuilt when the manifest changes, so the value is read at
   * call time.
   */
  const streamInto = useCallback(
    (
      messagesToSend: ChatMessage[],
      assistantId: string,
      mode: 'stream' | 'background' = 'stream',
      idempotencyKey?: string,
    ) => {
      // The thread this closure was built for is the one the message was
      // written on — not necessarily the one showing, since an upload or a
      // history reset can sit between the click and this call while the
      // operator moves on. Everything below is that thread's: marking the new
      // thread sent would file it as an empty session on the harness.
      if (threadIdRef.current === threadId) {
        setLeftApp(false);
        setDropped(false);
      }
      markSent(threadId);
      // The pool's engine for that thread, which the caller's pin kept there.
      return pool.get(threadId).send({
        manifest,
        messages: messagesToSend,
        assistantId,
        mode,
        ...(idempotencyKey ? { idempotencyKey } : {}),
      });
    },
    [pool, threadId, manifest, markSent],
  );

  const { pending, bannerOwned, tenantApprovals, onDecide, onDismiss } = useRunApprovals({
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
  });

  const runClock = useRunClock({ streaming, threadId, threadIdRef, pool, runStartsRef });

  /**
   * The keyboard layer. What each key means, and when it means nothing, is
   * `route()` in `src/lib/navigation/shortcuts.ts`; this is only what each action does.
   *
   * The targets are found by `data-` hooks rather than lifted state, because the
   * thing each binding reaches for already owns its open state — the thread
   * popover in the workspace zone, the queue in the attention line — and
   * clicking the real trigger means the shortcut and the pointer take exactly
   * the same path. A binding that opened a copy of the state would be a second
   * way for the two to disagree.
   */
  useVisualViewport();

  usePushNavigation(navigate);
  useShortcuts(onHarness ? 'harness' : 'workbench', {
    'toggle-workspace': () => setHistoryOpen((o) => !o),
    // The right zone's binding. In harness view it is the instrument's — which
    // hands the zone to and from the side pane where they share it — except over
    // the pane's own overlay on a phone, which the binding closes. Everyday, there
    // is no instrument, so it shows and hides the pane.
    'toggle-instrument': () => {
      const id = threadIdRef.current;
      const { hasItems, inline } = paneZone.current;
      const paneShown = paneState(id).shown && hasItems;
      // `/harness` has no instrument: there the binding is the pane's at every level.
      if (harnessViewRef.current && !onHarnessRef.current && !(paneShown && !inline)) {
        setInspectorOpen((o) => !o);
      } else if (hasItems) setPaneShown(id, !paneShown);
    },
    'open-threads': () => {
      // The search lives in the sidebar, so it has to be open first — expanded
      // inline or as the drawer, whichever this width gets.
      setHistoryOpen(true);
      whenMounted('[data-shortcut-target="thread-search"]', (el) => el.focus());
    },
    'focus-composer': () => {
      document.querySelector<HTMLElement>('[data-shortcut-target="composer"]')?.focus();
    },
    'focus-approval': () => {
      // The banner first: an approval that reached it came by frame, and the
      // banner can draw a write's before/after where a queue row cannot.
      const banner = '[data-approval-focus="banner"]';
      const queued = '[data-approval-focus="queue"]';
      const focus = (el: HTMLElement) => el.focus();
      const onScreen = document.querySelector<HTMLElement>(banner);
      if (onScreen) return focus(onScreen);
      // On `/harness` the attention line leaves the banner's approval out of its
      // queue, so the only place to decide it with the diff is back on the thread.
      if (pendingQueue.length > 0 && onHarness) {
        navigate(`/t/${threadId}`);
        return whenMounted(banner, focus);
      }
      const inQueue = document.querySelector<HTMLElement>(queued);
      if (inQueue) return focus(inQueue);
      const review = document.querySelector<HTMLElement>('[data-shortcut="review-approvals"]');
      if (review) {
        review.click();
        return whenMounted(queued, focus);
      }
      // Said rather than swallowed: a key that silently does nothing reads as
      // a broken key, not as an empty queue.
      toast.message('Nothing is waiting on you.');
    },
  });

  const send = useCallback(
    (
      text: string,
      attachments?: ImageAttachment[],
      mode: 'stream' | 'background' = 'stream',
      idempotencyKey?: string,
    ) => {
      // A reattach keeps `streaming` true, but there is no run to steer — this
      // one was torn down when the connection dropped. Queueing a steer here
      // would report "Steer queued" and then sit unread until some later turn
      // drained it, which is worse than declining.
      if (reattachingRef.current) {
        toast.message(REATTACHING_REFUSAL);
        return;
      }
      if (streaming) {
        if (text.trim()) {
          void steerChat({ threadId, text: text.trim() })
            .then(() => toast.message('Steer queued'))
            // No retry: a steer that failed on the response rather than the
            // request would queue the same message into the run twice.
            .catch((err) => toastError(err, 'queue that steer'));
        }
        return;
      }
      const hasAttachments = !!attachments && attachments.length > 0;
      if (!text.trim() && !hasAttachments) return;
      engine.setError(null);
      const userTurn: Turn = {
        id: crypto.randomUUID(),
        role: 'user',
        content: text,
        ...(hasAttachments ? { attachments } : {}),
      };
      const assistantId = crypto.randomUUID();
      // The engine's transcript as it stands, not the render's `turns`: the
      // composer is memoised without its callbacks (`MultimodalInput`), so this
      // can be a closure from several renders ago. Anything that changed the
      // transcript without re-rendering the composer — a snapshot rebuild after
      // the side pane told the agent about an edit, a return's `hydrateIfAhead` —
      // was dropped by the next send, which wrote the stale list back.
      const before = engine.state.turns;
      const firstTurn = before.length === 0;
      engine.setTurns([
        ...before,
        userTurn,
        { id: assistantId, role: 'assistant', content: '', tools: [] },
      ]);

      // Surface the thread in the sidebar immediately (title from the first
      // user message); refresh the index only at this boundary, not per token.
      const fallbackTitle = titleFromText(text || (hasAttachments ? '📎 Image' : ''));
      indexThread({
        id: threadId,
        manifest,
        title: firstTurn
          ? fallbackTitle
          : (threads.find((t) => t.id === threadId)?.title ?? fallbackTitle),
        updatedAt: Date.now(),
      });
      void refreshThreads();

      // Steady state: send only the new user message; Felix replays the thread.
      const userMessage: ChatMessage = { role: 'user', content: text };
      if (hasAttachments) userMessage.attachments = attachments;
      return streamInto([userMessage], assistantId, mode, idempotencyKey).then((outcome) => {
        // The harness never took it: another client drives the thread. The turn
        // on screen would read as sent until the next hydrate quietly dropped it,
        // so it goes now, and whoever holds the message gives it back.
        // Refused for a run already going on the thread: the same — it never landed — and
        // the engine is now watching that run.
        if (outcome === 'lease_refused' || outcome === 'run_in_progress' || outcome === 'refused') {
          engine.setTurns(engine.state.turns.filter((t) => t.id !== userTurn.id));
        }
        // It may or may not have landed, and the message is going back to whoever
        // holds it. The attempt goes from the transcript with it — whatever it had
        // streamed included — so the message is in one place at a time, and a
        // resend's replay is what shows what the harness actually kept.
        if (outcome === 'failed' || outcome === 'key_reused') engine.setTurns(before);
        return outcome;
      });
    },
    [engine, streaming, manifest, threadId, threads, streamInto],
  );

  // Re-run the last assistant turn. Felix's session log is append-only, so a
  // bare re-send would duplicate the prior turn; instead we reset the server
  // log and replay the full transcript up to (and including) the prompting
  // user turn, then stream a fresh answer in place of the old one.
  const regenerate = useCallback(() => {
    if (streaming) return;
    const lastAssistant = turns.length - 1;
    if (lastAssistant < 0 || turns[lastAssistant].role !== 'assistant') return;
    engine.setError(null);

    const replay = turns.slice(0, lastAssistant);
    // A note is not replayed. It came through `/chat/sessions/custom`, not the
    // conversation, and re-sending it as a message would turn an annotation the
    // model never saw into one it does. The cost: the reset below erases it from
    // the log, in-context or not, the same way it erases every tool result.
    const messagesToSend: ChatMessage[] = replay.flatMap((t) =>
      t.role !== 'note' && t.content.trim().length > 0
        ? [{ role: t.role, content: t.content }]
        : [],
    );
    if (messagesToSend.length === 0) return;

    const assistantId = crypto.randomUUID();
    engine.setTurns([...replay, { id: assistantId, role: 'assistant', content: '', tools: [] }]);

    // Reset the server log first so the replayed history isn't double-counted,
    // then stream. Best-effort: an anonymous prod caller can't reset history,
    // but the local transcript stays the source of truth either way.
    // Pinned through the reset: switching threads while it is on the wire must
    // not drop the engine the run is about to start on.
    const unpin = holdThread(threadId);
    void deleteThreadHistory(threadId)
      .then(() => {
        const run = streamInto(messagesToSend, assistantId);
        unpin();
        return run;
      })
      .catch(unpin);
  }, [engine, streaming, turns, threadId, streamInto, holdThread]);

  // Clear the current conversation in place (keeps the thread id; best-effort
  // server reset). Distinct from "New thread" which mints a fresh id.
  const clearThread = useCallback(() => {
    stopRun();
    engine.reset();
    void deleteThreadHistory(threadId);
    clearTurns(threadId);
  }, [engine, threadId, stopRun]);

  const continueRun = useCallback(() => {
    if (streaming) return;
    // `/continue` reaches here too: say why there is nothing to pick up rather than
    // spend a request on the harness's `already_complete`.
    const offer = continueOffer(engine.state.turns, engine.state.phase, engine.state.error);
    if (!offer.ok) {
      toast.message(offer.reason);
      return;
    }
    void continueChat({ threadId, manifest })
      .then(() => {
        toast.message('Continued');
        hydrateFromServer(threadId);
        engine.setPhase('idle');
      })
      // No retry: continuing twice starts a second run on the same thread.
      .catch((err) => toastError(err, 'continue this run'));
  }, [streaming, threadId, manifest, hydrateFromServer, engine]);
  const continueAvailable = continueOffer(turns, engine.state.phase, error);
  /**
   * Kept, where `chooseThinking` drops its toast.
   *
   * This is `/think`, a blind cycle: the composer's Thinking picker shows the
   * level, but the operator is looking at the text they typed rather than the
   * toolbar under it, so the cycle says where it landed.
   *
   * The thread comes from `threadIdRef` rather than the closure for the same
   * reason as `chooseThinking` below: this reaches the composer through
   * `onSlashCommand`, and the composer's memo can hold a stale callback.
   */
  const cycleThinking = useCallback(() => {
    const idx = THINKING_LEVELS.indexOf(thinkingLevel);
    const next = THINKING_LEVELS[(idx + 1) % THINKING_LEVELS.length] ?? 'off';
    setThinkingLevelState(next);
    void setThinkingLevel({ threadId: threadIdRef.current, thinkingLevel: next })
      .then(() => toast.message(`Thinking: ${next}`))
      .catch((err) =>
        toastError(err, 'change the thinking level', { retry: () => chooseThinking(next) }),
      );
  }, [thinkingLevel]);

  /**
   * Set the level from the composer's Thinking picker.
   *
   * No toast: the picker shows the selection at the moment of the click and
   * carries it afterwards. `cycleThinking` above keeps its toast for the
   * opposite reason.
   *
   * Reads the thread through `threadIdRef`. `MultimodalInput` is memoised with a
   * comparator that ignores callbacks, so the composer can hold this function
   * across a thread change; closing over `threadId` would set the level on the
   * thread the operator just left.
   */
  const chooseThinking = useCallback((level: ThinkingLevel) => {
    setThinkingLevelState(level);
    void setThinkingLevel({ threadId: threadIdRef.current, thinkingLevel: level }).catch((err) =>
      toastError(err, 'change the thinking level', { retry: () => chooseThinking(level) }),
    );
  }, []);

  /**
   * Store a permission mode on the thread on screen, from its next run. Shown at
   * once and put back if the harness refuses it. Thread and engine are read at
   * call time, for the composer's memo as with `chooseThinking`.
   */
  const choosePermissionMode = useCallback((mode: 'default' | 'plan') => {
    const id = threadIdRef.current;
    const target = poolRef.current?.peek(id);
    const before = target?.state.permissionMode ?? null;
    target?.setPermissionMode(mode);
    setPermissionMode({ threadId: id, mode })
      .then(() =>
        toast.message(mode === 'plan' ? 'Plan mode' : 'Left plan mode', {
          description:
            mode === 'plan'
              ? 'From the next run the agent only reads and proposes, and asks you to approve its plan before it changes anything.'
              : 'From the next run the agent works as its manifest says.',
        }),
      )
      .catch((err) => {
        target?.setPermissionMode(before);
        toastError(err, 'change the permission mode', {
          retry: () => choosePermissionMode(mode),
        });
      });
  }, []);

  /**
   * Store an output style on the thread on screen, from its next run, checked against the
   * agent selected for the next message. Shown at once and put back if the harness refuses
   * it. Thread and agent are read at call time, for the composer's memo.
   */
  const chooseOutputStyle = useCallback((style: string | null) => {
    const id = threadIdRef.current;
    let before: string | null = null;
    setStoredStyle((was) => {
      before = was.thread === id ? was.style : null;
      return { thread: id, style };
    });
    setOutputStyle({ threadId: id, manifest: manifestRef.current, style }).catch((err) => {
      setStoredStyle((was) => (was.thread === id ? { thread: id, style: before } : was));
      toastError(err, 'change the output style', { retry: () => chooseOutputStyle(style) });
    });
  }, []);

  const { side, askAboutThread, dismissSideQuestion } = useSideQuestion(threadIdRef, unsentRef);

  /** `/plan`: into plan mode, or back out of it. */
  const togglePlanMode = useCallback(() => {
    const current = poolRef.current?.peek(threadIdRef.current)?.state.permissionMode ?? null;
    choosePermissionMode(current === 'plan' ? 'default' : 'plan');
  }, [choosePermissionMode]);

  /**
   * Put the thread id on the clipboard.
   *
   * It is the one identifier the harness, its logs and the `/harness` pages all
   * key on, and the menu used to show it as a disabled row nothing could be
   * copied out of. The toast is the confirmation, because a menu closes on
   * select and leaves nothing on screen to change.
   */
  const copyThreadId = useCallback(() => {
    const failed = () => toastProblem('Could not copy the thread id: the browser refused.');
    if (!navigator.clipboard) return failed();
    void navigator.clipboard
      .writeText(threadId)
      .then(() => toast.message('Thread id copied', { description: threadId }))
      .catch(failed);
  }, [threadId]);

  /**
   * Move the thread's active leaf back to an earlier turn.
   *
   * This is the third irreversible-looking action in the app, and it used to be the
   * only one with no guard at all: a hover icon, a two-word tooltip, and everything
   * after the target vanished from the transcript.
   *
   * It gets an undo rather than a confirm, because the harness makes one possible.
   * `rewind_to` only requires that the target event exists on the session, not that
   * it is an ancestor of the current leaf, so the pointer can be moved forward again
   * to exactly where it was. Nothing is deleted by a rewind; the later events stay on
   * the session and simply stop being on the active branch.
   */
  /**
   * Name a turn, or clear the name.
   *
   * Optimistic, and deliberately so: the map is the operator's own annotation
   * rather than anything the agent reads, so the cost of showing it a moment
   * early is nothing, and the cost of waiting is a control that feels broken.
   * A failure puts the previous value back and says why.
   */
  const labelTurn = useCallback(
    (eventId: string, label: string | null) => {
      const previous = labels;
      setLabels((current) => {
        const next = { ...current };
        if (label === null) delete next[eventId];
        else next[eventId] = label;
        return next;
      });
      void setSessionLabel({ threadId, eventId, label }).catch((err) => {
        setLabels(previous);
        toastError(err, 'label this message', { retry: () => labelTurn(eventId, label) });
      });
    },
    [labels, threadId],
  );

  /**
   * The server's event id for a local turn, fetching the snapshot when the turn
   * has none — a reply written in this tab carries no ids until the thread is
   * re-read. Matched by position among turns of the same role; a count that
   * disagrees means the two transcripts have diverged, and that is `null` rather
   * than a guess at which turn was meant.
   */
  const serverEventId = useCallback(
    async (turnId: string): Promise<string | null> => {
      const local = turnsRef.current;
      const index = local.findIndex((t) => t.id === turnId);
      const turn = local[index];
      if (!turn) return null;
      if (turn.eventId) return turn.eventId;
      const snap = await getSessionSnapshot(threadId);
      const server = snap?.transcript?.length ? eventsToTurns(snapshotToEvents(snap)) : [];
      const sameRole = (ts: Turn[]) => ts.filter((t) => t.role === turn.role);
      if (sameRole(server).length !== sameRole(local).length) return null;
      const ordinal = sameRole(local.slice(0, index)).length;
      return sameRole(server)[ordinal]?.eventId ?? null;
    },
    [threadId],
  );

  /**
   * Rate an answer, or clear the rating with `null`. Optimistic, like a label: the
   * rating is the operator's own annotation, so showing it a moment early costs
   * nothing and waiting would feel broken.
   *
   * With `evalDataset` and a note, a thumbs-down also becomes an eval case: the
   * question that produced the answer, judged against what the person said was
   * wrong. Without a note there is nothing to judge against, so no case is made.
   */
  const rateTurn = useCallback(
    async (
      turnId: string,
      rating: 'up' | 'down' | null,
      opts: { note?: string; evalDataset?: string } = {},
    ) => {
      const eventId = await serverEventId(turnId).catch(() => null);
      if (!eventId) {
        toast.message(
          'This answer is not on the harness yet, or the thread changed. Reload and try again.',
        );
        return;
      }
      const note = opts.note?.trim() ?? '';
      const previous = feedback;
      setFeedback((current) => {
        const next = { ...current };
        if (rating === null) delete next[eventId];
        else next[eventId] = { rating, ...(note ? { note } : {}), at: Date.now() };
        return next;
      });
      try {
        await setSessionFeedback({ threadId, eventId, rating, ...(note ? { note } : {}) });
      } catch (err) {
        setFeedback(previous);
        toastError(err, 'save that rating', { retry: () => void rateTurn(turnId, rating, opts) });
        return;
      }

      if (rating !== 'down' || !note || !opts.evalDataset) return;
      const local = turnsRef.current;
      const at = local.findIndex((t) => t.id === turnId);
      const question = [...local.slice(0, Math.max(at, 0))]
        .reverse()
        .find((t) => t.role === 'user');
      if (!question?.content.trim()) {
        toast.message('Rating saved. No question before this answer to make an eval case from.');
        return;
      }
      const item = {
        user_input: question.content.trim(),
        rubric: {
          llm_judge: true,
          judge_criteria: `A person marked an earlier answer to this down, saying: "${note}". Pass only if the answer does not have that problem.`,
        },
      };
      const dataset = opts.evalDataset;
      try {
        const exists = await getEvalDataset(dataset).then(
          () => true,
          (err: unknown) => {
            if (/:\s*404\b/.test(String((err as Error)?.message))) return false;
            throw err;
          },
        );
        if (exists) await addEvalItem(dataset, item);
        else await putEvalDataset(dataset, 'Answers people marked down in chat.', [item]);
        toast.message(`Rating saved, and added as a case to ${dataset}.`);
      } catch (err) {
        toastError(err, `add the case to ${dataset}`);
      }
    },
    [feedback, serverEventId, threadId],
  );

  /**
   * Whether a rewind puts back the files on the turns it sets aside. Only asked when there are
   * some the harness recorded: an agent's own thread workspace, written by its file tools.
   * Elsewhere a rewind stays one click, and settles as `keep`, which is what it always did.
   */
  const [fileQuestion, setFileQuestion] = useState<{
    files: number;
    answer: (answer: RewindFilesAnswer) => void;
  } | null>(null);
  // Read through a ref so this never changes: `rewindTo` and `editTurn` take it, and a new
  // identity for them on each thread refresh lays out every finished turn again mid-stream.
  const fileContext = useRef({ threads, threadId, manifest, manifestEntries });
  fileContext.current = { threads, threadId, manifest, manifestEntries };
  const askAboutFiles = useCallback((abandoned: readonly Turn[]): Promise<RewindFilesAnswer> => {
    const now = fileContext.current;
    const agent = now.threads.find((t) => t.id === now.threadId)?.manifest?.trim() || now.manifest;
    const workspace = now.manifestEntries.find((m) => m.id === agent)?.workspace;
    const recorded =
      workspace?.scope === 'thread' && (workspace.tools === 'server' || workspace.tools === 'both');
    const files = recorded ? recordedFileChanges(abandoned) : 0;
    if (files === 0) return Promise.resolve('keep');
    return new Promise((resolve) => setFileQuestion({ files, answer: resolve }));
  }, []);

  const rewindingRef = useRef(false);
  const rewindTo = useCallback(
    (eventId: string) => {
      if (streaming || rewindingRef.current) return;

      // Where we are now, so undo has somewhere to go, and how much the rewind hides.
      const currentTurns = turnsRef.current;
      const targetIndex = currentTurns.findIndex((t) => t.eventId === eventId);
      const previousLeaf = [...currentTurns].reverse().find((t) => t.eventId)?.eventId ?? null;
      const hidden = targetIndex >= 0 ? currentTurns.length - 1 - targetIndex : 0;
      const canUndo = previousLeaf != null && previousLeaf !== eventId;

      rewindingRef.current = true;
      void (async () => {
        try {
          const choice = await askAboutFiles(currentTurns.slice(targetIndex + 1));
          if (choice === 'cancel') return;
          const restoreFiles = choice === 'restore';
          const { files } = await rewindChat({
            threadId,
            eventId,
            summarize: false,
            manifest,
            ...(restoreFiles ? { restoreFiles } : {}),
          });
          hydrateFromServer(threadId);
          const said =
            hidden > 0
              ? `Rewound. ${hidden} later ${hidden === 1 ? 'turn is' : 'turns are'} off the active branch.`
              : 'Rewound to this message.';
          if (restoreFiles) {
            // No Undo: it would bring the turns back and not the files, leaving a transcript
            // that claims writes which are no longer there.
            window.dispatchEvent(new Event(WORKSPACE_WRITTEN));
            reportRestoredFiles(said, files);
            return;
          }
          toast.message(
            said,
            canUndo
              ? {
                  action: {
                    label: 'Undo',
                    onClick: () => {
                      void rewindChat({
                        threadId,
                        eventId: previousLeaf,
                        summarize: false,
                        manifest,
                      })
                        .then(() => hydrateFromServer(threadId))
                        .catch((err) => toastError(err, 'undo the rewind'));
                    },
                  },
                }
              : undefined,
          );
        } catch (err) {
          toastError(err, 'rewind this thread', { retry: () => rewindTo(eventId) });
        } finally {
          rewindingRef.current = false;
        }
      })();
    },
    [streaming, threadId, manifest, hydrateFromServer, askAboutFiles],
  );

  /**
   * Replace a sent message with new text and run from there.
   *
   * Rewind and send, composed: the leaf moves to the event the original message
   * continued from, and the new text is appended as its sibling — so the model
   * sees the conversation as if the original had never been sent, and the
   * original and everything after it stay on the session on another branch. That
   * is what makes it undoable, the same way a rewind is.
   *
   * The parent is only known from a snapshot, and a message sent in this tab has
   * none yet, so this hydrates first when it has to. The n-th user turn locally is
   * the n-th on the snapshot's active branch; a count that disagrees means the two
   * have diverged and the edit refuses rather than guessing which message was meant.
   */
  /**
   * After an edit's run: learn the versions it created, without a rebuild.
   *
   * The switcher reads `branchPoints` off a snapshot and is keyed by the user
   * message's event id, which a message sent in this tab does not have — so on
   * the live check the edited turn showed no `‹ 2 of 2 ›` until a reload. A full
   * hydrate would supply both but discards detail only this tab holds (a run's
   * live reasoning, its unsaved tool output), so this stamps the server's ids onto
   * the local user turns by position, the same ordinal match the edit itself
   * uses, and refuses when the counts disagree rather than guessing.
   */
  const adoptVersions = useCallback(
    async (id: string) => {
      const snap = await getSessionSnapshot(id).catch(() => null);
      if (!snap?.transcript?.length || threadIdRef.current !== id) return;
      setBranches(branchPoints(snap));
      const serverUsers = eventsToTurns(snapshotToEvents(snap)).filter((t) => t.role === 'user');
      const local = engine.state.turns;
      if (local.filter((t) => t.role === 'user').length !== serverUsers.length) return;
      let k = 0;
      engine.setTurns(
        local.map((t) => {
          if (t.role !== 'user') return t;
          const server = serverUsers[k++];
          if (!server?.eventId || t.eventId) return t;
          return {
            ...t,
            eventId: server.eventId,
            ...(server.parentEventId ? { parentEventId: server.parentEventId } : {}),
          };
        }),
      );
    },
    [engine],
  );

  const editingRef = useRef(false);
  const editTurn = useCallback(
    async (turnId: string, text: string) => {
      if (streaming || reattachingRef.current || rewindingRef.current || editingRef.current) return;
      const next = text.trim();
      const local = turnsRef.current;
      const index = local.findIndex((t) => t.id === turnId);
      const original = local[index];
      if (!original || original.role !== 'user' || !next || next === original.content.trim()) {
        return;
      }
      const ordinal = local.slice(0, index).filter((t) => t.role === 'user').length;

      editingRef.current = true;
      try {
        const snap = await getSessionSnapshot(threadId);
        const server = snap?.transcript?.length ? eventsToTurns(snapshotToEvents(snap)) : [];
        const target = server.filter((t) => t.role === 'user')[ordinal];
        if (!target?.parentEventId) {
          toast.message(
            target
              ? 'The first message has nothing before it to branch from. Start a new thread instead.'
              : 'This thread changed since it was loaded. Reload it and try again.',
          );
          return;
        }
        const previousLeaf = [...server].reverse().find((t) => t.eventId)?.eventId ?? null;
        const choice = await askAboutFiles(local.slice(index));
        if (choice === 'cancel') {
          // The edit box closed when this was sent, so the composer is where the text survives.
          setKept((was) => ({ text: next, files: [], n: (was?.n ?? 0) + 1 }));
          return;
        }
        const restoreFiles = choice === 'restore';
        const { files } = await rewindChat({
          threadId,
          eventId: target.parentEventId,
          summarize: false,
          manifest,
          ...(restoreFiles ? { restoreFiles } : {}),
        });
        if (restoreFiles) window.dispatchEvent(new Event(WORKSPACE_WRITTEN));
        if (threadIdRef.current !== threadId) return;

        engine.setError(null);
        const userTurn: Turn = {
          id: crypto.randomUUID(),
          role: 'user',
          content: next,
          ...(original.attachments?.length ? { attachments: original.attachments } : {}),
        };
        const assistantId = crypto.randomUUID();
        engine.setTurns([
          ...local.slice(0, index),
          userTurn,
          { id: assistantId, role: 'assistant', content: '', tools: [] },
        ]);
        const userMessage: ChatMessage = { role: 'user', content: next };
        if (original.attachments?.length) userMessage.attachments = original.attachments;
        // The toast waits for the run. Restore cannot move the leaf under a live
        // run, and a toast raised at send time had expired — taking its only
        // way back with it — before any reply longer than a few seconds landed.
        await streamInto([userMessage], assistantId);
        if (threadIdRef.current !== threadId) return;
        await adoptVersions(threadId);

        const said = 'Edited. The original and its replies are kept on another branch.';
        // No Restore original once the files went back: see `rewindTo`.
        if (restoreFiles) {
          reportRestoredFiles(said, files);
          return;
        }
        toast.message(
          said,
          previousLeaf
            ? {
                duration: 10_000,
                action: {
                  label: 'Restore original',
                  onClick: () => {
                    // A message sent since the toast opened is a live run again, and
                    // moving the leaf under it would graft its reply onto the wrong
                    // branch.
                    if (engine.state.streaming) {
                      toast.message('Wait for this run to finish, then rewind.');
                      return;
                    }
                    void rewindChat({ threadId, eventId: previousLeaf, summarize: false, manifest })
                      .then(() => hydrateFromServer(threadId))
                      .catch((err) => toastError(err, 'restore the original'));
                  },
                },
              }
            : undefined,
        );
      } catch (err) {
        toastError(err, 'edit this message');
      } finally {
        editingRef.current = false;
      }
    },
    [
      engine,
      streaming,
      threadId,
      manifest,
      streamInto,
      hydrateFromServer,
      adoptVersions,
      askAboutFiles,
    ],
  );

  /**
   * Show another version of an edited message.
   *
   * The same move as the edit toast's Restore, from the turn itself: rewind the
   * leaf to the end of that version's thread and re-read it. Refused under a live
   * run, for the toast's reason — moving the leaf would graft the reply in flight
   * onto the wrong branch.
   */
  const switchBranch = useCallback(
    (tipEventId: string) => {
      if (engine.state.streaming) {
        toast.message('Wait for this run to finish, then switch versions.');
        return;
      }
      void rewindChat({ threadId, eventId: tipEventId, summarize: false, manifest })
        .then(() => hydrateFromServer(threadId))
        .catch((err) => toastError(err, 'switch to that version'));
    },
    [engine, threadId, manifest, hydrateFromServer],
  );

  const onUiRespond = useCallback(
    async (value: unknown) => {
      if (!uiPrompt) return;
      setUiResolving(true);
      try {
        await respondUiRequest({
          requestId: uiPrompt.requestId,
          threadId: uiPrompt.threadId,
          value,
        });
        engine.clearUiPrompt();
      } catch (err) {
        toastError(err, 'send that answer');
      } finally {
        setUiResolving(false);
      }
    },
    [engine, uiPrompt],
  );

  const onUiCancel = useCallback(async () => {
    if (!uiPrompt) return;
    setUiResolving(true);
    try {
      await respondUiRequest({
        requestId: uiPrompt.requestId,
        threadId: uiPrompt.threadId,
        cancelled: true,
        note: 'cancelled',
      });
      engine.clearUiPrompt();
    } catch (err) {
      toastError(err, 'cancel this request');
    } finally {
      setUiResolving(false);
    }
  }, [engine, uiPrompt]);

  /**
   * A message the harness refused on the lease, on its way back to the composer.
   *
   * The composer cleared when the send went out, which is the only moment it
   * can: the refusal arrives after. Bumped `n`, so the same text kept twice is
   * restored twice. The composer takes it and calls `takeKept`, so a remount
   * does not restore it again.
   */
  const [kept, setKept] = useState<KeptMessage | null>(null);
  /**
   * The message last handed back to the composer, with the key it went out
   * under. Sent again unchanged it is the same message, so it reuses the key;
   * edited, it is a new one. Read by `submit` and cleared by it either way.
   */
  const keptKeyRef = useRef<{ key: string; text: string; fileUrls: string[] } | null>(null);
  const keepRefused = useCallback((message: KeyedMessage, reason: KeptReason = 'lease') => {
    keptKeyRef.current = message.key
      ? { key: message.key, text: message.text, fileUrls: message.files.map((f) => f.url) }
      : null;
    setKept((was) => ({ text: message.text, files: message.files, n: (was?.n ?? 0) + 1 }));
    toast.message(
      reason === 'lease'
        ? KEPT_NOTICE
        : reason === 'run'
          ? RUN_BUSY_NOTICE
          : reason === 'failed'
            ? RESEND_NOTICE
            : reason === 'refused'
              ? REFUSED_NOTICE
              : REKEYED_NOTICE,
    );
  }, []);
  const takeKept = useCallback(() => setKept(null), []);
  // The kept-message path with no refusal behind it and no key to reuse: a new
  // message the composer takes like a kept one, with nothing said about it.
  const draftMessage = useCallback(
    (text: string) => setKept((was) => ({ text, files: [], n: (was?.n ?? 0) + 1 })),
    [],
  );

  /**
   * Streamed sends that failed after they may have reached the harness, by key.
   *
   * A resend must be byte-identical under its key, or the harness answers
   * `422 idempotency_key_reused`. Text is, but images are uploaded per send and
   * come back under new ids, so what went out — the uploaded attachments, and the
   * thread and agent the body named — is kept here and sent again instead.
   * Dropped once the key has an answer: the run went out, or the key was refused.
   */
  const unsettled = useRef(new Map<string, UnsettledSend>());

  // Map a composer submission (text + browser File parts, already converted to
  // data URLs by PromptInput) onto our send(). Image parts become attachments.
  /**
   * Send what the composer holds, uploading its images first.
   *
   * Async, and throwing on failure, because that is how the composer is told to
   * keep the text: a refused upload that resolved would clear the message it was
   * about to explain. Images are uploaded only when the message will open a run —
   * a steer carries text alone, so uploading for one would store bytes nothing
   * references.
   */
  const submit = useCallback(
    async (
      message: KeyedMessage,
      mode: 'stream' | 'background' = 'stream',
      onKept: (message: KeyedMessage, reason: KeptReason) => void = keepRefused,
    ) => {
      // Permission is asked for here, inside the click, and only for the mode
      // that needs it. Prompting on load is how a page trains people to say no.
      if (mode === 'background') void armNotifications();
      // The message's `Idempotency-Key`, one per message rather than per request.
      // A queued message brings the one it was given when queued; the message last
      // handed back to the composer keeps its own if it comes back unchanged; and
      // anything else — an edit of it included — is a new message.
      const restored = keptKeyRef.current;
      keptKeyRef.current = null;
      let key =
        message.key ??
        (restored && restored.text === message.text && sameFiles(restored.fileUrls, message.files)
          ? restored.key
          : crypto.randomUUID());
      // Mid-run, a message waits its turn rather than steering. The composer
      // clears because this resolved, which is right: it is on screen, queued.
      if (streaming && mode === 'stream') {
        queue.enqueue({ text: message.text, files: message.files, key });
        return;
      }
      // What a failed attempt under this key sent, which a resend sends again.
      // The same words to another thread or agent are another request: new key.
      const before = unsettled.current.get(key);
      const resend =
        before &&
        before.threadId === threadId &&
        before.manifest === manifest &&
        before.text === message.text &&
        sameFiles(before.fileUrls, message.files)
          ? before
          : null;
      if (before && !resend) {
        unsettled.current.delete(key);
        key = crypto.randomUUID();
      }
      const sendWritten = async () => {
        const images = message.files.filter((f) => f.mediaType.startsWith('image/'));
        let attachments: ImageAttachment[] = resend?.attachments ?? [];
        if (images.length && !streaming && !resend) {
          const pending = toast.loading(
            images.length === 1 ? 'Uploading the image…' : `Uploading ${images.length} images…`,
          );
          try {
            attachments = await uploadImages(images);
          } catch (err) {
            if (err instanceof ImageUploadError) {
              toastProblem(
                `${err.message} Your message is still in the composer.`,
                err.detail ? { detail: err.detail } : {},
              );
            } else {
              toastError(err, 'upload the image');
            }
            throw err;
          } finally {
            toast.dismiss(pending);
          }
        }
        // Resolving clears the composer, and it must, before the run is known to
        // have been taken: a reply streams for minutes. So the message is held
        // here instead, until the harness either starts the run or refuses it.
        const sent = { text: message.text, files: message.files, key };
        // A run can now end after the operator has left its thread. A message it
        // hands back then belongs to that thread, not to the composer on screen:
        // it goes back into that thread's own queue, paused, where returning to
        // the thread finds it. (A caller with its own `onKept` — the drain —
        // already puts it back where it came from.)
        const sentOn = threadId;
        const giveBack = (m: KeyedMessage, reason: KeptReason) => {
          if (onKept !== keepRefused || threadIdRef.current === sentOn) {
            onKept(m, reason);
            return;
          }
          queue.enqueue({ text: m.text, files: m.files, ...(m.key ? { key: m.key } : {}) });
          queue.setPaused(true);
          toast.message('A message on another conversation was not sent. It is queued there.');
        };
        void send(message.text, attachments, mode, key)?.then((outcome) => {
          if (outcome === 'done') unsettled.current.delete(key);
          else if (outcome === 'lease_refused') giveBack(sent, 'lease');
          else if (outcome === 'run_in_progress') {
            // Nothing ran under the key, and the harness released it.
            unsettled.current.delete(key);
            giveBack(sent, 'run');
          } else if (outcome === 'failed') {
            unsettled.current.set(key, {
              threadId,
              manifest,
              text: message.text,
              fileUrls: message.files.map((f) => f.url),
              attachments,
            });
            giveBack(sent, 'failed');
          } else if (outcome === 'refused') {
            // Turned away before anything ran: the key holds nothing, and a resend
            // goes out as a new message.
            unsettled.current.delete(key);
            giveBack({ text: message.text, files: message.files }, 'refused');
          } else {
            // The harness will never send this body under this key.
            unsettled.current.delete(key);
            giveBack({ text: message.text, files: message.files }, 'key_reused');
          }
        });
      };
      // Held in the pool until the run is under way: the upload above can take
      // seconds, and switching threads meanwhile must not drop the engine the
      // message is about to run on, or its lease (`holdThread`). Released on every exit,
      // after `send` has either started streaming or declined.
      const unpin = holdThread(threadId);
      try {
        await sendWritten();
      } finally {
        unpin();
      }
    },
    [send, streaming, queue.enqueue, queue.setPaused, keepRefused, threadId, manifest, holdThread],
  );

  /**
   * Send the next queued message once the thread is free.
   *
   * `draining` covers the gap between taking a message and the run it opens:
   * an image upload comes first, and `streaming` stays false through it, so
   * without the ref the next render would take a second message too.
   *
   * A run that ended badly pauses the queue rather than sending into it. The
   * next message was written on the assumption that this one would finish.
   */
  const draining = useRef(false);
  const wasStreaming = useRef(streaming);
  const drainedThread = useRef(threadId);
  useEffect(() => {
    const ended = wasStreaming.current && !streaming;
    wasStreaming.current = streaming;
    // Arriving on a thread with messages still queued from an earlier visit
    // must not fire them: the operator came here to read, not to send.
    if (drainedThread.current !== threadId) {
      drainedThread.current = threadId;
      draining.current = false;
      if (queue.items.length > 0 && !streaming) queue.setPaused(true);
      return;
    }
    if (streaming) {
      draining.current = false;
      return;
    }
    if (ended && (error || engine.state.phase === 'aborted') && queue.items.length > 0) {
      queue.setPaused(true);
      return;
    }
    // A watching tab holds its queue: the harness would refuse every send.
    if (draining.current || reattaching || !harnessReachable || watching) return;
    if (queue.paused || queue.items.length === 0) return;
    const next = queue.items[0];
    queue.take(next.id);
    draining.current = true;
    // Refused on the lease, it goes back to the head of the queue rather than
    // into the composer, unpaused: the tab is watching now, which holds the queue,
    // and the takeover sends it — once, since `restore` keys on its id. A send
    // that failed goes back the same way, under its key, but paused: the run it
    // was queued behind has ended badly, and resuming is the operator's call. One
    // whose key was refused goes back under a new one.
    submit({ text: next.text, files: next.files, key: next.key }, 'stream', (_, reason) => {
      // Refused for a run still going: back to the head, unpaused, and the engine is now
      // watching that run — so this drains when it finishes, which is what queuing meant.
      if (reason === 'lease' || reason === 'run') {
        queue.restore(next);
        return;
      }
      queue.restore(
        reason === 'key_reused' || reason === 'refused'
          ? { ...next, key: crypto.randomUUID() }
          : next,
      );
      queue.setPaused(true);
    }).then(
      () => {
        // A send that was refused without throwing opens no run, and nothing
        // would ever clear the flag. Say so by pausing, with the message back.
        if (!engine.state.streaming) {
          draining.current = false;
          queue.restore(next);
          queue.setPaused(true);
        }
      },
      () => {
        draining.current = false;
        queue.restore(next);
        queue.setPaused(true);
      },
    );
  }, [threadId, streaming, reattaching, harnessReachable, watching, error, engine, queue, submit]);

  /**
   * Hand one queued message to the run in flight. The harness cancels the
   * run's remaining tool calls when a steer lands, which is why this is a
   * deliberate act on one message rather than what Enter does.
   */
  const steerQueued = useCallback(
    (id: string) => {
      if (!streaming || reattachingRef.current) return;
      const message = queue.take(id);
      if (!message) return;
      void steerChat({ threadId, text: message.text.trim() }).catch((err) => {
        // Put back rather than retried: a steer that failed on the response
        // rather than the request may already be in the run.
        queue.restore(message);
        toastError(err, 'steer with that message');
      });
    },
    [streaming, queue, threadId],
  );

  const onSlashCommand = useCallback(
    (cmd: SlashCommand) => {
      switch (cmd.action) {
        case 'new':
          newThread();
          break;
        case 'clear':
          clearThread();
          break;
        case 'continue':
          continueRun();
          break;
        case 'think':
          cycleThinking();
          break;
        case 'plan':
          togglePlanMode();
          break;
        case 'theme':
          setTheme(resolved === 'dark' ? 'light' : 'dark');
          break;
        case 'debug':
          toggleDebug();
          break;
        case 'view':
          stepView();
          break;
      }
    },
    [
      newThread,
      clearThread,
      continueRun,
      cycleThinking,
      togglePlanMode,
      setTheme,
      resolved,
      toggleDebug,
      stepView,
    ],
  );

  const options = manifests.length ? manifests : [manifest];
  /** Waiting on a person — the same test `setPresence('blocked')` makes. */
  const runBlocked = pendingQueue.length > 0 || uiPrompt != null;
  /** Whether the header's run-state chip is on screen, which the modes yield to. */
  const runShown = runBlocked || streaming;
  /** The header names this thread from the same merged index the sidebar lists. */
  const currentThread = threads.find((t) => t.id === threadId);
  // Read per render rather than stored: it cannot change, and costs a regex.
  const mac = isMacPlatform();

  /**
   * What this tab believes, assembled when the Debug tab asks. Nothing here is
   * kept for it: each field is read from the shell, the pool or the lease keeper
   * at call time, so the readout cannot hold a copy that has drifted.
   */
  const inspectClient = (): ClientDiagnostics => {
    const at = Date.now();
    const lease = sessionLeases.state(threadId);
    let leaf: string | null = null;
    for (let i = turns.length - 1; i >= 0 && leaf === null; i--) leaf = turns[i]?.eventId ?? null;
    return {
      at,
      threadId,
      holderId: tabHolderId(),
      lease: {
        mode: lease.mode,
        heldByOther: lease.heldByOther,
        token: sessionLeases.token(threadId) ?? null,
      },
      manifest,
      threadAgent: currentThread?.manifest?.trim() || null,
      canary,
      leaf,
      turns: turns.length,
      harnessReachable,
      engines: pool.entries().map(({ threadId: id, engine: e, foreground, pins }) => ({
        threadId: id,
        foreground,
        pins,
        phase: e.state.phase,
        streaming: e.state.streaming,
        reattaching: e.state.reattaching,
        approvals: e.state.approvals.length,
        question: e.state.uiPrompt != null,
        error: e.state.error,
        diagnostics: e.inspect(at),
      })),
    };
  };

  /**
   * Everything below the `<Outlet/>`.
   *
   * Deliberately not memoised: `turns` changes on every streamed delta, so a
   * memo would be rebuilt on essentially every render it mattered for, and the
   * renders where it would hold are ones this component was re-rendering for
   * anyway. A dependency list of forty entries that buys nothing is a list that
   * will be wrong.
   */
  const shell: ShellValue = {
    turns,
    streaming,
    reattaching,
    leftApp,
    dropped,
    error,
    sessionPhase,
    pending,
    queueLength: pendingQueue.length,
    tenantApprovals,
    runClock,
    onDecide,
    onDismiss,
    uiPrompt,
    uiResolving,
    onUiRespond: (value) => void onUiRespond(value),
    onUiCancel: () => void onUiCancel(),
    threadId,
    runningThreads: poolRuns.running,
    blockedThreads: poolRuns.blocked,
    askingThreads,
    watching,
    driver,
    labels,
    labelTurn,
    branches,
    switchBranch,
    feedback,
    rateTurn,
    send,
    submit,
    kept,
    takeKept,
    draftMessage,
    queue,
    steerQueued,
    stopRun,
    regenerate,
    rewindTo,
    editTurn,
    onSlashCommand,
    threads,
    threadIndex: threadIndexStatus,
    selectThread,
    newThread,
    deleteThread,
    renameThread,
    forkThread,
    compactThread,
    exportThread,
    manifest,
    setManifest,
    manifestOptions: options,
    manifestEntries,
    refreshCanary: recheckCanary,
    thinkingLevel,
    thinkingLevels: THINKING_LEVELS,
    chooseThinking,
    permissionMode,
    choosePermissionMode,
    outputStyle: storedStyle.thread === threadId ? storedStyle.style : null,
    chooseOutputStyle,
    sideQuestion: side?.thread === threadId ? side : null,
    askAboutThread,
    dismissSideQuestion,
    view,
    setView: chooseView,
    harnessView,
    debug,
    inspectClient,
    harnessReachable,
    historyOpen,
    setHistoryOpen,
    inspectorOpen,
    setInspectorOpen,
    openInPane,
    tellAgentEdited,
    showRecordedNote: () => showRecordedNote(threadIdRef.current),
  };

  return {
    shell,
    onHarness,
    sidebarInline,
    setAttentionHost,
    attentionHost,
    currentThread,
    mac,
    canary,
    runShown,
    runBlocked,
    toggleDebug,
    menuTriggerRef,
    continueAvailable,
    continueRun,
    copyThreadId,
    theme,
    setTheme,
    pane,
    paneHasItems,
    bannerOwned,
    pendingQueue,
    poolRuns,
    uiPrompt,
    fileQuestion,
    setFileQuestion,
  };
}

export type AppController = ReturnType<typeof useAppController>;
