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
  | { event: string; data: Record<string, unknown> };

export interface TimelineItem {
  id: string;
  kind: 'user' | 'assistant' | 'tool' | 'approval' | 'system';
  title: string;
  body?: string;
  status?: 'pending' | 'running' | 'done' | 'error' | 'denied';
}

export interface PendingApproval {
  approvalId: string;
  toolName: string;
  args: Record<string, unknown>;
  ruleId?: string;
}
