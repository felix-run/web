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
  /**
   * A stored upload as `felix-file://<id>` (see `files.ts`), a data URL
   * (`data:<mime>;base64,…`), or a remote `https://` URL. A reference is the one
   * to send: anything inline is saved into the session log and re-sent on every
   * later turn.
   */
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
/**
 * One model call's token counts, as the harness's usage block spells them.
 *
 * `input` is the **uncached** part of the prompt only. Cached tokens are reported
 * apart — `cacheRead` for a prefix served from the provider's cache, `cacheWrite`
 * for one written to it — so the prompt is all three added together. Reading
 * `input` alone made a cached turn read as `3 in` when the call was 1,035 tokens.
 * Both are optional: a harness or provider that does not cache sends neither.
 */
/** One rating, as `POST /chat/sessions/feedback` stores it. */
export interface TurnFeedback {
  rating: 'up' | 'down';
  note?: string;
  /** Epoch ms. */
  at?: number;
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
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
        /** Epoch ms the harness stops waiting; null when the rule set no TTL. */
        expires_at?: number | null;
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
  /**
   * The run picked up a note that the operator edited a workspace file
   * (`POST /chat/workspace/edited`) and put it in front of the model before its
   * next call — without cancelling the tool calls in flight, unlike a steer. Only
   * a live run's drain emits it; a note recorded on an idle thread is in the log
   * and arrives with the snapshot.
   */
  | {
      event: 'workspace_note';
      data: {
        path: string;
        op: 'write' | 'delete' | 'rename';
        bytes: number | null;
        /** A rename's destination; absent otherwise. */
        to_path?: string;
        /** `folder` for the operator's folder delete or rename (felix#594); absent for a file. */
        kind?: 'folder';
        /** A folder delete: how many files went with it. */
        files?: number;
      };
    }
  /**
   * The agent rewrote its checklist (`todo_write`): the whole list, in order, as
   * the harness normalised it. Emitted inside the call, before its `tool_end`, and
   * only for a write that was accepted, so it is what confirms a call still in
   * flight. The list is also the call's own arguments, which is how a reload or a
   * durable run (no side events cross from the worker) shows it.
   */
  | {
      event: 'todo_updated';
      data: {
        todos: Array<{
          id: string;
          content: string;
          status: 'pending' | 'in_progress' | 'completed';
          active_form?: string;
        }>;
      };
    }
  /**
   * A `task` call handed a job to a child agent. A foreground child is bracketed
   * by `subagent_end`; a background one (`background: true`) runs as a durable
   * run on a thread of its own, named by `task_id`, and never sends an end here.
   * Neither carries the tool call's id, so a client matches by the agent's name.
   */
  | {
      event: 'subagent_start';
      data: { agent: string; background: boolean; task_id?: string; thread_id?: string };
    }
  | { event: 'subagent_end'; data: { agent: string; outcome: 'ok' | 'error' } }
  /**
   * The thread's permission mode changed mid-run — an approved `exit_plan_mode`.
   * A change through `POST /chat/mode` emits nothing; the snapshot's
   * `permissionMode` carries it.
   */
  | { event: 'permission_mode_changed'; data: { mode: PermissionMode } }
  /**
   * A `react` loop ran out of `spec.recursion_limit` steps with the model still
   * asking for tools. The session is recorded `truncated` and `done` says
   * `stop_reason: max_turns`; this frame is the one that carries the limit.
   */
  | { event: 'max_turns'; data: { limit: number } }
  | {
      event: 'session_progress';
      data: { phase?: string; reason?: string; [k: string]: unknown };
    }
  /**
   * The harness's in-process `InvokeOutput`, which reaches the wire as a Python
   * repr string (`default=str`). Typed as `unknown` because nothing in it is a
   * contract; usage is on `done`.
   */
  | { event: 'on_chain_end'; data: { output?: unknown } }
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
  /**
   * `usage` is the final model call's block (`felix-run/felix#399`), absent from
   * an older harness and whenever the provider reported none. Read it with
   * `readUsage`; the wire also carries `cost` and `totalTokens`, which nothing
   * here needs.
   */
  | {
      event: 'done';
      data: { final?: ChatMessage; messages?: ChatMessage[]; usage?: unknown };
    }
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
  /**
   * A workflow run's record, sent by `GET /workflows/{id}/runs/{run_id}/stream` each time it
   * changes: the body `GET /workflows/{id}/runs/{run_id}` answers, its `id:` the record's version.
   * Never on a chat stream. Typed loosely here; the Workflows page owns the run's shape.
   */
  | { event: 'workflow_run'; data: Record<string, unknown> }
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
/**
 * The durable run in flight on a thread (`activeRun` on the snapshot, felix-run/felix#529).
 * Its `resumeToken` is what `GET /chat/runs/{token}` takes.
 */
export interface ActiveRun {
  resumeToken: string;
  status?: string;
  /** Epoch ms. */
  expiresAt?: number | null;
}

/**
 * How much the agent may do on its own in a thread (`felix/governance/permission_mode.py`).
 * `plan` runs only read-only tools, and every agent honours it; `accept_edits` and
 * `bypass` waive approvals and are honoured only where the manifest allows them.
 * A closed set on the harness, open here so a newer mode still reads.
 */
export type PermissionMode = 'default' | 'plan' | 'accept_edits' | 'bypass' | (string & {});

export interface SessionSnapshot {
  id: string;
  name?: string | null;
  /** `idle` throughout a durable run, whose agent writes no thread phase: see `activeRun`. */
  phase?: string;
  /**
   * The durable run in flight, or null. Absent on a harness older than felix-run/felix#533,
   * which is how a client tells "no run" from "cannot say".
   */
  activeRun?: ActiveRun | null;
  thinkingLevel?: string;
  locked?: boolean;
  attached?: boolean;
  leafId?: string | null;
  revision?: number;
  /**
   * Operator labels, keyed by the event id they were put on.
   *
   * The harness has always sent this map and nothing modelled it, which is what
   * made `POST /chat/sessions/label` a write-only route: a label could be set
   * and never read back. It is the same event id `rewindChat` takes, so a
   * labelled turn is one anyone can also return to.
   */
  labels?: Record<string, string>;
  /**
   * The mode the thread was last set to (`POST /chat/mode`, or an approved plan),
   * or null for the manifest's default. Stored, not resolved: a run falls back from
   * a waiver mode its agent does not allow. Absent from an older harness.
   */
  permissionMode?: PermissionMode | null;
  /**
   * The output style the thread was set to (`POST /chat/style`), or null for the agent's
   * default. Stored, not resolved: a style the agent does not declare reads as its default.
   * Absent from an older harness.
   */
  outputStyle?: string | null;
  /**
   * A person's rating of an assistant turn, keyed by its event id
   * (`felix-run/felix#403`). Absent from an older harness. A cleared rating is
   * removed from the map, not set to `null`.
   */
  feedback?: Record<string, TurnFeedback>;
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
    /**
     * The event's stored metadata, sent whole (`session/snapshot.py`). The part a
     * client reads is `thinking`: the provider's reasoning blocks for an assistant
     * message, kept so a later turn can replay them. A durable run's live tail
     * frame carries no metadata, so after one lands the snapshot is the only place
     * its reasoning reaches a client.
     */
    metadata?: Record<string, unknown>;
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
  /** Carried from a snapshot row; see `SessionSnapshot.transcript[].metadata`. */
  metadata?: Record<string, unknown>;
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
  /**
   * The thread the prompt was asked on — the client's own id, not the namespaced
   * `thread_id` on the frame. `POST /chat/ui` requires it: the harness scopes a prompt to
   * its thread (felix-run/felix: UI waiter tenant scoping), so an answer names where it goes.
   */
  threadId: string;
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
