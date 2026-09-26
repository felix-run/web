/**
 * The headless Felix chat client: transport, transcript model, and the one
 * `StreamEvent` switch every surface runs on.
 *
 * What is *not* here is anything that assumes a viewport or a browser — no
 * storage, no notifications, no DOM. A client supplies its own origin,
 * credentials, persistence and renderer; this owns the conversation.
 */
export {
  type ApprovalOutcome,
  type ApprovalRequest,
  type ApprovalSync,
  type ApprovalSyncOptions,
  type ArgEdit,
  approvalRuleLabel,
  DEFAULT_APPROVAL_TTL_MS,
  describeGate,
  describeRefusal,
  formatArgsForEditing,
  formatCountdown,
  msUntilDecision,
  type PendingApproval,
  parseApprovalOutcome,
  parseEditedArgs,
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
export { createHttp, type FelixHttp } from './http';
export { createManagementClient } from './management';
export type { ArtifactContent } from './management/artifacts';
export {
  AUDIT_EVENT_TYPES,
  type AuditEvent,
  type AuditEventType,
  type AuditEventWire,
  type ToolMetrics,
  type ToolMetricsRow,
} from './management/audit';
export {
  DOCUMENT_LIMITS,
  type DocumentHit,
  type DocumentRecord,
} from './management/documents';
export type { MemoryHit, MemoryRecord } from './management/memory';
export {
  flattenPlan,
  type Plan,
  type PlanBody,
  type PlanStep,
  type PlanStepStatus,
  type PlanWire,
} from './management/plans';
export type {
  UsageEvent,
  UsageSummary,
  UsageSummaryItem,
  UsageSummaryTotals,
} from './management/usage';
export { type ReattachOptions, reattachThread } from './reattach';
export {
  eventsToTurns,
  mergeSessions,
  type SessionSummary,
  snapshotToEvents,
  type ThreadMeta,
  threadSuffix,
  titleFromText,
  UNTITLED_THREAD_TITLE,
} from './session-log';
export { relativeTime } from './time';
export { classifyToolResult, type ToolResultIssue } from './tool-results';
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
