import { nanoid } from 'nanoid';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { decideApproval, postToolResult, streamChat } from '@/api';
import { executeClientTool } from '@/lib/client-tools';
import { cn } from '@/lib/utils';
import { vfs } from '@/lib/vfs';
import type { PendingApproval, TimelineItem } from '@/types';

const MANIFEST = 'cowork';
const THREAD_KEY = 'felix.float.threadId';

function loadThreadId(): string {
  return localStorage.getItem(THREAD_KEY) || nanoid(12);
}

export default function App() {
  const [threadId, setThreadId] = useState(loadThreadId);
  const [goal, setGoal] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [assistantDraft, setAssistantDraft] = useState('');
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [pending, setPending] = useState<PendingApproval | null>(null);
  const [files, setFiles] = useState(() => vfs.tree());
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem(THREAD_KEY, threadId);
  }, [threadId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [timeline, assistantDraft, pending]);

  const refreshFiles = useCallback(() => setFiles(vfs.tree()), []);

  const push = useCallback((item: TimelineItem) => {
    setTimeline((cur) => [...cur, item]);
  }, []);

  const resetSession = useCallback(() => {
    abortRef.current?.abort();
    const next = nanoid(12);
    setThreadId(next);
    setTimeline([]);
    setAssistantDraft('');
    setPending(null);
    setStreaming(false);
  }, []);

  const clearVfs = useCallback(() => {
    vfs.reset();
    refreshFiles();
    toast.message('Local files cleared');
  }, [refreshFiles]);

  const runGoal = useCallback(async () => {
    const text = goal.trim();
    if (!text || streaming) return;

    setStreaming(true);
    setGoal('');
    setPending(null);
    setAssistantDraft('');
    push({ id: nanoid(), kind: 'user', title: 'Goal', body: text, status: 'done' });

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let draft = '';

    try {
      await streamChat(
        {
          manifest: MANIFEST,
          messages: [{ role: 'user', content: text }],
          threadId,
          signal: ctrl.signal,
        },
        async (event) => {
          if (event.event === 'text_delta' || event.event === 'on_chat_model_stream') {
            const data = event.data as {
              delta?: string;
              chunk?: { content?: string };
            };
            const chunk = data.delta ?? data.chunk?.content ?? '';
            if (chunk) {
              draft += chunk;
              setAssistantDraft(draft);
            }
            return;
          }

          if (event.event === 'tool_start' || event.event === 'on_tool_start') {
            if (draft) {
              push({
                id: nanoid(),
                kind: 'assistant',
                title: 'Update',
                body: draft,
                status: 'done',
              });
              draft = '';
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
                if (item && item.kind === 'tool' && item.title === name && item.status === 'running') {
                  next[i] = {
                    ...item,
                    body: output.slice(0, 4000),
                    status: output.startsWith('[approval') || output.startsWith('[error')
                      ? 'error'
                      : 'done',
                  };
                  break;
                }
              }
              return next;
            });
            refreshFiles();
            return;
          }

          if (event.event === 'approval_required') {
            const data = event.data as {
              approval_id: string;
              tool_name: string;
              args?: Record<string, unknown>;
              rule_id?: string;
            };
            setPending({
              approvalId: data.approval_id,
              toolName: data.tool_name,
              args: data.args ?? {},
              ruleId: data.rule_id,
            });
            push({
              id: nanoid(),
              kind: 'approval',
              title: `Approval · ${data.tool_name}`,
              body: JSON.stringify(data.args ?? {}, null, 2),
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
            refreshFiles();
            return;
          }

          if (event.event === 'done' && draft) {
            push({
              id: nanoid(),
              kind: 'assistant',
              title: 'Result',
              body: draft,
              status: 'done',
            });
            draft = '';
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
      abortRef.current = null;
      if (draft) {
        push({
          id: nanoid(),
          kind: 'assistant',
          title: 'Result',
          body: draft,
          status: 'done',
        });
        setAssistantDraft('');
      }
    }
  }, [goal, streaming, threadId, push, refreshFiles]);

  const onDecide = useCallback(
    async (status: 'approved' | 'denied') => {
      if (!pending) return;
      try {
        await decideApproval(pending.approvalId, { status });
        setTimeline((cur) =>
          cur.map((item) =>
            item.kind === 'approval' && item.status === 'pending'
              ? { ...item, status: status === 'approved' ? 'done' : 'denied' }
              : item,
          ),
        );
        setPending(null);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    },
    [pending],
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

      <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[1.4fr_0.9fr]">
        <section className="flex min-h-0 flex-col rounded-lg border border-border bg-card shadow-sm">
          <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {timeline.length === 0 && !assistantDraft ? (
              <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
                Try: create notes/todo.md with three tasks, then open it.
              </div>
            ) : null}
            {timeline.map((item) => (
              <article
                key={item.id}
                className={cn(
                  'rounded-md border border-border px-3 py-2',
                  item.kind === 'user' && 'bg-accent/40',
                  item.status === 'pending' && 'border-primary/40',
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
                <h2 className="text-sm font-medium">Working…</h2>
                <pre className="mt-2 whitespace-pre-wrap break-words text-sm">{assistantDraft}</pre>
              </article>
            ) : null}
          </div>

          {pending ? (
            <div className="border-t border-border bg-accent/30 p-4">
              <p className="text-sm font-medium">Approve `{pending.toolName}`?</p>
              <pre className="mt-2 max-h-28 overflow-auto rounded bg-background p-2 font-mono text-xs">
                {JSON.stringify(pending.args, null, 2)}
              </pre>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
                  onClick={() => void onDecide('approved')}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="rounded-md border border-border px-3 py-1.5 text-sm"
                  onClick={() => void onDecide('denied')}
                >
                  Deny
                </button>
              </div>
            </div>
          ) : null}

          <form
            className="border-t border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void runGoal();
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
                  void runGoal();
                }
              }}
            />
            <div className="mt-2 flex justify-end gap-2">
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
                type="submit"
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
                disabled={streaming || !goal.trim()}
              >
                {streaming ? 'Running…' : 'Run'}
              </button>
            </div>
          </form>
        </section>

        <aside className="flex min-h-0 flex-col rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Local VFS</h2>
            <div className="flex gap-2">
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={refreshFiles}
              >
                Refresh
              </button>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={clearVfs}
              >
                Clear
              </button>
            </div>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            `local_shell` and `local_open` run against this tab. Closing the tab ends the session.
          </p>
          <pre className="mt-3 min-h-0 flex-1 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-xs">
            {filePreview.length ? filePreview.join('\n') : '(empty)'}
          </pre>
        </aside>
      </div>
    </div>
  );
}
