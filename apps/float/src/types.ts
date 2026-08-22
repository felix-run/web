export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface ToolRequestEvent {
  event: 'tool_request';
  data: {
    id: string;
    name: string;
    args: Record<string, unknown>;
    thread_id?: string;
    transport?: string;
  };
}

export interface ApprovalRequiredEvent {
  event: 'approval_required';
  data: {
    approval_id: string;
    tool_name: string;
    args: Record<string, unknown>;
    rule_id?: string;
    thread_id?: string;
    tool_call_id?: string | null;
  };
}

export type StreamEvent =
  | { event: 'text_delta'; data: { chunk?: { content?: string }; delta?: string } }
  | { event: 'on_chat_model_stream'; data: { chunk?: { content?: string } } }
  | { event: 'tool_start'; data: { name: string; input?: unknown; id?: string } }
  | { event: 'tool_end'; data: { name: string; output?: unknown; id?: string } }
  | { event: 'on_tool_start'; data: { name: string; input?: unknown } }
  | { event: 'on_tool_end'; data: { name: string; output?: unknown } }
  | ToolRequestEvent
  | ApprovalRequiredEvent
  | { event: 'done'; data: { final?: ChatMessage } }
  | { event: 'aborted'; data: { thread_id?: string } }
  | { event: 'session_progress'; data: { phase?: string; reason?: string } }
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
  | { event: string; data: Record<string, unknown> };

export type ThinkingLevel =
  | 'off'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max';

export interface PendingUiRequest {
  requestId: string;
  kind: 'select' | 'confirm' | 'input';
  prompt: string;
  options: Array<{ value: string; label: string }>;
  defaultValue?: unknown;
}

export interface SessionSnapshot {
  id: string;
  phase?: string;
  thinkingLevel?: string;
  transcript?: Array<{
    seq: number;
    kind: string;
    role?: string | null;
    content?: string;
  }>;
}

export interface TimelineItem {
  id: string;
  kind: 'user' | 'assistant' | 'tool' | 'approval' | 'system';
  title: string;
  body?: string;
  status?: 'pending' | 'running' | 'done' | 'error' | 'denied';
}
