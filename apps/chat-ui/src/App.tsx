import {
  type ChatEngine,
  createChatEngine,
  describeError,
  eventsToTurns,
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@felix/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle } from '@felix/ui/sheet';
import {
  BotIcon,
  ClockIcon,
  EllipsisIcon,
  FlaskConicalIcon,
  GitBranchIcon,
  HistoryIcon,
  PanelRightIcon,
  PlusIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
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
  listManifests,
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
import { AgentSheet } from '@/components/agent/agent-sheet';
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input';
import { ApprovalBanner } from '@/components/chat/approval-banner';
import { Conversation } from '@/components/chat/conversation';
import { Greeting } from '@/components/chat/greeting';
import { Message } from '@/components/chat/message';
import { MultimodalInput } from '@/components/chat/multimodal-input';
import type { SlashCommand } from '@/components/chat/slash-commands';
import { ThreadList } from '@/components/chat/thread-list';
import { UiPromptBanner } from '@/components/chat/ui-prompt-banner';
import { WorkspaceStrip } from '@/components/chat/workspace-strip';
import { EvalSheet } from '@/components/eval/eval-sheet';
import { Inspector, type SkillState } from '@/components/inspector/inspector';
import { JobsSheet } from '@/components/jobs/jobs-sheet';
import { ManifestsSheet } from '@/components/manifests/manifests-sheet';
import { SheetBoundary } from '@/components/sheet-boundary';
import { useTheme } from '@/components/theme-provider';
import { ThemeToggle } from '@/components/theme-toggle';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useHarnessReachable } from '@/lib/connection';
import { executeClientTool, readWorkspaceFile } from '@/lib/cowork';
import { armNotifications, clearNotification, setPresence } from '@/lib/presence';
import {
  indexThread,
  listThreads,
  loadTurns,
  migrateLegacy,
  removeThread,
  saveTurns,
} from '@/lib/threads';
import type { ChatMessage, ImageAttachment, ThinkingLevel, Turn } from '@/types';

const THREAD_KEY = 'felix.threadId';
const MANIFEST_KEY = 'felix.manifest';
/** How long a deleted conversation can be restored, and how long the server delete waits. */
const DELETE_UNDO_MS = 7000;

const HISTORY_KEY = 'felix.historyOpen';
const INSPECTOR_KEY = 'felix.inspectorOpen';
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
/** Bundled workspace agent. */
const DEFAULT_MANIFEST = 'cowork';
/** How often to ask the harness for approvals while a run is in flight. */
const APPROVAL_POLL_MS = 2_500;

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

export default function App() {
  const [manifests, setManifests] = useState<string[]>([]);
  const [manifest, setManifest] = useState(() => {
    const stored = localStorage.getItem(MANIFEST_KEY)?.trim();
    return stored || DEFAULT_MANIFEST;
  });
  const [threadId, setThreadId] = useState(
    () => localStorage.getItem(THREAD_KEY) ?? crypto.randomUUID(),
  );
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
  // History open by default only when there are prior threads; inspector off
  // so chat owns the first viewport.
  const [historyOpen, setHistoryOpen] = useState(() =>
    readBool(HISTORY_KEY, listThreads().length > 0),
  );
  const [inspectorOpen, setInspectorOpen] = useState(() => readBool(INSPECTOR_KEY, false));
  const [verbose, setVerbose] = useState(() => readBool(VERBOSE_KEY, false));
  const [evalOpen, setEvalOpen] = useState(false);
  const [manifestsOpen, setManifestsOpen] = useState(false);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [skills, setSkills] = useState<SkillState | null>(null);
  const { resolved, setTheme } = useTheme();

  const leaseTokenRef = useRef<string | null>(null);
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
        if (verboseRef.current) setInspectorOpen(true);
      },
      onSkills: setSkills,
    });
    engineRef.current.setTurns(loadTurns(localStorage.getItem(THREAD_KEY) ?? ''));
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
  /**
   * Read inside `send`, which is memoised on other things — a ref keeps the
   * "no steering during a reattach" guard correct without rebuilding it.
   */
  const reattachingRef = useRef(reattaching);
  reattachingRef.current = reattaching;
  useEffect(() => {
    threadIdRef.current = threadId;
  }, [threadId]);
  useEffect(() => {
    verboseRef.current = verbose;
  }, [verbose]);

  useEffect(() => localStorage.setItem(THREAD_KEY, threadId), [threadId]);
  useEffect(() => localStorage.setItem(MANIFEST_KEY, manifest), [manifest]);
  // Content-driven, not device-driven. The chat column wants ~560px before the
  // transcript and composer start to feel cramped, and the two rails cost 592px of
  // chrome, so both fit inline down to 1152. Below that the inspector becomes a
  // drawer, which buys the chat back to ~790px; below 1024 the history rail follows
  // and the transcript gets the full width. Neither rail ever squeezes the chat
  // instead of yielding, which is what the old fixed-width flex row did all the way
  // down to a 168px transcript.
  //
  // The inspector is kept inline as long as it fits rather than switching at a round
  // number: it is a reference panel read *beside* the chat, and a drawer covers the
  // thing it is describing. The drawer is the fallback for widths with no room, not
  // the preferred form.
  const harnessReachable = useHarnessReachable();
  const inspectorInline = useMediaQuery('(min-width: 1152px)');
  const historyInline = useMediaQuery('(min-width: 1024px)');

  useEffect(() => localStorage.setItem(HISTORY_KEY, historyOpen ? '1' : '0'), [historyOpen]);
  useEffect(() => localStorage.setItem(INSPECTOR_KEY, inspectorOpen ? '1' : '0'), [inspectorOpen]);
  useEffect(() => localStorage.setItem(VERBOSE_KEY, verbose ? '1' : '0'), [verbose]);
  useEffect(() => saveTurns(threadId, turns), [threadId, turns]);

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
    listManifests(ctrl.signal)
      .then((names) => {
        if (!names.length) return;
        setManifests(names);
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

  // On mount: migrate legacy storage, load the thread list, and hydrate the
  // active thread from local cache + server. Intentionally runs once.
  // mount-only bootstrap
  useEffect(() => {
    migrateLegacy(Date.now());
    void refreshThreads();
    engine.setTurns(loadTurns(threadId));
    hydrateFromServer(threadId);
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

  const newThread = useCallback(() => {
    stopRun();
    setThreadId(crypto.randomUUID());
    setSkills(null);
    engine.reset();
  }, [engine, stopRun]);

  const selectThread = useCallback(
    (id: string) => {
      if (id === threadId) return;
      stopRun();
      setThreadId(id);
      engine.reset();
      engine.setTurns(loadTurns(id));
      setSkills(null);
      hydrateFromServer(id);
    },
    [engine, threadId, hydrateFromServer, stopRun],
  );

  /** POST /chat/sessions/name — a durable name, replacing the derived title. */
  const renameThread = useCallback(
    (id: string, name: string) => {
      void renameSession(id, name)
        .then(() => refreshThreads())
        .catch((err) => {
          const described = describeError(err, 'rename this conversation');
          toast.error(described.message, { description: described.detail });
        });
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
          selectThread(newId);
          toast.success('Duplicated');
        })
        .catch((err) => {
          const described = describeError(err, 'duplicate this conversation');
          toast.error(described.message, { description: described.detail });
        });
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
      toast.promise(compactSession(id, target?.manifest || manifest), {
        loading: 'Compacting…',
        success: 'Context compacted',
        error: (err) => describeError(err, 'compact this conversation').message,
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
      .catch((err) => {
        const described = describeError(err, 'export this conversation');
        toast.error(described.message, { description: described.detail });
      });
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
      let undone = false;
      const commit = window.setTimeout(() => {
        if (!undone) void deleteThreadHistory(id).catch(() => {});
      }, DELETE_UNDO_MS);

      toast('Conversation deleted', {
        duration: DELETE_UNDO_MS,
        action: {
          label: 'Undo',
          onClick: () => {
            undone = true;
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

  // Deliberately bare: `ApprovalDecision` owns the in-flight guard and both
  // toasts, so this does the work and lets a failure propagate to it.
  const onDecide = useCallback(
    async (status: 'approved' | 'denied') => {
      if (!pending) return;
      await decideApproval(pending.approvalId, { status });
      engine.shiftApproval();
    },
    [engine, pending],
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

  const send = useCallback(
    (text: string, attachments?: ImageAttachment[], mode: 'stream' | 'background' = 'stream') => {
      // A reattach keeps `streaming` true, but there is no run to steer — this
      // one was torn down when the connection dropped. Queueing a steer here
      // would report "Steer queued" and then sit unread until some later turn
      // drained it, which is worse than declining.
      if (reattachingRef.current) {
        toast.message('Rejoining this thread — stop it first to send.');
        return;
      }
      if (streaming) {
        if (text.trim()) {
          void steerChat({ threadId, text: text.trim() })
            .then(() => toast.message('Steer queued'))
            .catch((err) => toast.error(String((err as Error)?.message ?? err)));
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
    const messagesToSend: ChatMessage[] = replay
      .filter((t) => t.content.trim().length > 0)
      .map((t) => ({ role: t.role, content: t.content }));
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
      .catch((err) => toast.error(String((err as Error)?.message ?? err)));
  }, [streaming, threadId, manifest, hydrateFromServer]);

  const cycleThinking = useCallback(() => {
    const idx = THINKING_LEVELS.indexOf(thinkingLevel);
    const next = THINKING_LEVELS[(idx + 1) % THINKING_LEVELS.length]!;
    setThinkingLevelState(next);
    void setThinkingLevel({ threadId, thinkingLevel: next })
      .then(() => toast.message(`Thinking: ${next}`))
      .catch((err) => toast.error(String((err as Error)?.message ?? err)));
  }, [thinkingLevel, threadId]);

  const chooseThinking = useCallback(
    (level: ThinkingLevel) => {
      setThinkingLevelState(level);
      void setThinkingLevel({ threadId, thinkingLevel: level })
        .then(() => toast.message(`Thinking: ${level}`))
        .catch((err) => toast.error(String((err as Error)?.message ?? err)));
    },
    [threadId],
  );

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
        const described = describeError(err, 'label this message');
        toast.error(described.message, { description: described.detail });
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
                        .catch((err) => {
                          const described = describeError(err, 'undo the rewind');
                          toast.error(described.message, { description: described.detail });
                        });
                    },
                  },
                }
              : undefined,
          );
        })
        .catch((err) => {
          const described = describeError(err, 'rewind this thread');
          toast.error(described.message, { description: described.detail });
        })
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
        await respondUiRequest({ requestId: uiPrompt.requestId, value });
        engine.clearUiPrompt();
      } catch (err) {
        toast.error(String((err as Error)?.message ?? err));
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
        cancelled: true,
        note: 'cancelled',
      });
      engine.clearUiPrompt();
    } catch (err) {
      toast.error(String((err as Error)?.message ?? err));
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
  const modelOptions = useMemo(() => options.map((id) => ({ id, label: id })), [options]);

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border/60 px-3">
        <Button
          variant={historyOpen ? 'secondary' : 'ghost'}
          size="icon-sm"
          onClick={() => setHistoryOpen((o) => !o)}
          aria-label="Toggle history"
          title="Conversation history"
        >
          <HistoryIcon className="size-4" />
        </Button>
        <div className="flex min-w-0 items-center gap-2 px-1.5">
          {/* Wordmark: caps via CSS, not in the string, so the accessible name
              and anything copied out stay the proper noun. */}
          <span className="truncate font-semibold uppercase tracking-wider">Felix</span>
          {verbose && (
            <Badge variant="secondary" className="hidden font-normal sm:inline-flex">
              Verbose
            </Badge>
          )}
          {canary && (
            <Badge
              variant={canary.onCanary ? 'default' : 'secondary'}
              className="hidden font-normal sm:inline-flex"
              title={
                canary.onCanary
                  ? `This thread is served by canary v${canary.version} (rollout at ${canary.weight}%).`
                  : `Canary rollout in flight: v${canary.version} at ${canary.weight}%. ` +
                    'This thread is not confirmed to be on it.'
              }
            >
              {canary.onCanary
                ? `canary v${canary.version}`
                : `canary v${canary.version}${canary.weight < 100 ? ` @ ${canary.weight}%` : ''}`}
            </Badge>
          )}
          {thinkingLevel !== 'off' && (
            <Badge variant="outline" className="hidden font-normal sm:inline-flex">
              think:{thinkingLevel}
            </Badge>
          )}
          {sessionPhase && sessionPhase !== 'idle' && (
            <Badge variant="secondary" className="hidden font-normal sm:inline-flex">
              {sessionPhase}
            </Badge>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="default"
            size="sm"
            onClick={newThread}
            disabled={streaming}
            className="gap-1.5 rounded-full px-3"
          >
            <PlusIcon className="size-4" />
            <span className="hidden sm:inline">New chat</span>
          </Button>
          <ThemeToggle />
          <Button
            variant={inspectorOpen ? 'secondary' : 'ghost'}
            size="icon-sm"
            onClick={() => setInspectorOpen((o) => !o)}
            aria-label="Toggle inspector"
            title="Inspector"
          >
            <PanelRightIcon className="size-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="More tools">
                <EllipsisIcon className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
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
              <DropdownMenuLabel>Session</DropdownMenuLabel>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Thinking: {thinkingLevel}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-40">
                  <DropdownMenuRadioGroup
                    value={thinkingLevel}
                    onValueChange={(v) => chooseThinking(v as ThinkingLevel)}
                  >
                    {THINKING_LEVELS.map((level) => (
                      <DropdownMenuRadioItem key={level} value={level}>
                        {level}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem disabled={streaming} onSelect={() => continueRun()}>
                Continue run
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Tools</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setAgentOpen(true)}>
                <BotIcon className="size-4" />
                Agent spec
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setManifestsOpen(true)}>
                <GitBranchIcon className="size-4" />
                Manifests
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setJobsOpen(true)}>
                <ClockIcon className="size-4" />
                Jobs
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setEvalOpen(true)}>
                <FlaskConicalIcon className="size-4" />
                Eval
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled
                className="font-mono text-xs text-muted-foreground data-disabled:opacity-100"
              >
                {threadId.slice(0, 8)}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {historyOpen && historyInline && (
          <ThreadList
            threads={threads}
            currentId={threadId}
            disabled={streaming}
            onSelect={selectThread}
            onNew={newThread}
            onDelete={deleteThread}
            onRename={renameThread}
            onFork={forkThread}
            onCompact={compactThread}
            onExport={exportThread}
          />
        )}
        <main className="flex min-w-0 flex-1 flex-col">
          <Conversation>
            {turns.length === 0 && (
              <Greeting manifest={manifest} disabled={streaming} onSend={send} />
            )}
            {turns.map((t, i) => {
              const isLast = i === turns.length - 1;
              return (
                <Message
                  key={t.id}
                  turn={t}
                  streaming={streaming && isLast}
                  verbose={verbose}
                  onRegenerate={isLast && t.role === 'assistant' ? regenerate : undefined}
                  onRewind={
                    !streaming && t.eventId && !isLast ? () => rewindTo(t.eventId!) : undefined
                  }
                  {...(t.eventId && labels[t.eventId] !== undefined
                    ? { label: labels[t.eventId] }
                    : {})}
                  {...(t.eventId ? { onLabel: (next) => labelTurn(t.eventId!, next) } : {})}
                />
              );
            })}
            {reattaching && (
              <div
                role="status"
                className="mx-auto max-w-2xl rounded-lg border border-state-running/30 bg-state-running/10 px-3 py-2 text-sm text-state-running"
              >
                Connection dropped. That run was stopped — showing what it finished, and anything
                still landing on this thread.
              </div>
            )}
            {error && (
              <div
                role="alert"
                className="mx-auto max-w-2xl rounded-lg border border-state-failed/30 bg-state-failed/10 px-3 py-2 text-sm text-state-failed"
              >
                {error}
              </div>
            )}
          </Conversation>
          <div className="border-t border-border/50 bg-background/80 pt-3 backdrop-blur-sm">
            {pending ? (
              <ApprovalBanner
                pending={pending}
                queueLength={pendingQueue.length}
                runAborted={sessionPhase === 'aborted'}
                onDecide={onDecide}
              />
            ) : null}
            {uiPrompt ? (
              <UiPromptBanner
                pending={uiPrompt}
                resolving={uiResolving}
                onRespond={(value) => void onUiRespond(value)}
                onCancel={() => void onUiCancel()}
              />
            ) : null}
            {manifest === DEFAULT_MANIFEST ? <WorkspaceStrip /> : null}
            <MultimodalInput
              status={streaming ? 'streaming' : 'ready'}
              reattaching={reattaching}
              isConnected={harnessReachable}
              onSubmit={submit}
              onBackground={(message) => submit(message, 'background')}
              onStop={stopRun}
              onSlashCommand={onSlashCommand}
              models={modelOptions}
              modelId={manifest}
              onModelChange={setManifest}
              placeholder={
                streaming
                  ? 'Type to steer the run…'
                  : manifest === DEFAULT_MANIFEST
                    ? 'Describe a workspace goal…'
                    : 'Message Felix…'
              }
            />
          </div>
        </main>
        {inspectorOpen && inspectorInline && (
          <Inspector
            open={inspectorOpen}
            onClose={() => setInspectorOpen(false)}
            skills={skills}
            onSuggest={send}
            busy={streaming}
          />
        )}
      </div>

      {/* Below their breakpoints the same rails become overlays. Same components and
          same toggle state, so the header buttons keep working and nothing is
          reachable in one layout but missing in the other. */}
      {!historyInline && (
        <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
          <SheetContent side="left" className="w-[17rem] gap-0 p-0 sm:max-w-none">
            <SheetTitle className="sr-only">Conversation history</SheetTitle>
            <ThreadList
              threads={threads}
              currentId={threadId}
              disabled={streaming}
              onSelect={(id) => {
                selectThread(id);
                setHistoryOpen(false);
              }}
              onNew={() => {
                newThread();
                setHistoryOpen(false);
              }}
              onDelete={deleteThread}
              onRename={renameThread}
              onFork={(id) => {
                forkThread(id);
                setHistoryOpen(false);
              }}
              onCompact={compactThread}
              onExport={exportThread}
              // The drawer supplies its own close button in the top-right corner, which
              // would otherwise land on top of this rail's "New chat" control.
              className="w-full border-r-0 bg-transparent [&>div:first-child]:pr-11"
            />
          </SheetContent>
        </Sheet>
      )}
      {!inspectorInline && (
        <Sheet open={inspectorOpen} onOpenChange={setInspectorOpen}>
          <SheetContent
            side="right"
            showCloseButton={false}
            className="w-[22rem] gap-0 p-0 sm:max-w-none"
          >
            <SheetTitle className="sr-only">Harness inspector</SheetTitle>
            <Inspector
              open={inspectorOpen}
              onClose={() => setInspectorOpen(false)}
              skills={skills}
              onSuggest={(text) => {
                send(text);
                setInspectorOpen(false);
              }}
              busy={streaming}
              className="w-full border-l-0 bg-transparent"
            />
          </SheetContent>
        </Sheet>
      )}
      {/*
        Each sheet is wrapped, not the group: a sheet throws during its own render,
        so a boundary around all four would catch the first failure and take the
        other three down with it.
      */}
      <SheetBoundary
        open={evalOpen}
        onOpenChange={setEvalOpen}
        title="Eval harness"
        className="w-full gap-0 p-0 sm:max-w-xl"
      >
        <EvalSheet open={evalOpen} onOpenChange={setEvalOpen} manifest={manifest} />
      </SheetBoundary>
      <SheetBoundary
        open={manifestsOpen}
        onOpenChange={setManifestsOpen}
        title="Manifest lifecycle"
        className="w-full gap-0 p-0 sm:max-w-xl"
      >
        <ManifestsSheet
          open={manifestsOpen}
          onOpenChange={(o) => {
            setManifestsOpen(o);
            if (!o) void refreshCanary();
          }}
          manifest={manifest}
        />
      </SheetBoundary>
      <SheetBoundary
        open={jobsOpen}
        onOpenChange={setJobsOpen}
        title="Scheduled jobs"
        className="w-full gap-0 p-0 sm:max-w-xl"
      >
        <JobsSheet
          open={jobsOpen}
          onOpenChange={setJobsOpen}
          manifest={manifest}
          manifestOptions={options}
        />
      </SheetBoundary>
      <SheetBoundary
        open={agentOpen}
        onOpenChange={setAgentOpen}
        title="Agent spec"
        className="w-full gap-0 p-0 sm:max-w-md"
      >
        <AgentSheet open={agentOpen} onOpenChange={setAgentOpen} manifest={manifest} />
      </SheetBoundary>
    </div>
  );
}
