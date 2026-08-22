import { nanoid } from 'nanoid';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { readExisting, summarizeToolArgs, type PendingApproval } from '@felix/cowork-client';
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
import {
  clearMount,
  executeClientTool,
  getMountLabel,
  hasMount,
  mountTree,
  pickDirectory,
  supportsDirectoryPicker,
  vfs,
} from '@/lib/client-tools';
import { cn } from '@/lib/utils';
import type { PendingUiRequest, ThinkingLevel, TimelineItem } from '@/types';

const MANIFEST = 'cowork';
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
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHits, setSearchHits] = useState<
    Array<{ thread_id: string; content: string; event_id?: string }>
  >([]);
  const [searching, setSearching] = useState(false);
  const [mountLabel, setMountLabel] = useState<string | null>(getMountLabel());
  const [files, setFiles] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const leaseTokenRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canMount = supportsDirectoryPicker();

  const pending = pendingQueue[0] ?? null;

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

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [timeline, assistantDraft, pendingQueue]);

  const refreshFiles = useCallback(async () => {
    if (hasMount()) {
      setFiles(await mountTree());
    } else {
      setFiles(vfs.tree());
    }
  }, []);

  useEffect(() => {
    void refreshFiles();
  }, [refreshFiles, mountLabel]);

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
    setAssistantDraft('');
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
      setMountLabel(name);
      await refreshFiles();
      toast.success(`Mounted ${name}`);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    }
  }, [refreshFiles]);

  const onUnmount = useCallback(() => {
    clearMount();
    setMountLabel(null);
    void refreshFiles();
    toast.message('Folder unmounted');
  }, [refreshFiles]);

  const handleStreamEvents = useCallback(
    async (event: { event: string; data: Record<string, unknown> }, draftRef: { current: string }) => {
      if (event.event === 'text_delta' || event.event === 'on_chat_model_stream') {
        const data = event.data as { delta?: string; chunk?: { content?: string } };
        const chunk = data.delta ?? data.chunk?.content ?? '';
        if (chunk) {
          draftRef.current += chunk;
          setAssistantDraft(draftRef.current);
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
          setAssistantDraft('');
        }
        const data = event.data as { name?: string; input?: unknown };
        push({
          id: nanoid(),
          kind: 'tool',
          title: String(data.name ?? 'tool'),
          body: JSON.stringify(data.input ?? {}, null, 2),
          status: 'running',
        });
        return;
      }

      if (event.event === 'tool_end' || event.event === 'on_tool_end') {
        const data = event.data as { name?: string; output?: unknown };
        const name = String(data.name ?? 'tool');
        const output =
          typeof data.output === 'string' ? data.output : JSON.stringify(data.output ?? '');
        setTimeline((cur) => {
          const next = [...cur];
          for (let i = next.length - 1; i >= 0; i--) {
            const item = next[i];
            if (
              item &&
              item.kind === 'tool' &&
              (item.title === name || item.title === `client · ${name}`) &&
              item.status === 'running'
            ) {
              next[i] = {
                ...item,
                body: output.slice(0, 4000),
                status:
                  output.startsWith('[approval') || output.startsWith('[error') ? 'error' : 'done',
              };
              break;
            }
          }
          return next;
        });
        await refreshFiles();
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
        });
        return;
      }

      if (event.event === 'tool_request') {
        const data = event.data as {
          id: string;
          name: string;
          args?: Record<string, unknown>;
        };
        push({
          id: nanoid(),
          kind: 'tool',
          title: `client · ${data.name}`,
          body: JSON.stringify(data.args ?? {}, null, 2),
          status: 'running',
        });
        const result = await executeClientTool({
          id: data.id,
          name: data.name,
          args: data.args ?? {},
        });
        await postToolResult({
          threadId,
          toolCallId: data.id,
          content: result.content,
          error: result.error,
        });
        await refreshFiles();
        return;
      }

      if (event.event === 'aborted') {
        setSessionPhase('aborted');
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
    [push, refreshFiles, threadId],
  );

  const runGoal = useCallback(
    async (mode: 'stream' | 'background') => {
      const text = goal.trim();
      if (!text || streaming) return;

      setStreaming(true);
      setBackground(mode === 'background');
      setGoal('');
      setAssistantDraft('');
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
              setAssistantDraft(`status: ${r.status || 'pending'}`);
            },
          });
          setAssistantDraft('');
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
              setAssistantDraft('');
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
          setAssistantDraft('');
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

  const onSteer = useCallback(async () => {
    const text = goal.trim();
    if (!text || !streaming) return;
    try {
      await steerChat({ threadId, text });
      push({ id: nanoid(), kind: 'user', title: 'Steer', body: text, status: 'done' });
      setGoal('');
      toast.message('Steer queued');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }, [goal, streaming, threadId, push]);

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

  const openSearchHit = useCallback((fullThreadId: string) => {
    const suffix = fullThreadId.includes(':')
      ? fullThreadId.slice(fullThreadId.indexOf(':') + 1)
      : fullThreadId;
    if (suffix === threadId) return;
    stopRun();
    setThreadId(suffix);
    setTimeline([]);
    setAssistantDraft('');
    setPendingQueue([]);
    setUiPrompt(null);
    setSessionPhase(null);
    setSearchQuery('');
    setSearchHits([]);
  }, [threadId, stopRun]);

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
                      ? hit.thread_id.slice(hit.thread_id.indexOf(':') + 1, hit.thread_id.indexOf(':') + 9)
                      : hit.thread_id.slice(0, 8)}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {pending ? (
        <div className="rounded-lg border border-primary/40 bg-accent/50 p-4 shadow-sm">
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
                <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">After</p>
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
        <div className="rounded-lg border border-primary/40 bg-accent/50 p-4 shadow-sm">
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

      <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[1.4fr_0.9fr]">
        <section className="flex min-h-0 flex-col rounded-lg border border-border bg-card shadow-sm">
          <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {timeline.length === 0 && !assistantDraft ? (
              <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
                Try: create notes/todo.md with three tasks, then open it.
                {canMount ? ' Mount a real folder to write outside the tab VFS.' : ''}
              </div>
            ) : null}
            {timeline.map((item) => (
              <article
                key={item.id}
                className={cn(
                  'rounded-md border border-border px-3 py-2',
                  item.kind === 'user' && 'bg-accent/40',
                  item.kind === 'approval' && item.status === 'pending' && 'border-primary/50',
                  item.status === 'error' && 'border-destructive/40',
                  item.status === 'denied' && 'opacity-70',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-medium">{item.title}</h2>
                  <div className="flex items-center gap-2">
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
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
                    {item.body}
                  </pre>
                ) : null}
              </article>
            ))}
            {assistantDraft ? (
              <article className="rounded-md border border-border px-3 py-2">
                <h2 className="text-sm font-medium">
                  {background ? 'Background…' : 'Working…'}
                </h2>
                <pre className="mt-2 whitespace-pre-wrap break-words text-sm">{assistantDraft}</pre>
              </article>
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
              placeholder="Describe the goal…"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              disabled={streaming}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void runGoal('stream');
                }
              }}
            />
            <div className="mt-2 flex flex-wrap justify-end gap-2">
              {streaming ? (
                <>
                  <button
                    type="button"
                    className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50"
                    disabled={!goal.trim()}
                    onClick={() => void onSteer()}
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
