/**
 * chat-ui's binding of the Felix HTTP surface, all reached same-origin under
 * /api/* (Vite proxy in dev, proxy Worker in prod):
 *
 *   GET  /api/v1/models      → manifest list for the switcher
 *   POST /api/chat/stream    → SSE token stream + inline tool events (+ per-turn
 *                              token usage on the terminal on_chain_end frame)
 *   GET  /api/audit          → activity feed (Inspector)
 *   GET  /api/audit/metrics  → tool-call rollups (Inspector → Metrics)
 *   GET  /api/approvals      → pending HITL approvals
 *   POST /api/approvals/:id/decide → approve / deny
 *   GET  /api/plans          → plan/step progress (Inspector)
 *
 * The chat half of that list is not implemented here. It lives in
 * `@felix/client`, which is origin- and credential-agnostic so a terminal
 * client can drive the same conversation; this module supplies the browser's
 * half of the arrangement — the `/api` prefix, the shared key, the reachability
 * signal, the 401 reset — and re-exports the result. What stays below is the
 * management and inspector surface, which only this app reads.
 *
 * The Inspector endpoints are tenant-scoped; an anonymous dev caller resolves
 * to tenant `default`, so they read back exactly what anonymous chat turns
 * produce. Behind real auth, send an Authorization header (see README).
 */

import { createFelixClient } from '@felix/client';
import { reportReachability } from '@/lib/connection';
import { authHeaders, handleUnauthorized } from './lib/auth';
import type {
  AgentCard,
  ArtifactContent,
  AuditEvent,
  AuditEventWire,
  EvalDataset,
  EvalDatasetItem,
  EvalRun,
  EvalRunSummary,
  JobRecord,
  JobRun,
  ManifestPointer,
  ManifestSummary,
  ManifestVersionRow,
  MemoryHit,
  MemoryRecord,
  Plan,
  PlanWire,
  ResolvedManifest,
  Rubric,
  ToolMetrics,
  UsageEvent,
} from './types';

/**
 * The one client every chat call goes through.
 *
 * `/api` rather than the harness origin because a browser cannot reach the
 * harness at all — no CORS, no static assets — so the proxy Worker forwards it
 * and swaps `x-chat-key` for the upstream credential. The three callbacks are
 * this app's own concerns, which is exactly why the package takes them rather
 * than assuming them.
 */
export const felix = createFelixClient({
  baseUrl: '/api',
  headers: authHeaders,
  onReachability: reportReachability,
  onUnauthorized: handleUnauthorized,
});

export const listManifests = felix.listManifests.bind(felix);
export const streamChat = felix.streamChat.bind(felix);
export const resumeStream = felix.resumeStream.bind(felix);
export const postToolResult = felix.postToolResult.bind(felix);
export const startChat = felix.startChat.bind(felix);
export const getDurableRun = felix.getDurableRun.bind(felix);
export const pollDurableRun = felix.pollDurableRun.bind(felix);
export const steerChat = felix.steerChat.bind(felix);
export const getSessionSnapshot = felix.getSessionSnapshot.bind(felix);
export const abortChat = felix.abortChat.bind(felix);
export const continueChat = felix.continueChat.bind(felix);
export const setThinkingLevel = felix.setThinkingLevel.bind(felix);
export const acquireSessionLease = felix.acquireSessionLease.bind(felix);
export const releaseSessionLease = felix.releaseSessionLease.bind(felix);
export const listSessions = felix.listSessions.bind(felix);
export const renameSession = felix.renameSession.bind(felix);
export const forkSession = felix.forkSession.bind(felix);
export const compactSession = felix.compactSession.bind(felix);
export const exportSession = felix.exportSession.bind(felix);
export const searchSessions = felix.searchSessions.bind(felix);
export const rewindChat = felix.rewindChat.bind(felix);
export const respondUiRequest = felix.respondUiRequest.bind(felix);
export const getThreadHistory = felix.getThreadHistory.bind(felix);
export const deleteThreadHistory = felix.deleteThreadHistory.bind(felix);
export const listApprovals = felix.listApprovals.bind(felix);
export const decideApproval = felix.decideApproval.bind(felix);

export type { StreamArgs, StreamHandlers } from '@felix/client';

/**
 * `fetch` for the management routes below, with the shared-key header attached.
 * A 401 means the key is missing/wrong/rotated — drop it and re-prompt
 * (handleUnauthorized) before the caller's own error handling runs.
 */
async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(input, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), ...authHeaders() },
    });
  } catch (err) {
    // `fetch` rejects only when the request never reached anything: DNS, TLS, a
    // refused connection, a dropped link. That is the one case that means the
    // harness is not there. An abort is the caller changing its mind, not a
    // connectivity fact, so it is left alone.
    if (!(err instanceof DOMException && err.name === 'AbortError')) {
      reportReachability(false);
    }
    throw err;
  }
  // Any reply at all, a 500 included, means something is listening.
  reportReachability(true);
  if (res.status === 401) handleUnauthorized();
  return res;
}

// --- Inspector REST helpers ---

/**
 * GET /audit → newest-first activity feed (`user_input`, `tool_call`, `policy_deny`,
 * `final_response`).
 *
 * The rename is the point of this function. The harness serialises the payload as
 * `payload_json`, and the route aliases only the *envelope* — it returns `items` and
 * `events` side by side so a client reading either works — which made the row shape
 * look settled when it was not. Reading `e.payload` off the raw row yields `undefined`
 * for every event the harness has ever written, and because the old type asserted the
 * field existed, nothing failed: the tool name fell back to the manifest id and the
 * summary line rendered as an empty string on every row.
 *
 * `event_type` and `status` are both server-side filters, so the panel narrows the
 * query rather than the rendered slice. `limit` is capped at 500 upstream.
 */
export async function listAudit(
  opts: { status?: string; eventType?: string; limit?: number } = {},
): Promise<AuditEvent[]> {
  const q = new URLSearchParams();
  if (opts.status) q.set('status', opts.status);
  if (opts.eventType) q.set('event_type', opts.eventType);
  q.set('limit', String(opts.limit ?? 50));
  const res = await apiFetch(`/api/audit?${q}`);
  if (!res.ok) throw new Error(`audit: ${res.status}`);
  const body = (await res.json()) as { events?: AuditEventWire[] };
  return (body.events ?? []).map((e) => ({
    ...e,
    payload: e.payload_json ?? e.payload ?? {},
  }));
}

/** GET /usage → paginated token meter events. */
export async function listUsage(
  opts: { limit?: number; cursor?: string; manifest_id?: string } = {},
): Promise<{ items: UsageEvent[]; next_cursor: string | null }> {
  const q = new URLSearchParams();
  q.set('limit', String(opts.limit ?? 50));
  if (opts.cursor) q.set('cursor', opts.cursor);
  if (opts.manifest_id) q.set('manifest_id', opts.manifest_id);
  const res = await apiFetch(`/api/usage?${q}`);
  if (!res.ok) throw new Error(`usage: ${res.status}`);
  return (await res.json()) as { items: UsageEvent[]; next_cursor: string | null };
}

// --- Spilled tool outputs (/artifacts) ---

/**
 * GET /artifacts/{manifest_id}/{artifact_id} → the full text behind a marker.
 *
 * A manifest with artifact spilling on replaces any oversized tool result with a
 * preview and a reference. The preview is what the transcript shows, so until
 * this is called the rest of that output is stored, addressed, and unreachable —
 * which is the state the harness route was added to end, and which no client
 * here had left it.
 *
 * The tenant is not a parameter. It comes from the caller's own credentials
 * upstream, which is what stops one tenant naming another's artifact however the
 * reference is spelled. Reads need the `artifacts:read` scope, so a 403 here is
 * a narrow key rather than a missing artifact — the same trap `/memory` sets.
 */
export async function getArtifact(
  manifestId: string,
  artifactId: string,
): Promise<ArtifactContent> {
  const res = await apiFetch(
    `/api/artifacts/${encodeURIComponent(manifestId)}/${encodeURIComponent(artifactId)}`,
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`artifact: ${res.status} ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as ArtifactContent;
}

// --- Long-term memory (/memory) ---
//
// Reads need the `memory:read` scope and writes `memory:write`, so a 403 here
// means the key is too narrow rather than that the store is empty — the two look
// identical without the message `describeError` writes. These routes are also
// newer than the rest of the surface, so a 404 means the harness predates them.

/** GET /memory → what the agent has stored, newest first. */
export async function listMemories(
  opts: { manifestId?: string; kind?: string; limit?: number } = {},
): Promise<MemoryRecord[]> {
  const q = new URLSearchParams();
  if (opts.manifestId) q.set('manifest_id', opts.manifestId);
  if (opts.kind) q.set('kind', opts.kind);
  q.set('limit', String(opts.limit ?? 50));
  const res = await apiFetch(`/api/memory?${q}`);
  if (!res.ok) throw new Error(`memory: ${res.status}`);
  const body = (await res.json()) as { items?: MemoryRecord[] };
  return body.items ?? [];
}

/**
 * GET /memory/search → the same hybrid ranking the agent sees.
 *
 * The point of exposing this is reproducibility: an operator can ask what the
 * agent would have recalled, and each hit reports which retriever found it.
 */
export async function searchMemories(
  query: string,
  opts: { manifestId?: string; kind?: string; limit?: number } = {},
): Promise<MemoryHit[]> {
  const q = new URLSearchParams({ q: query });
  if (opts.manifestId) q.set('manifest_id', opts.manifestId);
  if (opts.kind) q.set('kind', opts.kind);
  q.set('limit', String(opts.limit ?? 8));
  const res = await apiFetch(`/api/memory/search?${q}`);
  if (!res.ok) throw new Error(`memory/search: ${res.status}`);
  const body = (await res.json()) as { items?: MemoryHit[] };
  return body.items ?? [];
}

/**
 * GET /memory/as-of/{turn_seq} → what was believed at a past turn, including
 * facts since superseded.
 *
 * Read-only by design on the harness side: rewinding memory would be a
 * data-loss primitive on a shared multi-tenant table, and session rewind is
 * deliberately non-destructive.
 */
export async function memoriesAsOf(
  turnSeq: number,
  opts: { manifestId?: string; kind?: string; limit?: number } = {},
): Promise<MemoryRecord[]> {
  const q = new URLSearchParams();
  if (opts.manifestId) q.set('manifest_id', opts.manifestId);
  if (opts.kind) q.set('kind', opts.kind);
  q.set('limit', String(opts.limit ?? 200));
  const res = await apiFetch(`/api/memory/as-of/${encodeURIComponent(String(turnSeq))}?${q}`);
  if (!res.ok) throw new Error(`memory/as-of: ${res.status}`);
  const body = (await res.json()) as { items?: MemoryRecord[] };
  return body.items ?? [];
}

/**
 * DELETE /memory/{id} → stop the agent recalling this.
 *
 * A soft delete: the row moves to `status: "forgotten"` and drops out of recall
 * and the default listing, rather than being erased. Called "forget" throughout
 * the UI for that reason — promising deletion would overstate what happens.
 */
export async function forgetMemory(id: string): Promise<void> {
  const res = await apiFetch(`/api/memory/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`memory/forget: ${res.status} ${detail.slice(0, 200)}`);
  }
}

/**
 * GET /plans → plan/step progress (populated by the `deep` pattern).
 *
 * The row is metadata plus an opaque `plan` blob, and the title and steps live
 * inside it; flattening here is what lets the panel read `p.steps` at all. The
 * response carries the rows twice, as `plans` and as `items` — the same doubled
 * shape `/approvals` returns — so both names are read rather than betting on one.
 */
export async function listPlans(limit = 25): Promise<Plan[]> {
  const res = await apiFetch(`/api/plans?limit=${limit}`);
  if (!res.ok) throw new Error(`plans: ${res.status}`);
  const body = (await res.json()) as { plans?: PlanWire[]; items?: PlanWire[] };
  return (body.plans ?? body.items ?? []).map(flattenPlan);
}

/** A wire plan row as the panel consumes it: blob hoisted, steps always an array. */
export function flattenPlan(row: PlanWire): Plan {
  const plan = row.plan ?? {};
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    manifest_id: row.manifest_id,
    title: plan.title || 'Untitled plan',
    steps: (plan.steps ?? []).map((s, i) => ({
      id: String(s.id ?? i + 1),
      title: s.title ?? '',
      status: s.status ?? 'pending',
      note: s.note,
    })),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * GET /audit/metrics → tool-call rollups for a window. Aggregates `tool_call`
 * audit rows by `(tool, transport, status, error_code)`; defaults to the last
 * hour server-side. We pass an explicit `since` so the panel window is stable.
 */
export async function getToolMetrics(
  opts: { sinceMs?: number; limit?: number } = {},
): Promise<ToolMetrics> {
  const q = new URLSearchParams();
  if (opts.sinceMs) q.set('since', String(Date.now() - opts.sinceMs));
  q.set('limit', String(opts.limit ?? 200));
  const res = await apiFetch(`/api/audit/metrics?${q}`);
  if (!res.ok) throw new Error(`metrics: ${res.status}`);
  return (await res.json()) as ToolMetrics;
}

// --- Eval harness (/eval) ---

async function evalFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(`/api/eval${path}`, init);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`eval ${path}: ${res.status} ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/** GET /eval/datasets → the tenant's golden datasets. */
export async function listEvalDatasets(): Promise<EvalDataset[]> {
  const body = await evalFetch<{ items?: EvalDataset[]; datasets?: EvalDataset[] }>('/datasets');
  return body.items ?? body.datasets ?? [];
}

/**
 * PUT /eval/datasets/{name} → upsert a dataset *whole*. The harness has no
 * per-item route: `items` replaces the dataset's contents on every write.
 */
export async function putEvalDataset(
  name: string,
  description = '',
  items: Array<{ user_input: string; rubric: Rubric }> = [],
): Promise<EvalDataset> {
  return evalFetch<EvalDataset>(`/datasets/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ description, items }),
  });
}

/** GET /eval/datasets/{name} → the dataset with its items. */
export async function getEvalDataset(
  name: string,
): Promise<EvalDataset & { items: EvalDatasetItem[] }> {
  const body = await evalFetch<EvalDataset & { items?: EvalDatasetItem[] }>(
    `/datasets/${encodeURIComponent(name)}`,
  );
  return { ...body, items: body.items ?? [] };
}

/** Items in a dataset — read from the dataset itself; there is no /items route. */
export async function listEvalItems(dataset: string): Promise<EvalDatasetItem[]> {
  return (await getEvalDataset(dataset)).items;
}

/**
 * Append one item. Datasets are written whole, so this is a read-modify-write:
 * fetch current items, append, PUT the result back.
 */
export async function addEvalItem(
  dataset: string,
  item: { user_input: string; rubric: Rubric },
): Promise<EvalDataset> {
  const current = await getEvalDataset(dataset);
  const items = [
    ...current.items.map((i) => ({ user_input: i.user_input, rubric: i.rubric })),
    item,
  ];
  return putEvalDataset(dataset, current.description ?? '', items);
}

/**
 * POST /eval/datasets/{name}/run → replay the dataset against a manifest and
 * judge each item. Returns the summary; per-item scores come back via
 * getEvalRun(run_id). `deterministic_judge` skips the LLM judge and scores with
 * rubric heuristics only — the path CI uses.
 */
export async function runEvalDataset(
  dataset: string,
  candidateManifest: string,
  deterministicJudge = false,
): Promise<EvalRunSummary> {
  return evalFetch<EvalRunSummary>(`/datasets/${encodeURIComponent(dataset)}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      candidate_manifest: candidateManifest,
      deterministic_judge: deterministicJudge,
    }),
  });
}

/** GET /eval/runs?dataset=… → runs newest first. */
export async function listEvalRuns(dataset?: string, limit = 25): Promise<EvalRun[]> {
  const q = new URLSearchParams({ limit: String(limit) });
  if (dataset) q.set('dataset', dataset);
  const body = await evalFetch<{ items?: EvalRun[]; runs?: EvalRun[] }>(`/runs?${q}`);
  return body.items ?? body.runs ?? [];
}

/** GET /eval/runs/{id} → one run with per-item scores. */
export async function getEvalRun(id: string): Promise<EvalRun> {
  return evalFetch<EvalRun>(`/runs/${encodeURIComponent(id)}`);
}

// --- Manifest lifecycle (/manifests) ---
//
// Writes require the `manifests:write` scope. With FELIX_AUTH_MODE=none the
// harness skips scope checks entirely, so local dev drives the full lifecycle
// unauthenticated.
//
// The harness exposes no version *list* route: `GET /manifests` returns active
// pointers, and a specific version is read with `GET /manifests/{name}?version=N`.

async function manifestFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(`/api/manifests${path}`, init);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`manifests ${path}: ${res.status} ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/** GET /manifests → tenant-managed manifests (active pointer + canary state). */
export async function listTenantManifests(): Promise<ManifestSummary[]> {
  const body = await manifestFetch<{ items?: ManifestSummary[]; manifests?: ManifestSummary[] }>(
    '',
  );
  return body.items ?? body.manifests ?? [];
}

/**
 * GET /manifests/{name} → resolved manifest + which layer it came from.
 *
 * `threadId` is the thread-id *suffix*, and it is what makes `variant`
 * meaningful: canary assignment is a server-side hash over the thread, so the
 * harness answers `stable` for every caller that does not name one.
 */
export async function getResolvedManifest(
  name: string,
  opts: { version?: number; threadId?: string } = {},
): Promise<ResolvedManifest> {
  const q = new URLSearchParams();
  if (opts.version) q.set('version', String(opts.version));
  if (opts.threadId) q.set('thread_id', opts.threadId);
  // One flat template on purpose: check-api-drift extracts route strings by
  // regex, and a nested template literal truncates the path it sees.
  const qs = q.toString();
  const suffix = qs ? `?${qs}` : '';
  return manifestFetch<ResolvedManifest>(`/${encodeURIComponent(name)}${suffix}`);
}

/**
 * PUT /manifests/{name} → append a new version and activate it. The body's
 * `metadata.name` must equal `name` or the harness answers 400 `name_mismatch`.
 */
export async function createManifestVersion(
  name: string,
  manifest: unknown,
  comment = '',
): Promise<ManifestVersionRow> {
  return manifestFetch<ManifestVersionRow>(`/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ manifest, comment }),
  });
}

/**
 * POST /manifests/{name}/rollback → flip the active pointer to `version`.
 * This is the harness's activate: the route name reflects its common use, but
 * it activates any version, forward or back.
 */
export async function activateManifestVersion(
  name: string,
  version: number,
  comment = 'activate',
): Promise<ManifestPointer> {
  return manifestFetch<ManifestPointer>(`/${encodeURIComponent(name)}/rollback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version, comment }),
  });
}

/** POST /manifests/{name}/canary → route `weight`% of traffic to `version` (null clears). */
export async function setManifestCanary(
  name: string,
  canaryVersion: number | null,
  canaryWeight: number,
): Promise<ManifestPointer> {
  return manifestFetch<ManifestPointer>(`/${encodeURIComponent(name)}/canary`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ canary_version: canaryVersion, canary_weight: canaryWeight }),
  });
}

/**
 * DELETE /manifests/{name}/canary → clear the canary. The harness drops the
 * canary version and zeroes its weight together; there is no "keep it pinned at
 * 0%" variant.
 */
export async function clearManifestCanary(name: string): Promise<ManifestPointer> {
  return manifestFetch<ManifestPointer>(`/${encodeURIComponent(name)}/canary`, {
    method: 'DELETE',
  });
}

// --- Scheduled jobs (/jobs) ---
//
// The worker's `run_scheduled_jobs` cron invokes each job's manifest on its
// schedule — which needs felix-scheduler running alongside felix-worker. There
// is no run-now route; inspect `listJobRuns` for what the sweep has done.

async function jobsFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(`/api/jobs${path}`, init);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`jobs ${path}: ${res.status} ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/** GET /jobs → the tenant's persistent job registry. */
export async function listJobs(): Promise<JobRecord[]> {
  const body = await jobsFetch<{ items?: JobRecord[]; jobs?: JobRecord[] }>('');
  return body.items ?? body.jobs ?? [];
}

/** PUT /jobs/{name} → create or update a job. Empty `schedule` = never swept. */
export async function upsertJob(job: {
  name: string;
  schedule?: string;
  manifest_id?: string;
  payload?: Record<string, unknown>;
  enabled?: boolean;
}): Promise<JobRecord> {
  const { name, schedule = '', manifest_id = '', payload = {}, enabled = true } = job;
  return jobsFetch<JobRecord>(`/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ schedule, manifest_id, payload, enabled }),
  });
}

/** GET /jobs/{name}/runs → recent runs of one job, newest first. */
export async function listJobRuns(name: string, limit = 20): Promise<JobRun[]> {
  const body = await jobsFetch<{ items?: JobRun[] }>(
    `/${encodeURIComponent(name)}/runs?limit=${limit}`,
  );
  return body.items ?? [];
}

/** DELETE /jobs/{name} → remove a job from the registry. */
export async function deleteJob(name: string): Promise<void> {
  await jobsFetch<{ status: string }>(`/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

// --- A2A discovery card (/.well-known/agent-card.json) ---

/**
 * GET /.well-known/agent-card.json → the orchestrator's A2A discovery document
 * for its *default* manifest (protocols, endpoints, declared capabilities). The
 * route is public (auth middleware skips /.well-known/*).
 */
export async function getAgentCard(): Promise<AgentCard> {
  const res = await apiFetch('/api/.well-known/agent-card.json');
  if (!res.ok) throw new Error(`agent-card: ${res.status}`);
  return (await res.json()) as AgentCard;
}
