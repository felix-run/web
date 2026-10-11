/**
 * The headless Felix chat client: transport, transcript model, and the one
 * `StreamEvent` switch every surface runs on.
 *
 * What is *not* here is anything that assumes a viewport or a browser — no
 * storage, no notifications, no DOM. A client supplies its own origin,
 * credentials, persistence and renderer; this owns the conversation.
 */

export { subagentOf, TASK_TOOL, TODO_TOOL, todosFromCall } from './agent-work';
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
  isLapsedApproval,
  msUntilDecision,
  type PendingApproval,
  parseApprovalOutcome,
  parseEditedArgs,
  readsBefore,
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
export { type DiffCall, routedDiffReader } from './diff-before';
export { durableRunFailure, isDurableRunOver } from './durable-runs';
export {
  type ChatEngine,
  type ClientToolPort,
  createChatEngine,
  type EngineDiagnostics,
  type EnginePorts,
  type EngineState,
  type SendArgs,
  type SendOutcome,
  STREAM_STALL_MS,
} from './engine';
export {
  type DescribedError,
  describeError,
  IdempotencyKeyReusedError,
  isLeaseRefusal,
  LeaseRefusedError,
  RunInProgressError,
  SendRefusedError,
  StreamInProgressError,
} from './errors';
export { createHttp, type FelixHttp, type LeaseRefusal } from './http';
export {
  DEFAULT_READ_CHARS,
  type FileToolOp,
  fileToolOp,
  isLocalFileTool,
  type LocalEntry,
  type LocalFs,
  MAX_LIST_ENTRIES,
  runLocalFileTool,
} from './local-files';
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
  isThreadScoped,
  type Plan,
  type PlanBody,
  PlanChangedError,
  type PlanEdited,
  type PlanStep,
  type PlanStepStatus,
  type PlanWire,
} from './management/plans';
export type {
  OutdatedSkill,
  OutdatedSkillPage,
  SkillDiff,
  SkillFileChange,
  SkillImportResult,
  SkillSourceItem,
  SkillSourceListing,
  SkillUpdateResult,
  SkillUpstreamCheck,
} from './management/skill-import';
export type {
  EvalScenario,
  EvalScenarioResult,
  EvalStatus,
  FeedbackSource,
  FeedbackStatus,
  ScenarioSource,
  SkillEval,
  SkillFeedback,
  SkillPolicyPatch,
} from './management/skill-quality';
export {
  type BundleIssue,
  isSkillLibraryError,
  isSkillName,
  isStaleWrite,
  librarySegment,
  REQUEST_BODY_LIMIT_BYTES,
  type ReviewCheck,
  type ReviewQueueItem,
  requestBodyBytes,
  type SecuritySeverity,
  type SecurityStatus,
  SKILL_BUNDLE_BODY_LIMIT_BYTES,
  type SkillArchived,
  type SkillBump,
  type SkillBundleWrite,
  type SkillDetail,
  type SkillFile,
  type SkillFileMeta,
  SkillLibraryError,
  type SkillLibraryId,
  type SkillPage,
  type SkillPolicy,
  type SkillPolicySource,
  type SkillPolicyValues,
  type SkillPreview,
  type SkillRefusal,
  type SkillSecurityIssue,
  type SkillSource,
  type SkillStatus,
  type SkillSummary,
  type SkillUpstreamState,
  type SkillVersion,
  type SkillVersionDetail,
  type SkillVersionHead,
  type SkillVersionWrite,
  type SkillWriteResult,
} from './management/skills';
export type {
  UsageByThread,
  UsageEvent,
  UsageSummary,
  UsageSummaryItem,
  UsageSummaryTotals,
  UsageThreadItem,
} from './management/usage';
export {
  CHECKLIST_ID,
  checklistFromCall,
  PLAN_TOOLS,
  type PlanCallStep,
  type PlanState,
  planFromCall,
  plansInTurn,
  type StepState,
} from './plans';
export { type ReattachOptions, reattachThread } from './reattach';
export {
  type BranchPoint,
  branchPoints,
  eventsToTurns,
  mergeSessions,
  type SessionSummary,
  snapshotToEvents,
  type ThreadMeta,
  threadSuffix,
  titleFromText,
  UNTITLED_THREAD_TITLE,
} from './session-log';
export { parseTabular, type Tabular } from './tabular';
export { formatElapsed, relativeTime } from './time';
export { classifyToolResult, type ToolResultIssue } from './tool-results';
export {
  createFelixClient,
  type FelixClient,
  type FelixClientOptions,
  type HarnessWorkspaceTree,
  type LeaseAcquireResult,
  type LeaseStatus,
  type ManifestCommand,
  type ManifestEntry,
  type ManifestGreeting,
  type ManifestOutputStyle,
  type ManifestStarter,
  type ManifestWorkspace,
  type SideAnswer,
  SideQuestionError,
  type StreamArgs,
  type StreamHandlers,
  WorkspaceChangedError,
  WorkspaceRouteError,
} from './transport';
export {
  closeTool,
  countWords,
  findOpenTool,
  interleaveTurn,
  markToolPhase,
  type ReasoningBlock,
  type SubagentRun,
  type TodoItem,
  type ToolCall,
  type Turn,
  type TurnSegment,
  type WorkspaceEdit,
} from './turns';
export { describeWorkspaceEdit, workspaceEditOf } from './workspace-edits';
