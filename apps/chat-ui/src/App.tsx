import { summarizeToolArgs } from '@felix/cowork-client';
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  abortChat,
  acquireSessionLease,
  continueChat,
  decideApproval,
  deleteThreadHistory,
  getSessionSnapshot,
  getThreadHistory,
  listApprovals,
  listManifests,
  listTenantManifests,
  pollDurableRun,
  postToolResult,
  releaseSessionLease,
  respondUiRequest,
  rewindChat,
  setThinkingLevel,
  startChat,
  steerChat,
  streamChat,
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
import { useTheme } from '@/components/theme-provider';
import { ThemeToggle } from '@/components/theme-toggle';
import { executeClientTool, readWorkspaceFile } from '@/lib/cowork';
import {
  eventsToTurns,
  indexThread,
  listThreads,
  loadTurns,
  migrateLegacy,
  removeThread,
  saveTurns,
  snapshotToEvents,
  type ThreadMeta,
  titleFromText,
} from '@/lib/threads';
import type {
  ChatMessage,
  ImageAttachment,
  PendingApproval,
  PendingUiRequest,
  ThinkingLevel,
  ToolCall,
  Turn,
} from '@/types';

const THREAD_KEY = 'felix.threadId';
const MANIFEST_KEY = 'felix.manifest';
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
/** Bundled workspace agent — same path as float. */
const DEFAULT_MANIFEST = 'cowork';

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
  const [turns, setTurns] = useState<Turn[]>(() =>
    loadTurns(localStorage.getItem(THREAD_KEY) ?? ''),
  );
  const [threads, setThreads] = useState<ThreadMeta[]>([]);
  // Canary rollout state for the selected manifest, from the `/manifests`
  // active pointer. Deliberately *not* "which side served this thread": that
  // assignment is a server-side hash the harness does not report to clients,
  // and `GET /manifests/{name}` answers `stable` for any partial rollout
  // because it resolves without a thread id.
  const [canary, setCanary] = useState<{ version: number; weight: number } | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingQueue, setPendingQueue] = useState<PendingApproval[]>([]);
  const [deciding, setDeciding] = useState(false);
  const [uiPrompt, setUiPrompt] = useState<PendingUiRequest | null>(null);
  const [uiResolving, setUiResolving] = useState(false);
  const [thinkingLevel, setThinkingLevelState] = useState<ThinkingLevel>('off');
  const [sessionPhase, setSessionPhase] = useState<string | null>(null);
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

  const abortRef = useRef<AbortController | null>(null);
  const leaseTokenRef = useRef<string | null>(null);
  const verboseRef = useRef(verbose);
  const threadIdRef = useRef(threadId);
  useEffect(() => {
    threadIdRef.current = threadId;
  }, [threadId]);
  useEffect(() => {
    verboseRef.current = verbose;
  }, [verbose]);

  useEffect(() => localStorage.setItem(THREAD_KEY, threadId), [threadId]);
  useEffect(() => localStorage.setItem(MANIFEST_KEY, manifest), [manifest]);
  useEffect(() => localStorage.setItem(HISTORY_KEY, historyOpen ? '1' : '0'), [historyOpen]);
  useEffect(() => localStorage.setItem(INSPECTOR_KEY, inspectorOpen ? '1' : '0'), [inspectorOpen]);
  useEffect(() => localStorage.setItem(VERBOSE_KEY, verbose ? '1' : '0'), [verbose]);
  useEffect(() => saveTurns(threadId, turns), [threadId, turns]);

  // Canary state for the selected manifest. Only tenant-managed manifests have
  // an active pointer, so a bundled one simply has no rollout and no badge.
  const refreshCanary = useCallback(async () => {
    try {
      const rows = await listTenantManifests();
      const row = rows.find((r) => r.name === manifest);
      const weight = row?.canary_weight ?? 0;
      const version = row?.canary_version ?? null;
      setCanary(version != null && weight > 0 ? { version, weight } : null);
    } catch {
      // The tenant store is optional and the route needs `manifests:read`;
      // a badge is not worth surfacing an error for.
      setCanary(null);
    }
  }, [manifest]);

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
  const hydrateFromServer = useCallback((id: string) => {
    void (async () => {
      try {
        const snap = await getSessionSnapshot(id);
        if (snap?.transcript?.length) {
          const rebuilt = eventsToTurns(snapshotToEvents(snap));
          if (rebuilt.length && id === threadIdRef.current) {
            setTurns(rebuilt);
            saveTurns(id, rebuilt);
          }
          if (snap.thinkingLevel && THINKING_LEVELS.includes(snap.thinkingLevel as ThinkingLevel)) {
            setThinkingLevelState(snap.thinkingLevel as ThinkingLevel);
          }
          if (snap.phase) setSessionPhase(snap.phase);
          return;
        }
        const h = await getThreadHistory(id);
        if (!h || h.events.length === 0) return;
        const rebuilt = eventsToTurns(h.events);
        if (rebuilt.length && id === threadIdRef.current) {
          setTurns(rebuilt);
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
    setThreads(listThreads());
    setTurns(loadTurns(threadId));
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
    abortRef.current?.abort();
    setSessionPhase('aborted');
  }, []);

  const newThread = useCallback(() => {
    stopRun();
    setThreadId(crypto.randomUUID());
    setTurns([]);
    setSkills(null);
    setError(null);
    setPendingQueue([]);
    setUiPrompt(null);
    setSessionPhase(null);
  }, [stopRun]);

  const selectThread = useCallback(
    (id: string) => {
      if (id === threadId) return;
      stopRun();
      setThreadId(id);
      setTurns(loadTurns(id));
      setSkills(null);
      setError(null);
      setUiPrompt(null);
      setSessionPhase(null);
      hydrateFromServer(id);
    },
    [threadId, hydrateFromServer, stopRun],
  );

  const deleteThread = useCallback(
    (id: string) => {
      removeThread(id);
      void deleteThreadHistory(id);
      const remaining = listThreads();
      setThreads(remaining);
      if (id === threadId) {
        if (remaining.length) selectThread(remaining[0].id);
        else newThread();
      }
    },
    [threadId, selectThread, newThread],
  );

  // Open one SSE turn: stream model deltas / tool events into the assistant
  // turn identified by `assistantId`. Shared by `send` (new user message) and
  // `regenerate` (replays prior history). Returns the streaming promise.
  const streamInto = useCallback(
    (
      messagesToSend: ChatMessage[],
      assistantId: string,
      mode: 'stream' | 'background' = 'stream',
    ) => {
      // A drained steer / follow-up splits the reply: the harness appends the
      // steer as a user message and keeps going, so the UI opens a fresh
      // assistant turn after it. Everything downstream patches whichever turn
      // is currently active, not the one we opened with.
      let activeAssistantId = assistantId;
      const patch = (fn: (t: Turn) => Turn) =>
        setTurns((prev) => prev.map((t) => (t.id === activeAssistantId ? fn(t) : t)));

      const interject = (content: string) => {
        const nextAssistantId = crypto.randomUUID();
        setTurns((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: 'user', content },
          { id: nextAssistantId, role: 'assistant', content: '', tools: [] },
        ]);
        activeAssistantId = nextAssistantId;
      };

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setStreaming(true);
      setError(null);
      setSessionPhase('turn');

      const handleEvent = async (ev: { event: string; data: Record<string, unknown> }) => {
        switch (ev.event) {
          case 'on_chat_model_stream':
          case 'text_delta': {
            const data = ev.data as { chunk?: { content?: string }; delta?: string };
            const chunk = data.delta ?? data.chunk?.content ?? '';
            if (chunk) patch((t) => ({ ...t, content: t.content + chunk }));
            break;
          }
          case 'on_tool_start':
          case 'tool_start': {
            if (verboseRef.current) setInspectorOpen(true);
            const data = ev.data as { name?: string; input?: unknown };
            patch((t) => ({
              ...t,
              tools: [
                ...(t.tools ?? []),
                { name: String(data.name ?? 'tool'), input: data.input, done: false },
              ],
            }));
            break;
          }
          case 'on_tool_end':
          case 'tool_end': {
            const data = ev.data as { name?: string; output?: unknown };
            const name = String(data.name ?? 'tool');
            patch((t) => ({ ...t, tools: closeTool(t.tools, name, data.output) }));
            captureSkills(name, data.output, setSkills);
            break;
          }
          case 'approval_required': {
            const data = ev.data as {
              approval_id: string;
              tool_name: string;
              args?: Record<string, unknown>;
              rule_id?: string;
            };
            const args = data.args ?? {};
            let before: string | null = null;
            if (data.tool_name === 'write_file' && typeof args.path === 'string') {
              before = await readWorkspaceFile(args.path);
            }
            setPendingQueue((q) => [
              ...q,
              {
                approvalId: data.approval_id,
                toolName: data.tool_name,
                args,
                ruleId: data.rule_id,
                before,
              },
            ]);
            patch((t) => ({
              ...t,
              tools: [
                ...(t.tools ?? []),
                {
                  name: `approval · ${data.tool_name}`,
                  input: summarizeToolArgs(data.tool_name, args),
                  done: false,
                },
              ],
            }));
            break;
          }
          case 'tool_request': {
            const data = ev.data as {
              id: string;
              name: string;
              args?: Record<string, unknown>;
            };
            patch((t) => ({
              ...t,
              tools: [
                ...(t.tools ?? []),
                {
                  name: `client · ${data.name}`,
                  input: data.args,
                  done: false,
                },
              ],
            }));
            const result = await executeClientTool({
              id: data.id,
              name: data.name,
              args: data.args ?? {},
            });
            await postToolResult({
              threadId: threadIdRef.current,
              toolCallId: data.id,
              content: result.content,
              error: result.error,
            });
            patch((t) => ({
              ...t,
              tools: closeTool(t.tools, `client · ${data.name}`, result.content),
            }));
            break;
          }
          case 'on_chain_end': {
            const usage = (ev.data as { output?: { usage?: Turn['usage'] } }).output?.usage;
            if (usage) patch((t) => ({ ...t, usage }));
            break;
          }
          case 'on_error':
            setError(String((ev.data as { message?: string }).message ?? 'error'));
            break;
          case 'aborted':
            setSessionPhase('aborted');
            break;
          // The agent drained a queued steer / follow-up. It is a real user
          // message in the session log, so render it as one rather than
          // letting the reply silently change direction.
          case 'steer':
          case 'follow_up': {
            const content = (ev.data as { content?: string }).content?.trim();
            if (content) interject(content);
            break;
          }
          case 'session_progress': {
            const phase = (ev.data as { phase?: string }).phase;
            if (phase) setSessionPhase(phase);
            break;
          }
          case 'ui_request': {
            const data = ev.data as {
              request_id: string;
              kind: 'select' | 'confirm' | 'input';
              prompt: string;
              options?: Array<string | { id?: string; label?: string; value?: string }>;
              default?: unknown;
            };
            const options = (data.options ?? []).map((opt) => {
              if (typeof opt === 'string') return { value: opt, label: opt };
              const value = String(opt.value ?? opt.id ?? opt.label ?? '');
              return { value, label: String(opt.label ?? value) };
            });
            setUiPrompt({
              requestId: data.request_id,
              kind: data.kind,
              prompt: data.prompt,
              options,
              defaultValue: data.default,
            });
            break;
          }
        }
      };

      const run = async () => {
        if (mode === 'background') {
          patch((t) => ({ ...t, content: t.content || 'Queued durable job…' }));
          const started = await startChat({
            manifest,
            messages: messagesToSend,
            threadId: threadIdRef.current,
            signal: ctrl.signal,
          });
          if (started.kind === 'done') {
            patch((t) => ({ ...t, content: started.final.content }));
            return;
          }
          const runResult = await pollDurableRun(started.resumeToken, {
            signal: ctrl.signal,
            onTick: (r) => {
              patch((t) => ({
                ...t,
                content: `Background · ${r.status || 'pending'}…`,
              }));
            },
          });
          if (runResult.error) {
            setError(runResult.error);
            return;
          }
          const content =
            typeof runResult.final === 'object' && runResult.final && 'content' in runResult.final
              ? String(runResult.final.content || '')
              : '';
          patch((t) => ({
            ...t,
            content: content || `(${runResult.status || 'completed'})`,
          }));
          return;
        }

        await streamChat(
          {
            manifest,
            messages: messagesToSend,
            threadId: threadIdRef.current,
            signal: ctrl.signal,
          },
          {
            onEvent: (ev) => handleEvent(ev as { event: string; data: Record<string, unknown> }),
          },
        );
      };

      return run()
        .catch((err) => {
          if (!ctrl.signal.aborted) setError(String((err as Error)?.message ?? err));
        })
        .finally(() => {
          setStreaming(false);
          abortRef.current = null;
          setSessionPhase((p) => (p === 'aborted' ? p : 'idle'));
        });
    },
    [manifest],
  );

  const pending = pendingQueue[0] ?? null;

  const onDecide = useCallback(
    async (status: 'approved' | 'denied') => {
      if (!pending || deciding) return;
      setDeciding(true);
      try {
        await decideApproval(pending.approvalId, { status });
        setPendingQueue((q) => q.slice(1));
        toast.message(status === 'approved' ? 'Approved — run continues' : 'Denied');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      } finally {
        setDeciding(false);
      }
    },
    [pending, deciding],
  );

  // Restore pending approvals after refresh.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const items = await listApprovals('pending');
        if (cancelled || !items.length) return;
        const restored: PendingApproval[] = [];
        for (const item of items) {
          const args = item.args ?? {};
          let before: string | null = null;
          if (item.tool_name === 'write_file' && typeof args.path === 'string') {
            before = await readWorkspaceFile(args.path);
          }
          restored.push({
            approvalId: item.id,
            toolName: item.tool_name,
            args,
            before,
          });
        }
        if (!cancelled) setPendingQueue(restored);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const send = useCallback(
    (text: string, attachments?: ImageAttachment[], mode: 'stream' | 'background' = 'stream') => {
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
      setError(null);
      const userTurn: Turn = {
        id: crypto.randomUUID(),
        role: 'user',
        content: text,
        ...(hasAttachments ? { attachments } : {}),
      };
      const assistantId = crypto.randomUUID();
      const firstTurn = turns.length === 0;
      setTurns((prev) => [
        ...prev,
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
      setThreads(listThreads());

      // Steady state: send only the new user message; Felix replays the thread.
      const userMessage: ChatMessage = { role: 'user', content: text };
      if (hasAttachments) userMessage.attachments = attachments;
      void streamInto([userMessage], assistantId, mode);
    },
    [streaming, manifest, threadId, turns, threads, streamInto],
  );

  // Re-run the last assistant turn. Felix's session log is append-only, so a
  // bare re-send would duplicate the prior turn; instead we reset the server
  // log and replay the full transcript up to (and including) the prompting
  // user turn, then stream a fresh answer in place of the old one.
  const regenerate = useCallback(() => {
    if (streaming) return;
    const lastAssistant = turns.length - 1;
    if (lastAssistant < 0 || turns[lastAssistant].role !== 'assistant') return;
    setError(null);

    const replay = turns.slice(0, lastAssistant);
    const messagesToSend: ChatMessage[] = replay
      .filter((t) => t.content.trim().length > 0)
      .map((t) => ({ role: t.role, content: t.content }));
    if (messagesToSend.length === 0) return;

    const assistantId = crypto.randomUUID();
    setTurns([...replay, { id: assistantId, role: 'assistant', content: '', tools: [] }]);

    // Reset the server log first so the replayed history isn't double-counted,
    // then stream. Best-effort: an anonymous prod caller can't reset history,
    // but the local transcript stays the source of truth either way.
    void deleteThreadHistory(threadId).then(() => streamInto(messagesToSend, assistantId));
  }, [streaming, turns, threadId, streamInto]);

  // Clear the current conversation in place (keeps the thread id; best-effort
  // server reset). Distinct from "New thread" which mints a fresh id.
  const clearThread = useCallback(() => {
    stopRun();
    setTurns([]);
    setSkills(null);
    setError(null);
    setPendingQueue([]);
    setUiPrompt(null);
    setSessionPhase(null);
    void deleteThreadHistory(threadId);
    saveTurns(threadId, []);
  }, [threadId, stopRun]);

  const continueRun = useCallback(() => {
    if (streaming) return;
    void continueChat({ threadId, manifest })
      .then(() => {
        toast.message('Continued');
        hydrateFromServer(threadId);
        setSessionPhase('idle');
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

  const rewindTo = useCallback(
    (eventId: string) => {
      if (streaming) return;
      void rewindChat({ threadId, eventId, summarize: false, manifest })
        .then(() => {
          toast.message('Rewound');
          hydrateFromServer(threadId);
        })
        .catch((err) => toast.error(String((err as Error)?.message ?? err)));
    },
    [streaming, threadId, manifest, hydrateFromServer],
  );

  const onUiRespond = useCallback(
    async (value: unknown) => {
      if (!uiPrompt) return;
      setUiResolving(true);
      try {
        await respondUiRequest({ requestId: uiPrompt.requestId, value });
        setUiPrompt(null);
      } catch (err) {
        toast.error(String((err as Error)?.message ?? err));
      } finally {
        setUiResolving(false);
      }
    },
    [uiPrompt],
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
      setUiPrompt(null);
    } catch (err) {
      toast.error(String((err as Error)?.message ?? err));
    } finally {
      setUiResolving(false);
    }
  }, [uiPrompt]);

  // Map a composer submission (text + browser File parts, already converted to
  // data URLs by PromptInput) onto our send(). Image parts become attachments.
  const submit = useCallback(
    (message: PromptInputMessage, mode: 'stream' | 'background' = 'stream') => {
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
          <span className="truncate font-semibold tracking-tight">Felix</span>
          {verbose && (
            <Badge variant="secondary" className="hidden font-normal sm:inline-flex">
              Verbose
            </Badge>
          )}
          {canary && (
            <Badge
              variant="default"
              className="hidden font-normal sm:inline-flex"
              title={
                `Canary rollout in flight: v${canary.version} at ${canary.weight}%. ` +
                'Which side serves a given thread is decided server-side and is not reported.'
              }
            >
              canary v{canary.version}
              {canary.weight < 100 ? ` @ ${canary.weight}%` : ''}
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
        {historyOpen && (
          <ThreadList
            threads={threads}
            currentId={threadId}
            disabled={streaming}
            onSelect={selectThread}
            onNew={newThread}
            onDelete={deleteThread}
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
                />
              );
            })}
            {error && (
              <div
                role="alert"
                className="mx-auto max-w-2xl rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
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
                deciding={deciding}
                onDecide={(status) => void onDecide(status)}
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
              isConnected
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
        {inspectorOpen && (
          <Inspector
            open={inspectorOpen}
            onClose={() => setInspectorOpen(false)}
            skills={skills}
            onSuggest={send}
          />
        )}
      </div>
      <EvalSheet open={evalOpen} onOpenChange={setEvalOpen} manifest={manifest} />
      <ManifestsSheet
        open={manifestsOpen}
        onOpenChange={(o) => {
          setManifestsOpen(o);
          if (!o) void refreshCanary();
        }}
        manifest={manifest}
      />
      <JobsSheet
        open={jobsOpen}
        onOpenChange={setJobsOpen}
        manifest={manifest}
        manifestOptions={options}
      />
      <AgentSheet open={agentOpen} onOpenChange={setAgentOpen} manifest={manifest} />
    </div>
  );
}

function closeTool(tools: ToolCall[] | undefined, name: string, output: unknown): ToolCall[] {
  const next = [...(tools ?? [])];
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i].name === name && !next[i].done) {
      next[i] = { ...next[i], output, done: true };
      break;
    }
  }
  return next;
}

/** Capture a `list_skills` tool result so the Inspector Skills tab can show it. */
function captureSkills(name: string, output: unknown, set: (s: SkillState) => void) {
  if (name !== 'list_skills') return;
  try {
    const obj = typeof output === 'string' ? JSON.parse(output) : output;
    if (obj && Array.isArray(obj.declared) && Array.isArray(obj.active)) {
      set({ declared: obj.declared, active: obj.active });
    }
  } catch {
    // non-JSON list_skills output — ignore
  }
}
