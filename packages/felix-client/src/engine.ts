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
  type DurableRun,
  type PendingUiRequest,
  promptTokens,
  readUsage,
  type SessionEvent,
  type StreamEvent,
} from '@felix/protocol';
import { describeGate, type PendingApproval, summarizeToolArgs, syncApprovals } from './approvals';
import { durableRunFailure } from './durable-runs';
import {
  describeError,
  IdempotencyKeyReusedError,
  isLeaseRefusal,
  StreamInProgressError,
} from './errors';
import { fileToolOp } from './local-files';
import { reattachThread } from './reattach';
import { eventsToTurns } from './session-log';
import type { FelixClient } from './transport';
import { closeTool, markToolPhase, type Turn, toolImages } from './turns';

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
  /**
   * The harness took a durable run on this thread and handed back its token.
   *
   * The token is the only handle on the run: the snapshot does not say a durable run
   * is in flight (its phase reads `idle` throughout), and no route lists a thread's
   * runs. A client that keeps it across a reload can `rejoinRun` instead of showing
   * a thread that looks finished while the run goes on — and instead of letting the
   * next message start a second run beside it, which the harness does not refuse.
   */
  onRunAccepted?: (resumeToken: string) => void;
  /** The run `onRunAccepted` reported is over (or was stopped): forget its token. */
  onRunSettled?: () => void;
  /**
   * Re-read the transcript while a durable run is only being *polled* — the stream
   * that carried its session events has closed, so nothing else shows its work.
   * Called at most every `DURABLE_PROGRESS_MS`. Safe for the reason
   * `onDurableComplete` is: a durable turn has no streamed detail to lose.
   */
  onDurableProgress?: () => void;
}

export interface SendArgs {
  manifest: string;
  messages: ChatMessage[];
  /** The assistant turn deltas append to. It must already be in `state.turns`. */
  assistantId: string;
  /** `background` posts to /chat and polls the durable run instead of streaming. */
  mode?: 'stream' | 'background';
  /**
   * `Idempotency-Key` for a streamed send: one per logical message, minted when
   * the message is written and reused, with a byte-identical body, by every
   * resend of it. With one, a failure that may have reached the harness resolves
   * `'failed'` rather than rejoining the thread, so the caller can hand the
   * message back; and a resend is answered from what the first attempt did — a
   * replay of its events, or a reattach while it is still running — never by a
   * second turn. Ignored in `background` mode.
   */
  idempotencyKey?: string;
}

/**
 * How a `send` ended, as far as the message it carried is concerned.
 *
 * - `done`: the run went out, or what it left is on screen. A failure of a send
 *   with no `idempotencyKey` is `done` too: it may have been appended before it
 *   failed, and without a key a resend could not tell, so the thread is rejoined.
 * - `lease_refused`: another client drives the thread; the message never landed.
 * - `failed`: a keyed send failed — no answer, a 5xx, a stream that dropped — and
 *   may or may not have landed. Its turns are left for the caller to take back
 *   with the message; resending it under the same key with the same body is safe,
 *   because the harness answers that from the first attempt instead of running it.
 * - `key_reused`: the harness already holds this key for a different body
 *   (`422 idempotency_key_reused`). Nothing ran; the message can only go again
 *   as a new one, under a new key.
 */
export type SendOutcome = 'done' | 'lease_refused' | 'failed' | 'key_reused';

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
  /**
   * Pick a durable run back up by its token, from a tab that did not start it or
   * no longer holds its stream (a reload). Streams nothing — no route replays a
   * run's frames — so it polls the run, says its status in a turn of its own,
   * refreshes the transcript as the run works, and settles as `send` would.
   * Approvals still arrive through `syncApprovals`. A no-op while a run is live.
   */
  rejoinRun(resumeToken: string): Promise<void>;
  /** Apply one wire frame. Exposed for reattach, and for tests. */
  applyEvent(event: StreamEvent): Promise<void>;
  /**
   * Adopt any approval `GET /approvals` is holding that is not already on
   * screen. Safe to call on a timer: ids stay remembered, so an answered
   * approval cannot come back if the server briefly still lists it as pending.
   * `attributedOnly` leaves rows naming no thread alone — for a run the client
   * keeps going off screen, so an unattributed approval is not adopted by every
   * engine at once (see `ApprovalSyncOptions.attributedOnly`).
   */
  syncApprovals(opts?: { attributedOnly?: boolean }): Promise<void>;
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

/** How often a polled durable run re-reads the transcript (`onDurableProgress`). */
export const DURABLE_PROGRESS_MS = 5_000;

/**
 * The durable stream's own deadline, not the run's end. The harness closes a durable
 * `POST /chat/stream` at the run's `expires_at` with `run_expired:<token>` whether or
 * not the run has stopped — "expired" and "still running" look the same from here —
 * so the engine polls the run instead of reporting a failure for work that may still
 * be going.
 */
const STREAM_DEADLINE = /^run_expired:/;

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
   * A resend the harness answered from its first attempt (`Idempotent-Replayed`).
   *
   * The body is that attempt's own session events, as `session_event` frames —
   * the reattach stream's shape — so they are folded the way a durable run's are:
   * through `eventsToTurns`, after the transcript as it stood before this send's
   * user message. The local user turn and the empty reply are replaced, not added
   * to, because the replay carries the user message the harness stored: keeping
   * both is the duplicate the key exists to prevent. Null outside a replay, which
   * keeps these frames inert on an ordinary stream.
   */
  let replayEvents: SessionEvent[] = [];
  let replayPrefix: Turn[] | null = null;
  /** This send's stream carried `run_accepted`: whatever happens next, it was taken. */
  let runAccepted = false;

  /**
   * Everything before the in-flight run's user message. The user message is left
   * out on purpose: both a durable run's tail and a replay start at a cursor read
   * before that message was appended, so the log re-supplies it. Guarded on the
   * role rather than assumed, because `assistantId` is the only turn `send` is
   * contracted to know about.
   */
  const beforeRun = (): Turn[] => {
    const at = state.turns.findIndex((t) => t.id === activeAssistantId);
    const head = at < 0 ? state.turns.length : at;
    return state.turns.slice(0, state.turns[head - 1]?.role === 'user' ? head - 1 : head);
  };

  const renderReplay = () => {
    if (replayPrefix === null) return;
    // Deterministic, for the reason `renderDurable` gives.
    let n = 0;
    set({ turns: [...replayPrefix, ...eventsToTurns(replayEvents, () => `replay-${n++}`)] });
  };

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
        const data = ev.data as {
          name?: string;
          output?: unknown;
          id?: string;
          attachments?: unknown;
        };
        const name = String(data.name ?? 'tool');
        // `attachments` is the images the tool returned. A harness that predates
        // sending them on the frame sends none, and the images arrive with the
        // session log instead — on the next hydrate, or as a durable run's events.
        const images = toolImages(data.attachments);
        patch((t) => ({ ...t, tools: closeTool(t.tools, name, data.output, data.id, images) }));
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
        if (fileToolOp(data.tool_name) === 'write' && typeof args.path === 'string') {
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
        if (data.resume_token) {
          resumeToken = data.resume_token;
          ports.onRunAccepted?.(data.resume_token);
        }
        runAccepted = true;
        set({ phase: 'durable' });
        durableStatus = ACCEPTED;
        patch((t) => (t.content ? t : sayStatus(t, ACCEPTED)));
        // Everything before the in-flight turn, without its user message: the
        // harness captured its cursor *before* the run was enqueued, so the log
        // re-supplies that message and keeping the local copy too would render it
        // twice.
        durablePrefix = beforeRun();
        // A replayed durable send reattaches to the run; its frames are the run's.
        replayPrefix = null;
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
        if (resumeToken) ports.onRunSettled?.();
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
      // than a second synthesis path. On a **replayed resend** they are the whole
      // of what the first attempt did, folded the same way. Outside both, the
      // prefixes are null and these stay inert: on a reattach stream
      // `reattachThread` owns them, and it folds the same rows the same way.
      case 'session_event': {
        const row = ev.data as SessionEvent;
        if (durablePrefix !== null) {
          durableEvents = [...durableEvents, row];
          renderDurable();
        } else if (replayPrefix !== null) {
          if (replayEvents.some((e) => e.seq === row.seq)) break;
          replayEvents = [...replayEvents, row];
          renderReplay();
        }
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
      case 'on_error': {
        const message = String((ev.data as { message?: string }).message ?? 'error');
        // The run outlives this: the clean-end path below polls it to its real end.
        if (resumeToken && STREAM_DEADLINE.test(message)) break;
        set({ error: message });
        break;
      }
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

  /**
   * Finish a durable run by polling it, and say so when it lands.
   *
   * Shared by every way a run can be left without a stream: the stream dropped, it
   * ended cleanly without `final` (the harness closes it at the run's deadline), the
   * run was started in the background, or a reload is picking it back up. A poll
   * carries no frames, so while it runs the transcript is re-read every
   * `DURABLE_PROGRESS_MS` — otherwise a run still working reads as one that stopped.
   *
   * A run that ended without an answer is an error with a sentence, not a status line
   * left saying `Background · expired…`; the transcript is re-read either way, since
   * whatever the run did before it stopped is in the log.
   */
  const settleDurable = async (token: string, signal: AbortSignal) => {
    set({ phase: 'durable' });
    let progressAt = Date.now();
    const run = await ports.client.pollDurableRun(token, {
      signal,
      onTick: (r) => {
        tick(r.status || 'pending');
        if (ports.onDurableProgress && Date.now() - progressAt >= DURABLE_PROGRESS_MS) {
          progressAt = Date.now();
          ports.onDurableProgress();
        }
      },
    });
    finishDurable(run);
  };

  const finishDurable = (run: DurableRun) => {
    resumeToken = null;
    durableStatus = null;
    ports.onRunSettled?.();
    const failure = durableRunFailure(run);
    if (failure) {
      set({ error: failure });
      // The status line was never an answer. A turn holding nothing else goes; one
      // holding cards keeps them, without a line claiming the run is still going.
      const target = activeAssistantId;
      set({
        turns: state.turns
          .filter((t) => !(t.id === target && !(t.tools ?? []).length))
          .map((t) => (t.id === target ? answered(t, '') : t)),
      });
    } else {
      patch((t) => answered(t, finalOf(run) || `(${run.status || 'completed'})`));
    }
    ports.onDurableComplete?.();
  };

  /** What every run leaves behind, however it ended. */
  const endRun = (ctrl: AbortController) => {
    if (controller === ctrl) controller = null;
    replayPrefix = null;
    replayEvents = [];
    // Stopped on purpose: nothing is left for a reload to rejoin.
    if (ctrl.signal.aborted && resumeToken) ports.onRunSettled?.();
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
  };

  const rejoinRun = async (token: string): Promise<void> => {
    if (state.streaming) return;
    const ctrl = new AbortController();
    controller = ctrl;
    activeAssistantId = newId();
    resumeToken = token;
    lastEventId = undefined;
    durableStatus = 'running';
    set({
      streaming: true,
      error: null,
      phase: 'durable',
      turns: [...state.turns, { id: activeAssistantId, role: 'assistant', content: '', tools: [] }],
    });
    patch((t) => sayStatus(t, 'running'));
    try {
      await settleDurable(token, ctrl.signal);
    } catch (err) {
      // Not settled: the token stays remembered, so the next load tries again.
      if (!ctrl.signal.aborted) set({ error: describeError(err, 'check on the run').message });
    } finally {
      endRun(ctrl);
    }
  };

  const send = async (args: SendArgs): Promise<SendOutcome> => {
    const mode = args.mode ?? 'stream';
    activeAssistantId = args.assistantId;

    const ctrl = new AbortController();
    controller = ctrl;
    set({ streaming: true, error: null, phase: 'turn' });
    resumeToken = null;
    durableStatus = null;
    lastEventId = undefined;
    replayPrefix = null;
    replayEvents = [];
    runAccepted = false;
    const keyed = mode === 'stream' ? args.idempotencyKey : undefined;
    /** The harness answered 200 and the body began: a failure now is a dropped stream. */
    let opened = false;

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
        resumeToken = started.resumeToken;
        ports.onRunAccepted?.(started.resumeToken);
        await settleDurable(started.resumeToken, ctrl.signal);
        return;
      }

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
              ...(keyed ? { idempotencyKey: keyed } : {}),
            },
            {
              onOpen: ({ replayed }) => {
                opened = true;
                if (!replayed) return;
                replayPrefix = beforeRun();
                replayEvents = [];
              },
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
        if (resumeToken && !ctrl.signal.aborted) await settleDurable(resumeToken, ctrl.signal);
      } catch (err) {
        // A lease refusal is the harness declining to start the run at all —
        // nothing was torn down, so there is nothing to rejoin.
        if (ctrl.signal.aborted || isLeaseRefusal(err)) throw err;
        // A resend under a key whose first attempt is still streaming: that
        // attempt's turn is the one running, so watch it rather than start one.
        // Cold, from a snapshot, which replaces the transcript whole — this
        // send's local copy of the message included, so it is not shown twice.
        if (err instanceof StreamInProgressError) {
          const threadId = ports.threadId();
          set({ reattaching: true });
          try {
            await reattachThread({
              client: ports.client,
              threadId,
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
        // A keyed send that failed before a durable run took it goes back to
        // the caller instead of rejoining: it may or may not have landed, and a
        // resend under its key is what finds out — a replay of what landed, or
        // the run it never got. Rejoining as well would put the message on screen
        // and in the composer at once.
        if (keyed && !runAccepted) throw err;
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
        await settleDurable(resumeToken, ctrl.signal);
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
      } else if (err instanceof IdempotencyKeyReusedError) {
        outcome = 'key_reused';
        set({
          error:
            'The harness refused this resend: its retry key was already used for a different message, so nothing was sent.',
        });
      } else if (!ctrl.signal.aborted) {
        if (keyed && !runAccepted) {
          outcome = 'failed';
          set({
            error: opened
              ? 'The connection dropped before the reply finished.'
              : describeError(err, 'send this message').message,
          });
        } else {
          set({ error: String((err as Error)?.message ?? err) });
        }
      }
    } finally {
      endRun(ctrl);
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
      // A transcript re-read while a durable run is only being polled (the progress
      // refresh, a hydrate) carries no status turn: the harness never logged one. Keep
      // ours last, or the run reads as finished until its next status change.
      const status =
        durableStatus !== null && state.streaming
          ? state.turns.find((t) => t.id === activeAssistantId)
          : undefined;
      set({ turns: status && !turns.some((t) => t.id === status.id) ? [...turns, status] : turns });
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
    rejoinRun,
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
    async syncApprovals(opts = {}) {
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
        ...(opts.attributedOnly ? { attributedOnly: true } : {}),
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
