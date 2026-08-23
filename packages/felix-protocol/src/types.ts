/**
 * The wire contract between the browser clients and the Python Felix harness.
 *
 * Hand-mirrored from the harness — there is no generated client. Both chat-ui
 * and float used to keep their own copy of this file and had already drifted
 * apart from each other and from the harness. One copy now, so a protocol
 * change is one edit.
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
  | { event: 'on_error'; data: { message: string } }
  | { event: 'done'; data: { final?: ChatMessage; messages?: ChatMessage[] } }
  | { event: 'aborted'; data: { thread_id?: string } }
  | { event: string; data: Record<string, unknown> };

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

/** Sticky mid-stream UI prompt waiting on POST /chat/ui. */
export interface PendingUiRequest {
  requestId: string;
  kind: 'select' | 'confirm' | 'input';
  prompt: string;
  options: Array<{ value: string; label: string }>;
  defaultValue?: unknown;
}

/** Sticky mid-stream approval waiting on decide. */
export interface PendingApproval {
  approvalId: string;
  toolName: string;
  args: Record<string, unknown>;
  ruleId?: string;
  before?: string | null;
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
