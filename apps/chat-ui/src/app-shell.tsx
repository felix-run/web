import {
  type BranchPoint,
  branchPoints,
  type ChatEngine,
  createChatEngine,
  eventsToTurns,
  type ManifestEntry,
  mergeSessions,
  snapshotToEvents,
  type ThreadMeta,
  titleFromText,
} from '@felix/client';
import { Badge } from '@felix/ui/badge';
import { Button } from '@felix/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@felix/ui/dropdown-menu';
import { SidebarInset, SidebarProvider } from '@felix/ui/sidebar';
import {
  BirdIcon,
  CopyIcon,
  EllipsisIcon,
  MonitorIcon,
  MoonIcon,
  PanelRightIcon,
  PlusIcon,
  ScrollTextIcon,
  SunIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Outlet, useMatch, useNavigate } from 'react-router';
import { toast } from 'sonner';
import {
  abortChat,
  acquireSessionLease,
  addEvalItem,
  bindLeases,
  compactSession,
  continueChat,
  decideApproval,
  deleteThreadHistory,
  exportSession,
  felix,
  forkSession,
  getEvalDataset,
  getResolvedManifest,
  getSessionLease,
  getSessionSnapshot,
  getThreadHistory,
  listManifestEntries,
  listSessions,
  listTenantManifests,
  putEvalDataset,
  releaseSessionLease,
  renameSession,
  respondUiRequest,
  rewindChat,
  setSessionFeedback,
  setSessionLabel,
  setThinkingLevel,
  steerChat,
} from '@/api';
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input';
import { AppSidebar } from '@/components/app-sidebar';
import { AttentionLine } from '@/components/attention-line';
import { BrandToggle, Wordmark } from '@/components/brand-mark';
import {
  KEPT_NOTICE,
  type KeptMessage,
  REATTACHING_REFUSAL,
  REKEYED_NOTICE,
  RESEND_NOTICE,
} from '@/components/chat/multimodal-input';
import type { SlashCommand } from '@/components/chat/slash-commands';
import type { Driver } from '@/components/chat/watching-banner';
import type { SkillState } from '@/components/inspector/primitives';
import { type Theme, useTheme } from '@/components/theme-provider';
import { useMessageQueue } from '@/hooks/use-message-queue';
import { usePendingApprovals } from '@/hooks/use-pending-approvals';
import { useRails, WORKSPACE_INLINE } from '@/hooks/use-rails';
import { useShortcuts } from '@/hooks/use-shortcuts';
import { useVisualViewport } from '@/hooks/use-visual-viewport';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useHarnessReachable } from '@/lib/connection';
import { executeClientTool, readWorkspaceFile } from '@/lib/cowork';
import { createEnginePool, type EnginePool } from '@/lib/engine-pool';
import { toastError, toastProblem } from '@/lib/error-toast';
import { middleTruncate } from '@/lib/format';
import { ImageUploadError, uploadImages } from '@/lib/image-upload';
import { DEFAULT_MANIFEST } from '@/lib/manifests';
import { armNotifications, clearNotification, setPresence } from '@/lib/presence';
import { resyncPush } from '@/lib/push';
import { lastResume, onResume } from '@/lib/resume';
import { createLeaseKeeper, LEASE_RENEW_MS, releaseOnPageExit } from '@/lib/session-lease';
import { ariaShortcut, isMacPlatform, shortcutLabel, whenMounted } from '@/lib/shortcuts';
import { recallTabThread, rememberTabThread } from '@/lib/tab-thread';
import {
  indexThread,
  listThreads,
  loadTurns,
  migrateLegacy,
  readPins,
  removeThread,
  saveTurns,
  threadLabel,
  writePins,
} from '@/lib/threads';
import { cn } from '@/lib/utils';
import { NO_RUN, type RunClock, ShellProvider, type ShellValue } from '@/shell-context';
import type { ChatMessage, ImageAttachment, ThinkingLevel, Turn, TurnFeedback } from '@/types';
import { AccountChip } from './components/account-chip';

const MANIFEST_KEY = 'felix.manifest';
/** How long a deleted conversation can be restored, and how long the server delete waits. */
const DELETE_UNDO_MS = 7000;

const VERBOSE_KEY = 'felix.verbose';
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
/** The header menu's Theme choices, in the order the radio group lists them. */
const THEME_OPTIONS: ReadonlyArray<{ value: Theme; label: string; Icon: typeof SunIcon }> = [
  { value: 'light', label: 'Light', Icon: SunIcon },
  { value: 'dark', label: 'Dark', Icon: MoonIcon },
  { value: 'system', label: 'System', Icon: MonitorIcon },
];
/** How often to ask the harness for approvals while a run is in flight. */
const APPROVAL_POLL_MS = 2_500;
/**
 * How soon after the page comes back a dropped stream still counts as one the
 * operator's leaving caused: the connection's failure surfaces on the first read
 * after resume, or when `checkLiveness` cuts it a beat later.
 */
const LEFT_APP_WINDOW_MS = 10_000;
/** How often to ask whether a live stream has stalled, while the page is on screen. */
const LIVENESS_CHECK_MS = 15_000;
/** How long past an approval's deadline to re-ask, so the harness has denied it by then. */
const LAPSE_GRACE_MS = 2_000;

/** A composer or queued message, with the `Idempotency-Key` it goes out under when it has one. */
type KeyedMessage = PromptInputMessage & { key?: string };

/** Why a message came back: the lease, a send that failed, or a key the harness refused. */
type KeptReason = 'lease' | 'failed' | 'key_reused';

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

function readBool(key: string, fallback: boolean): boolean {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  return raw === '1' || raw === 'true';
}

export function AppShell() {
  const [manifestEntries, setManifestEntries] = useState<ManifestEntry[]>([]);
  const manifests = useMemo(() => manifestEntries.map((m) => m.id), [manifestEntries]);
  const [manifest, setManifest] = useState(() => {
    const stored = localStorage.getItem(MANIFEST_KEY)?.trim();
    return stored || DEFAULT_MANIFEST;
  });
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
  const [threads, setThreads] = useState<ThreadMeta[]>([]);
  // Canary rollout state for the selected manifest, from the `/manifests`
  // active pointer. Deliberately *not* "which side served this thread": that
  // assignment is a server-side hash the harness does not report to clients,
  // and `GET /manifests/{name}` answers `stable` for any partial rollout
  // because it resolves without a thread id.
  const [canary, setCanary] = useState<{
    version: number;
    weight: number;
    onCanary: boolean;
  } | null>(null);
  const [uiResolving, setUiResolving] = useState(false);
  const [thinkingLevel, setThinkingLevelState] = useState<ThinkingLevel>('off');
  // Workspace open by default wherever it fits inline: it is the subject (the
  // folder, and the only door to other threads), and it used to open only once a
  // profile had threads, so a first visit started with the subject hidden.
  // The instrument starts open only where all three zones fit at their own
  // widths (`useRails`). What is persisted is the
  // *inline* preference — a drawer at a narrow width starts closed and is never
  // written down; `useRails` says why.
  const { historyOpen, setHistoryOpen, inspectorOpen, setInspectorOpen, revealInspector } =
    useRails();
  const [verbose, setVerbose] = useState(() => readBool(VERBOSE_KEY, false));
  const [skills, setSkills] = useState<SkillState | null>(null);
  const { theme, resolved, setTheme } = useTheme();
  /** Where focus lands when the Verbose badge turns verbose off and unmounts. */
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
  const verboseRef = useRef(verbose);
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
        const created = createChatEngine({
          client: felix,
          threadId: () => id,
          clientTools: { execute: executeClientTool, readForDiff: readWorkspaceFile },
          onToolStart: () => {
            if (verboseRef.current && threadIdRef.current === id) revealInspector();
          },
          onSkills: (s) => {
            if (threadIdRef.current === id) setSkills(s);
          },
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
      onRunEnd: (id) => {
        if (id === threadIdRef.current) return;
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
        if (id !== threadIdRef.current) saveTurns(id, e.state.turns);
      },
    });
  }
  const pool = poolRef.current;
  const engine = pool.get(threadId);
  /** Threads with a run in flight in this tab, the foreground's included. */
  const poolRuns = useSyncExternalStore(pool.subscribe, pool.runs);
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
  } = useSyncExternalStore(engine.subscribe, () => engine.state);
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
  const queue = useMessageQueue(threadId);
  useEffect(() => {
    verboseRef.current = verbose;
  }, [verbose]);

  useEffect(() => localStorage.setItem(MANIFEST_KEY, manifest), [manifest]);
  // Whether the harness answered the last request, for the composer's connection
  // hint. The rails' breakpoints moved to the workbench route with the rails.
  const harnessReachable = useHarnessReachable();

  useEffect(() => localStorage.setItem(VERBOSE_KEY, verbose ? '1' : '0'), [verbose]);
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
    saveTurns(threadId, engine.state.turns);
  }, [threadId, turns, engine]);

  // Canary state for the selected manifest on *this* thread. Two questions, two
  // sources: whether a rollout exists at all comes from the active pointer, and
  // which side serves this thread comes from resolving the manifest with the
  // thread id — the assignment is a server-side hash the client cannot compute.
  //
  // Only tenant-managed manifests have a pointer, so a bundled one has no
  // rollout and no badge, and the second call is skipped entirely.
  const refreshCanary = useCallback(async () => {
    try {
      const rows = await listTenantManifests();
      const row = rows.find((r) => r.name === manifest);
      const weight = row?.canary_weight ?? 0;
      const version = row?.canary_version ?? null;
      if (version == null || weight <= 0) {
        setCanary(null);
        return;
      }
      // Only a `canary` answer is treated as one. A harness that does not yet
      // take `thread_id` replies `stable` for every thread, and reporting that
      // as "this thread is on stable" would be a confident guess — so an
      // unconfirmed thread shows the rollout, and claims nothing about itself.
      let onCanary = false;
      try {
        const resolved = await getResolvedManifest(manifest, { threadId });
        onCanary = resolved.variant === 'canary';
      } catch {
        // Resolution is best-effort; the rollout badge still stands without it.
      }
      setCanary({ version, weight, onCanary });
    } catch {
      // The tenant store is optional and the route needs `manifests:read`;
      // a badge is not worth surfacing an error for.
      setCanary(null);
    }
  }, [manifest, threadId]);

  useEffect(() => {
    void refreshCanary();
  }, [refreshCanary]);

  useEffect(() => {
    const ctrl = new AbortController();
    listManifestEntries(ctrl.signal)
      .then((entries) => {
        if (!entries.length) return;
        const names = entries.map((m) => m.id);
        setManifestEntries(entries);
        // Drop stale localStorage (e.g. chat-ui-demo) that isn't on this harness.
        setManifest((cur) =>
          names.includes(cur)
            ? cur
            : names.includes(DEFAULT_MANIFEST)
              ? DEFAULT_MANIFEST
              : names[0]!,
        );
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  // Prefer authoritative snapshot; fall back to history events.
  /**
   * Rebuild the sidebar: the harness's thread list merged over the local index.
   *
   * Renders the local list first and upgrades it, so the rail is populated
   * immediately and a slow harness never shows an empty history. A failed fetch
   * leaves the local list standing rather than emptying it — a sidebar that goes
   * blank because one request failed reads as data loss.
   */
  const refreshThreads = useCallback(async () => {
    const local = listThreads();
    setThreads(local);
    try {
      setThreads(mergeSessions(local, await listSessions()));
    } catch {
      // Local list is already rendered; nothing further to show.
    }
  }, []);

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
  const hydrateFromServer = useCallback((id: string, opts: { transcript?: boolean } = {}) => {
    const withTranscript = opts.transcript ?? true;
    void (async () => {
      try {
        const snap = await getSessionSnapshot(id);
        if (snap && id === threadIdRef.current) {
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
    })();
  }, []);
  hydrateFromServerRef.current = hydrateFromServer;

  /**
   * Hydrate on return, but only when the harness holds more of the thread than
   * this tab does — a run that finished somewhere else while the page was away.
   * A rebuild from the snapshot drops local detail the snapshot does not carry
   * (a turn's usage, among others), so an unconditional one on every return
   * would cost the tab what it already had to learn nothing new.
   */
  const hydrateIfAhead = useCallback(async (id: string) => {
    const snap = await getSessionSnapshot(id).catch(() => null);
    const target = poolRef.current?.peek(id);
    if (!snap?.transcript?.length || id !== threadIdRef.current || !target) return;
    const rebuilt = eventsToTurns(snapshotToEvents(snap));
    if (rebuilt.length <= target.state.turns.length || target.state.streaming) return;
    target.setTurns(rebuilt);
    saveTurns(id, rebuilt);
    if (snap.phase) target.setPhase(snap.phase);
  }, []);

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
      setSkills(null);
      // Server-owned like the rest of session state, so this clears and
      // hydration refills it rather than merging.
      setLabels({});
      setFeedback({});
      setBranches(new Map());
      if (hydrate || running) hydrateFromServer(id, { transcript: !running });
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
        .then(() => toast.success('Context compacted', { id: pending }))
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
      .then((jsonl) => {
        const url = URL.createObjectURL(new Blob([jsonl], { type: 'application/x-ndjson' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `${id}.jsonl`;
        a.click();
        // Revoking synchronously can beat the download starting in some browsers.
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      })
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
      const remaining = listThreads();
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

  // Deliberately bare: `ApprovalDecision` owns the in-flight guard and both
  // toasts, so this does the work and lets a failure propagate to it.
  // The harness already decided a lapsed approval; this only takes the card down.
  const onDismiss = useCallback(() => engine.shiftApproval(), [engine]);

  const onDecide = useCallback(
    async (status: 'approved' | 'denied', editedArgs?: Record<string, unknown>) => {
      if (!pending) return;
      await decideApproval(pending.approvalId, {
        status,
        // Only when the operator actually changed something: `edited_args`
        // installs a substitution that stands for every identical call until
        // the grant expires, so sending the originals back would quietly create
        // one nobody asked for.
        ...(editedArgs ? { edited_args: editedArgs } : {}),
      });
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
  const syncApprovals = useCallback(() => engine.syncApprovals(), [engine]);

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
        ? live.syncApprovals()
        : live.syncApprovals({ attributedOnly: true }),
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
   * Presence, for the runs nobody is watching.
   *
   * The banners above assume a viewport. A background run can block on an
   * approval minutes after the tab lost focus, so the same state also has to
   * leave the page: the title carries it always, and an OS notification fires
   * only while the tab is hidden.
   */
  // Over every run in the tab: a run kept going after the operator switched
  // threads is still working, and still blocks on a person, with nothing on
  // screen to say so.
  const blockedAnywhere = pendingQueue.length > 0 || uiPrompt != null || poolRuns.blocked.size > 0;
  const workingAnywhere = streaming || anyRunning;
  useEffect(() => {
    if (blockedAnywhere) setPresence('blocked');
    else if (workingAnywhere) setPresence('working');
    else setPresence('idle');
  }, [blockedAnywhere, workingAnywhere]);

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
        void engine.syncApprovals();
        for (const live of pool.live()) if (live !== engine) void syncLive(live);
        if (
          hiddenForMs > 0 &&
          !engine.state.streaming &&
          !unsentRef.current.has(threadIdRef.current)
        ) {
          void hydrateIfAhead(threadIdRef.current);
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

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') clearNotification();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  /**
   * The keyboard layer. What each key means, and when it means nothing, is
   * `route()` in `src/lib/shortcuts.ts`; this is only what each action does.
   *
   * The targets are found by `data-` hooks rather than lifted state, because the
   * thing each binding reaches for already owns its open state — the thread
   * popover in the workspace zone, the queue in the attention line — and
   * clicking the real trigger means the shortcut and the pointer take exactly
   * the same path. A binding that opened a copy of the state would be a second
   * way for the two to disagree.
   */
  useVisualViewport();

  /**
   * A tapped push notification, routed by the router rather than by a reload.
   *
   * `sw.js` asks an open window to move instead of navigating it, because a reload drops the
   * connection of a run in flight. Only same-app paths are followed. And on load, tell the
   * harness about a subscription this device already holds (`resyncPush` says why).
   */
  useEffect(() => {
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
    if (!sw) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; path?: unknown } | null;
      if (data?.type !== 'felix:open' || typeof data.path !== 'string') return;
      if (!data.path.startsWith('/') || data.path.startsWith('//')) return;
      event.ports[0]?.postMessage('ok');
      navigate(data.path);
    };
    sw.addEventListener('message', onMessage);
    void resyncPush();
    return () => sw.removeEventListener('message', onMessage);
  }, [navigate]);
  useShortcuts(onHarness ? 'harness' : 'workbench', {
    'toggle-workspace': () => setHistoryOpen((o) => !o),
    'toggle-instrument': () => setInspectorOpen((o) => !o),
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
      const firstTurn = turns.length === 0;
      engine.setTurns([
        ...turns,
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
        if (outcome === 'lease_refused') {
          engine.setTurns(engine.state.turns.filter((t) => t.id !== userTurn.id));
        }
        // It may or may not have landed, and the message is going back to whoever
        // holds it. The attempt goes from the transcript with it — whatever it had
        // streamed included — so the message is in one place at a time, and a
        // resend's replay is what shows what the harness actually kept.
        if (outcome === 'failed' || outcome === 'key_reused') engine.setTurns(turns);
        return outcome;
      });
    },
    [engine, streaming, manifest, threadId, turns, threads, streamInto],
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
    setSkills(null);
    engine.reset();
    void deleteThreadHistory(threadId);
    saveTurns(threadId, []);
  }, [engine, threadId, stopRun]);

  const continueRun = useCallback(() => {
    if (streaming) return;
    void continueChat({ threadId, manifest })
      .then(() => {
        toast.message('Continued');
        hydrateFromServer(threadId);
        engine.setPhase('idle');
      })
      // No retry: continuing twice starts a second run on the same thread.
      .catch((err) => toastError(err, 'continue this run'));
  }, [streaming, threadId, manifest, hydrateFromServer]);

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
      void rewindChat({ threadId, eventId, summarize: false, manifest })
        .then(() => {
          hydrateFromServer(threadId);
          toast.message(
            hidden > 0
              ? `Rewound. ${hidden} later ${hidden === 1 ? 'turn is' : 'turns are'} off the active branch.`
              : 'Rewound to this message.',
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
        })
        .catch((err) => toastError(err, 'rewind this thread', { retry: () => rewindTo(eventId) }))
        .finally(() => {
          rewindingRef.current = false;
        });
    },
    [streaming, threadId, manifest, hydrateFromServer],
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
        await rewindChat({ threadId, eventId: target.parentEventId, summarize: false, manifest });
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

        toast.message(
          'Edited. The original and its replies are kept on another branch.',
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
    [engine, streaming, threadId, manifest, streamInto, hydrateFromServer, adoptVersions],
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
      reason === 'lease' ? KEPT_NOTICE : reason === 'failed' ? RESEND_NOTICE : REKEYED_NOTICE,
    );
  }, []);
  const takeKept = useCallback(() => setKept(null), []);

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
          else if (outcome === 'failed') {
            unsettled.current.set(key, {
              threadId,
              manifest,
              text: message.text,
              fileUrls: message.files.map((f) => f.url),
              attachments,
            });
            giveBack(sent, 'failed');
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
      if (reason === 'lease') {
        queue.restore(next);
        return;
      }
      queue.restore(reason === 'key_reused' ? { ...next, key: crypto.randomUUID() } : next);
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
        case 'theme':
          setTheme(resolved === 'dark' ? 'light' : 'dark');
          break;
        case 'verbose':
          setVerbose((v) => {
            const next = !v;
            if (next) setInspectorOpen(true);
            return next;
          });
          break;
      }
    },
    [newThread, clearThread, continueRun, cycleThinking, setTheme, resolved],
  );

  const options = manifests.length ? manifests : [manifest];
  /** Waiting on a person — the same test `setPresence('blocked')` makes. */
  const runBlocked = pendingQueue.length > 0 || uiPrompt != null;
  /** Whether the header's run-state chip is on screen, which the modes yield to. */
  const runShown = runBlocked || streaming;
  // Read per render rather than stored: it cannot change, and costs a regex.
  const mac = isMacPlatform();

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
    skills,
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
    queue,
    steerQueued,
    stopRun,
    regenerate,
    rewindTo,
    editTurn,
    onSlashCommand,
    threads,
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
    refreshCanary: () => void refreshCanary(),
    thinkingLevel,
    thinkingLevels: THINKING_LEVELS,
    chooseThinking,
    verbose,
    harnessReachable,
    historyOpen,
    setHistoryOpen,
    inspectorOpen,
    setInspectorOpen,
  };

  return (
    // `--vvh` is the visual viewport while an on-screen keyboard covers part of the
    // layout one (use-visual-viewport.ts); otherwise `dvh`, which follows Safari's
    // toolbar where `h-screen` (the *large* viewport) put the composer under it.
    // The side insets are on the shell rather than on each zone: a phone on its
    // side has the notch at one edge, and everything inside clears it at once.
    <div className="flex h-[var(--vvh,100dvh)] flex-col bg-background px-safe-0">
      {/*
        The address decides what renders here. The engine, the thread and the
        approval queue are above it deliberately: mounting `createChatEngine`
        inside a route would unmount it on a visit to any other address, and
        take a live run down with it.
      */}
      <ShellProvider value={shell}>
        <SidebarProvider
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          openMobile={historyOpen}
          onOpenMobileChange={setHistoryOpen}
          mobile={!sidebarInline}
        >
          {/* Full height, beside the header rather than under it, so its top edge
              can carry the brand on the header's own line. */}
          <AppSidebar />
          <SidebarInset>
            {/* The inset is added to the bar's height rather than taken out of it:
                `--header-height` is read by the toaster and must stay the bar's own. */}
            <header className="flex h-[calc(var(--header-height)+env(safe-area-inset-top,0px))] shrink-0 items-center gap-1 border-b border-border/60 px-3 pt-safe">
              {/* Below 1024 the sidebar is a drawer and has no edge on screen, so its
                  brand — and with it the toggle — stands here, in the slot the panel
                  button had. From 1024 both live at the top of the sidebar instead,
                  on this bar's line, and the header starts with the run. */}
              {!sidebarInline && (
                <div data-slot="header-brand" className="flex shrink-0 items-center gap-1.5">
                  <BrandToggle
                    open={historyOpen}
                    onClick={() => setHistoryOpen((o) => !o)}
                    // What is on screen, not what is stored: at this width the stored
                    // preference is not what the operator is looking at. Pressed means
                    // the drawer is open.
                    aria-pressed={historyOpen}
                    aria-label="Sidebar"
                    aria-keyshortcuts={ariaShortcut('toggle-workspace', mac)}
                    title={`Sidebar (${shortcutLabel('toggle-workspace', mac)})`}
                  />
                  {/* Below `sm`, while a run state is showing, the word steps aside
                      the way the modes do: the mark beside it is the brand and the
                      toggle, and the chip and the attention line need the room. It
                      stays the page's `h1` for a reader. */}
                  <Wordmark className={cn(runShown && 'max-sm:sr-only')} />
                </div>
              )}
              {/* The left cluster yields in a fixed order, because at 390px with both
                  modes on and a run blocked it holds more than its space. The brand
                  before it never shrinks, and nor does the run state. Below `sm` the
                  two modes draw as icons, keeping their words for a reader, and while
                  a run state is on screen they step aside (see the modes' row). Past
                  that — a 320px viewport, where the brand and the chip alone are wider
                  than the room — the cluster clips at its own edge rather than running
                  under the right cluster, which holds the controls. `py-1` is room for
                  a focus ring the clip would otherwise cut. */}
              <div
                data-slot="header-state"
                className="flex min-w-0 items-center gap-2 overflow-hidden px-1.5 py-1"
              >
                {/* This thread's run, in one slot that is the same on both addresses.
                    It used to ride the Chat door on `/harness` only, so `/t` said
                    nothing in the header and the two addresses disagreed about where
                    to look. Two words and nothing else — waiting on a person, or
                    working — because a copy with its own idea of which finer phases
                    were worth showing disagreed with the instrument's.

                    `blocked` outranks `running` and reads the same queue the tab title
                    does (`setPresence` above): a run waiting on an approval or a
                    question is not working, and "running" was the reason to stay on a
                    page while the run timed out behind it.

                    A tinted chip the height of the badges beside it, not bare text:
                    as `text-xs` with no surface it lost to the filled Verbose pill, so
                    the header ranked a viewing preference above the run. The tint is
                    the state's own hue at /10 — the ramp is tuned for text on its own
                    tint up to /15 in both themes.

                    Not a live region. The attention line below is one, and already
                    announces both "Working" and a call waiting on you; a second region
                    saying the same change would make a screen reader say it twice.
                    The `sr-only` prefix is what keeps it from being mistaken for that
                    line when it is read in place: that line is tenant-wide, this is
                    the thread on screen. */}
                {runBlocked ? (
                  <span
                    data-slot="run-state"
                    title="This thread's run is waiting on you"
                    className="inline-flex h-5.5 shrink-0 items-center gap-1 rounded-full border border-transparent bg-solid-state-blocked/10 px-2 py-0.5 text-xs font-medium text-state-blocked"
                  >
                    <span aria-hidden className="size-1.5 rounded-full bg-state-blocked" />
                    <span className="sr-only">This thread's run: </span>
                    blocked
                  </span>
                ) : streaming ? (
                  <span
                    data-slot="run-state"
                    title="This thread's run is in progress"
                    className="inline-flex h-5.5 shrink-0 items-center gap-1 rounded-full border border-transparent bg-solid-state-running/10 px-2 py-0.5 text-xs font-medium text-state-running"
                  >
                    <span aria-hidden className="size-1.5 rounded-full bg-state-running" />
                    <span className="sr-only">This thread's run: </span>
                    running
                  </span>
                ) : null}
                {/* The modes this tab is in, at every width. They were `hidden` below
                    `sm`, so on a phone, or at 200% zoom, verbose and a canary rollout
                    were states with nothing on screen to say so. What narrows instead
                    is their words: below `sm` each draws as its icon, and the word
                    stays in the accessible name and the `title`.

                    Below `sm`, while this thread's run state is showing, the modes
                    step off the screen. Measured at 390px, the wordmark and a
                    `blocked` chip leave no room for even one icon beside them, and
                    the alternatives were both worse: a badge clipped part-way reads
                    as broken, and one pushed out of view by overflow is a Verbose
                    button keyboard focus can land on and nobody can see. So Verbose
                    is `hidden`, which takes it out of the tab order as well — the
                    Session menu still holds it — and the canary, which is not
                    focusable, goes `sr-only` and is still read. Both come back when
                    the run settles. Nothing else in the cluster shrinks, so this row
                    is `min-w-0` for the widths between, where it is the one to give. */}
                {(verbose || canary) && (
                  <div
                    data-slot="header-modes"
                    // `contents` while the modes have stepped off a narrow screen, so
                    // the row leaves no empty box and no gap behind them.
                    className={cn('flex min-w-0 items-center gap-2', runShown && 'max-sm:contents')}
                  >
                    {verbose && (
                      <Badge
                        variant="secondary"
                        className={cn('h-5.5 font-normal', runShown && 'max-sm:hidden')}
                        asChild
                      >
                        {/* A button, because a badge that reports a mode should also be
                            the way out of it — otherwise the way out is two clicks into
                            a menu whose trigger says nothing about verbose. Focus moves
                            to that menu's trigger, since the badge unmounts under the
                            click.

                            No `aria-pressed`: the badge exists only while verbose is
                            on, so it was permanently true — a toggle that could never
                            read unpressed. The name says the state and the action
                            instead, which is also what lets the word go below `sm`. */}
                        <button
                          type="button"
                          data-slot="verbose-mode"
                          aria-label="Verbose on, turn off"
                          title="Verbose tools is on. Click to turn it off."
                          onClick={() => {
                            setVerbose(false);
                            menuTriggerRef.current?.focus();
                          }}
                          className="cursor-pointer hover:bg-solid-secondary/80"
                        >
                          <ScrollTextIcon aria-hidden className="sm:hidden" />
                          <span className="hidden sm:inline">Verbose</span>
                        </button>
                      </Badge>
                    )}
                    {canary && (
                      // Outline and mono, never a filled pill: the version is the
                      // harness's number quoted back, and a filled badge made it the
                      // loudest object in the header. On-canary reads in the
                      // foreground, a rollout this thread is not confirmed to be on
                      // stays muted — and the words say the same, because a colour
                      // difference alone says it to nobody who cannot see it.
                      <Badge
                        variant="outline"
                        data-slot="canary-mode"
                        className={cn(
                          'h-5.5 border-border/60 font-mono font-normal',
                          canary.onCanary ? 'text-foreground' : 'text-muted-foreground',
                          runShown && 'max-sm:sr-only',
                        )}
                        title={
                          canary.onCanary
                            ? `This thread is served by canary v${canary.version} (rollout at ${canary.weight}%).`
                            : `Canary rollout in flight: v${canary.version} at ${canary.weight}%. ` +
                              'This thread is not confirmed to be on it.'
                        }
                      >
                        <BirdIcon aria-hidden className="sm:hidden" />
                        <span className="sr-only sm:not-sr-only">canary</span>
                        <span className="sr-only sm:not-sr-only">
                          {canary.onCanary
                            ? `v${canary.version}`
                            : `v${canary.version}${canary.weight < 100 ? ` @ ${canary.weight}%` : ''}`}
                        </span>
                        <span className="sr-only">
                          {canary.onCanary
                            ? ', this thread is on it'
                            : ', this thread is not confirmed on it'}
                        </span>
                      </Badge>
                    )}
                  </div>
                )}
              </div>

              {/*
                The attention line. Always rendered, never conditional, and in the
                header so it is the same line on both addresses: it answers the
                question an operator has before they have navigated anywhere, so it
                cannot be somewhere they have to navigate to.

                `ml-auto` puts it beside the controls. From `sm` a shrink weight far
                above the run cluster's makes it the first thing to give way — its
                sentence truncates. Below `sm` it is two words that cannot truncate,
                so it does not shrink at all: it shrank below them and drew "1
                waiting" over New chat and the sidebar toggle at 390px and 320px.
                There the run cluster gives instead, clipping at its own edge.
              */}
              <div className="ml-auto flex min-w-0 shrink-[100] items-center justify-end pl-2 max-sm:shrink-0">
                <AttentionLine
                  approvals={tenantApprovals}
                  streaming={streaming}
                  handled={bannerOwned}
                  bannerOnScreen={!onHarness}
                  threadId={threadId}
                  threads={threads}
                  reasons={Object.fromEntries(pendingQueue.map((q) => [q.approvalId, q.reason]))}
                  question={uiPrompt?.prompt ?? null}
                  elsewhereQuestions={poolRuns.questions.filter((q) => q.threadId !== threadId)}
                  queueHost={attentionHost}
                />
              </div>
              {/* `shrink-0`: the controls are what the left cluster yields to, never
                  the other way round. */}
              <div className="flex shrink-0 items-center gap-1">
                {/* Conversation controls stay with the conversation. On `/harness` —
                    whose premise is what outlives every run — New chat, the instrument
                    and the Session menu's run verbs act on a transcript that is not on
                    screen. The door back to Chat is the one way to them. It is plain
                    navigation: the run's state is the header's first slot, on both
                    addresses.

                    From 1024 New chat is the sidebar's first row, on screen expanded
                    or as icons, so a second one here was the same button twice. It
                    stays here where the sidebar is a drawer, because there it would
                    be two clicks away. */}
                {/* Below `sm` it steps aside while a run is showing, for the room
                    the run's status needs; the drawer holds it. Never disabled: a
                    new thread leaves the run going on its own. */}
                {!onHarness && !sidebarInline && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={newThread}
                    className={cn('gap-1.5', runShown && 'max-sm:hidden')}
                    title="New chat"
                  >
                    <PlusIcon className="size-4" aria-hidden />
                    {/* `sr-only` below `sm` rather than `hidden`, so the word is the
                        accessible name at every width and no `aria-label` has to
                        repeat it. */}
                    <span className="sr-only sm:not-sr-only">New chat</span>
                  </Button>
                )}
                {onHarness ? (
                  // The instrument toggle's slot, held empty so the attention line
                  // beside it stays put: without it the line moved on every switch
                  // between the two addresses.
                  <span
                    aria-hidden
                    data-slot="instrument-toggle-slot"
                    className="size-8 shrink-0"
                  />
                ) : (
                  <Button
                    variant={inspectorOpen ? 'secondary' : 'ghost'}
                    size="icon-sm"
                    onClick={() => setInspectorOpen((o) => !o)}
                    aria-pressed={inspectorOpen}
                    aria-label="This run"
                    aria-keyshortcuts={ariaShortcut('toggle-instrument', mac)}
                    title={`This run (${shortcutLabel('toggle-instrument', mac)})`}
                  >
                    <PanelRightIcon className="size-4" />
                  </Button>
                )}
                {/* One menu, in one place on both addresses. On `/t` it is named
                    Session and opens on Session — it used to open on a View group,
                    so the name promised one thing and the first row was another.
                    View follows, then Theme under a label of its own: the Verbose
                    checkbox and the theme radios ran together as one unlabelled list.

                    On `/harness` it holds Theme alone, so it is named **Theme** there
                    and its one label says the same word: a menu called Session with no
                    session in it would be the "More tools" problem again, and one
                    called View holding only Theme names a group it does not show.
                    Theme is a set-once preference, so it holds no header slot of its
                    own. */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      ref={menuTriggerRef}
                      variant="ghost"
                      size="icon-sm"
                      aria-label={onHarness ? 'Theme' : 'Session'}
                      title={onHarness ? 'Theme' : 'Session'}
                    >
                      <EllipsisIcon className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  {/* `w-64` so Copy thread id and its id sit on one row: at `w-56` the
                      row wrapped. */}
                  <DropdownMenuContent align="end" className="w-64">
                    {!onHarness && (
                      <>
                        <DropdownMenuLabel>Session</DropdownMenuLabel>
                        {/* Disabled on an empty thread: there is no run to continue, and
                            the harness would start one from nothing. */}
                        <DropdownMenuItem
                          disabled={streaming || watching || turns.length === 0}
                          onSelect={() => continueRun()}
                        >
                          Continue run
                        </DropdownMenuItem>
                        {/* Cut from the middle, never the end: `threadId.slice(0, 8)` read
                            `self-pr-` for every `self-pr-*` thread. The id is whole in
                            `title`, in the accessible name, and on the clipboard.

                            `middleTruncate` is the only cut. The span does not also
                            `truncate`: a CSS ellipsis on top of a middle ellipsis would
                            drop the end of the id, which is the half that differs. */}
                        <DropdownMenuItem
                          onSelect={copyThreadId}
                          title={threadId}
                          aria-label={`Copy thread id ${threadId}`}
                          className="gap-1.5 whitespace-nowrap"
                        >
                          <CopyIcon className="size-4" aria-hidden />
                          Copy thread id
                          <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                            {middleTruncate(threadId, 14)}
                          </span>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>View</DropdownMenuLabel>
                        <DropdownMenuCheckboxItem
                          checked={verbose}
                          onCheckedChange={(checked) => {
                            setVerbose(checked);
                            if (checked) setInspectorOpen(true);
                          }}
                        >
                          Verbose tools
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuSeparator />
                      </>
                    )}
                    <DropdownMenuLabel>Theme</DropdownMenuLabel>
                    {/* Radio items, so the checked theme is announced rather than marked
                        with a glyph only a sighted reader could see. */}
                    <DropdownMenuRadioGroup
                      aria-label="Theme"
                      value={theme}
                      onValueChange={(v) => {
                        if (v === 'light' || v === 'dark' || v === 'system') setTheme(v);
                      }}
                    >
                      {THEME_OPTIONS.map(({ value, label, Icon }) => (
                        <DropdownMenuRadioItem key={value} value={value} className="gap-2">
                          <Icon className="size-4" aria-hidden />
                          {label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                {/* Last, past the menu: who this browser is, when it signed in with
                    GitHub. Renders nothing under the shared key, which names no one. */}
                <AccountChip />
              </div>
            </header>

            {/* The attention line's queue opens here, under the bar the line sits
                on, in the flow — it pushes the page down rather than covering it. */}
            <div ref={setAttentionHost} className="contents" />

            <Outlet />
          </SidebarInset>
        </SidebarProvider>
      </ShellProvider>
    </div>
  );
}
