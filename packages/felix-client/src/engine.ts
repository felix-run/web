/**
 * One turn of a Felix conversation, from the frames on the wire to the
 * transcript a client renders.
 *
 * This is the `StreamEvent` switch, and it is the only one in the repo:
 * `pnpm check-protocol-parity` reads its branches, so an event the harness
 * gains with no arm here fails CI. Everything a view would do — scroll,
 * highlight, redraw — is left to the subscriber; everything the *protocol*
 * requires is done here, including the three frames a run blocks on
 * (`tool_request`, `approval_required`, `ui_request`), which must be answered
 * on every path or the conversation hangs with no error shown.
 *
 * It is imperative rather than a pure reducer on purpose. Three arms `await`
 * mid-switch — an approval pre-reads the file it would overwrite, a client tool
 * runs and posts its result back — and the order those land in the transcript is
 * part of the behaviour. A reducer returning effects would move them a tick
 * later and change what the user sees.
 */
import type { ChatMessage, PendingUiRequest, StreamEvent, TokenUsage } from '@felix/protocol';
import { type PendingApproval, summarizeToolArgs, syncApprovals } from './approvals';
import { reattachThread } from './reattach';
import type { FelixClient } from './transport';
import { closeTool, markToolPhase, type Turn } from './turns';

export interface EngineState {
  turns: Turn[];
  /** `idle` | `turn` | `durable` | `aborted` | `compaction` | whatever a newer harness reports. */
  phase: string;
  /** A run this client started is in flight. */
  streaming: boolean;
  /** The stream dropped and the thread is being rejoined — not the same as still running. */
  reattaching: boolean;
  error: string | null;
  /** Gated tool calls waiting on a decision, oldest first. */
  approvals: PendingApproval[];
  uiPrompt: PendingUiRequest | null;
}

export interface ClientToolPort {
  /** Run the tool the harness handed back, and never throw — a hang costs the run. */
  execute(req: {
    id: string;
    name: string;
    args: Record<string, unknown>;
  }): Promise<{ content: string; error?: boolean }>;
  /** Pre-edit text for a `write_file` approval diff, where the client can read one. */
  readForDiff?(path: string): Promise<string | null>;
}

export interface EnginePorts {
  client: FelixClient;
  /** The thread the run belongs to, read at call time — it changes as threads switch. */
  threadId: () => string;
  /** Injected so a test can make transcript ids deterministic. */
  newId?: () => string;
  /**
   * Absent means this client cannot run tools: every `tool_request` is answered
   * with an error so the run continues instead of stalling for the tool timeout.
   */
  clientTools?: ClientToolPort;
  /** A tool card opened — chat-ui reveals its inspector on this. */
  onToolStart?: () => void;
  /** A `list_skills` result, for a client that shows which skills a manifest loaded. */
  onSkills?: (skills: { declared: string[]; active: string[] }) => void;
}

export interface SendArgs {
  manifest: string;
  messages: ChatMessage[];
  /** The assistant turn deltas append to. It must already be in `state.turns`. */
  assistantId: string;
  /** `background` posts to /chat and polls the durable run instead of streaming. */
  mode?: 'stream' | 'background';
}

export interface ChatEngine {
  readonly state: EngineState;
  /** Fires after every state change. Returns an unsubscribe. */
  subscribe(listener: (state: EngineState) => void): () => void;
  /** Replace the transcript — thread switches, hydration, rewind. */
  setTurns(turns: Turn[]): void;
  /**
   * Forget everything thread-scoped: transcript, error, phase, and both kinds of
   * blocking prompt. The seen-approval ids go too, because they were only ever
   * about not re-showing *this* thread's decisions.
   */
  reset(): void;
  /** Open one turn and run it to completion. Never rejects. */
  send(args: SendArgs): Promise<void>;
  /** Apply one wire frame. Exposed for reattach, and for tests. */
  applyEvent(event: StreamEvent): Promise<void>;
  /**
   * Adopt any approval `GET /approvals` is holding that is not already on
   * screen. Safe to call on a timer: ids stay remembered, so an answered
   * approval cannot come back if the server briefly still lists it as pending.
   */
  syncApprovals(): Promise<void>;
  /** Drop the approval at the head of the queue, once decided. */
  shiftApproval(): void;
  clearUiPrompt(): void;
  setError(message: string | null): void;
  setPhase(phase: string): void;
  /** Abort the in-flight run, if any. */
  abort(): void;
}

const IDLE: EngineState = {
  turns: [],
  phase: 'idle',
  streaming: false,
  reattaching: false,
  error: null,
  approvals: [],
  uiPrompt: null,
};

export function createChatEngine(ports: EnginePorts): ChatEngine {
  const newId = ports.newId ?? (() => crypto.randomUUID());
  let state: EngineState = { ...IDLE };
  const listeners = new Set<(s: EngineState) => void>();
  const seenApprovals = new Set<string>();

  let controller: AbortController | null = null;
  /**
   * The turn deltas currently land on. A drained steer splits the reply — the
   * harness appends the steer as a user message and keeps going — so this moves
   * to a fresh assistant turn mid-run.
   */
  let activeAssistantId = '';

  const emit = () => {
    for (const listener of listeners) listener(state);
  };

  const set = (next: Partial<EngineState>) => {
    state = { ...state, ...next };
    emit();
  };

  /** Patch whichever turn is active *now* — a steer may have moved it. */
  const patch = (fn: (turn: Turn) => Turn) => {
    const target = activeAssistantId;
    set({ turns: state.turns.map((t) => (t.id === target ? fn(t) : t)) });
  };

  const interject = (content: string) => {
    const nextAssistantId = newId();
    set({
      turns: [
        ...state.turns,
        { id: newId(), role: 'user', content },
        { id: nextAssistantId, role: 'assistant', content: '', tools: [] },
      ],
    });
    activeAssistantId = nextAssistantId;
  };

  /** Capture a `list_skills` tool result so a client can show declared vs active. */
  const captureSkills = (name: string, output: unknown) => {
    if (name !== 'list_skills' || !ports.onSkills) return;
    try {
      const obj = typeof output === 'string' ? JSON.parse(output) : output;
      if (obj && Array.isArray(obj.declared) && Array.isArray(obj.active)) {
        ports.onSkills({ declared: obj.declared, active: obj.active });
      }
    } catch {
      // non-JSON list_skills output — ignore
    }
  };

  // Set by a `run_accepted` frame, cleared by `final`. Non-null means a durable
  // run is still executing server-side, so losing the stream is not the same as
  // losing the run.
  let resumeToken: string | null = null;
  // Newest `id:` the stream stamped, handed to a reattach so it replays only
  // what was missed; undefined means a cold reattach off a full snapshot.
  let lastEventId: string | undefined;

  const applyEvent = async (ev: StreamEvent): Promise<void> => {
    switch (ev.event) {
      case 'on_chat_model_stream':
      case 'text_delta': {
        const data = ev.data as { chunk?: { content?: string }; delta?: string };
        const chunk = data.delta ?? data.chunk?.content ?? '';
        if (chunk) patch((t) => ({ ...t, content: t.content + chunk }));
        break;
      }
      // Reasoning, which the harness names separately from the answer. A
      // deployment older than 2026-08-26 sends it only inside `session_progress`,
      // where it is ignored, so this arm never fires and the turn renders exactly
      // as it did before.
      case 'thinking_delta': {
        const data = ev.data as { chunk?: { content?: string }; delta?: string };
        const chunk = data.delta ?? data.chunk?.content ?? '';
        if (!chunk) break;
        patch((t) => {
          const blocks = t.reasoning ?? [];
          const last = blocks[blocks.length - 1];
          // Consecutive thinking at the same point in the prose is one thought. A
          // new block only starts once text or a tool has moved the offset on, so
          // two stretches either side of a call do not merge into a single stream
          // of consciousness.
          if (last && last.at === t.content.length) {
            return {
              ...t,
              reasoning: [...blocks.slice(0, -1), { ...last, text: last.text + chunk }],
            };
          }
          return { ...t, reasoning: [...blocks, { text: chunk, at: t.content.length }] };
        });
        break;
      }
      case 'on_tool_start':
      case 'tool_start': {
        ports.onToolStart?.();
        const data = ev.data as { name?: string; input?: unknown; id?: string };
        patch((t) => ({
          ...t,
          tools: [
            ...(t.tools ?? []),
            {
              name: String(data.name ?? 'tool'),
              input: data.input,
              done: false,
              at: t.content.length,
              ...(data.id ? { callId: data.id } : {}),
            },
          ],
        }));
        break;
      }
      case 'on_tool_end':
      case 'tool_end': {
        const data = ev.data as { name?: string; output?: unknown; id?: string };
        const name = String(data.name ?? 'tool');
        patch((t) => ({ ...t, tools: closeTool(t.tools, name, data.output, data.id) }));
        captureSkills(name, data.output);
        break;
      }
      case 'approval_required': {
        const data = ev.data as {
          approval_id: string;
          tool_name: string;
          args?: Record<string, unknown>;
          rule_id?: string;
          reason?: string;
        };
        const args = data.args ?? {};
        let before: string | null = null;
        if (data.tool_name === 'write_file' && typeof args.path === 'string') {
          before = (await ports.clientTools?.readForDiff?.(args.path)) ?? null;
        }
        if (seenApprovals.has(data.approval_id)) break;
        seenApprovals.add(data.approval_id);
        set({
          approvals: [
            ...state.approvals,
            {
              approvalId: data.approval_id,
              toolName: data.tool_name,
              args,
              ruleId: data.rule_id,
              reason: data.reason,
              // Deliberately absent: the frame carries no deadline. The
              // `/approvals` poll fills it in a beat later, which is why a
              // watched client keeps polling too.
              before,
            },
          ],
        });
        patch((t) => ({
          ...t,
          tools: [
            ...(t.tools ?? []),
            {
              name: `approval · ${data.tool_name}`,
              input: summarizeToolArgs(data.tool_name, args),
              done: false,
              at: t.content.length,
            },
          ],
        }));
        break;
      }
      case 'tool_request': {
        const data = ev.data as { id: string; name: string; args?: Record<string, unknown> };
        patch((t) => ({
          ...t,
          tools: [
            ...(t.tools ?? []),
            {
              name: `client · ${data.name}`,
              input: data.args,
              done: false,
              callId: data.id,
              at: t.content.length,
            },
          ],
        }));
        // The run is blocked on this. A client with no executor still has to
        // answer, or the harness waits out the tool's timeout for nothing.
        const result = ports.clientTools
          ? await ports.clientTools.execute({ id: data.id, name: data.name, args: data.args ?? {} })
          : { content: `error: this client cannot run ${data.name}`, error: true };
        await ports.client.postToolResult({
          threadId: ports.threadId(),
          toolCallId: data.id,
          content: result.content,
          error: result.error,
        });
        patch((t) => ({
          ...t,
          tools: closeTool(t.tools, `client · ${data.name}`, result.content, data.id),
        }));
        break;
      }
      case 'on_chain_end': {
        const usage = (ev.data as { output?: { usage?: TokenUsage } }).output?.usage;
        if (usage) patch((t) => ({ ...t, usage }));
        break;
      }
      // Progress either side of a tool call. Without it a long-running tool shows
      // nothing but "running" for its whole duration.
      case 'tool_execution_update': {
        const { name, status, id } = ev.data as { name?: string; status?: string; id?: string };
        if (!name || !status) break;
        patch((t) => ({ ...t, tools: markToolPhase(t.tools, name, status, id) }));
        break;
      }
      // Terminal frame for the turn. It is not what ends the read loop —
      // `readSseStream` returns on the `[DONE]` sentinel — so the useful part is
      // `final`, which carries the answer when a model produced no deltas at all,
      // and the chance to settle anything still marked running before the spinner
      // outlives the run that owned it.
      case 'done': {
        const data = ev.data as { final?: { content?: string } };
        const final = data.final?.content?.trim();
        patch((t) => ({
          ...t,
          content: t.content.trim() ? t.content : (final ?? t.content),
          tools: (t.tools ?? []).map((tool) => (tool.done ? tool : { ...tool, done: true })),
        }));
        break;
      }
      // The durable trio. A manifest with `spec.execution.mode: durable` makes
      // /chat/stream stream the *run's progress* rather than tokens: no deltas
      // ever arrive, and the answer lands in `final`. Rendered the same way as
      // the background-run path below, because to the user it is the same thing —
      // it just got here down a different route.
      case 'run_accepted': {
        const data = ev.data as { resume_token?: string };
        // Held so a dropped connection can rejoin the run instead of abandoning
        // it: the run itself outlives this stream.
        if (data.resume_token) resumeToken = data.resume_token;
        set({ phase: 'durable' });
        patch((t) => ({ ...t, content: t.content || 'Durable run accepted…' }));
        break;
      }
      case 'run_status': {
        const status = String((ev.data as { status?: string }).status ?? '').trim();
        if (status) patch((t) => ({ ...t, content: `Background · ${status}…` }));
        break;
      }
      // The durable answer, and the only place it arrives — there are no deltas
      // to have accumulated, so this replaces rather than defers.
      case 'final': {
        const content = String((ev.data as { content?: string }).content ?? '').trim();
        resumeToken = null;
        patch((t) => ({ ...t, content: content || t.content }));
        break;
      }
      // Only `GET /chat/stream/{thread_id}` sends these two, and only
      // `reattachThread` reads them — it folds them through `eventsToTurns`, the
      // same path thread hydration uses, rather than patching the turn in flight.
      // Listed here so the frames are not silently unhandled if they ever arrive
      // on a stream that is not a reattach.
      case 'snapshot':
      case 'session_event':
        break;
      // Normalised by `readSseStream` from the harness's `event: error` frame —
      // the one SSE-typed frame, and the only way a stream reports a failure that
      // happened after its 200 was already sent.
      case 'on_error':
        set({ error: String((ev.data as { message?: string }).message ?? 'error') });
        break;
      case 'aborted':
        set({ phase: 'aborted' });
        break;
      // The agent drained a queued steer / follow-up. It is a real user message
      // in the session log, so render it as one rather than letting the reply
      // silently change direction.
      case 'steer':
      case 'follow_up': {
        const content = (ev.data as { content?: string }).content?.trim();
        if (content) interject(content);
        break;
      }
      case 'session_progress': {
        const phase = (ev.data as { phase?: string }).phase;
        if (phase) set({ phase });
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
        set({
          uiPrompt: {
            requestId: data.request_id,
            kind: data.kind,
            prompt: data.prompt,
            options,
            defaultValue: data.default,
          },
        });
        break;
      }
    }
  };

  const finalOf = (run: { final?: unknown }) =>
    typeof run.final === 'object' && run.final && 'content' in run.final
      ? String((run.final as { content?: unknown }).content || '')
      : '';

  const send = async (args: SendArgs): Promise<void> => {
    const mode = args.mode ?? 'stream';
    activeAssistantId = args.assistantId;

    const ctrl = new AbortController();
    controller = ctrl;
    set({ streaming: true, error: null, phase: 'turn' });
    resumeToken = null;
    lastEventId = undefined;

    const run = async () => {
      if (mode === 'background') {
        patch((t) => ({ ...t, content: t.content || 'Queued durable job…' }));
        const started = await ports.client.startChat({
          manifest: args.manifest,
          messages: args.messages,
          threadId: ports.threadId(),
          signal: ctrl.signal,
        });
        if (started.kind === 'done') {
          patch((t) => ({ ...t, content: started.final.content }));
          return;
        }
        const runResult = await ports.client.pollDurableRun(started.resumeToken, {
          signal: ctrl.signal,
          onTick: (r) => {
            patch((t) => ({ ...t, content: `Background · ${r.status || 'pending'}…` }));
          },
        });
        if (runResult.error) {
          set({ error: runResult.error });
          return;
        }
        patch((t) => ({
          ...t,
          content: finalOf(runResult) || `(${runResult.status || 'completed'})`,
        }));
        return;
      }

      try {
        await ports.client.streamChat(
          {
            manifest: args.manifest,
            messages: args.messages,
            threadId: ports.threadId(),
            signal: ctrl.signal,
          },
          {
            onEvent: (ev) => applyEvent(ev),
            onCursor: (id) => {
              lastEventId = id;
            },
          },
        );
      } catch (err) {
        if (ctrl.signal.aborted) throw err;
        // A durable run survives its stream. If one was accepted and has not yet
        // reported `final`, rejoin it by polling rather than reporting a failure
        // for work that is still going.
        if (!resumeToken) {
          // Otherwise the run itself is gone — torn down when we hung up — but
          // whatever it committed to the session log before that is not, and work
          // may still be landing there. Rejoin the thread.
          const threadId = ports.threadId();
          if (!threadId) throw err;
          set({ reattaching: true });
          try {
            await reattachThread({
              client: ports.client,
              threadId,
              lastEventId,
              signal: ctrl.signal,
              onTurns: (rebuilt) => set({ turns: rebuilt }),
              onPhase: (phase) => set({ phase }),
              onEvent: (ev) => applyEvent(ev),
            });
          } finally {
            set({ reattaching: false });
          }
          return;
        }
        set({ phase: 'durable' });
        const rejoined = await ports.client.pollDurableRun(resumeToken, {
          signal: ctrl.signal,
          onTick: (r) => {
            patch((t) => ({ ...t, content: `Background · ${r.status || 'pending'}…` }));
          },
        });
        if (rejoined.error) {
          set({ error: rejoined.error });
          return;
        }
        patch((t) => ({
          ...t,
          content: finalOf(rejoined) || `(${rejoined.status || 'completed'})`,
        }));
      }
    };

    try {
      await run();
    } catch (err) {
      if (!ctrl.signal.aborted) set({ error: String((err as Error)?.message ?? err) });
    } finally {
      if (controller === ctrl) controller = null;
      // A card still not `done` never reported back — the run was stopped, or
      // ended with no matching tool_end. The `done` frame settles this when it
      // arrives; an aborted run has no such frame, and a spinner that outlives
      // the run that owned it reads as work still going.
      patch((t) =>
        (t.tools ?? []).some((tool) => !tool.done)
          ? { ...t, tools: (t.tools ?? []).map((tool) => ({ ...tool, done: true })) }
          : t,
      );
      set({
        streaming: false,
        phase: state.phase === 'aborted' ? state.phase : 'idle',
      });
    }
  };

  return {
    get state() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setTurns(turns) {
      set({ turns });
    },
    reset() {
      seenApprovals.clear();
      activeAssistantId = '';
      resumeToken = null;
      lastEventId = undefined;
      set({ turns: [], error: null, phase: 'idle', approvals: [], uiPrompt: null });
    },
    send,
    applyEvent,
    async syncApprovals() {
      const { added, deadlines } = await syncApprovals({
        listPending: () => ports.client.listApprovals('pending'),
        seen: seenApprovals,
        readForDiff: ports.clientTools?.readForDiff?.bind(ports.clientTools),
      });
      // An approval that arrived as a frame has no deadline — the frame carries
      // none — so the poll backfills it. Without this the banner for a *watched*
      // run is the one that never learns when the harness gives up.
      let patched = false;
      const known = state.approvals.map((pending) => {
        if (pending.expiresAt != null) return pending;
        const deadline = deadlines.get(pending.approvalId);
        if (deadline === undefined) return pending;
        patched = true;
        return { ...pending, expiresAt: deadline };
      });
      if (added.length || patched) set({ approvals: [...known, ...added] });
    },
    shiftApproval() {
      set({ approvals: state.approvals.slice(1) });
    },
    clearUiPrompt() {
      set({ uiPrompt: null });
    },
    setError(message) {
      set({ error: message });
    },
    setPhase(phase) {
      set({ phase });
    },
    abort() {
      controller?.abort();
      controller = null;
    },
  };
}
