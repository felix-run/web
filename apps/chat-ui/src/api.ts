/**
 * chat-ui's binding of the Felix HTTP surface, all reached same-origin under
 * /api/* (Vite proxy in dev, proxy Worker in prod).
 *
 * Most of that surface is no longer implemented here. The chat verbs and the
 * read-only inspector reads — audit, usage, memory, plans, artifacts — both live
 * in `@felix/client`, which is origin- and credential-agnostic so a terminal
 * client can ask the same questions; this module supplies the browser's half of
 * the arrangement (the `/api` prefix, the shared key, the reachability signal,
 * the 401 reset) and re-exports the result under the names the components
 * already import.
 *
 * What is still *declared* below is the operator write surface — eval datasets,
 * manifest versions and canaries, scheduled jobs, the A2A discovery card. It
 * stays for two reasons: nothing outside this app calls it, and each area is
 * reached through its own `evalFetch`/`manifestFetch`/`jobsFetch` helper whose
 * definition `scripts/check-api-drift.mjs` skips with a regex spelled for the
 * `/api` prefix. Moved as-is, those helpers would be extracted as the phantom
 * paths `/eval{}`, `/manifests{}` and `/jobs{}` and fail the drift check against
 * routes that are perfectly fine.
 *
 * These endpoints are tenant-scoped; an anonymous dev caller resolves to tenant
 * `default`, so they read back exactly what anonymous chat turns produce. Behind
 * real auth, send an Authorization header (see README).
 */

import { createFelixClient } from '@felix/client';
import { reportReachability } from '@/lib/connection';
import { authHeaders, handleUnauthorized } from './lib/auth';
import type {
  AgentCard,
  EvalComparison,
  EvalDataset,
  EvalDatasetItem,
  EvalRun,
  EvalRunSummary,
  JobRecord,
  JobRun,
  ManifestPointer,
  ManifestSummary,
  ManifestVersionRow,
  ResolvedManifest,
  Rubric,
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
export const setSessionLabel = felix.setSessionLabel.bind(felix);
export const respondUiRequest = felix.respondUiRequest.bind(felix);
export const getThreadHistory = felix.getThreadHistory.bind(felix);
export const deleteThreadHistory = felix.deleteThreadHistory.bind(felix);
export const listApprovals = felix.listApprovals.bind(felix);
export const decideApproval = felix.decideApproval.bind(felix);

// The management half moved into @felix/client so a terminal client can ask the
// same questions. Bound here so every `@/api` import site is unchanged.
export const listAudit = felix.listAudit.bind(felix);
export const getToolMetrics = felix.getToolMetrics.bind(felix);
export const listUsage = felix.listUsage.bind(felix);
export const listMemories = felix.listMemories.bind(felix);
export const searchMemories = felix.searchMemories.bind(felix);
export const memoriesAsOf = felix.memoriesAsOf.bind(felix);
export const forgetMemory = felix.forgetMemory.bind(felix);
export const addMemory = felix.addMemory.bind(felix);
export const listPlans = felix.listPlans.bind(felix);
export const deletePlan = felix.deletePlan.bind(felix);
export const getArtifact = felix.getArtifact.bind(felix);

export type { StreamArgs, StreamHandlers } from '@felix/client';
export { flattenPlan } from '@felix/client';

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

/**
 * POST /eval/runs/compare → one dataset, a baseline manifest and candidates.
 *
 * The difference from `runEvalDataset` is the question being asked. A single run
 * says whether a manifest passes; this replays the *same* dataset against a
 * baseline and each candidate and reports the pass-rate lift between them, which
 * is the shape of "is the new prompt better" — the question anyone editing a
 * manifest actually has, and the one the panel could not ask.
 *
 * Every candidate is a real run, so this costs one full pass per manifest and
 * takes as long as they all do.
 */
export async function compareEvalRuns(input: {
  dataset: string;
  baseline: { name?: string; manifest: string };
  candidates: Array<{ name?: string; manifest: string }>;
  judgeThreshold?: number;
}): Promise<EvalComparison> {
  return evalFetch<EvalComparison>('/runs/compare', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      dataset_name: input.dataset,
      baseline: input.baseline,
      candidates: input.candidates,
      ...(input.judgeThreshold === undefined ? {} : { judge_threshold: input.judgeThreshold }),
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
