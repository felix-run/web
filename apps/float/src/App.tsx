import {
  collectToolCallPaths,
  type PendingApproval,
  readExisting,
  reconnectMount,
  restoreMount,
  summarizeToolArgs,
} from '@felix/cowork-client';
import { nanoid } from 'nanoid';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  abortChat,
  acquireSessionLease,
  continueChat,
  decideApproval,
  getSessionSnapshot,
  listApprovals,
  pollDurableRun,
  postToolResult,
  releaseSessionLease,
  respondUiRequest,
  rewindChat,
  searchSessions,
  setThinkingLevel,
  startChat,
  steerChat,
  streamChat,
} from '@/api';
import { CopyButton } from '@/components/chat/copy-button';
import { ToolCard } from '@/components/chat/tool-card';
import {
  clearMount,
  executeClientTool,
  getMountLabel,
  hasMount,
  mountTree,
  openWorkspaceFile,
  pickDirectory,
  supportsDirectoryPicker,
  vfs,
} from '@/lib/client-tools';
import { composerKeyAction } from '@/lib/composer';
import { hintsByRow, invalidateMentions, useFileMentions } from '@/lib/mentions';
import { cn } from '@/lib/utils';
import type { PendingUiRequest, ThinkingLevel, TimelineItem, TokenUsage } from '@/types';

/**
 * The markdown renderer pulls in syntax highlighting, math, and diagram
 * support — together several times the weight of the rest of float. Loading it
 * with the first assistant message keeps that off the critical path; until then
 * the raw text shows, which is what float displayed before it existed.
 */
const Response = lazy(() =>
  import('@/components/chat/response').then((m) => ({ default: m.Response })),
);

const MANIFEST = 'cowork';
/** Distance from the bottom that still counts as "reading the tail". */
const FOLLOW_SLACK_PX = 80;
const THREAD_KEY = 'felix.float.threadId';
const HOLDER_KEY = 'felix.float.holderId';
const THINKING_LEVELS: ThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

function loadThreadId(): string {
  return localStorage.getItem(THREAD_KEY) || nanoid(12);
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
    return 'float-anon';
  }
}

export default function App() {
  const [threadId, setThreadId] = useState(loadThreadId);
  const [goal, setGoal] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [background, setBackground] = useState(false);
  const [assistantDraft, setAssistantDraft] = useState('');
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [pendingQueue, setPendingQueue] = useState<PendingApproval[]>([]);
  const [deciding, setDeciding] = useState(false);
  const [uiPrompt, setUiPrompt] = useState<PendingUiRequest | null>(null);
  const [uiResolving, setUiResolving] = useState(false);
  const [thinkingLevel, setThinkingLevelState] = useState<ThinkingLevel>('off');
  const [sessionPhase, setSessionPhase] = useState<string | null>(null);
  const [usage, setUsage] = useState<TokenUsage | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHits, setSearchHits] = useState<
    Array<{ thread_id: string; content: string; event_id?: string }>
  >([]);
  const [searching, setSearching] = useState(false);
  const [mountLabel, setMountLabel] = useState<string | null>(getMountLabel());
  const [files, setFiles] = useState<string[]>([]);
  const [hasNewBelow, setHasNewBelow] = useState(false);
  const followTailRef = useRef(true);
  const draftFrameRef = useRef<number | null>(null);
  /** Harness tool-call id -> timeline row id, so concurrent calls settle correctly. */
  const toolRowsRef = useRef(new Map<string, string>());
  const abortRef = useRef<AbortController | null>(null);
  const leaseTokenRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Folder remembered from a previous session, waiting on a click to come back. */
  const [reconnectName, setReconnectName] = useState<string | null>(null);
  const canMount = supportsDirectoryPicker();

  const pending = pendingQueue[0] ?? null;

  const rowHints = useMemo(() => hintsByRow(timeline), [timeline]);

  useEffect(() => {
    localStorage.setItem(THREAD_KEY, threadId);
  }, [threadId]);

  // Exclusive lease while this tab owns the float thread.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await acquireSessionLease({
          threadId,
          holderId: tabHolderId(),
          mode: 'exclusive',
        });
        if (cancelled) return;
        if (result.ok && result.token) {
          leaseTokenRef.current = result.token;
        } else {
          const shared = await acquireSessionLease({
            threadId,
            holderId: tabHolderId(),
            mode: 'shared',
          });
          if (!cancelled && shared.token) leaseTokenRef.current = shared.token;
        }
      } catch {
        // best-effort
      }
    })();
    return () => {
      cancelled = true;
      const token = leaseTokenRef.current;
      leaseTokenRef.current = null;
      void releaseSessionLease({
        threadId,
        holderId: tabHolderId(),
        token: token ?? undefined,
      });
    };
  }, [threadId]);

  // Hydrate thinking / phase / transcript from authoritative snapshot.
  useEffect(() => {
    void getSessionSnapshot(threadId).then((snap) => {
      if (!snap) return;
      if (snap.thinkingLevel && THINKING_LEVELS.includes(snap.thinkingLevel as ThinkingLevel)) {
        setThinkingLevelState(snap.thinkingLevel as ThinkingLevel);
      }
      if (snap.phase) setSessionPhase(snap.phase);
      const rows = (snap.transcript ?? [])
        .filter(
          (ev) =>
            (ev.kind === 'message' || ev.kind === 'custom') &&
            (ev.role === 'user' || ev.role === 'assistant') &&
            (ev.content || '').trim(),
        )
        .map((ev) => ({
          id: ev.id ?? nanoid(),
          kind: (ev.role === 'user' ? 'user' : 'assistant') as TimelineItem['kind'],
          title: ev.role === 'user' ? 'You' : 'Felix',
          body: ev.content ?? '',
          status: 'done' as const,
          eventId: ev.id,
        }));
      if (rows.length) setTimeline(rows);
    });
  }, [threadId]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchHits([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void searchSessions(q)
        .then((hits) => {
          if (!cancelled) setSearchHits(hits);
        })
        .catch(() => {
          if (!cancelled) setSearchHits([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchQuery]);

  // A token-by-token stream renders far faster than a screen refreshes, so
  // committing every delta to state is work nobody sees. Coalesce into one
  // paint per frame; anything that ENDS the draft commits synchronously,
  // because a queued frame would otherwise overwrite the cleared value.
  const queueDraft = useCallback((text: string) => {
    if (draftFrameRef.current !== null) return;
    draftFrameRef.current = requestAnimationFrame(() => {
      draftFrameRef.current = null;
      setAssistantDraft(text);
    });
  }, []);

  const commitDraft = useCallback((text: string) => {
    if (draftFrameRef.current !== null) {
      cancelAnimationFrame(draftFrameRef.current);
      draftFrameRef.current = null;
    }
    setAssistantDraft(text);
  }, []);

  useEffect(
    () => () => {
      if (draftFrameRef.current !== null) cancelAnimationFrame(draftFrameRef.current);
    },
    [],
  );

  // Follow the tail only while the reader is already at it. Scrolling up to
  // re-read something during a long run must not be yanked back by the next
  // delta; the chip is how they get back down deliberately.
  const onTranscriptScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atTail = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_SLACK_PX;
    followTailRef.current = atTail;
    if (atTail) setHasNewBelow(false);
  }, []);

  const jumpToTail = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    followTailRef.current = true;
    setHasNewBelow(false);
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (followTailRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    } else {
      setHasNewBelow(true);
    }
  }, [timeline, assistantDraft, pendingQueue]);

  const refreshFiles = useCallback(async () => {
    // Called after every tool, which is exactly when the workspace may have
    // gained the file the assistant is about to name.
    invalidateMentions();
    try {
      if (hasMount()) {
        setFiles(await mountTree());
      } else {
        setFiles(vfs.tree());
      }
    } catch {
      // mountTree walks the File System Access handle with no guard of its own,
      // so it rejects once a permission grant lapses or the mounted folder is
      // moved or deleted. The file strip is cosmetic: leaving it stale is
      // always better than the alternatives. This is awaited inside the
      // tool_end and tool_request handlers, and readSseStream no longer
      // swallows handler rejections, so without this a stale mount would tear
      // down the stream on the first tool call. The `void refreshFiles()` call
      // sites relied on the same swallow and would otherwise leak an unhandled
      // rejection.
    }
  }, []);

  useEffect(() => {
    void refreshFiles();
  }, [refreshFiles, mountLabel]);

  // A folder mounted last session may still be usable. Whether it is depends on
  // a permission that boot cannot ask for — see restoreMount.
  useEffect(() => {
    let cancelled = false;
    void restoreMount().then((result) => {
      if (cancelled) return;
      if (result.status === 'restored') {
        setMountLabel(result.name);
        toast.message(`Reattached ${result.name}`);
      } else if (result.status === 'needs-permission') {
        setReconnectName(result.name);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const push = useCallback((item: TimelineItem) => {
    setTimeline((cur) => [...cur, item]);
  }, []);

  // Restore pending approvals after refresh (run may still be waiting).
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
            before = await readExisting(args.path, vfs);
          }
          restored.push({
            approvalId: item.id,
            toolName: item.tool_name,
            args,
            before,
          });
        }
        if (!cancelled) {
          setPendingQueue(restored);
          for (const entry of restored) {
            push({
              id: nanoid(),
              kind: 'approval',
              title: `Needs approval · ${entry.toolName}`,
              body: summarizeToolArgs(entry.toolName, entry.args),
              status: 'pending',
            });
          }
        }
      } catch {
        // ignore — approvals endpoint may be unavailable offline
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [push]);

  const stopRun = useCallback(() => {
    void abortChat(threadId).catch(() => {});
    abortRef.current?.abort();
    setSessionPhase('aborted');
  }, [threadId]);

  const resetSession = useCallback(() => {
    stopRun();
    const next = nanoid(12);
    setThreadId(next);
    setTimeline([]);
    commitDraft('');
    setPendingQueue([]);
    setUiPrompt(null);
    setStreaming(false);
    setBackground(false);
    setSessionPhase(null);
  }, [stopRun]);

  const clearVfs = useCallback(() => {
    vfs.reset();
    void refreshFiles();
    toast.message('Local VFS cleared');
  }, [refreshFiles]);

  const onMount = useCallback(async () => {
    try {
      const name = await pickDirectory();
      setReconnectName(null);
      setMountLabel(name);
      await refreshFiles();
      toast.success(`Mounted ${name}`);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    }
  }, [refreshFiles]);

  /**
   * Open a file the assistant named. Failure is ordinary here — the file may
   * have been deleted since the message was written — so it reports rather
   * than throwing into the render tree.
   */
  const openMentionedFile = useCallback((path: string) => {
    void openWorkspaceFile(path).catch((err) => {
      toast.error(`Could not open ${path}: ${err instanceof Error ? err.message : String(err)}`);
    });
  }, []);

  const onUnmount = useCallback(() => {
    clearMount();
    setMountLabel(null);
    setReconnectName(null);
    void refreshFiles();
    toast.message('Folder unmounted');
  }, [refreshFiles]);

  /**
   * Must stay inside the click handler: the permission prompt is only allowed
   * to open while the user's gesture is still being processed.
   */
  const onReconnect = useCallback(async () => {
    const name = await reconnectMount();
    if (!name) {
      toast.error('Folder access was not granted');
      return;
    }
    setReconnectName(null);
    setMountLabel(name);
    await refreshFiles();
    toast.success(`Reattached ${name}`);
  }, [refreshFiles]);

  const handleStreamEvents = useCallback(
    async (
      event: { event: string; data: Record<string, unknown> },
      draftRef: { current: string },
    ) => {
      if (event.event === 'text_delta' || event.event === 'on_chat_model_stream') {
        const data = event.data as { delta?: string; chunk?: { content?: string } };
        const chunk = data.delta ?? data.chunk?.content ?? '';
        if (chunk) {
          draftRef.current += chunk;
          queueDraft(draftRef.current);
        }
        return;
      }

      if (event.event === 'tool_start' || event.event === 'on_tool_start') {
        if (draftRef.current) {
          push({
            id: nanoid(),
            kind: 'assistant',
            title: 'Update',
            body: draftRef.current,
            status: 'done',
          });
          draftRef.current = '';
          commitDraft('');
        }
        const data = event.data as { name?: string; input?: unknown; id?: string };
        const rowId = nanoid();
        if (data.id) toolRowsRef.current.set(data.id, rowId);
        push({
          id: rowId,
          kind: 'tool',
          title: String(data.name ?? 'tool'),
          body: JSON.stringify(data.input ?? {}, null, 2),
          status: 'running',
          paths: collectToolCallPaths(data.input),
        });
        return;
      }

      if (event.event === 'tool_end' || event.event === 'on_tool_end') {
        const data = event.data as { name?: string; output?: unknown; id?: string };
        const name = String(data.name ?? 'tool');
        const output =
          typeof data.output === 'string' ? data.output : JSON.stringify(data.output ?? '');
        const status =
          output.startsWith('[approval') || output.startsWith('[error') ? 'error' : 'done';
        // `tool_start`/`tool_end` carry an id; the `on_*` pair does not. With an
        // id, settle the exact row — two concurrent calls to the same tool are
        // otherwise indistinguishable, and the newest-first name scan settles
        // whichever happened to be pushed last.
        const rowId = data.id ? toolRowsRef.current.get(data.id) : undefined;
        if (data.id) toolRowsRef.current.delete(data.id);
        setTimeline((cur) => {
          const next = [...cur];
          let i = rowId ? next.findIndex((item) => item.id === rowId) : -1;
          if (i === -1) {
            for (let j = next.length - 1; j >= 0; j--) {
              const item = next[j];
              if (
                item.kind === 'tool' &&
                (item.title === name || item.title === `client · ${name}`) &&
                item.status === 'running'
              ) {
                i = j;
                break;
              }
            }
          }
          const target = next[i];
          if (!target) return cur;
          next[i] = { ...target, body: output.slice(0, 4000), status };
          return next;
        });
        await refreshFiles();
        return;
      }

      // Progress either side of a tool call. Without this the row sits on
      // 'running' until `tool_end`, which for a long tool is the whole wait.
      if (event.event === 'tool_execution_update') {
        const data = event.data as { name?: string; id?: string; status?: string };
        const rowId = data.id ? toolRowsRef.current.get(data.id) : undefined;
        if (!rowId || !data.status) return;
        setTimeline((cur) =>
          cur.map((item) =>
            item.id === rowId && item.status === 'running' ? { ...item, phase: data.status } : item,
          ),
        );
        return;
      }

      if (event.event === 'approval_required') {
        const data = event.data as {
          approval_id: string;
          tool_name: string;
          args?: Record<string, unknown>;
          rule_id?: string;
        };
        const args = data.args ?? {};
        let before: string | null = null;
        if (data.tool_name === 'write_file' && typeof args.path === 'string') {
          before = await readExisting(args.path, vfs);
        }
        const entry: PendingApproval = {
          approvalId: data.approval_id,
          toolName: data.tool_name,
          args,
          ruleId: data.rule_id,
          before,
        };
        setPendingQueue((q) => [...q, entry]);
        push({
          id: nanoid(),
          kind: 'approval',
          title: `Needs approval · ${data.tool_name}`,
          body: summarizeToolArgs(data.tool_name, args),
          status: 'pending',
          paths: collectToolCallPaths(args),
        });
        return;
      }

      // The harness blocks the model loop until this tool_call_id is answered,
      // so every path below — including a thrown executor and a failed POST —
      // must end in either a posted result or a visible error. Since the SSE
      // reader now propagates handler failures, an escaping throw would also
      // tear down the stream and leave the run silently dead.
      if (event.event === 'tool_request') {
        const data = event.data as {
          id: string;
          name: string;
          args?: Record<string, unknown>;
        };
        const rowId = nanoid();
        toolRowsRef.current.set(data.id, rowId);
        push({
          id: rowId,
          kind: 'tool',
          title: `client · ${data.name}`,
          body: JSON.stringify(data.args ?? {}, null, 2),
          status: 'running',
          paths: collectToolCallPaths(data.args),
        });

        let result: { content: string; error?: boolean };
        try {
          result = await executeClientTool(
            { id: data.id, name: data.name, args: data.args ?? {} },
            { signal: abortRef.current?.signal },
          );
        } catch (err) {
          result = {
            content: `error: ${err instanceof Error ? err.message : String(err)}`,
            error: true,
          };
        }

        try {
          await postToolResult({
            threadId,
            toolCallId: data.id,
            content: result.content,
            error: result.error,
          });
        } catch (err) {
          // Nothing upstream will retry this, and the run is now waiting on a
          // result that will never arrive. Say so rather than appearing idle.
          const message = err instanceof Error ? err.message : String(err);
          toolRowsRef.current.delete(data.id);
          setTimeline((cur) =>
            cur.map((item) =>
              item.id === rowId
                ? { ...item, body: `tool result not delivered: ${message}`, status: 'error' }
                : item,
            ),
          );
          toast.error(`Tool result not delivered: ${message}`);
          await refreshFiles();
          return;
        }
        await refreshFiles();
        return;
      }

      // A mid-stream failure arrives as a frame, not a thrown error, so the
      // try/catch around the stream never sees it and the run ends looking like
      // it succeeded. Clearing the draft here is the load-bearing half: the
      // `finally` in runGoal commits any leftover draft as a `Result` with
      // status 'done', which would present a truncated failed answer as a
      // finished one. chat-ui surfaces the same frame via setError.
      if (event.event === 'on_error') {
        const message = String((event.data as { message?: string }).message ?? 'error');
        if (draftRef.current) {
          push({
            id: nanoid(),
            kind: 'assistant',
            title: 'Partial',
            body: draftRef.current,
            status: 'error',
          });
          draftRef.current = '';
          commitDraft('');
        }
        toast.error(message);
        push({ id: nanoid(), kind: 'system', title: 'Error', body: message, status: 'error' });
        return;
      }

      // Terminal frame of a turn; the only place per-turn usage is reported.
      if (event.event === 'on_chain_end') {
        const usage = (event.data as { output?: { usage?: TokenUsage } }).output?.usage;
        if (usage) {
          setUsage((cur) => ({
            input: (cur?.input ?? 0) + (usage.input ?? 0),
            output: (cur?.output ?? 0) + (usage.output ?? 0),
          }));
        }
        return;
      }

      if (event.event === 'aborted') {
        setSessionPhase('aborted');
        return;
      }

      // The agent drained a queued steer / follow-up. Settle the pending item we
      // optimistically pushed; if it came from elsewhere (another tab, the CLI)
      // there is nothing to settle, so record it.
      if (event.event === 'steer' || event.event === 'follow_up') {
        const content = (event.data as { content?: string }).content?.trim();
        if (!content) return;
        const title = event.event === 'steer' ? 'Steer' : 'Follow-up';
        setTimeline((cur) => {
          const i = cur.findIndex(
            (t) => t.kind === 'user' && t.status === 'pending' && t.body === content,
          );
          if (i === -1) {
            return [...cur, { id: nanoid(), kind: 'user', title, body: content, status: 'done' }];
          }
          const next = [...cur];
          next[i] = { ...next[i], status: 'done' };
          return next;
        });
        return;
      }

      if (event.event === 'session_progress') {
        const phase = (event.data as { phase?: string }).phase;
        if (phase) setSessionPhase(phase);
        return;
      }

      if (event.event === 'ui_request') {
        const data = event.data as {
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
      }
    },
    [push, refreshFiles, threadId, queueDraft, commitDraft],
  );

  const runGoal = useCallback(
    async (mode: 'stream' | 'background') => {
      const text = goal.trim();
      if (!text || streaming) return;

      setStreaming(true);
      // A run that ended without settling every tool leaves stale ids behind.
      toolRowsRef.current.clear();
      setBackground(mode === 'background');
      setGoal('');
      commitDraft('');
      push({ id: nanoid(), kind: 'user', title: 'Goal', body: text, status: 'done' });

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const draftRef = { current: '' };

      try {
        if (mode === 'background') {
          push({
            id: nanoid(),
            kind: 'system',
            title: 'Background run',
            body: 'Queued durable job…',
            status: 'running',
          });
          const started = await startChat({
            manifest: MANIFEST,
            messages: [{ role: 'user', content: text }],
            threadId,
            signal: ctrl.signal,
          });
          if (started.kind === 'done') {
            push({
              id: nanoid(),
              kind: 'assistant',
              title: 'Result',
              body: started.final.content,
              status: 'done',
            });
            return;
          }
          push({
            id: nanoid(),
            kind: 'system',
            title: 'Polling',
            body: `resume ${started.resumeToken.slice(0, 12)}…`,
            status: 'running',
          });
          const run = await pollDurableRun(started.resumeToken, {
            signal: ctrl.signal,
            onTick: (r) => {
              commitDraft(`status: ${r.status || 'pending'}`);
            },
          });
          commitDraft('');
          if (run.error) {
            push({
              id: nanoid(),
              kind: 'system',
              title: 'Failed',
              body: run.error,
              status: 'error',
            });
          } else {
            const content =
              typeof run.final === 'object' && run.final && 'content' in run.final
                ? String(run.final.content || '')
                : '';
            push({
              id: nanoid(),
              kind: 'assistant',
              title: 'Result',
              body: content || `(${run.status || 'completed'})`,
              status: 'done',
            });
          }
          return;
        }

        await streamChat(
          {
            manifest: MANIFEST,
            messages: [{ role: 'user', content: text }],
            threadId,
            signal: ctrl.signal,
          },
          async (event) => {
            await handleStreamEvents(
              event as { event: string; data: Record<string, unknown> },
              draftRef,
            );
            if (event.event === 'done' && draftRef.current) {
              push({
                id: nanoid(),
                kind: 'assistant',
                title: 'Result',
                body: draftRef.current,
                status: 'done',
              });
              draftRef.current = '';
              commitDraft('');
            }
          },
        );
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          toast.error(err instanceof Error ? err.message : String(err));
          push({
            id: nanoid(),
            kind: 'system',
            title: 'Error',
            body: err instanceof Error ? err.message : String(err),
            status: 'error',
          });
        }
      } finally {
        setStreaming(false);
        setBackground(false);
        abortRef.current = null;
        setSessionPhase((p) => (p === 'aborted' ? p : 'idle'));
        if (draftRef.current) {
          push({
            id: nanoid(),
            kind: 'assistant',
            title: 'Result',
            body: draftRef.current,
            status: 'done',
          });
          commitDraft('');
        }
      }
    },
    [goal, streaming, threadId, push, handleStreamEvents],
  );

  const onDecide = useCallback(
    async (status: 'approved' | 'denied') => {
      if (!pending || deciding) return;
      setDeciding(true);
      try {
        await decideApproval(pending.approvalId, { status });
        setTimeline((cur) =>
          cur.map((item) =>
            item.kind === 'approval' &&
            item.status === 'pending' &&
            item.title.includes(pending.toolName)
              ? { ...item, status: status === 'approved' ? 'done' : 'denied' }
              : item,
          ),
        );
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

  /**
   * Send into a turn that is already running.
   *
   * `steer` is injected as soon as the current step finishes — use it to
   * redirect. `follow_up` waits for the turn to end — use it to queue the next
   * thing without interrupting. Both are the same endpoint; only `kind` differs.
   */
  const sendDuringRun = useCallback(
    async (kind: 'steer' | 'follow_up') => {
      const text = goal.trim();
      if (!text || !streaming) return;
      const title = kind === 'steer' ? 'Steer' : 'Follow-up';
      try {
        await steerChat({ threadId, text, kind });
        // Queued, not applied: the agent drains it between steps and answers with
        // a matching frame. Left pending until then so the timeline does not claim
        // the run has taken it on board when it has not.
        push({ id: nanoid(), kind: 'user', title, body: text, status: 'pending' });
        setGoal('');
        toast.message(`${title} queued`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    },
    [goal, streaming, threadId, push],
  );

  const continueRun = useCallback(() => {
    if (streaming) return;
    void continueChat({ threadId, manifest: MANIFEST })
      .then(() => {
        toast.message('Continued');
        setSessionPhase('idle');
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : String(err)));
  }, [streaming, threadId]);

  const chooseThinking = useCallback(
    (level: ThinkingLevel) => {
      setThinkingLevelState(level);
      void setThinkingLevel({ threadId, thinkingLevel: level })
        .then(() => toast.message(`Thinking: ${level}`))
        .catch((err) => toast.error(err instanceof Error ? err.message : String(err)));
    },
    [threadId],
  );

  const rewindTo = useCallback(
    (eventId: string) => {
      if (streaming) return;
      void rewindChat({ threadId, eventId, summarize: false, manifest: MANIFEST })
        .then(() => {
          toast.message('Rewound');
          return getSessionSnapshot(threadId);
        })
        .then((snap) => {
          if (!snap?.transcript?.length) return;
          const rows = snap.transcript
            .filter(
              (ev) =>
                (ev.kind === 'message' || ev.kind === 'custom') &&
                (ev.role === 'user' || ev.role === 'assistant') &&
                (ev.content || '').trim(),
            )
            .map((ev) => ({
              id: ev.id ?? nanoid(),
              kind: (ev.role === 'user' ? 'user' : 'assistant') as TimelineItem['kind'],
              title: ev.role === 'user' ? 'You' : 'Felix',
              body: ev.content ?? '',
              status: 'done' as const,
              eventId: ev.id,
            }));
          // Keep items up through the rewind target when leaf is known.
          const leaf = snap.leafId;
          const cut = leaf ? rows.findIndex((r) => r.eventId === leaf) : -1;
          setTimeline(cut >= 0 ? rows.slice(0, cut + 1) : rows);
          if (snap.phase) setSessionPhase(snap.phase);
        })
        .catch((err) => toast.error(err instanceof Error ? err.message : String(err)));
    },
    [streaming, threadId],
  );

  const openSearchHit = useCallback(
    (fullThreadId: string) => {
      const suffix = fullThreadId.includes(':')
        ? fullThreadId.slice(fullThreadId.indexOf(':') + 1)
        : fullThreadId;
      if (suffix === threadId) return;
      stopRun();
      setThreadId(suffix);
      setTimeline([]);
      commitDraft('');
      setPendingQueue([]);
      setUiPrompt(null);
      setSessionPhase(null);
      setSearchQuery('');
      setSearchHits([]);
    },
    [threadId, stopRun],
  );

  const onUiRespond = useCallback(
    async (value: unknown) => {
      if (!uiPrompt) return;
      setUiResolving(true);
      try {
        await respondUiRequest({ requestId: uiPrompt.requestId, value });
        setUiPrompt(null);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
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
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setUiResolving(false);
    }
  }, [uiPrompt]);

  const filePreview = useMemo(() => files.slice(0, 80), [files]);

  const writeDiff = useMemo(() => {
    if (!pending || pending.toolName !== 'write_file') return null;
    const next = typeof pending.args.content === 'string' ? pending.args.content : '';
    const before = pending.before ?? '';
    return { before, next, isNew: pending.before == null };
  }, [pending]);

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Felix
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Float</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Hand off a goal. Client tools run in this tab; gated writes wait for your approval.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded border border-border px-2 py-1 font-mono">{MANIFEST}</span>
          <span className="rounded border border-border px-2 py-1 font-mono">
            {threadId.slice(0, 8)}
          </span>
          {sessionPhase && sessionPhase !== 'idle' ? (
            <span className="rounded border border-border px-2 py-1">{sessionPhase}</span>
          ) : null}
          {usage ? (
            <span
              className="rounded border border-border px-2 py-1 font-mono"
              title="Tokens this session (input / output)"
            >
              {usage.input.toLocaleString()} ↓ {usage.output.toLocaleString()} ↑
            </span>
          ) : null}
          <label className="flex items-center gap-1 rounded border border-border px-2 py-1">
            <span className="sr-only">Thinking level</span>
            <select
              className="bg-transparent outline-none"
              value={thinkingLevel}
              onChange={(e) => chooseThinking(e.target.value as ThinkingLevel)}
              title="Thinking level"
            >
              {THINKING_LEVELS.map((level) => (
                <option key={level} value={level}>
                  think:{level}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="rounded border border-border px-2 py-1 hover:bg-accent disabled:opacity-50"
            disabled={streaming}
            onClick={continueRun}
          >
            Continue
          </button>
          <button
            type="button"
            className="rounded border border-border px-2 py-1 hover:bg-accent"
            onClick={resetSession}
          >
            New session
          </button>
        </div>
      </header>

      <div className="relative max-w-md">
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search sessions…"
          className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none ring-ring focus:ring-2"
        />
        {(searchHits.length > 0 || (searchQuery.trim().length >= 2 && !searching)) && (
          <div className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-md border border-border bg-card shadow-md">
            {searchHits.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                {searching ? 'Searching…' : 'No matches'}
              </p>
            ) : (
              searchHits.map((hit, i) => (
                <button
                  key={`${hit.thread_id}-${hit.event_id ?? i}`}
                  type="button"
                  className="block w-full truncate px-3 py-2 text-left text-xs hover:bg-accent"
                  onClick={() => openSearchHit(hit.thread_id)}
                >
                  <span className="font-medium">{hit.content.slice(0, 72)}</span>
                  <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">
                    {hit.thread_id.includes(':')
                      ? hit.thread_id.slice(
                          hit.thread_id.indexOf(':') + 1,
                          hit.thread_id.indexOf(':') + 9,
                        )
                      : hit.thread_id.slice(0, 8)}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {pending ? (
        <div className="relative z-10 rounded-lg border border-primary/40 bg-accent/50 p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Approval required{pendingQueue.length > 1 ? ` · ${pendingQueue.length} queued` : ''}
              </p>
              <h2 className="mt-1 text-base font-semibold">{pending.toolName}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {summarizeToolArgs(pending.toolName, pending.args)}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={deciding}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                onClick={() => void onDecide('approved')}
              >
                {deciding ? '…' : 'Approve'}
              </button>
              <button
                type="button"
                disabled={deciding}
                className="rounded-md border border-border bg-background px-4 py-2 text-sm disabled:opacity-50"
                onClick={() => void onDecide('denied')}
              >
                Deny
              </button>
            </div>
          </div>
          {writeDiff ? (
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                  {writeDiff.isNew ? 'Before (new file)' : 'Before'}
                </p>
                <pre className="max-h-40 overflow-auto rounded-md border border-border bg-background p-2 font-mono text-xs">
                  {writeDiff.isNew ? '(empty)' : writeDiff.before.slice(0, 8000)}
                </pre>
              </div>
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                  After
                </p>
                <pre className="max-h-40 overflow-auto rounded-md border border-border bg-background p-2 font-mono text-xs">
                  {writeDiff.next.slice(0, 8000)}
                </pre>
              </div>
            </div>
          ) : (
            <pre className="mt-3 max-h-32 overflow-auto rounded-md border border-border bg-background p-2 font-mono text-xs">
              {JSON.stringify(pending.args, null, 2)}
            </pre>
          )}
        </div>
      ) : null}

      {uiPrompt ? (
        <div className="relative z-10 rounded-lg border border-primary/40 bg-accent/50 p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {uiPrompt.kind === 'confirm'
              ? 'Confirm'
              : uiPrompt.kind === 'select'
                ? 'Select'
                : 'Input'}{' '}
            required
          </p>
          <h2 className="mt-1 text-base font-semibold">{uiPrompt.prompt}</h2>
          {uiPrompt.kind === 'confirm' ? (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={uiResolving}
                className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
                onClick={() => void onUiRespond(true)}
              >
                Yes
              </button>
              <button
                type="button"
                disabled={uiResolving}
                className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50"
                onClick={() => void onUiRespond(false)}
              >
                No
              </button>
              <button
                type="button"
                disabled={uiResolving}
                className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50"
                onClick={() => void onUiCancel()}
              >
                Cancel
              </button>
            </div>
          ) : null}
          {uiPrompt.kind === 'select' ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {uiPrompt.options.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={uiResolving}
                  className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50"
                  onClick={() => void onUiRespond(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
              <button
                type="button"
                disabled={uiResolving}
                className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50"
                onClick={() => void onUiCancel()}
              >
                Cancel
              </button>
            </div>
          ) : null}
          {uiPrompt.kind === 'input' ? (
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                void onUiRespond(String(fd.get('value') ?? ''));
              }}
            >
              <input
                name="value"
                defaultValue={
                  typeof uiPrompt.defaultValue === 'string' ? uiPrompt.defaultValue : ''
                }
                disabled={uiResolving}
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                placeholder="Type a response…"
              />
              <button
                type="submit"
                disabled={uiResolving}
                className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
              >
                Send
              </button>
              <button
                type="button"
                disabled={uiResolving}
                className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50"
                onClick={() => void onUiCancel()}
              >
                Cancel
              </button>
            </form>
          ) : null}
        </div>
      ) : null}

      {/*
        `isolate` is load-bearing, not cosmetic. Assistant output is rendered as
        markup now, so the model can emit positioned, stacked elements — and a
        fake approval prompt drawn over the real one is the attack that buys
        something. A stacking context here confines every z-index below it,
        including `position: fixed`, so the banners above (which sit at z-10 in
        this context) cannot be painted over. Raising the banners' z-index
        instead would only start a bidding war the model can rejoin.
      */}
      <div className="isolate grid min-h-0 flex-1 gap-4 md:grid-cols-[1.4fr_0.9fr]">
        <section className="flex min-h-0 flex-col rounded-lg border border-border bg-card shadow-sm">
          <div
            ref={scrollRef}
            onScroll={onTranscriptScroll}
            className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4"
          >
            {timeline.length === 0 && !assistantDraft ? (
              <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
                Try: create notes/todo.md with three tasks, then open it.
                {canMount ? ' Mount a real folder to write outside the tab VFS.' : ''}
              </div>
            ) : null}
            {timeline.map((item, index) =>
              item.kind === 'tool' ? (
                <ToolCard
                  key={item.id}
                  item={item}
                  action={item.body ? <CopyButton text={item.body} label="Copy output" /> : null}
                />
              ) : (
                <article
                  key={item.id}
                  className={cn(
                    'group rounded-md border border-border px-3 py-2',
                    item.kind === 'user' && 'bg-accent/40',
                    item.kind === 'approval' && item.status === 'pending' && 'border-primary/50',
                    item.status === 'error' && 'border-destructive/40',
                    item.status === 'denied' && 'opacity-70',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-medium">{item.title}</h2>
                    <div className="flex items-center gap-2">
                      {item.body ? (
                        <span className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                          <CopyButton text={item.body} />
                        </span>
                      ) : null}
                      {item.eventId && !streaming ? (
                        <button
                          type="button"
                          className="text-[11px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
                          onClick={() => rewindTo(item.eventId!)}
                          title="Rewind to this message"
                        >
                          Rewind
                        </button>
                      ) : null}
                      {item.status ? (
                        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          {item.status}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {item.body ? (
                    item.kind === 'assistant' ? (
                      <AssistantBody
                        text={item.body}
                        hints={rowHints[index]}
                        onOpenFile={openMentionedFile}
                      />
                    ) : (
                      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
                        {item.body}
                      </pre>
                    )
                  ) : null}
                </article>
              ),
            )}
            {assistantDraft ? (
              <article className="rounded-md border border-border px-3 py-2">
                <h2 className="text-sm font-medium">{background ? 'Background…' : 'Working…'}</h2>
                <AssistantBody text={assistantDraft} streaming />
              </article>
            ) : null}
            {hasNewBelow ? (
              <div className="pointer-events-none sticky bottom-0 flex h-0 justify-center">
                <button
                  type="button"
                  className="pointer-events-auto -translate-y-2 rounded-full border border-border bg-card px-3 py-1 text-xs shadow-sm hover:bg-accent"
                  onClick={jumpToTail}
                >
                  New messages ↓
                </button>
              </div>
            ) : null}
          </div>

          <form
            className="border-t border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void runGoal('stream');
            }}
          >
            <textarea
              className="min-h-20 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
              placeholder={streaming ? 'Enter queues, ⌘/Ctrl+Enter steers…' : 'Describe the goal…'}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              onKeyDown={(e) => {
                const action = composerKeyAction(
                  {
                    key: e.key,
                    shiftKey: e.shiftKey,
                    metaKey: e.metaKey,
                    ctrlKey: e.ctrlKey,
                    isComposing: e.nativeEvent.isComposing,
                  },
                  { streaming, hasText: goal.trim().length > 0 },
                );
                if (action === 'newline') return;
                e.preventDefault();
                if (action === 'run') void runGoal('stream');
                else if (action === 'steer') void sendDuringRun('steer');
                else if (action === 'follow_up') void sendDuringRun('follow_up');
              }}
            />
            <div className="mt-2 flex flex-wrap justify-end gap-2">
              {streaming ? (
                <>
                  <button
                    type="button"
                    className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50"
                    disabled={!goal.trim()}
                    onClick={() => void sendDuringRun('follow_up')}
                    title="Enter — runs after this turn"
                  >
                    Queue
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50"
                    disabled={!goal.trim()}
                    onClick={() => void sendDuringRun('steer')}
                    title="⌘/Ctrl+Enter — redirects the running turn"
                  >
                    Steer
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-border px-3 py-1.5 text-sm"
                    onClick={stopRun}
                  >
                    Stop
                  </button>
                </>
              ) : null}
              <button
                type="button"
                className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50"
                disabled={streaming || !goal.trim()}
                onClick={() => void runGoal('background')}
              >
                Background
              </button>
              <button
                type="submit"
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
                disabled={streaming || !goal.trim()}
              >
                {streaming && !background ? 'Running…' : 'Run'}
              </button>
            </div>
          </form>
        </section>

        <aside className="flex min-h-0 flex-col rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">{mountLabel ? 'Mounted folder' : 'Local VFS'}</h2>
            <div className="flex flex-wrap justify-end gap-2">
              {canMount ? (
                mountLabel ? (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={onUnmount}
                  >
                    Unmount
                  </button>
                ) : (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => void onMount()}
                  >
                    Mount folder
                  </button>
                )
              ) : null}
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => void refreshFiles()}
              >
                Refresh
              </button>
              {!mountLabel ? (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={clearVfs}
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>
          {reconnectName && !mountLabel ? (
            <button
              type="button"
              className="mt-3 w-full rounded-md border border-primary/50 bg-accent/40 px-3 py-2 text-left text-xs hover:bg-accent/60"
              onClick={() => void onReconnect()}
            >
              <span className="font-medium">Reconnect {reconnectName}</span>
              <span className="mt-0.5 block text-muted-foreground">
                Mounted last session. The browser drops folder access on reload — one click gets it
                back.
              </span>
            </button>
          ) : null}
          <p className="mt-1 text-xs text-muted-foreground">
            {mountLabel
              ? `Using ${mountLabel} via File System Access. Client tools write here.`
              : '`local_shell` / `local_open` use the tab VFS unless you mount a folder.'}
          </p>
          <pre className="mt-3 min-h-0 flex-1 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-xs">
            {filePreview.length ? filePreview.join('\n') : '(empty)'}
          </pre>
        </aside>
      </div>
    </div>
  );
}

/**
 * One assistant turn, with the file names it mentions confirmed against the
 * workspace and turned into links.
 *
 * Resolution lives here rather than in `Response` so each turn resolves once,
 * for its own text, and a turn still streaming skips it entirely — its text is
 * rewritten on every delta, and half a path resolves to nothing anyway.
 */
function AssistantBody({
  text,
  streaming = false,
  hints,
  onOpenFile,
}: {
  text: string;
  streaming?: boolean;
  hints?: string[];
  onOpenFile?: (path: string, line?: number) => void;
}) {
  const mentions = useFileMentions(text, !streaming && Boolean(onOpenFile), hints);
  return (
    <Suspense fallback={<p className="mt-2 whitespace-pre-wrap break-words text-sm">{text}</p>}>
      <Response className="mt-2" mentions={mentions} onOpenFile={onOpenFile}>
        {text}
      </Response>
    </Suspense>
  );
}
