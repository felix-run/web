/**
 * The wire contract between the browser clients and the Python Felix harness.
 *
 * Hand-mirrored from the harness — there is no generated client. This lived as
 * a per-app copy once, and the copies drifted apart from each other and from the
 * harness. One copy now, so a protocol change is one edit.
 *
 * Route drift is caught separately by `scripts/check-api-drift.mjs`; this file
 * covers the shapes, which no tooling can check.
 */

export type Role = 'system' | 'user' | 'assistant' | 'tool';

/** An image attached to a user message (multimodal/vision input). */
export interface ImageAttachment {
  /** Data URL (`data:<mime>;base64,…`) or remote `https://` URL. */
  url: string;
  media_type: string;
  filename?: string;
}

export interface ChatMessage {
  role: Role;
  content: string;
  /** Image attachments on a user turn (mapped to provider vision blocks). */
  attachments?: ImageAttachment[];
}

/** Cumulative token usage for one turn (all model sub-calls summed). */
export interface TokenUsage {
  input: number;
  output: number;
}

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * One `data: <json>` line from POST /chat/stream.
 *
 * The harness wraps every frame in the same envelope — `{event, type, data,
 * text}`, where `type` repeats `event` and `text` is a convenience projection
 * of `data`. Only `event` and `data` are modelled here.
 *
 * The union ends in an open arm on purpose, so an event the harness gains
 * compiles and no-ops rather than breaking the build. That is also the trap: a
 * frame nobody handles is indistinguishable from a frame that never arrives.
 * Add the arm *and* the handler together.
 */
export type StreamEvent =
  | { event: 'on_chat_model_stream'; data: { chunk?: { content?: string }; delta?: string } }
  | { event: 'text_delta'; data: { chunk?: { content?: string }; delta?: string } }
  /**
   * The model's reasoning, as it is produced.
   *
   * Same shape as `text_delta` and same rate, but deliberately not the same event:
   * reasoning rendered as the reply is worse than reasoning not rendered at all.
   *
   * It rode inside `session_progress` before the harness gained this name
   * (`{progress: {type: 'assistant_delta', kind: 'thinking'}}`) and still does, so
   * a harness older than 2026-08-26 sends only that and this arm simply never
   * fires. Reading it from the progress frame instead would mean handling both
   * spellings forever; the deployment catches up.
   */
  | { event: 'thinking_delta'; data: { chunk?: { content?: string }; delta?: string } }
  /**
   * Legacy spelling of `tool_start` / `tool_end`, renamed in the harness on
   * 2026-08-22. Kept because the harness is self-hosted and versions
   * independently: a deployment older than that rename still emits these, and
   * dropping the arms would silently stop rendering its tool cards.
   */
  | { event: 'on_tool_start'; data: { name: string; input?: unknown } }
  | { event: 'on_tool_end'; data: { name: string; output?: unknown } }
  | { event: 'tool_start'; data: { name: string; input?: unknown; id?: string } }
  | { event: 'tool_end'; data: { name: string; output?: unknown; id?: string } }
  /** Emitted either side of a tool call; `running` then `complete`. */
  | { event: 'tool_execution_update'; data: { name?: string; id?: string; status?: string } }
  /** The browser must run this tool and answer with POST /chat/tool_result. */
  | {
      event: 'tool_request';
      data: {
        id: string;
        name: string;
        args: Record<string, unknown>;
        thread_id?: string;
        transport?: string;
      };
    }
  /** A gated tool is waiting on POST /approvals/{id}/decide. */
  | {
      event: 'approval_required';
      data: {
        approval_id: string;
        tool_name: string;
        args: Record<string, unknown>;
        rule_id?: string;
        reason?: string;
        thread_id?: string;
        tool_call_id?: string | null;
      };
    }
  /** The agent is asking the user; answer with POST /chat/ui. */
  | {
      event: 'ui_request';
      data: {
        request_id: string;
        kind: 'select' | 'confirm' | 'input';
        prompt: string;
        options?: Array<string | { id?: string; label?: string; value?: string }>;
        default?: unknown;
        thread_id?: string;
      };
    }
  /** A queued steer / follow-up was drained into the run as a user message. */
  | { event: 'steer'; data: { content: string } }
  | { event: 'follow_up'; data: { content: string } }
  | {
      event: 'session_progress';
      data: { phase?: string; reason?: string; [k: string]: unknown };
    }
  | { event: 'on_chain_end'; data: { output?: { usage?: TokenUsage } } }
  /**
   * A stream that failed after its 200 was sent.
   *
   * The harness never emits this name. It arrives as `event: error` — the one
   * SSE-typed frame on the wire, carrying `{error: {message, type}}` — and
   * `readSseStream` normalises it here so handlers see the same envelope as
   * everything else. Changing that spelling means changing the reader, not
   * this arm.
   */
  | { event: 'on_error'; data: { message: string; type?: string } }
  | { event: 'done'; data: { final?: ChatMessage; messages?: ChatMessage[] } }
  | { event: 'aborted'; data: { thread_id?: string } }
  /**
   * The durable trio. `POST /chat/stream` checks `spec.execution.mode` and, when
   * it is `durable`, streams the run's *progress* instead of its tokens: no
   * deltas ever arrive, and the answer comes in `final`.
   *
   * A client that models only the transient path renders an empty turn here,
   * with nothing to distinguish it from a model that said nothing. The other
   * durable entry point — `POST /chat` returning `202 + resume_token`, then
   * polling `GET /chat/runs/{token}` — is unaffected and still supported.
   */
  | { event: 'run_accepted'; data: DurableRunAccepted }
  | { event: 'run_status'; data: { status: string; resume_token?: string } }
  | { event: 'final'; data: ChatMessage | { content?: string } }
  /**
   * The two frames only `GET /chat/stream/{thread_id}` sends.
   *
   * A cold reattach (no `Last-Event-ID`) opens with `snapshot` — the thread as
   * it now stands, the same payload `GET /chat/sessions/{id}` returns. A warm
   * one replays `session_event` for each entry after the cursor, then both tail
   * the session log.
   *
   * Note what this is not: the original run was torn down when the connection
   * dropped, deliberately, so a hung-up client stops burning tokens. These
   * frames rejoin the *thread*, they do not revive the run.
   */
  | { event: 'snapshot'; data: SessionSnapshot }
  | { event: 'session_event'; data: SessionEvent }
  | { event: string; data: Record<string, unknown> };

/** First frame of a durable run: what to come back to if the connection drops. */
export interface DurableRunAccepted {
  status?: string;
  resume_token?: string;
  fiber_id?: string;
  thread_id?: string;
  /** Epoch ms. The run is finished either way once this passes. */
  expires_at?: number;
}

/**
 * Authoritative session snapshot from GET /chat/sessions/{id}.
 *
 * camelCase on purpose — the harness builds this one payload for clients and
 * spells it in the client's idiom, unlike every other route.
 */
export interface SessionSnapshot {
  id: string;
  name?: string | null;
  phase?: string;
  thinkingLevel?: string;
  locked?: boolean;
  attached?: boolean;
  leafId?: string | null;
  revision?: number;
  transcript?: Array<{
    id?: string;
    seq: number;
    kind: string;
    role?: Role | null;
    content?: string;
    toolCallId?: string;
    toolName?: string;
    toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
    status?: string;
  }>;
  wake?: {
    fresh?: boolean;
    endedOnAssistant?: boolean;
    headSeq?: number;
    pendingToolCalls?: Array<{ id: string; name: string; args?: Record<string, unknown> }>;
  };
}

/**
 * One event from GET /chat/history/{thread_id}, or a session snapshot transcript row.
 *
 * snake_case, unlike `SessionSnapshot` above — the history route spells the wire in
 * the harness's idiom, and only the snapshot route is built in the client's.
 */
export interface SessionEvent {
  id?: string;
  seq: number;
  ts?: number;
  kind:
    | 'message'
    | 'tool_result'
    | 'tool_call'
    | 'thinking'
    | 'audit'
    | 'compaction'
    | 'branch_summary'
    | 'thinking_level_change'
    | 'model_change'
    | 'custom'
    | 'label'
    | 'session_info'
    | string;
  role?: Role;
  content?: string;
  tool_call_id?: string;
  name?: string;
  tool_calls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
}

/**
 * GET /chat/history/{thread_id} response.
 *
 * The harness returns the *newest* window of the thread, capped at 5000 events read
 * — not the oldest, and not necessarily all of them. `messages` and `events` are the
 * same array under two keys; read either.
 *
 * `oldest_seq` is the window's lower bound rather than the first message's `seq`,
 * because the harness filters non-message kinds out of the response: paging from the
 * first message returned would step over whatever was filtered. Hand it back as
 * `beforeSeq` to walk further into the past, while `has_more` is true.
 *
 * `oldest_seq` and `has_more` are **optional because the harness is self-hosted and
 * versions independently of this client**: a deployment predating the paging change
 * omits both, and this response is parsed with a cast rather than validated, so
 * declaring them required would type them as present while they arrive `undefined`.
 * Treat a missing `has_more` as "this harness cannot page", not as "no more pages".
 */
export interface ThreadHistory {
  thread_id: string;
  messages: SessionEvent[];
  events: SessionEvent[];
  oldest_seq?: number;
  has_more?: boolean;
}

/** Sticky mid-stream UI prompt waiting on POST /chat/ui. */
export interface PendingUiRequest {
  requestId: string;
  kind: 'select' | 'confirm' | 'input';
  prompt: string;
  options: Array<{ value: string; label: string }>;
  defaultValue?: unknown;
}

/** POST /chat when the manifest sets `spec.execution.mode: durable`. */
export interface DurableRun {
  status?: string;
  final?: ChatMessage | { content?: string } | null;
  error?: string | null;
  resume_token?: string;
  fiber_id?: string;
  expires_at?: string;
  manifest_id?: string;
}
