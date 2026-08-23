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
} from '@felix/protocol';

export interface TimelineItem {
  id: string;
  kind: 'user' | 'assistant' | 'tool' | 'approval' | 'system';
  title: string;
  body?: string;
  status?: 'pending' | 'running' | 'done' | 'error' | 'denied';
  /** Server event id when hydrated from a snapshot (enables rewind). */
  eventId?: string;
}
