import {
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
import {
  BirdIcon,
  CopyIcon,
  EllipsisIcon,
  MessageSquareIcon,
  MonitorIcon,
  MoonIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PlusIcon,
  ScrollTextIcon,
  ServerIcon,
  SunIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link, Outlet, useMatch, useNavigate } from 'react-router';
import { toast } from 'sonner';
import {
  abortChat,
  acquireSessionLease,
  compactSession,
  continueChat,
  decideApproval,
  deleteThreadHistory,
  exportSession,
  felix,
  forkSession,
  getResolvedManifest,
  getSessionSnapshot,
  getThreadHistory,
  listManifestEntries,
  listSessions,
  listTenantManifests,
  releaseSessionLease,
  renameSession,
  respondUiRequest,
  rewindChat,
  setSessionLabel,
  setThinkingLevel,
  steerChat,
} from '@/api';
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input';
import { AttentionLine } from '@/components/attention-line';
import { REATTACHING_REFUSAL } from '@/components/chat/multimodal-input';
import type { SlashCommand } from '@/components/chat/slash-commands';
import type { SkillState } from '@/components/inspector/primitives';
import { type Theme, useTheme } from '@/components/theme-provider';
import { usePendingApprovals } from '@/hooks/use-pending-approvals';
import { useRails } from '@/hooks/use-rails';
import { useShortcuts } from '@/hooks/use-shortcuts';
import { useHarnessReachable } from '@/lib/connection';
import { executeClientTool, readWorkspaceFile } from '@/lib/cowork';
import { toastError, toastProblem } from '@/lib/error-toast';
import { middleTruncate } from '@/lib/format';
import { DEFAULT_MANIFEST } from '@/lib/manifests';
import { armNotifications, clearNotification, setPresence } from '@/lib/presence';
import { ariaShortcut, isMacPlatform, shortcutLabel, whenMounted } from '@/lib/shortcuts';
import { recallTabThread, rememberTabThread } from '@/lib/tab-thread';
import {
  indexThread,
  listThreads,
  loadTurns,
  migrateLegacy,
  removeThread,
  saveTurns,
} from '@/lib/threads';
import { cn } from '@/lib/utils';
import { NO_RUN, type RunClock, ShellProvider, type ShellValue } from '@/shell-context';
import type { ChatMessage, ImageAttachment, ThinkingLevel, Turn } from '@/types';

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
/** How long past an approval's deadline to re-ask, so the harness has denied it by then. */
const LAPSE_GRACE_MS = 2_000;

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
  if (routeThread) activeThread.current = routeThread;
  // A cold load on `/harness` has no thread yet; the tab's last one is the one
  // "keeps the thread the tab was already on" means after a reload.
  activeThread.current ??= (freshRoute ? null : recallTabThread()) ?? crypto.randomUUID();
  const threadId = activeThread.current;
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
  // Workspace open by default only when there are prior threads; instrument off
  // so chat owns the first viewport. What is persisted is the *inline*
  // preference — a drawer at a narrow width starts closed and is never written
  // down; `useRails` says why.
  const { historyOpen, setHistoryOpen, inspectorOpen, setInspectorOpen, revealInspector } =
    useRails(() => listThreads().length > 0);
  const [verbose, setVerbose] = useState(() => readBool(VERBOSE_KEY, false));
  const [skills, setSkills] = useState<SkillState | null>(null);
  const { theme, resolved, setTheme } = useTheme();
  /** Where focus lands when the Verbose badge turns verbose off and unmounts. */
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  const leaseTokenRef = useRef<string | null>(null);
  /** Which thread the engine currently holds — see `loadThread`. */
  const loadedThreadRef = useRef<string | null>(null);
  /**
   * `hydrateFromServer`, for the engine's callbacks.
   *
   * The engine is built once, above the callback's own declaration, and must not
   * be rebuilt when it changes — a new engine mid-run is a lost run.
   */
  const hydrateFromServerRef = useRef<(id: string) => void>(() => {});
  const verboseRef = useRef(verbose);
  const threadIdRef = useRef(threadId);

  /**
   * The conversation itself — every SSE frame, the durable-run and reattach
   * paths, the approval queue and the UI prompt — lives in `@felix/client`, so
   * this component renders it rather than implementing it. Created once and
   * mirrored below; the ports are the three things only a browser can do.
   */
  const engineRef = useRef<ChatEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = createChatEngine({
      client: felix,
      threadId: () => threadIdRef.current,
      clientTools: { execute: executeClientTool, readForDiff: readWorkspaceFile },
      onToolStart: () => {
        if (verboseRef.current) revealInspector();
      },
      onSkills: setSkills,
      /**
       * Re-read the session once a durable run lands.
       *
       * Its stream carried the answer and nothing else — no deltas, no tool
       * frames — so the tool cards, and the workspace zone's "touched this
       * session" list that is derived from them, are empty until something
       * re-reads the harness's own transcript. Before this they stayed empty
       * until the operator happened to reload.
       *
       * Reading `threadIdRef` rather than closing over a thread: the engine is
       * created once and the run may well finish on a thread the operator has
       * since left, in which case `hydrateFromServer` drops the result itself.
       */
      onDurableComplete: () => hydrateFromServerRef.current(threadIdRef.current),
    });
    // Seeded from the thread *the address names*, so the first paint is this
    // thread's transcript rather than an empty one — and, on a deep link, not
    // some other thread's. It used to read a `felix.threadId` key holding the
    // last thread this tab was on, which was the same answer back when that key
    // chose the thread and is the wrong one now that the URL does. That key is
    // no longer written at all: the address is where a thread is remembered, and
    // `migrateLegacy` reads only what a pre-multi-thread build left behind.
    engineRef.current.setTurns(loadTurns(threadId));
  }
  const engine = engineRef.current;
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
   * Mirrored at render rather than from an effect. The engine reads this for
   * every request it makes, and `hydrateFromServer` compares a slow response
   * against it to decide whether that response still belongs to the thread on
   * screen. An effect leaves it one render behind, which on a thread change
   * driven by Back or a pasted link is long enough to matter.
   */
  threadIdRef.current = threadId;
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

  const hydrateFromServer = useCallback((id: string) => {
    void (async () => {
      try {
        const snap = await getSessionSnapshot(id);
        if (snap && id === threadIdRef.current) setLabels(snap.labels ?? {});
        if (snap?.transcript?.length) {
          const rebuilt = eventsToTurns(snapshotToEvents(snap));
          if (rebuilt.length && id === threadIdRef.current) {
            engine.setTurns(rebuilt);
            saveTurns(id, rebuilt);
          }
          if (snap.thinkingLevel && THINKING_LEVELS.includes(snap.thinkingLevel as ThinkingLevel)) {
            setThinkingLevelState(snap.thinkingLevel as ThinkingLevel);
          }
          if (snap.phase) engine.setPhase(snap.phase);
          return;
        }
        const h = await getThreadHistory(id);
        if (!h || h.events.length === 0) return;
        const rebuilt = eventsToTurns(h.events);
        if (rebuilt.length && id === threadIdRef.current) {
          engine.setTurns(rebuilt);
          saveTurns(id, rebuilt);
        }
      } catch {
        // local cache remains source of truth
      }
    })();
  }, []);
  hydrateFromServerRef.current = hydrateFromServer;

  const attachLease = useCallback(async (id: string) => {
    try {
      const result = await acquireSessionLease({
        threadId: id,
        holderId: tabHolderId(),
        mode: 'exclusive',
      });
      if (result.ok && result.token) leaseTokenRef.current = result.token;
      else if (!result.ok) {
        // Another tab holds exclusive — attach as shared observer.
        const shared = await acquireSessionLease({
          threadId: id,
          holderId: tabHolderId(),
          mode: 'shared',
        });
        if (shared.token) leaseTokenRef.current = shared.token;
      }
    } catch {
      // leases are best-effort
    }
  }, []);

  const detachLease = useCallback(async (id: string) => {
    const token = leaseTokenRef.current;
    leaseTokenRef.current = null;
    await releaseSessionLease({
      threadId: id,
      holderId: tabHolderId(),
      token: token ?? undefined,
    });
  }, []);

  // Mount-only: storage migration and the thread index. Everything thread-scoped
  // is `loadThread`'s, below, because it now has more than one way to happen.
  useEffect(() => {
    migrateLegacy(Date.now());
    void refreshThreads();
  }, []);

  // Exclusive lease while this tab is attached to a thread.
  useEffect(() => {
    void attachLease(threadId);
    return () => {
      void detachLease(threadId);
    };
  }, [threadId, attachLease, detachLease]);

  const stopRun = useCallback(() => {
    const tid = threadIdRef.current;
    void abortChat(tid).catch(() => {});
    engine.abort();
    engine.setPhase('aborted');
  }, [engine]);

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
      engine.reset();
      engine.setTurns(loadTurns(id));
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
      if (hydrate) hydrateFromServer(id);
    },
    [engine, hydrateFromServer],
  );

  useEffect(() => {
    // A thread reached by link or by Back has server state worth asking for; one
    // `/` minted a moment ago does not.
    loadThread(threadId, routeThread !== null);
  }, [threadId, routeThread, loadThread]);

  const newThread = useCallback(() => {
    stopRun();
    const id = crypto.randomUUID();
    // Nothing to hydrate: the id was minted a line ago, so the snapshot request
    // would be a round trip to be told the thread does not exist yet.
    loadThread(id, false);
    navigate(`/t/${id}`);
  }, [stopRun, loadThread, navigate]);

  const selectThread = useCallback(
    (id: string) => {
      if (id === threadId) return;
      stopRun();
      loadThread(id);
      navigate(`/t/${id}`);
    },
    [threadId, stopRun, loadThread, navigate],
  );

  /** POST /chat/sessions/name — a durable name, replacing the derived title. */
  const renameThread = useCallback(
    (id: string, name: string) => {
      void renameSession(id, name)
        .then(() => refreshThreads())
        .catch((err) =>
          toastError(err, 'rename this conversation', { retry: () => renameThread(id, name) }),
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
        .catch((err) =>
          toastError(err, 'duplicate this conversation', { retry: () => forkThread(id) }),
        );
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
          toastError(err, 'compact this conversation');
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
      .catch((err) =>
        toastError(err, 'export this conversation', { retry: () => exportThread(id) }),
      );
  }, []);

  const deleteThread = useCallback(
    (id: string) => {
      // Capture enough to put it back before anything is destroyed.
      const meta = listThreads().find((t) => t.id === id);
      const turns = loadTurns(id);

      removeThread(id);
      const remaining = listThreads();
      setThreads(remaining);
      if (id === threadId) {
        if (remaining.length) selectThread(remaining[0].id);
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
        void deleteThreadHistory(id).catch(() => {});
      }, DELETE_UNDO_MS);

      toast('Conversation deleted', {
        duration: DELETE_UNDO_MS,
        action: {
          label: 'Undo',
          onClick: () => {
            if (committed) {
              toastProblem(
                'Too late to undo. This conversation was already deleted on the harness.',
              );
              return;
            }
            window.clearTimeout(commit);
            if (meta) indexThread(meta);
            if (turns.length) saveTurns(id, turns);
            void refreshThreads();
          },
        },
      });
    },
    [threadId, selectThread, newThread],
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
    ) => engine.send({ manifest, messages: messagesToSend, assistantId, mode }),
    [engine, manifest],
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
    if (streaming) setRunClock({ startedAt: Date.now(), endedAt: null });
    else
      setRunClock((c) =>
        c.startedAt !== null && c.endedAt === null ? { ...c, endedAt: Date.now() } : c,
      );
  }, [streaming]);
  useEffect(() => {
    setRunClock((c) => (c.startedAt === null ? c : NO_RUN));
  }, [threadId]);

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

  // A run may already have been waiting on one before this tab loaded.
  useEffect(() => {
    void syncApprovals();
  }, [syncApprovals]);

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
  useEffect(() => {
    if (!streaming) return;
    const timer = window.setInterval(() => void syncApprovals(), APPROVAL_POLL_MS);
    return () => window.clearInterval(timer);
  }, [streaming, syncApprovals]);

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
  useEffect(() => {
    if (pendingQueue.length > 0 || uiPrompt) setPresence('blocked');
    else if (streaming) setPresence('working');
    else setPresence('idle');
  }, [pendingQueue.length, uiPrompt, streaming]);

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
  useShortcuts(onHarness ? 'harness' : 'workbench', {
    'toggle-workspace': () => setHistoryOpen((o) => !o),
    'toggle-instrument': () => setInspectorOpen((o) => !o),
    'open-threads': () => {
      // The popover hangs off the workspace, so the zone has to be open first —
      // inline or as the drawer, whichever this width gets.
      setHistoryOpen(true);
      whenMounted('[data-shortcut="threads"]', (el) => el.click());
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
    (text: string, attachments?: ImageAttachment[], mode: 'stream' | 'background' = 'stream') => {
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
      void streamInto([userMessage], assistantId, mode);
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
    void deleteThreadHistory(threadId).then(() => streamInto(messagesToSend, assistantId));
  }, [engine, streaming, turns, threadId, streamInto]);

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

  // Map a composer submission (text + browser File parts, already converted to
  // data URLs by PromptInput) onto our send(). Image parts become attachments.
  const submit = useCallback(
    (message: PromptInputMessage, mode: 'stream' | 'background' = 'stream') => {
      // Permission is asked for here, inside the click, and only for the mode
      // that needs it. Prompting on load is how a page trains people to say no.
      if (mode === 'background') void armNotifications();
      const attachments: ImageAttachment[] = message.files
        .filter((f) => f.mediaType.startsWith('image/'))
        .map((f) => ({ url: f.url, media_type: f.mediaType, filename: f.filename }));
      send(message.text, attachments, mode);
    },
    [send],
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
    error,
    sessionPhase,
    skills,
    pending,
    queueLength: pendingQueue.length,
    approvalQueue: pendingQueue,
    bannerOwned,
    tenantApprovals,
    runClock,
    onDecide,
    onDismiss,
    uiPrompt,
    uiResolving,
    onUiRespond: (value) => void onUiRespond(value),
    onUiCancel: () => void onUiCancel(),
    threadId,
    labels,
    labelTurn,
    send,
    submit,
    stopRun,
    regenerate,
    rewindTo,
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
    <div className="flex h-screen flex-col bg-background">
      <header className="flex h-[var(--header-height)] shrink-0 items-center gap-1 border-b border-border/60 px-3">
        {!onHarness && (
          <Button
            variant={historyOpen ? 'secondary' : 'ghost'}
            size="icon-sm"
            onClick={() => setHistoryOpen((o) => !o)}
            // What is on screen, not what is stored: at a narrow width the
            // stored rail preference is not what the operator is looking at.
            aria-pressed={historyOpen}
            // The tooltip's word, so the name a reader hears and the one a
            // sighted operator sees are one name; `aria-pressed` says the rest.
            aria-label="Workspace"
            aria-keyshortcuts={ariaShortcut('toggle-workspace', mac)}
            title={`Workspace (${shortcutLabel('toggle-workspace', mac)})`}
          >
            <PanelLeftIcon className="size-4" />
          </Button>
        )}
        {/* The toggle's slot, held empty where the toggle has nothing to toggle.
            Without it the wordmark moved 36px left on every switch between the
            two addresses — the one element that should not move at all. */}
        {onHarness && (
          <span aria-hidden data-slot="workspace-toggle-slot" className="size-8 shrink-0" />
        )}
        {/* The left cluster yields in a fixed order, because at 390px with both
            modes on and a run blocked it holds more than its space. Before the
            order was written down, every child was `shrink-0` except the
            wordmark, so the wordmark was what gave: "F…", then nothing, and the
            canary pill ran on under New chat.

            So: the wordmark and the run state never shrink. Below `sm` the two
            modes draw as icons, keeping their words for a reader, and while a
            run state is on screen they step aside (see the modes' row). Past
            that — a 320px viewport, where the wordmark and the chip alone are
            wider than the room — the cluster clips at its own edge rather than
            running under the right cluster, which holds the controls. `py-1`
            is room for a focus ring the clip would otherwise cut. */}
        <div className="flex min-w-0 items-center gap-2 overflow-hidden px-1.5 py-1">
          {/* Wordmark: caps via CSS, not in the string, so the accessible name
              and anything copied out stay the proper noun.

              An `h1` because the document had none — every page began at `h2`,
              so there was no top-level heading naming the application for anyone
              navigating by heading. */}
          <h1 className="shrink-0 text-base font-semibold uppercase tracking-wider">Felix</h1>
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
              className="inline-flex h-5.5 shrink-0 items-center gap-1 rounded-full border border-transparent bg-state-blocked/10 px-2 py-0.5 text-xs font-medium text-state-blocked"
            >
              <span aria-hidden className="size-1.5 rounded-full bg-state-blocked" />
              <span className="sr-only">This thread's run: </span>
              blocked
            </span>
          ) : streaming ? (
            <span
              data-slot="run-state"
              title="This thread's run is in progress"
              className="inline-flex h-5.5 shrink-0 items-center gap-1 rounded-full border border-transparent bg-state-running/10 px-2 py-0.5 text-xs font-medium text-state-running"
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
                    className="cursor-pointer hover:bg-secondary/80"
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

        {/* `shrink-0`: the controls are what the left cluster yields to, never
            the other way round. */}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {/* Conversation controls stay with the conversation. On `/harness` —
              whose premise is what outlives every run — New chat, the instrument
              and the Session menu's run verbs act on a transcript that is not on
              screen. The door back to Chat is the one way to them. It is plain
              navigation: the run's state is in the slot beside the wordmark,
              which is there on both addresses. */}
          {!onHarness && (
            <Button
              variant="ghost"
              size="sm"
              onClick={newThread}
              disabled={streaming}
              className="gap-1.5"
              title="New chat"
            >
              <PlusIcon className="size-4" aria-hidden />
              {/* `sr-only` below `sm` rather than `hidden`, so the word is the
                  accessible name at every width and no `aria-label` has to
                  repeat it. */}
              <span className="sr-only sm:not-sr-only">New chat</span>
            </Button>
          )}
          {/*
            The second top-level address, and a real control rather than a menu
            item: the four workbenches behind the ellipsis were not hard to find,
            they had no home. This is the switch between the two things this
            client is — a conversation, and the harness behind it.
          */}
          {/* Always ghost: it links to the *other* address, so a "current" fill
              would mark the place you are leaving. The icon names the destination
              where there is room for it; below `sm` the door is its word alone,
              because the word is the part that cannot go and the icon's 22px is
              what lets the left cluster keep the wordmark and the run state. */}
          <Button asChild variant="ghost" size="sm" className="gap-1.5">
            <Link
              to={onHarness ? `/t/${threadId}` : '/harness'}
              title={onHarness ? 'Chat' : 'Harness'}
            >
              {onHarness ? (
                <MessageSquareIcon className="hidden size-4 sm:block" aria-hidden />
              ) : (
                <ServerIcon className="hidden size-4 sm:block" aria-hidden />
              )}
              {/* The word at every width. Below `sm` it used to be `sr-only`, so
                  on a phone the only route between the app's two addresses was a
                  server glyph beside a panel glyph — two icons that say nothing
                  about which is a place. New chat gives up its word there
                  instead: a plus is the one icon here that names its action. */}
              <span>{onHarness ? 'Chat' : 'Harness'}</span>
            </Link>
          </Button>
          {onHarness ? (
            // The instrument toggle's slot, held empty for the same reason as the
            // workspace toggle's on the left: without it the door moved on every
            // switch between the two addresses. At every width — collapsing it
            // on a phone was tried, and a door that moves is a worse cost than
            // 32px of gap; the header does not overflow at 390px with it held.
            <span aria-hidden data-slot="instrument-toggle-slot" className="size-8 shrink-0" />
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
                    disabled={streaming || turns.length === 0}
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
        </div>
      </header>

      {/*
        Always rendered, never conditional, and above the `<Outlet/>` so it is the
        same line on both addresses. It answers the question an operator has
        before they have navigated anywhere, which means it cannot be somewhere
        they have to navigate to.
      */}
      <AttentionLine
        approvals={tenantApprovals}
        streaming={streaming}
        handled={bannerOwned}
        threadId={threadId}
        threads={threads}
      />

      {/*
        The address decides what renders here. The engine, the thread and the
        approval queue are above it deliberately: mounting `createChatEngine`
        inside a route would unmount it on a visit to any other address, and
        take a live run down with it.
      */}
      <ShellProvider value={shell}>
        <Outlet />
      </ShellProvider>
    </div>
  );
}
