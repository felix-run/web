/**
 * chat-ui's view of the harness.
 *
 * The wire contract itself lives in `@felix/protocol`. What stays here is
 * either chat-ui's own UI state (`Turn`) or a management surface (audit, eval,
 * jobs, manifests, plans, usage).
 */

/**
 * Approval state is client-side: `before` carries the pre-edit file text for the
 * diff, so the type lives with the client tool executor, not the wire contract.
 */
export type { PendingApproval } from '@felix/cowork-client';
export type {
  ChatMessage,
  DurableRun,
  ImageAttachment,
  PendingUiRequest,
  Role,
  SessionEvent,
  SessionSnapshot,
  StreamEvent,
  ThinkingLevel,
  ThreadHistory,
  TokenUsage,
} from '@felix/protocol';

import type { ImageAttachment, Role, TokenUsage } from '@felix/protocol';

/** A finished or in-flight tool call, rendered inline in the transcript. */
export interface ToolCall {
  name: string;
  /** Harness tool-call id, when the frame carried one. */
  callId?: string;
  input?: unknown;
  output?: unknown;
  done: boolean;
  /** Latest `tool_execution_update` phase while the call is still running. */
  phase?: string;
}

/** A turn in the UI transcript. Assistant turns may carry inline tool calls. */
export interface Turn {
  id: string;
  role: Exclude<Role, 'tool' | 'system'>;
  content: string;
  tools?: ToolCall[];
  /** Image attachments on a user turn (rendered as thumbnails). */
  attachments?: ImageAttachment[];
  /** Set on assistant turns from the terminal `on_chain_end` usage payload. */
  usage?: TokenUsage;
  /** Server event id when hydrated from a session snapshot (enables rewind). */
  eventId?: string;
}

export type Variant = 'stable' | 'canary';

/**
 * One row from GET /chat/sessions — the tenant's threads, as the harness knows
 * them.
 *
 * `id` here is the *client* thread id: the wire spells it `{tenant}:{id}` and
 * `threadSuffix` strips the prefix, because a client only ever sends the suffix
 * back (the harness rejects one containing `:` outright, so a thread can never
 * be addressed across tenants).
 *
 * There is no manifest on this row. Which agent a thread was talked to is
 * client-side state, so the local index remains its only record.
 */
export interface SessionSummary {
  id: string;
  /** Server-set name from POST /chat/sessions/name; null until someone sets one. */
  name: string | null;
  /** Epoch ms. */
  createdAt?: number;
  updatedAt?: number;
  /** Set on a thread created by POST /chat/fork. */
  parentSessionId?: string | null;
}

// --- Harness-parity surfaces (Inspector panel) ---
// Shapes mirror src/api/{audit,approvals,plans}.ts in the orchestrator.

/** One row from GET /audit. */
export interface AuditEvent {
  id: string;
  tenant_id: string;
  ts: number;
  event_type: string;
  manifest_id: string;
  principal_subject: string;
  status: string;
  payload: Record<string, unknown>;
}

/** One row from GET /approvals. */
export interface ApprovalRequest {
  id: string;
  tenant_id: string;
  manifest_id: string;
  tool_name: string;
  call_signature: string;
  args: Record<string, unknown>;
  principal_subject: string;
  status: 'pending' | 'approved' | 'denied';
  created_at: number;
  decided_at: number | null;
  decided_by: string;
  decision_note: string;
  edited_args: Record<string, unknown> | null;
}

/** One row from GET /usage. */
export interface UsageEvent {
  id: string;
  tenant_id: string;
  ts: number;
  manifest_id: string;
  model_id: string;
  kind: string;
  tokens_input: number;
  tokens_output: number;
  cache_creation: number;
  cache_read: number;
  meta_json: Record<string, unknown>;
}

export type PlanStepStatus = 'pending' | 'in_progress' | 'completed' | 'skipped' | 'failed';

export interface PlanStep {
  id: string;
  description: string;
  status: PlanStepStatus;
  result: string;
}

/** One row from GET /plans. */
export interface Plan {
  id: string;
  tenant_id: string;
  manifest_id: string;
  title: string;
  steps: PlanStep[];
  created_at: number;
  updated_at: number;
}

/**
 * One per-tool rollup row from GET /audit/metrics.
 *
 * The harness aggregates `tool_call` audit events by tool name and returns them already
 * summed and sorted by `calls` descending, so the client does no folding of its own.
 * `avg_latency_ms` is a true mean (harness-side `latency_ms_sum / calls`), not a
 * max across buckets.
 */
export interface ToolMetricsRow {
  tool: string;
  calls: number;
  errors: number;
  avg_latency_ms: number;
}

/** GET /audit/metrics response. `window_since` is the epoch-ms floor the rollup covers. */
export interface ToolMetrics {
  tools: ToolMetricsRow[];
  window_since: number;
}

// --- Eval harness (/eval) ---
// Shapes mirror src/eval/types.ts. The UI authors a simplified rubric
// (criteria + must_include + threshold); the harness fills rubric defaults.

export interface Rubric {
  criteria?: string;
  must_include?: string[];
  must_not_include?: string[];
  pass_threshold?: number;
}

export interface EvalDataset {
  tenant_id?: string;
  name: string;
  description: string;
  created_at?: number;
}

export interface EvalDatasetItem {
  /** Absent on items nested in a dataset response; present on standalone rows. */
  dataset_name?: string;
  item_id: string;
  user_input: string;
  rubric: Rubric;
  created_at?: number;
}

export interface ItemScore {
  item_id: string;
  score: number;
  verdict: 'pass' | 'fail';
  reasoning: string;
  response: string;
  tokens_input?: number | null;
  tokens_output?: number | null;
  tool_call_count?: number | null;
  duration_ms?: number | null;
}

export interface EvalRun {
  id: string;
  dataset_name: string;
  candidate_manifest: string;
  started_at: number;
  finished_at: number | null;
  status: 'in_progress' | 'completed' | 'failed';
  pass_count: number;
  fail_count: number;
  scores: ItemScore[];
}

/** POST /eval/datasets/{name}/run response. */
export interface EvalRunSummary {
  run_id: string;
  pass_count: number;
  fail_count: number;
  pass_rate: number;
}

// --- Manifest lifecycle (/manifests) ---
// Shapes mirror src/api/manifests.ts. Tenant-managed manifests live in D1 as an
// append-only version log with an active pointer + optional canary pointer.

/** One row from GET /manifests — an active tenant-managed manifest. */
/**
 * The active pointer for one tenant-managed manifest, as returned by
 * `GET /manifests` items and by every write route. Note the active version is
 * `version` — the harness has no `active_version` field.
 */
export interface ManifestPointer {
  tenant_id?: string;
  name: string;
  version: number | null;
  canary_version?: number | null;
  canary_weight?: number;
  updated_at?: number;
  updated_by?: string;
}

/** `GET /manifests` returns pointer rows. */
export type ManifestSummary = ManifestPointer;

/** `PUT /manifests/{name}` returns the stored version row, not a pointer. */
export interface ManifestVersionRow {
  tenant_id?: string;
  name: string;
  version: number;
  manifest: unknown;
  created_at?: number;
  created_by?: string;
  comment?: string;
}

/**
 * GET /manifests/{name} — resolved through the 4-layer chain
 * (tenant Postgres → tenant object store → global object store → bundled).
 */
export interface ResolvedManifest {
  name: string;
  source?: 'tenant_postgres' | 'tenant_object' | 'global_object' | 'bundled';
  version: number | null;
  variant?: Variant;
  manifest: unknown;
}

// --- Scheduled jobs (/jobs) ---
// A job is a persistent, tenant-scoped record the worker's cron sweep invokes on
// its `schedule`. There is no run-now route; runs are observed, not triggered.

export interface JobRecord {
  tenant_id: string;
  name: string;
  schedule: string;
  manifest_id: string;
  enabled?: boolean;
  last_run_at?: number | null;
  next_run_at?: number | null;
  last_status: string;
  last_error: string;
  created_at: number;
  payload: Record<string, unknown>;
}

/** One row from GET /jobs/{name}/runs. */
export interface JobRun {
  job_name?: string;
  run_id?: string;
  status?: string;
  error?: string;
  started_at?: number | null;
  finished_at?: number | null;
}

// --- A2A discovery card (/.well-known/agent-card.json) ---
// Built for the harness's *default* manifest by `build_agent_card` — the
// peer-facing discovery document.
//
// This interface previously described a document the harness has never served:
// of ten declared fields, seven did not exist on the wire and `capabilities` was
// typed as an array when it arrives as an object. `AgentSheet` trusted the type,
// called `Object.entries(card.endpoints)` on `undefined`, and took the whole app
// down every time the sheet was opened. Nothing caught it — TypeScript believes
// whatever a hand-mirrored type asserts, and `check-api-drift` compares paths and
// verbs, never payload shapes.
//
// So every field here is optional on purpose. The route is served by whichever
// harness build the operator is running, which is not necessarily the one this
// repo was last read against, and a field that arrives late should render as a
// gap rather than as a crash.

export interface AgentCardSkill {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
}

export interface AgentCardCapabilities {
  streaming?: boolean;
  mcp?: boolean;
  /** Capabilities the manifest declared, beyond the two transport flags. */
  declared?: Array<{ id?: string; description?: string; inputSchemaRef?: string }>;
}

export interface AgentCard {
  name?: string;
  description?: string;
  /** Where peers address this agent, e.g. `http://localhost:8080/chat`. */
  url?: string;
  version?: string;
  capabilities?: AgentCardCapabilities;
  skills?: AgentCardSkill[];
  transparencyNotice?: boolean;
  /**
   * The route answers **200** with `{error, name}` when the default manifest is
   * missing, rather than a status code, so this is a success path to check for.
   */
  error?: string;
}
