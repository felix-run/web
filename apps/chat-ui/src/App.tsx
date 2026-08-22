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
import { deleteThreadHistory, getThreadHistory, listManifests, streamChat } from '@/api';
import { AgentSheet } from '@/components/agent/agent-sheet';
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input';
import { Conversation } from '@/components/chat/conversation';
import { Greeting } from '@/components/chat/greeting';
import { Message } from '@/components/chat/message';
import { MultimodalInput } from '@/components/chat/multimodal-input';
import type { SlashCommand } from '@/components/chat/slash-commands';
import { ThreadList } from '@/components/chat/thread-list';
import { EvalSheet } from '@/components/eval/eval-sheet';
import { Inspector, type SkillState } from '@/components/inspector/inspector';
import { JobsSheet } from '@/components/jobs/jobs-sheet';
import { ManifestsSheet } from '@/components/manifests/manifests-sheet';
import { useTheme } from '@/components/theme-provider';
import { ThemeToggle } from '@/components/theme-toggle';
import { Badge } from '@felix/ui/badge';
import { Button } from '@felix/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@felix/ui/dropdown-menu';
import {
  eventsToTurns,
  indexThread,
  listThreads,
  loadTurns,
  migrateLegacy,
  removeThread,
  saveTurns,
  type ThreadMeta,
  titleFromText,
} from '@/lib/threads';
import type { ChatMessage, ImageAttachment, ToolCall, Turn, Variant } from '@/types';

const THREAD_KEY = 'felix.threadId';
const MANIFEST_KEY = 'felix.manifest';
const HISTORY_KEY = 'felix.historyOpen';
const INSPECTOR_KEY = 'felix.inspectorOpen';
const VERBOSE_KEY = 'felix.verbose';
/** Bundled workspace agent — same path as float. */
const DEFAULT_MANIFEST = 'cowork';

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
  const [variant, setVariant] = useState<Variant | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  // Replace the active transcript with the server-checkpointed one when it
  // exists (richer than the local cache: survives across browsers/clears).
  const hydrateFromServer = useCallback((id: string) => {
    getThreadHistory(id)
      .then((h) => {
        if (!h || h.events.length === 0) return;
        const rebuilt = eventsToTurns(h.events);
        if (rebuilt.length) {
          // Only swap into view if the user is still on this thread.
          setTurns((cur) => (id === threadIdRef.current ? rebuilt : cur));
          saveTurns(id, rebuilt);
        }
      })
      .catch(() => {});
  }, []);

  // On mount: migrate legacy storage, load the thread list, and hydrate the
  // active thread from local cache + server. Intentionally runs once.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only bootstrap
  useEffect(() => {
    migrateLegacy(Date.now());
    setThreads(listThreads());
    setTurns(loadTurns(threadId));
    hydrateFromServer(threadId);
  }, []);

  const newThread = useCallback(() => {
    abortRef.current?.abort();
    setThreadId(crypto.randomUUID());
    setTurns([]);
    setVariant(null);
    setSkills(null);
    setError(null);
  }, []);

  const selectThread = useCallback(
    (id: string) => {
      if (id === threadId) return;
      abortRef.current?.abort();
      setThreadId(id);
      setTurns(loadTurns(id));
      setVariant(null);
      setSkills(null);
      setError(null);
      hydrateFromServer(id);
    },
    [threadId, hydrateFromServer],
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
    (messagesToSend: ChatMessage[], assistantId: string) => {
      const patch = (fn: (t: Turn) => Turn) =>
        setTurns((prev) => prev.map((t) => (t.id === assistantId ? fn(t) : t)));

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setStreaming(true);

      return streamChat(
        { manifest, messages: messagesToSend, threadId, signal: ctrl.signal },
        {
          onVariant: setVariant,
          onEvent: (ev) => {
            switch (ev.event) {
              case 'on_chat_model_stream':
                patch((t) => ({ ...t, content: t.content + ev.data.chunk.content }));
                break;
              case 'on_tool_start':
                if (verboseRef.current) setInspectorOpen(true);
                patch((t) => ({
                  ...t,
                  tools: [
                    ...(t.tools ?? []),
                    { name: ev.data.name, input: ev.data.input, done: false },
                  ],
                }));
                break;
              case 'on_tool_end':
                patch((t) => ({ ...t, tools: closeTool(t.tools, ev.data.name, ev.data.output) }));
                captureSkills(ev.data.name, ev.data.output, setSkills);
                break;
              case 'on_chain_end': {
                const usage = ev.data.output?.usage;
                if (usage) patch((t) => ({ ...t, usage }));
                break;
              }
              case 'on_error':
                setError(ev.data.message);
                break;
            }
          },
        },
      )
        .catch((err) => {
          if (!ctrl.signal.aborted) setError(String((err as Error)?.message ?? err));
        })
        .finally(() => {
          setStreaming(false);
          abortRef.current = null;
        });
    },
    [manifest, threadId],
  );

  const send = useCallback(
    (text: string, attachments?: ImageAttachment[]) => {
      if (streaming) return;
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
      void streamInto([userMessage], assistantId);
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
    abortRef.current?.abort();
    setTurns([]);
    setVariant(null);
    setSkills(null);
    setError(null);
    void deleteThreadHistory(threadId);
    saveTurns(threadId, []);
  }, [threadId]);

  // Map a composer submission (text + browser File parts, already converted to
  // data URLs by PromptInput) onto our send(). Image parts become attachments.
  const submit = useCallback(
    (message: PromptInputMessage) => {
      const attachments: ImageAttachment[] = message.files
        .filter((f) => f.mediaType.startsWith('image/'))
        .map((f) => ({ url: f.url, media_type: f.mediaType, filename: f.filename }));
      send(message.text, attachments);
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
    [newThread, clearThread, setTheme, resolved],
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
          {variant && (
            <Badge
              variant={variant === 'canary' ? 'default' : 'secondary'}
              className="hidden uppercase sm:inline-flex"
            >
              {variant}
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
            <MultimodalInput
              status={streaming ? 'streaming' : 'ready'}
              isConnected
              onSubmit={submit}
              onStop={() => abortRef.current?.abort()}
              onSlashCommand={onSlashCommand}
              models={modelOptions}
              modelId={manifest}
              onModelChange={setManifest}
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
      <ManifestsSheet open={manifestsOpen} onOpenChange={setManifestsOpen} manifest={manifest} />
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
