/**
 * chat-ui's view of the harness.
 *
 * The wire contract lives in `@felix/protocol`, and everything the conversation
 * itself is made of — the transcript, tool cards, approvals, the thread index —
 * in `@felix/client`, because a terminal client needs exactly those — and, since
 * the inspector reads moved across, the audit, usage, memory, plan and artifact
 * row shapes too. All of it is re-exported here so components keep importing one
 * module. What is *declared* below is only the operator write surface (eval,
 * jobs, manifests) and the A2A card, which nothing outside this app reads.
 */

export type {
  ApprovalRequest,
  PendingApproval,
  ReasoningBlock,
  SessionSummary,
  ThreadMeta,
  ToolCall,
  Turn,
  TurnSegment,
} from '@felix/client';
export {
  type ApprovalOutcome,
  type ArtifactContent,
  AUDIT_EVENT_TYPES,
  type AuditEvent,
  type AuditEventType,
  type AuditEventWire,
  DOCUMENT_LIMITS,
  type DocumentHit,
  type DocumentRecord,
  describeRefusal,
  type MemoryHit,
  type MemoryRecord,
  type Plan,
  type PlanBody,
  type PlanStep,
  type PlanStepStatus,
  type PlanWire,
  parseApprovalOutcome,
  type ToolMetrics,
  type ToolMetricsRow,
  type UsageEvent,
  type UsageSummary,
  type UsageSummaryItem,
} from '@felix/client';
export type {
  ArtifactRef,
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
export { parseArtifactMarker } from '@felix/protocol';

export type Variant = 'stable' | 'canary';

// --- Comparative eval (/eval/runs/compare) ---

/**
 * One manifest's showing in a comparison: its own run, its pass rate, and how
 * far it moved the needle against the baseline.
 *
 * Like `ArtifactContent`, outside the `check-payload-shapes` guard — this is
 * assembled in `felix/eval/compare.py`, not in a `store.py` serializer, so there
 * is no recorded key set to check it against. The nested `run` *is* a recorded
 * shape (`EvalRun`), and that is the part the panel reads in detail.
 */
export interface EvalComparisonEntry {
  name: string;
  manifest: string;
  is_baseline: boolean;
  pass_rate: number;
  /** Percentage points against the baseline; 0 for the baseline itself. */
  lift_pp: number;
  run?: EvalRun;
  /** Only present when a `judge_threshold` was given and this run missed it. */
  below_threshold?: boolean;
}

export interface EvalComparison {
  dataset: string;
  baseline: string;
  results: EvalComparisonEntry[];
  judge_threshold: number | null;
}

// --- Spilled tool outputs (/artifacts) ---

// --- Long-term memory (/memory) ---
//
// What an agent has stored across sessions. The harness builds this as an
// operator surface: when a run starts answering from a fact that is stale,
// wrong, or was extracted from a hostile tool result, someone has to be able to
// find that fact and remove it without a database console.

// --- Harness-parity surfaces (Inspector panel) ---
// Shapes mirror src/api/{audit,approvals,plans}.ts in the orchestrator.

// --- Eval harness (/eval) ---
// Shapes mirror src/eval/types.ts. The UI authors a simplified rubric
// (criteria + must_include + threshold); the harness fills rubric defaults.

/**
 * An eval item's rubric: the keys `felix.eval.runner._score_answer` reads, and
 * nothing else.
 *
 * The previous shape — `criteria`, `must_include`, `must_not_include`,
 * `pass_threshold` — shared one key with the harness, and that one (`criteria`)
 * only *tunes* a judge without selecting one. Every item the Add form wrote
 * therefore named no rule the scorer reads and fell through to `nonempty`, which
 * passes any answer that is not blank: a dataset that looked configured and gated
 * nothing. See the rubric table in the management API guide.
 *
 * Trajectory rules are read first and can only reject. Then exactly one answer
 * rule applies, in this order: `expect`/`equals`, `contains`, `min_chars`, else
 * `nonempty`. A judge runs only when `llm_judge`, `judge_criteria` or
 * `judge_model` is set, and its verdict replaces the answer rule.
 */
export interface Rubric {
  tools_called?: string[];
  tools_not_called?: string[];
  max_tool_calls?: number;
  max_errors?: number;
  expect?: string;
  equals?: string;
  contains?: string;
  min_chars?: number | string;
  llm_judge?: boolean;
  judge_criteria?: string;
  judge_model?: string;
  judge_threshold?: number;
  /** Judge tuning only; does not select the judge. */
  criteria?: string;
  mock_answer?: string;
  /** Free-form on the wire; anything else is stored and ignored by the scorer. */
  [key: string]: unknown;
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

/**
 * One item's score, as `felix.eval.runner` builds it.
 *
 * `rule` is the harness's own name for what decided the row — one of the rubric
 * keys, `nonempty`, `invalid_rubric`, or `llm_judge` — and is the thing worth
 * reading on a failure. `reason` is set by a judge, or by a judge that fell back
 * (`llm_fallback:…`). `error` replaces the rest on an item that never reached
 * the scorer; such rows are counted in `fail_count` *and* `error_count`.
 *
 * Nothing here is nested inside the run row's `scores` list on the wire, so
 * `check-payload-shapes` cannot see it; the previous shape (`verdict`,
 * `reasoning`, `response`, per-item tokens) matched no field the runner writes
 * and rendered an empty verdict on every row.
 */
export interface ItemScore {
  item_id: string;
  pass?: boolean;
  score?: number;
  rule?: string;
  /** The answer, cut at 500 characters by the harness. */
  answer?: string;
  reason?: string;
  mock?: boolean;
  /** Tool invocations the run made, and how many came back as an error or a denial. */
  tool_calls?: number;
  tool_errors?: number;
  error?: string;
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
  /**
   * Items that never reached the scorer — a malformed item, a run that threw.
   * A subset of `fail_count`, which keeps meaning "did not pass" for the CLI's
   * exit code; this is what tells a malformed dataset from a rejected one.
   * Optional because a harness before `felix-run/felix@6853057` does not send it.
   */
  error_count?: number;
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
