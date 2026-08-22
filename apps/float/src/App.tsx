import { nanoid } from 'nanoid';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  decideApproval,
  pollDurableRun,
  postToolResult,
  startChat,
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
} from '@/lib/client-tools';
import { cn } from '@/lib/utils';
import { vfs } from '@/lib/vfs';
import type { PendingApproval, TimelineItem } from '@/types';

const MANIFEST = 'cowork';
const THREAD_KEY = 'felix.float.threadId';

function loadThreadId(): string {
  return localStorage.getItem(THREAD_KEY) || nanoid(12);
}

function summarizeArgs(toolName: string, args: Record<string, unknown>): string {
  if (toolName === 'write_file') {
    const path = typeof args.path === 'string' ? args.path : '?';
    const len = typeof args.content === 'string' ? args.content.length : 0;
    return `Write ${path} (${len} chars)${args.append ? ' append' : ''}`;
  }
  if (toolName === 'local_shell') {
    return `Shell: ${typeof args.command === 'string' ? args.command : JSON.stringify(args)}`;
  }
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
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
  const [mountLabel, setMountLabel] = useState<string | null>(getMountLabel());
  const [files, setFiles] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canMount = supportsDirectoryPicker();

  const pending = pendingQueue[0] ?? null;

  useEffect(() => {
    localStorage.setItem(THREAD_KEY, threadId);
  }, [threadId]);

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

  const resetSession = useCallback(() => {
    abortRef.current?.abort();
    const next = nanoid(12);
    setThreadId(next);
    setTimeline([]);
    setAssistantDraft('');
    setPendingQueue([]);
    setStreaming(false);
    setBackground(false);
  }, []);

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
        const entry: PendingApproval = {
          approvalId: data.approval_id,
          toolName: data.tool_name,
          args: data.args ?? {},
          ruleId: data.rule_id,
        };
        setPendingQueue((q) => [...q, entry]);
        push({
          id: nanoid(),
          kind: 'approval',
          title: `Needs approval · ${data.tool_name}`,
          body: summarizeArgs(data.tool_name, data.args ?? {}),
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

  const filePreview = useMemo(() => files.slice(0, 80), [files]);

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
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded border border-border px-2 py-1 font-mono">{MANIFEST}</span>
          <span className="rounded border border-border px-2 py-1 font-mono">
            {threadId.slice(0, 8)}
          </span>
          <button
            type="button"
            className="rounded border border-border px-2 py-1 hover:bg-accent"
            onClick={resetSession}
          >
            New session
          </button>
        </div>
      </header>

      {pending ? (
        <div className="rounded-lg border border-primary/40 bg-accent/50 p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Approval required{pendingQueue.length > 1 ? ` · ${pendingQueue.length} queued` : ''}
              </p>
              <h2 className="mt-1 text-base font-semibold">{pending.toolName}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {summarizeArgs(pending.toolName, pending.args)}
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
          <pre className="mt-3 max-h-32 overflow-auto rounded-md border border-border bg-background p-2 font-mono text-xs">
            {JSON.stringify(pending.args, null, 2)}
          </pre>
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
                  {item.status ? (
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {item.status}
                    </span>
                  ) : null}
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
                <button
                  type="button"
                  className="rounded-md border border-border px-3 py-1.5 text-sm"
                  onClick={() => abortRef.current?.abort()}
                >
                  Stop
                </button>
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
