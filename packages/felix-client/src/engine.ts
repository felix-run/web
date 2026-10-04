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
import {
  type ChatMessage,
  type PendingUiRequest,
  promptTokens,
  readUsage,
  type SessionEvent,
  type StreamEvent,
} from '@felix/protocol';
import { describeGate, type PendingApproval, summarizeToolArgs, syncApprovals } from './approvals';
import { isLeaseRefusal } from './errors';
import { reattachThread } from './reattach';
import { eventsToTurns } from './session-log';
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
  /**
   * A durable run finished, and the transcript it left here may be incomplete.
   *
   * A durable manifest's stream carries `run_accepted` → `run_status` → `final`
   * and **never any deltas**: the fiber runs the agent through `invoke`, which
   * drops display events at the source, and only completed messages are ever
   * persisted. What it does now carry (felix-run/felix#238) are `session_event`
   * frames tailed from the thread's session log, which the engine folds as they
   * land — so the tool cards appear during the run rather than only after it.
   *
   * That tail is progressive rendering, not a replacement for this. It starts at
   * a cursor, so it never carries the thread's earlier turns, and a stream that
   * dropped can have missed the end of it. Re-reading the session is still what
   * makes the transcript authoritative.
   *
   * Hydrating from here is safe *because* no deltas were streamed: there is no
   * local detail for a snapshot rebuild to discard, and the folded turns came
   * from the same session the rebuild reads. That is not true of an ordinary
   * run, which is why this fires only on the two durable paths.
   */
  onDurableComplete?: () => void;
}

export interface SendArgs {
  manifest: string;
  messages: ChatMessage[];
  /** The assistant turn deltas append to. It must already be in `state.turns`. */
  assistantId: string;
  /** `background` posts to /chat and polls the durable run instead of streaming. */
  mode?: 'stream' | 'background';
}

/**
 * How a `send` ended, as far as the message it carried is concerned. Only a lease
 * refusal is definite about that message never reaching the thread: a failure
 * after the request went out may have been appended first, so it is `done`.
 */
export type SendOutcome = 'done' | 'lease_refused';

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
  /**
   * Open one turn and run it to completion. Never rejects. Resolves
   * `'lease_refused'` when the harness declined to start the run because another
   * client drives the thread — the message was never taken, so a caller holding
   * it can give it back to the person who wrote it.
   */
  send(args: SendArgs): Promise<SendOutcome>;
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
  /**
   * Drop a live stream that has gone silent, so the ordinary reattach path runs.
   *
   * For a page coming back from the background, and on a timer while one is on
   * screen: a connection can die without an error ever reaching the reader — a
   * suspended tab, a proxy that lost its upstream — and the run then reads as live
   * forever. Acts only when the harness has *proved* it heartbeats and the stream
   * has then gone 45s with nothing at all, so a healthy stream in a long tool call
   * is never cut: hanging up tears the run down.
   *
   * The harness sends `: keep-alive` only after 15s with nothing else to send
   * (`with_heartbeat` in its `routes/_sse.py`), so a stream that dies mid-reply,
   * while deltas were flowing, has never shown one. Proof is therefore kept per
   * engine as well as per stream: once any stream from this harness has
   * heartbeated, a later one that falls silent for three intervals is dead. Durable
   * streams (`run_accepted` seen) send none by design and are never touched, nor
   * are reattach streams. Returns whether it acted.
   */
  checkLiveness(now?: number): boolean;
}

/** Three missed 15-second heartbeats. */
export const STREAM_STALL_MS = 45_000;

const IDLE: EngineState = {
  turns: [],
  phase: 'idle',
  streaming: false,
  reattaching: false,
  error: null,
  approvals: [],
  uiPrompt: null,
};

/** The status turn, now carrying the run's answer — no longer a status line. */
function answered(t: Turn, content: string): Turn {
  const { runStatus: _, ...rest } = t;
  return { ...rest, content };
}

export function createChatEngine(ports: EnginePorts): ChatEngine {
  const newId = ports.newId ?? (() => crypto.randomUUID());
  let state: EngineState = { ...IDLE };
  const listeners = new Set<(s: EngineState) => void>();
  const seenApprovals = new Set<string>();

  let controller: AbortController | null = null;
  /**
   * The live `POST /chat/stream` connection, while one is open: its own abort
   * (separate from the run's, so cutting a dead connection reads as a drop and
   * not as Stop), when it last delivered anything, and whether it has shown it
   * heartbeats at all.
   */
  let liveStream: { abort: AbortController; lastActivityAt: number; heartbeats: boolean } | null =
    null;
  /** Some stream from this harness has sent a keep-alive, so it is one that heartbeats. */
  let harnessHeartbeats = false;
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

  /**
   * Progressive rendering for a durable run.
   *
   * The harness now tails the thread's session log between status frames
   * (felix-run/felix#238), so the tool calls and assistant turns of a durable
   * run land here as they happen rather than only in the final answer. They are
   * the same rows `reattachThread` folds, so they go through the same
   * `eventsToTurns` — one definition of how events become turns, not a second
   * synthesis path that would drift from it.
   *
   * `durablePrefix` is the transcript *before* the in-flight turn, captured at
   * `run_accepted`. Everything after it is rebuilt from the log rather than
   * patched, because the log is the thing that knows what happened. Null means
   * no durable run is in flight, which is also what keeps these frames inert on
   * a reattach stream — `reattachThread` owns them there.
   *
   * What this is **not** is a second source of truth. `onDurableComplete` still
   * hydrates from the session when the run lands; this only decides what the
   * user watches in the meantime.
   */
  let durableEvents: SessionEvent[] = [];
  let durablePrefix: Turn[] | null = null;

  /**
   * The harness's last word on a durable run — `running`, `pending` — or null
   * when none is in flight. It is what the status turn would say if nothing
   * were waiting on a person.
   */
  let durableStatus: string | null = null;
  /**
   * The durable run has been accepted and has not reported a status yet.
   *
   * Set by `run_accepted`, so a durable run counts as in flight from its first frame. It used to
   * start at the first `run_status`, and a v0.4.0 harness announces a durable run's approval on
   * the stream — often before any status — so the frame arrived while the engine did not yet
   * consider a run in flight, and the turn went on saying "Durable run accepted…" for the whole
   * wait. Observed on the reference deployment on 2026-09-24.
   */
  // A plain word, not a sentinel: a harness that reported `accepted` as a real status would want
  // the same line.
  const ACCEPTED = 'accepted';

  /**
   * What the status turn says while a durable run is in flight.
   *
   * A durable run blocked on an approval sat on `Background · running…` for the
   * whole of its deadline, because the stream carries no approval frame and the
   * poll that finds the approval put it in a banner the turn said nothing about.
   * An operator reading the turn typed "proceed" into the composer, which is not
   * where the decision lives, and the write timed out twice (2026-09-23). So the
   * turn names what is blocking it, in the same words the banner uses to
   * describe the call; the countdown and the decision stay in the banner.
   */
  const statusLine = (status: string): string => {
    const blocked = state.approvals[0];
    if (blocked)
      return `Waiting on your approval · ${describeGate(blocked.toolName, blocked.args)}`;
    return status === ACCEPTED ? 'Durable run accepted…' : `Background · ${status}…`;
  };

  /** The status turn, saying `status` — marked as a status so it is not drawn as a reply. */
  const sayStatus = (t: Turn, status: string): Turn => ({
    ...t,
    content: statusLine(status),
    runStatus: state.approvals.length > 0 ? 'blocked' : 'running',
  });

  /** Re-say the status when what is waiting has changed, and only mid-run. */
  const refreshStatus = () => {
    if (durableStatus === null) return;
    const status = durableStatus;
    patch((t) => sayStatus(t, status));
  };

  const tick = (status: string) => {
    durableStatus = status;
    patch((t) => sayStatus(t, status));
  };

  const renderDurable = () => {
    if (durablePrefix === null) return;
    // A deterministic generator, not `newId`. `eventsToTurns` mints an id for a
    // turn the log does not name — a dangling tool-only step — and this re-folds
    // on every frame, so a random one would hand React a different key each time
    // and remount the card mid-run.
    let n = 0;
    const folded = eventsToTurns(durableEvents, () => `durable-${n++}`);
    // The status turn stays last and keeps its id, so `patch` still finds it and
    // `run_status` keeps reporting into the same place.
    const status = state.turns.find((t) => t.id === activeAssistantId);
    set({ turns: status ? [...durablePrefix, ...folded, status] : [...durablePrefix, ...folded] });
  };

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
        // Before the card, not after it. On a durable run the turn's text *is* the status
        // line, and a card is placed at the text's length when it opens — rewriting the line
        // afterwards would leave the card part-way through "Waiting on your approval".
        refreshStatus();
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
      // Nothing to read here: the harness puts its in-process `InvokeOutput` on this
      // frame, which reaches the wire as a Python repr string. Usage rides on `done`.
      case 'on_chain_end':
        break;
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
        const data = ev.data as { final?: { content?: string }; usage?: unknown };
        const final = data.final?.content?.trim();
        // The final call's block. It is the turn's spend only when that call was the
        // whole turn — the same rule hydration applies — but it is always how full
        // the context is, because that call's prompt held everything before it.
        const usage = readUsage(data.usage);
        patch((t) => ({
          ...t,
          content: t.content.trim() ? t.content : (final ?? t.content),
          tools: (t.tools ?? []).map((tool) => (tool.done ? tool : { ...tool, done: true })),
          ...(usage && !t.tools?.length ? { usage } : {}),
          ...(usage ? { contextTokens: promptTokens(usage) + usage.output } : {}),
        }));
        break;
      }
      // The durable trio. A manifest with `spec.execution.mode: durable` makes
      // /chat/stream stream the *run's progress* rather than tokens: no deltas
      // ever arrive, and the answer lands in `final`. Interleaved with them now
      // are `session_event` frames tailed from the thread's session log, which is
      // how the work behind the answer becomes visible while it is happening —
      // completed messages only, never token deltas, because chunks are never
      // persisted.
      case 'run_accepted': {
        const data = ev.data as { resume_token?: string };
        // Held so a dropped connection can rejoin the run instead of abandoning
        // it: the run itself outlives this stream.
        if (data.resume_token) resumeToken = data.resume_token;
        set({ phase: 'durable' });
        durableStatus = ACCEPTED;
        patch((t) => (t.content ? t : sayStatus(t, ACCEPTED)));
        // Everything before the in-flight turn. The user message is dropped from
        // the prefix on purpose: the harness captured its cursor *before* the run
        // was enqueued, so the log re-supplies that message and keeping the local
        // copy too would render it twice. Guarded on the role rather than assumed,
        // because `assistantId` is the only turn `send` is contracted to know about.
        const at = state.turns.findIndex((t) => t.id === activeAssistantId);
        const head = at < 0 ? state.turns.length : at;
        durablePrefix = state.turns.slice(
          0,
          state.turns[head - 1]?.role === 'user' ? head - 1 : head,
        );
        durableEvents = [];
        break;
      }
      case 'run_status': {
        const status = String((ev.data as { status?: string }).status ?? '').trim();
        if (status) tick(status);
        break;
      }
      // The durable answer, and the only place it arrives — there are no deltas
      // to have accumulated, so this replaces rather than defers.
      case 'final': {
        const content = String((ev.data as { content?: string }).content ?? '').trim();
        resumeToken = null;
        durableStatus = null;
        durablePrefix = null;
        durableEvents = [];
        patch((t) => answered(t, content || t.content));
        // The tail above is progressive rendering, not a substitute for hydration:
        // it starts at the cursor, so it never carries the thread's earlier turns,
        // and a dropped stream can have missed the end of it. Re-reading the
        // session is still what makes the transcript authoritative.
        ports.onDurableComplete?.();
        break;
      }
      // Tailed from the thread's session log. On a **durable run** they are this
      // client's only view of the work behind the answer, so they are folded here
      // — through `eventsToTurns`, the same function `reattachThread` uses, rather
      // than a second synthesis path. Outside one, `durablePrefix` is null and
      // these stay inert: on a reattach stream `reattachThread` owns them, and it
      // folds the same rows the same way.
      case 'session_event': {
        if (durablePrefix === null) break;
        durableEvents = [...durableEvents, ev.data as SessionEvent];
        renderDurable();
        break;
      }
      // Only `GET /chat/stream/{thread_id}` sends this, and only `reattachThread`
      // reads it. Listed so the frame is not silently unhandled if it ever arrives
      // on a stream that is not a reattach.
      case 'snapshot':
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
      // The react loop ran out of `recursion_limit` steps with the model still
      // asking for tools. The harness records the session `truncated` and the
      // `done` frame's `stop_reason` agrees, but nothing in the transcript would:
      // the last assistant message reads as an answer that merely stopped
      // mid-sentence. Pin the reason and the limit to the turn, where the cut is.
      case 'max_turns': {
        const limit = Number((ev.data as { limit?: unknown }).limit);
        patch((t) => ({
          ...t,
          stop: { reason: 'max_turns', ...(Number.isFinite(limit) ? { limit } : {}) },
        }));
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
            // Captured now, not at answer time: the user may switch threads before answering,
            // and the answer must go to the thread that asked.
            threadId: ports.threadId(),
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

  const send = async (args: SendArgs): Promise<SendOutcome> => {
    const mode = args.mode ?? 'stream';
    activeAssistantId = args.assistantId;

    const ctrl = new AbortController();
    controller = ctrl;
    set({ streaming: true, error: null, phase: 'turn' });
    resumeToken = null;
    durableStatus = null;
    lastEventId = undefined;

    const run = async () => {
      if (mode === 'background') {
        durableStatus = 'queued';
        patch((t) =>
          t.content ? t : { ...t, content: 'Queued durable job…', runStatus: 'running' },
        );
        const started = await ports.client.startChat({
          manifest: args.manifest,
          messages: args.messages,
          threadId: ports.threadId(),
          signal: ctrl.signal,
        });
        if (started.kind === 'done') {
          durableStatus = null;
          patch((t) => answered(t, started.final.content));
          // Same shape as the `final` frame: an answer with no tool calls behind it.
          ports.onDurableComplete?.();
          return;
        }
        const runResult = await ports.client.pollDurableRun(started.resumeToken, {
          signal: ctrl.signal,
          onTick: (r) => tick(r.status || 'pending'),
        });
        durableStatus = null;
        if (runResult.error) {
          set({ error: runResult.error });
          return;
        }
        patch((t) => answered(t, finalOf(runResult) || `(${runResult.status || 'completed'})`));
        return;
      }

      /**
       * Finish a durable run by polling it, and say so when it lands.
       *
       * Shared by the two ways a stream can leave one unfinished: it dropped, or
       * it ended cleanly having never sent `final`.
       */
      const settleDurable = async (token: string) => {
        set({ phase: 'durable' });
        const rejoined = await ports.client.pollDurableRun(token, {
          signal: ctrl.signal,
          onTick: (r) => tick(r.status || 'pending'),
        });
        durableStatus = null;
        if (rejoined.error) {
          set({ error: rejoined.error });
          return;
        }
        patch((t) => answered(t, finalOf(rejoined) || `(${rejoined.status || 'completed'})`));
        ports.onDurableComplete?.();
      };

      const stream = {
        abort: new AbortController(),
        lastActivityAt: Date.now(),
        heartbeats: false,
      };
      const stopStream = () => stream.abort.abort();
      ctrl.signal.addEventListener('abort', stopStream, { once: true });
      liveStream = stream;
      try {
        try {
          await ports.client.streamChat(
            {
              manifest: args.manifest,
              messages: args.messages,
              threadId: ports.threadId(),
              signal: stream.abort.signal,
            },
            {
              onEvent: (ev) => applyEvent(ev),
              onCursor: (id) => {
                lastEventId = id;
              },
              onActivity: ({ keepAlive }) => {
                stream.lastActivityAt = Date.now();
                if (keepAlive) {
                  stream.heartbeats = true;
                  harnessHeartbeats = true;
                }
              },
            },
          );
        } finally {
          ctrl.signal.removeEventListener('abort', stopStream);
          if (liveStream === stream) liveStream = null;
        }
        /**
         * A durable stream can end **cleanly** without ever sending `final`.
         *
         * The run is handed to the worker and the API's stream simply stops;
         * nothing throws, so the drop path below never runs. `resumeToken` is the
         * tell — set by `run_accepted`, cleared only by `final` — and without
         * this the turn sits on "Background · running…" for the life of the tab
         * while the run finishes behind it, taking the answer, the tool cards and
         * everything derived from them with it.
         */
        if (resumeToken && !ctrl.signal.aborted) await settleDurable(resumeToken);
      } catch (err) {
        // A lease refusal is the harness declining to start the run at all —
        // nothing was torn down, so there is nothing to rejoin.
        if (ctrl.signal.aborted || isLeaseRefusal(err)) throw err;
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
        await settleDurable(resumeToken);
      }
    };

    let outcome: SendOutcome = 'done';
    try {
      await run();
    } catch (err) {
      if (isLeaseRefusal(err)) {
        outcome = 'lease_refused';
        // Not an error to show: another client drives this thread, and the
        // transport has already told the client (`onLeaseRefused`), which says
        // so in its own terms. The placeholder reply would never be written.
        const target = activeAssistantId;
        set({
          turns: state.turns.filter(
            (t) => !(t.id === target && !t.content && !(t.tools ?? []).length),
          ),
        });
      } else if (!ctrl.signal.aborted) {
        set({ error: String((err as Error)?.message ?? err) });
      }
    } finally {
      if (controller === ctrl) controller = null;
      // However the run ended — `final`, a settled poll, an abort, a thrown
      // error — nothing is in flight to report on any more, so an approval
      // answered after this must not rewrite the turn it left behind.
      durableStatus = null;
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
    return outcome;
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
      durableStatus = null;
      lastEventId = undefined;
      set({ turns: [], error: null, phase: 'idle', approvals: [], uiPrompt: null });
    },
    send,
    applyEvent,
    checkLiveness(now = Date.now()) {
      const stream = liveStream;
      if (!stream || now - stream.lastActivityAt < STREAM_STALL_MS) return false;
      // A durable run's stream carries status, not deltas, and never heartbeats.
      const proved = stream.heartbeats || (harnessHeartbeats && resumeToken === null);
      if (!proved) return false;
      liveStream = null;
      stream.abort.abort(new Error('stream stalled'));
      return true;
    },
    async syncApprovals() {
      // Taken before the request, so an approval a frame queues while it is in
      // flight is not judged against a list read before its row existed.
      const queued = new Set(state.approvals.map((pending) => pending.approvalId));
      const threadId = ports.threadId();
      // A private copy of `seen`, merged back only once the thread is known not
      // to have changed. The shared set used to be marked the moment a list
      // resolved, so a sync for the thread being left could mark a row a beat
      // before a sync for the thread being entered filtered against it — and
      // neither adopted it.
      const scratch = new Set(seenApprovals);
      const result = await syncApprovals({
        listPending: () => ports.client.listApprovals('pending'),
        threadId,
        seen: scratch,
        readForDiff: ports.clientTools?.readForDiff?.bind(ports.clientTools),
      });
      // The thread changed while the list was in flight. Its rows were filtered
      // for the thread that asked, so adopting them now would put one
      // conversation's approval in another's banner. The new thread asks for
      // itself — navigating to a thread triggers a sync, so this is routine.
      if (ports.threadId() !== threadId) return;
      const { deadlines, listed } = result;
      // Merged here, deduped against anything a concurrent sync for this same
      // thread adopted first: two ticks in flight must not queue one call twice.
      const added = result.added.filter((pending) => !seenApprovals.has(pending.approvalId));
      for (const pending of added) seenApprovals.add(pending.approvalId);
      // An approval that arrived as a frame has no deadline — the frame carries
      // none — so the poll backfills it. Without this the banner for a *watched*
      // run is the one that never learns when the harness gives up.
      let patched = false;
      // An approval the harness no longer lists was decided without this card:
      // by its own timeout, or from another tab or the terminal. Left queued it
      // sat at the head as `Denied · timed out` with both buttons disabled —
      // hiding every approval behind it and holding the tab at `blocked` — since
      // `shiftApproval` only ever runs after a decision made here.
      const live = listed
        ? state.approvals.filter(
            (pending) => !queued.has(pending.approvalId) || deadlines.has(pending.approvalId),
          )
        : state.approvals;
      const pruned = live.length !== state.approvals.length;
      const known = live.map((pending) => {
        if (pending.expiresAt != null) return pending;
        const deadline = deadlines.get(pending.approvalId);
        if (deadline === undefined) return pending;
        patched = true;
        return { ...pending, expiresAt: deadline };
      });
      if (added.length || patched || pruned) set({ approvals: [...known, ...added] });
      if (added.length || pruned) refreshStatus();
    },
    shiftApproval() {
      set({ approvals: state.approvals.slice(1) });
      refreshStatus();
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
