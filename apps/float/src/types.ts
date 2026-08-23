/**
 * float's view of the harness.
 *
 * The wire contract lives in `@felix/protocol`, shared with chat-ui. Only
 * float's own UI state stays here — it renders a timeline rather than a chat
 * transcript.
 */
export type {
  ChatMessage,
  DurableRun,
  PendingUiRequest,
  Role,
  SessionSnapshot,
  StreamEvent,
  ThinkingLevel,
  TokenUsage,
} from '@felix/protocol';

export interface TimelineItem {
  id: string;
  kind: 'user' | 'assistant' | 'tool' | 'approval' | 'system';
  title: string;
  body?: string;
  status?: 'pending' | 'running' | 'done' | 'error' | 'denied';
  /** Latest `tool_execution_update` phase for a running tool row. */
  phase?: string;
  /** Paths this row's tool call named, used to resolve later file mentions. */
  paths?: string[];
  /** Server event id when hydrated from a snapshot (enables rewind). */
  eventId?: string;
}
