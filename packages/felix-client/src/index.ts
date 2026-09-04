/**
 * The headless Felix chat client: transport, transcript model, and the one
 * `StreamEvent` switch every surface runs on.
 *
 * What is *not* here is anything that assumes a viewport or a browser — no
 * storage, no notifications, no DOM. A client supplies its own origin,
 * credentials, persistence and renderer; this owns the conversation.
 */
export {
  type ApprovalRequest,
  type ApprovalSync,
  type ApprovalSyncOptions,
  DEFAULT_APPROVAL_TTL_MS,
  formatCountdown,
  msUntilDecision,
  type PendingApproval,
  summarizeToolArgs,
  syncApprovals,
} from './approvals';
export {
  type ClientToolOptions,
  type ClientToolRequest,
  type ClientToolResult,
  DEFAULT_CLIENT_TOOL_TIMEOUT_MS,
  settleClientTool,
} from './client-tools';
export {
  type ChatEngine,
  type ClientToolPort,
  createChatEngine,
  type EnginePorts,
  type EngineState,
  type SendArgs,
} from './engine';
export { type DescribedError, describeError } from './errors';
export { type ReattachOptions, reattachThread } from './reattach';
export {
  eventsToTurns,
  mergeSessions,
  type SessionSummary,
  snapshotToEvents,
  type ThreadMeta,
  threadSuffix,
  titleFromText,
} from './session-log';
export { relativeTime } from './time';
export {
  createFelixClient,
  type FelixClient,
  type FelixClientOptions,
  type StreamArgs,
  type StreamHandlers,
} from './transport';
export {
  closeTool,
  findOpenTool,
  interleaveTurn,
  markToolPhase,
  type ReasoningBlock,
  type ToolCall,
  type Turn,
  type TurnSegment,
} from './turns';
