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

import { createFelixClient, type LeaseRefusal } from '@felix/client';
import { readSseStream } from '@felix/protocol';
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
  ManifestVersionPage,
  ManifestVersionRow,
  ResolvedManifest,
  Rubric,
  SessionSnapshot,
  WorkflowCheck,
  WorkflowDefinition,
  WorkflowKind,
  WorkflowRecord,
  WorkflowRun,
  WorkflowRunSummary,
  WorkflowSummary,
  WorkflowTool,
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
/**
 * Where the client asks for a thread's lease token, and reports a refusal.
 *
 * The holder is the shell's lease keeper, which is built from this module's own
 * acquire and release — so it cannot be handed to `createFelixClient` here
 * without an import cycle. The shell binds it once, at module scope, through
 * `bindLeases`; until then no token is sent and leases stay advisory.
 */
const leases: {
  token: (threadId: string) => string | undefined;
  refused: (threadId: string, code: LeaseRefusal) => void;
} = { token: () => undefined, refused: () => {} };

export function bindLeases(binding: typeof leases): void {
  leases.token = binding.token;
  leases.refused = binding.refused;
}

export const felix = createFelixClient({
  baseUrl: '/api',
  headers: authHeaders,
  onReachability: reportReachability,
  onUnauthorized: handleUnauthorized,
  leaseToken: (threadId) => leases.token(threadId),
  onLeaseRefused: (threadId, code) => leases.refused(threadId, code),
});

export const listManifestEntries = felix.listManifestEntries.bind(felix);
export const streamChat = felix.streamChat.bind(felix);
export const resumeStream = felix.resumeStream.bind(felix);
export const postToolResult = felix.postToolResult.bind(felix);
export const startChat = felix.startChat.bind(felix);
export const getDurableRun = felix.getDurableRun.bind(felix);
export const pollDurableRun = felix.pollDurableRun.bind(felix);
export const steerChat = felix.steerChat.bind(felix);
export const workspaceEdited = felix.workspaceEdited.bind(felix);
export const workspaceTree = felix.workspaceTree.bind(felix);
export const workspaceRead = felix.workspaceRead.bind(felix);
export const workspaceWrite = felix.workspaceWrite.bind(felix);
export const workspaceDelete = felix.workspaceDelete.bind(felix);
export const workspaceRename = felix.workspaceRename.bind(felix);
export const workspaceDeleteFolder = felix.workspaceDeleteFolder.bind(felix);
export const workspaceRenameFolder = felix.workspaceRenameFolder.bind(felix);
export const getSessionSnapshot = felix.getSessionSnapshot.bind(felix);
export const abortChat = felix.abortChat.bind(felix);
export const continueChat = felix.continueChat.bind(felix);
export const setThinkingLevel = felix.setThinkingLevel.bind(felix);
export const setPermissionMode = felix.setPermissionMode.bind(felix);
export const setOutputStyle = felix.setOutputStyle.bind(felix);
export const askAboutThread = felix.askAboutThread.bind(felix);
export const acquireSessionLease = felix.acquireSessionLease.bind(felix);
export const releaseSessionLease = felix.releaseSessionLease.bind(felix);
export const getSessionLease = felix.getSessionLease.bind(felix);
export const listSessions = felix.listSessions.bind(felix);
export const renameSession = felix.renameSession.bind(felix);
export const forkSession = felix.forkSession.bind(felix);
export const compactSession = felix.compactSession.bind(felix);
export const exportSession = felix.exportSession.bind(felix);
export const searchSessions = felix.searchSessions.bind(felix);
export const rewindChat = felix.rewindChat.bind(felix);
export const uploadFile = felix.uploadFile.bind(felix);
export const getFile = felix.getFile.bind(felix);
export const setSessionLabel = felix.setSessionLabel.bind(felix);
export const setSessionFeedback = felix.setSessionFeedback.bind(felix);
export const respondUiRequest = felix.respondUiRequest.bind(felix);
export const getThreadHistory = felix.getThreadHistory.bind(felix);
export const deleteThreadHistory = felix.deleteThreadHistory.bind(felix);
export const listApprovals = felix.listApprovals.bind(felix);
export const decideApproval = felix.decideApproval.bind(felix);

// The management half moved into @felix/client so a terminal client can ask the
// same questions. Bound here so every `@/api` import site is unchanged.
export const listAudit = felix.listAudit.bind(felix);
export const listAuditWindow = felix.listAuditWindow.bind(felix);
export const listAgentSkills = felix.listAgentSkills.bind(felix);
export const getAgentSkill = felix.getAgentSkill.bind(felix);
export const recentSkillActivations = felix.recentSkillActivations.bind(felix);
export const exportAudit = felix.exportAudit.bind(felix);
export const getToolMetrics = felix.getToolMetrics.bind(felix);
export const listUsage = felix.listUsage.bind(felix);
export const getUsageSummary = felix.getUsageSummary.bind(felix);
export const listUsageByThread = felix.listUsageByThread.bind(felix);
export const listMemories = felix.listMemories.bind(felix);
export const searchMemories = felix.searchMemories.bind(felix);
export const memoriesAsOf = felix.memoriesAsOf.bind(felix);
export const forgetMemory = felix.forgetMemory.bind(felix);
export const restoreMemory = felix.restoreMemory.bind(felix);
export const addMemory = felix.addMemory.bind(felix);
export const listDocuments = felix.listDocuments.bind(felix);
export const searchDocuments = felix.searchDocuments.bind(felix);
export const addDocument = felix.addDocument.bind(felix);
export const deleteDocument = felix.deleteDocument.bind(felix);
export const listPlans = felix.listPlans.bind(felix);
export const deletePlan = felix.deletePlan.bind(felix);
export const updatePlan = felix.updatePlan.bind(felix);
export const getArtifact = felix.getArtifact.bind(felix);

// The tenant skill library: the one management area with a full write surface,
// because reviewing what an agent drafted is what it is for.
export const listLibrarySkills = felix.listLibrarySkills.bind(felix);
export const listSkillReviewQueue = felix.listSkillReviewQueue.bind(felix);
export const getSkillPublishPolicy = felix.getSkillPublishPolicy.bind(felix);
export const getLibrarySkill = felix.getLibrarySkill.bind(felix);
export const getSkillVersion = felix.getSkillVersion.bind(felix);
export const getSkillFile = felix.getSkillFile.bind(felix);
export const previewSkillVersion = felix.previewSkillVersion.bind(felix);
export const readSkillBundle = felix.readSkillBundle.bind(felix);
export const createLibrarySkill = felix.createLibrarySkill.bind(felix);
export const saveSkillVersion = felix.saveSkillVersion.bind(felix);
export const publishSkillVersion = felix.publishSkillVersion.bind(felix);
export const rollbackSkillVersion = felix.rollbackSkillVersion.bind(felix);
export const rejectSkillVersion = felix.rejectSkillVersion.bind(felix);
export const archiveLibrarySkill = felix.archiveLibrarySkill.bind(felix);
export const promoteSkillVersion = felix.promoteSkillVersion.bind(felix);
export const listPersonalLibraries = felix.listPersonalLibraries.bind(felix);
export const browseSkillSource = felix.browseSkillSource.bind(felix);
export const importSkill = felix.importSkill.bind(felix);
export const listOutdatedSkills = felix.listOutdatedSkills.bind(felix);
export const checkSkillUpstream = felix.checkSkillUpstream.bind(felix);
export const updateSkillFromSource = felix.updateSkillFromSource.bind(felix);
export const adoptSkillVersion = felix.adoptSkillVersion.bind(felix);
export const updateSkillPublishPolicy = felix.updateSkillPublishPolicy.bind(felix);
export const resetSkillPublishPolicy = felix.resetSkillPublishPolicy.bind(felix);
export const listFeedbackInbox = felix.listFeedbackInbox.bind(felix);
export const listSkillFeedback = felix.listSkillFeedback.bind(felix);
export const submitSkillFeedback = felix.submitSkillFeedback.bind(felix);
export const acceptSkillFeedback = felix.acceptSkillFeedback.bind(felix);
export const rejectSkillFeedback = felix.rejectSkillFeedback.bind(felix);
export const queueSkillEval = felix.queueSkillEval.bind(felix);
export const listSkillEvals = felix.listSkillEvals.bind(felix);
export const getSkillEval = felix.getSkillEval.bind(felix);

export type { StreamArgs, StreamHandlers } from '@felix/client';
export { flattenPlan } from '@felix/client';

/**
 * `fetch` for the management routes below, with the shared-key header attached.
 * A 401 means the key is missing/wrong/rotated — drop it and re-prompt
 * (handleUnauthorized) before the caller's own error handling runs.
 */
async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  const sent = authHeaders();
  try {
    res = await fetch(input, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), ...sent },
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
  if (res.status === 401) handleUnauthorized(sent);
  return res;
}

// --- Signing in (/auth) ---
//
// Plain `fetch`, not `apiFetch`: these are how a browser *gets* a credential, so
// they send none, and a 401 from one of them is not a stored credential going
// stale. The Worker passes all three through without its key.

/** `GET /auth/methods` — what the harness offers a browser with no credential. */
export interface AuthMethods {
  github_device: boolean;
  /** Browser sign-in by redirect (`GET /auth/github/authorize`), through a GitHub App. */
  github_redirect: boolean;
  /**
   * Google sign-in by redirect (`GET /auth/google/authorize`), for the accounts the operator
   * listed and nobody else. `false` from a harness older than the field.
   */
  google_redirect: boolean;
  /** Whether the harness verifies a bearer. The Worker honours one only when it does. */
  bearer_required: boolean;
  /**
   * Who may sign in without belonging to an organization the harness maps: nobody (`off`), or
   * the accounts the operator invited (`invite`), each into a tenant of its own. `off` from a
   * harness older than the field, and for any value this client does not know.
   */
  github_signup: 'off' | 'invite';
}

export interface GitHubDeviceStart {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface GitHubLoginToken {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  tenant: string;
  scopes: string[];
  /** Absent from a harness older than the field. */
  github_login?: string;
  /** Google sign-in only: who signed in, for the account chip. Empty when Google withheld it. */
  email?: string;
  name?: string;
  picture?: string;
}

/** Every refusal from the login routes. `interval` rides a 428/429, `tenants` a 409. */
export interface GitHubLoginRefusal {
  error: string;
  message: string;
  interval?: number;
  tenants?: string[];
  /** The GitHub account that was refused, once GitHub had said who signed in. */
  github_login?: string;
}

export type LoginResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; refusal: GitHubLoginRefusal | null };

/**
 * How long a sign-in call may hang before it counts as unreachable. Every caller already reads
 * a throw as offline; without a deadline, a proxy that took the connection and never answered
 * left the gate on its spinner, or on "Asking GitHub for a code…", for good.
 */
export const AUTH_TIMEOUT_MS = 15_000;

function authDeadline(): AbortSignal {
  return AbortSignal.timeout(AUTH_TIMEOUT_MS);
}

async function loginCall<T>(res: Response): Promise<LoginResult<T>> {
  const body = (await res.json().catch(() => null)) as unknown;
  if (res.ok && body && typeof body === 'object') return { ok: true, value: body as T };
  const refusal =
    body && typeof body === 'object' && typeof (body as GitHubLoginRefusal).error === 'string'
      ? (body as GitHubLoginRefusal)
      : null;
  return { ok: false, status: res.status, refusal };
}

/**
 * Null when the harness cannot say — an older one has no such route, and under
 * `api_key` it 401s an anonymous caller — which reads as "no GitHub login".
 */
export async function getAuthMethods(): Promise<AuthMethods | null> {
  try {
    const res = await fetch('/api/auth/methods', { signal: authDeadline() });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<AuthMethods>;
    return {
      github_device: body.github_device === true,
      github_redirect: body.github_redirect === true,
      google_redirect: body.google_redirect === true,
      bearer_required: body.bearer_required === true,
      github_signup: body.github_signup === 'invite' ? 'invite' : 'off',
    };
  } catch {
    return null;
  }
}

/** POST /auth/github/device → a code for the person to enter at GitHub. Throws only offline. */
export async function startGitHubLogin(): Promise<LoginResult<GitHubDeviceStart>> {
  return loginCall<GitHubDeviceStart>(
    await fetch('/api/auth/github/device', { method: 'POST', signal: authDeadline() }),
  );
}

/**
 * POST /auth/github/token → a Felix bearer once the person has approved, or a
 * refusal. `authorization_pending` (428) is the usual answer and means "ask
 * again in `interval` seconds". Throws only offline.
 */
export async function redeemGitHubLogin(
  deviceCode: string,
  tenant?: string,
): Promise<LoginResult<GitHubLoginToken>> {
  return loginCall<GitHubLoginToken>(
    await fetch('/api/auth/github/token', {
      method: 'POST',
      signal: authDeadline(),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        tenant ? { device_code: deviceCode, tenant } : { device_code: deviceCode },
      ),
    }),
  );
}

/**
 * Where "Continue with GitHub" sends the browser: the harness's own redirect to GitHub, coming
 * back to `returnTo` (an origin the harness allows). A navigation, not a fetch — GitHub's sign-in
 * is a page, and the cookies that carry the sign-in's state are set on this origin on the way.
 */
export function githubAuthorizeUrl(returnTo: string, tenant?: string): string {
  const params = new URLSearchParams({ return_to: returnTo });
  if (tenant) params.set('tenant', tenant);
  return `/api/auth/github/authorize?${params.toString()}`;
}

/**
 * POST /auth/github/exchange → the token a redirect sign-in left waiting, once. The harness
 * holds it in an HttpOnly cookie for one page load and clears it on this call, so a reload or a
 * second call answers `expired_token`. Sends no credential: this is how the page gets one.
 */
export async function exchangeGitHubLogin(): Promise<LoginResult<GitHubLoginToken>> {
  return loginCall<GitHubLoginToken>(
    await fetch('/api/auth/github/exchange', {
      method: 'POST',
      credentials: 'same-origin',
      signal: authDeadline(),
    }),
  );
}

/**
 * Where "Continue with Google" sends the browser: the harness's redirect to Google, coming back
 * to `returnTo`. The same shape as `githubAuthorizeUrl`, without tenants: an account's tenant is
 * fixed by the operator's list.
 */
export function googleAuthorizeUrl(returnTo: string): string {
  return `/api/auth/google/authorize?${new URLSearchParams({ return_to: returnTo }).toString()}`;
}

/** POST /auth/google/exchange → the token a Google sign-in left waiting, once. */
export async function exchangeGoogleLogin(): Promise<LoginResult<GitHubLoginToken>> {
  return loginCall<GitHubLoginToken>(
    await fetch('/api/auth/google/exchange', {
      method: 'POST',
      credentials: 'same-origin',
      signal: authDeadline(),
    }),
  );
}

// --- Your GitHub connection and repositories (/github, /chat/sessions/{t}/workspace/repo) ---

export interface GitHubConnection {
  github_user_id: number;
  github_login: string;
  status: 'active' | 'revoked';
  created_at: number;
  updated_at: number;
  refresh_expires_at: number;
}

export interface GitHubConnectionState {
  connected: boolean;
  connection: GitHubConnection | null;
}

/** GET /github/connection → whether Felix holds a GitHub connection for you in this tenant. */
export async function getGitHubConnection(): Promise<GitHubConnectionState> {
  const res = await apiFetch('/api/github/connection');
  if (!res.ok) throw await problem(res, 'github connection');
  return (await res.json()) as GitHubConnectionState;
}

/**
 * DELETE /github/connection → forget your GitHub connection here and withdraw the App's grant at
 * GitHub. Your Felix sign-in is unaffected until it expires; this is what signing out also calls.
 */
export async function removeGitHubConnection(): Promise<void> {
  const res = await apiFetch('/api/github/connection', { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw await problem(res, 'remove github connection');
}

export interface GitHubRepo {
  full_name: string;
  private: boolean;
  archived: boolean;
  default_branch: string;
  /** Whether you can push to it (and it is not archived). */
  can_write: boolean;
  size_kb: number;
  installation_id: number | null;
}

export interface GitHubRepos {
  installations: Array<{
    id: number;
    account: string;
    account_type: string;
    repository_selection: string;
  }>;
  repositories: GitHubRepo[];
  /** More than one listing walks: filter by name instead. */
  truncated: boolean;
  /** Where to install the App on more repositories; null when the harness has no App slug. */
  install_url: string | null;
}

/** GET /github/repos → the repositories your GitHub App authorization reaches, filtered by `q`. */
export async function listMyRepos(q = ''): Promise<GitHubRepos> {
  // The `?` is in the template, not a variable, so the path is unambiguous to `check-api-drift`.
  const res = await apiFetch(`/api/github/repos?${new URLSearchParams(q ? { q } : {}).toString()}`);
  if (!res.ok) throw await problem(res, 'github repos');
  return (await res.json()) as GitHubRepos;
}

export interface ThreadRepo {
  state: 'cloning' | 'ready' | 'failed' | 'expired';
  repo: string;
  base: string;
  private: boolean;
  opened_by: string;
  created_at: number | null;
  error: string | null;
  branch: string | null;
  ahead: number | null;
  dirty: boolean | null;
}

/** POST /chat/sessions/{t}/workspace/repo → start cloning a repository into the thread's checkout. */
export async function openThreadRepo(
  threadSuffix: string,
  fullName: string,
  ref?: string,
): Promise<ThreadRepo> {
  const res = await apiFetch(
    `/api/chat/sessions/${encodeURIComponent(threadSuffix)}/workspace/repo`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ref ? { full_name: fullName, ref } : { full_name: fullName }),
    },
  );
  if (!res.ok) throw await problem(res, 'open repository');
  return (await res.json()) as ThreadRepo;
}

/** GET /chat/sessions/{t}/workspace/repo → the thread's checkout, or null when it has none. */
export async function getThreadRepo(threadSuffix: string): Promise<ThreadRepo | null> {
  const res = await apiFetch(
    `/api/chat/sessions/${encodeURIComponent(threadSuffix)}/workspace/repo`,
  );
  if (res.status === 404) return null;
  if (!res.ok) throw await problem(res, 'thread repository');
  return (await res.json()) as ThreadRepo;
}

/** One path in a thread's checkout, relative to its root. */
export interface ThreadRepoFile {
  path: string;
  /** `missing` is a path git knows (a staged deletion) with nothing on disk. A symlink is never followed. */
  kind: 'file' | 'symlink' | 'missing';
  size: number | null;
  status: 'clean' | 'modified' | 'added' | 'deleted' | 'untracked' | 'conflicted';
}

export interface ThreadRepoFiles {
  state: 'ready' | 'failed' | 'expired';
  files: ThreadRepoFile[];
  /** More paths than the limit; the harness cut the list. */
  truncated: boolean;
}

/**
 * GET /chat/sessions/{t}/workspace/repo/files → the checkout's tracked and untracked (not
 * ignored) files with their git status, or null when the thread has no checkout. A clone still
 * running is a 409 `checkout_cloning`, thrown as a `RepoRouteError`.
 */
export async function listThreadRepoFiles(threadSuffix: string): Promise<ThreadRepoFiles | null> {
  const res = await apiFetch(
    `/api/chat/sessions/${encodeURIComponent(threadSuffix)}/workspace/repo/files`,
  );
  if (res.status === 404) return null;
  if (!res.ok) throw await problem(res, 'repository files');
  return (await res.json()) as ThreadRepoFiles;
}

/** DELETE /chat/sessions/{t}/workspace/repo → remove the thread's checkout. */
export async function removeThreadRepo(threadSuffix: string): Promise<void> {
  const res = await apiFetch(
    `/api/chat/sessions/${encodeURIComponent(threadSuffix)}/workspace/repo`,
    {
      method: 'DELETE',
    },
  );
  if (!res.ok && res.status !== 404) throw await problem(res, 'remove repository');
}

/**
 * A refusal from the GitHub and repo routes, carrying the harness's code (`github_not_connected`,
 * `repository_too_large`, …) so a caller can act on it rather than parse prose.
 */
export class RepoRouteError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RepoRouteError';
  }
}

async function problem(res: Response, what: string): Promise<RepoRouteError> {
  const body = (await res.json().catch(() => null)) as {
    error?: string;
    message?: string;
    detail?: string;
  } | null;
  const code =
    body?.error ?? (typeof body?.detail === 'string' ? body.detail : `http_${res.status}`);
  return new RepoRouteError(res.status, code, body?.message ?? `${what}: ${res.status}`);
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
): Promise<EvalDataset & { warnings?: string[] }> {
  // `warnings` rides alongside the stored dataset on a 200: an item whose rubric
  // names no rule and no judge is legal, is stored, and will pass any non-blank
  // answer — which the harness says out loud here and nowhere else.
  return evalFetch<EvalDataset & { warnings?: string[] }>(`/datasets/${encodeURIComponent(name)}`, {
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
): Promise<EvalDataset & { warnings?: string[] }> {
  const current = await getEvalDataset(dataset);
  const items = [
    ...current.items.map((i) => ({ user_input: i.user_input, rubric: i.rubric })),
    item,
  ];
  return putEvalDataset(dataset, current.description ?? '', items);
}

/**
 * POST /eval/runs → replay the dataset against a manifest and judge each item.
 * Returns the summary; per-item scores come back via getEvalRun(run_id).
 * `deterministic_judge` skips the LLM judge and scores with rubric heuristics
 * only — the path CI uses.
 *
 * `POST /eval/datasets/{name}/run` starts the same run and is what this called
 * until `felix-run/felix#570` deprecated it (`Deprecation` + a `Link` to this
 * route). This one has been served since the harness's first release, so no
 * harness needs the old one.
 */
export async function runEvalDataset(
  dataset: string,
  candidateManifest: string,
  deterministicJudge = false,
  /** A stored version to run instead of the active one — how an inactive one is tried first. */
  manifestVersion?: number,
): Promise<EvalRunSummary> {
  return evalFetch<EvalRunSummary>('/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      dataset_name: dataset,
      candidate_manifest: candidateManifest,
      ...(manifestVersion ? { manifest_version: manifestVersion } : {}),
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
// `GET /manifests` returns active pointers; `GET /manifests/{name}/versions` lists a
// manifest's stored versions (metadata only), and one version's body is read with
// `GET /manifests/{name}?version=N`.

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
 * GET /manifests/{name}/versions → stored versions, newest first, without their
 * manifests. Page with `before` (the last version seen); the harness answers
 * `next_before: null` on the last page, and an empty list under
 * `FELIX_BUNDLED_ONLY`.
 */
export async function listManifestVersions(
  name: string,
  opts: { limit?: number; before?: number } = {},
): Promise<ManifestVersionPage> {
  const q = new URLSearchParams();
  if (opts.limit) q.set('limit', String(opts.limit));
  if (opts.before) q.set('before', String(opts.before));
  // Typed whole and read partially, and the query after a literal `?`: check-api-drift
  // reads one level of `<…>`, and a bare `${suffix}` after the path as one more segment.
  const body: Partial<ManifestVersionPage> = await manifestFetch<ManifestVersionPage>(
    `/${encodeURIComponent(name)}/versions?${q}`,
  );
  return { items: body.items ?? [], next_before: body.next_before ?? null };
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
 * PUT /manifests/{name} → append a new version. It does **not** move the active
 * pointer (`POST …/rollback` does) — except for a manifest's first version, which
 * is the only one there is. The body's `metadata.name` must equal `name` or the
 * harness answers 400 `name_mismatch`. The row carries `warnings` (felix#591).
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
// schedule — which needs felix-scheduler running alongside felix-worker.
// `runJobNow` fires one at once, in the API process, without the schedule.

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

/** PUT /jobs/{name} → create or update a job. Empty `schedule` = every 60s (`lib/job-schedule.ts`). */
export async function upsertJob(job: {
  name: string;
  schedule?: string;
  manifest_id?: string;
  /** A workflow to run instead of an agent (`felix-run/felix#642`); never with `manifest_id`. */
  workflow_id?: string;
  /**
   * The revision the writer reviewed: the save is refused (`412 workflow_changed`) unless it is
   * still current. Left out, the job is pinned to whatever is current now.
   */
  workflow_revision?: string;
  payload?: Record<string, unknown>;
  enabled?: boolean;
}): Promise<JobRecord> {
  const { name, schedule = '', manifest_id = '', payload = {}, enabled = true } = job;
  // The workflow keys only when set: `JobUpsert` forbids extra fields, so a harness older
  // than workflow jobs would refuse every write that carried them, even empty.
  const workflow = job.workflow_id
    ? {
        workflow_id: job.workflow_id,
        ...(job.workflow_revision ? { workflow_revision: job.workflow_revision } : {}),
      }
    : {};
  return jobsFetch<JobRecord>(`/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ schedule, manifest_id, ...workflow, payload, enabled }),
  });
}

/** GET /jobs/{name}/runs → recent runs of one job, newest first. */
export async function listJobRuns(name: string, limit = 20): Promise<JobRun[]> {
  const body = await jobsFetch<{ items?: JobRun[] }>(
    `/${encodeURIComponent(name)}/runs?limit=${limit}`,
  );
  return body.items ?? [];
}

/**
 * POST /jobs/{name}/run → run a job now and wait for it: the response is the finished run,
 * recorded like a scheduled one but `trigger: manual`. Runs a disabled job too, and leaves the
 * schedule alone. Needs `jobs:write`.
 */
export async function runJobNow(name: string): Promise<JobRun> {
  return jobsFetch<JobRun>(`/${encodeURIComponent(name)}/run`, { method: 'POST' });
}

/** DELETE /jobs/{name} → remove a job from the registry. */
export async function deleteJob(name: string): Promise<void> {
  await jobsFetch<{ status: string }>(`/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

// --- Authored workflows (/workflows) ---

/** A refused workflow request, with the harness's own error code (`not_runnable`, `bad_inputs`,
 * `workflow_changed`, `too_many_runs`, `not_permitted`) when it sent one. */
export class WorkflowRouteError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail: unknown,
  ) {
    super(`workflows: ${status} ${code}`);
    this.name = 'WorkflowRouteError';
  }
}

/** A refused workflow response as the error it is, with the harness's own code. */
async function workflowRefusal(res: Response): Promise<WorkflowRouteError> {
  const parsed = await res.json().catch(() => null);
  const detail =
    parsed && typeof parsed === 'object' ? (parsed as { detail?: unknown }).detail : undefined;
  const code =
    typeof detail === 'string'
      ? detail
      : detail &&
          typeof detail === 'object' &&
          typeof (detail as { error?: unknown }).error === 'string'
        ? (detail as { error: string }).error
        : `http_${res.status}`;
  return new WorkflowRouteError(res.status, code, detail);
}

async function workflowsFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<{ body: T; res: Response }> {
  const res = await apiFetch(`/api/workflows${path}`, init);
  if (!res.ok) {
    throw await workflowRefusal(res);
  }
  return { body: (await res.json()) as T, res };
}

/** GET /workflows → the tenant's workflows, without their definitions. */
export async function listWorkflows(): Promise<WorkflowSummary[]> {
  const { body } = await workflowsFetch<{ items?: WorkflowSummary[] }>('');
  return body.items ?? [];
}

/** GET /workflows/{id} → the definition, its ports and problems. */
export async function getWorkflow(id: string): Promise<WorkflowRecord> {
  const { body } = await workflowsFetch<WorkflowRecord>(`/${encodeURIComponent(id)}`);
  return body;
}

/**
 * PUT /workflows/{id} → save a definition whole. `revision` saves only over that revision
 * (`If-Match`); `create` only where no workflow is (`If-None-Match: *`). A miss is a
 * `WorkflowRouteError` coded `workflow_changed` whose `detail.current` is the workflow as it now
 * stands, or null when it was deleted.
 */
export async function saveWorkflow(
  id: string,
  definition: WorkflowDefinition,
  precondition: { revision: string } | { create: true },
): Promise<WorkflowRecord> {
  const condition: Record<string, string> =
    'create' in precondition
      ? { 'if-none-match': '*' }
      : { 'if-match': `"${precondition.revision}"` };
  const { body } = await workflowsFetch<WorkflowRecord>(`/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...condition },
    body: JSON.stringify(definition),
  });
  return body;
}

/** DELETE /workflows/{id}, only at `revision`: a co-author's save since is a 412. */
export async function deleteWorkflow(id: string, revision: string): Promise<void> {
  await workflowsFetch<unknown>(`/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'if-match': `"${revision}"` },
  });
}

/** POST /workflows/-/check → a draft's ports and problems, without saving it. */
export async function checkWorkflow(
  definition: WorkflowDefinition,
  signal?: AbortSignal,
): Promise<WorkflowCheck> {
  const { body } = await workflowsFetch<WorkflowCheck>('/-/check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(definition),
    ...(signal ? { signal } : {}),
  });
  return body;
}

/** GET /workflows/-/kinds → the step kinds this harness can run: the palette. */
export async function listWorkflowKinds(): Promise<WorkflowKind[]> {
  const { body } = await workflowsFetch<{ items?: WorkflowKind[] }>('/-/kinds');
  return body.items ?? [];
}

/** GET /workflows/-/tools?manifest= → what a tool step naming `manifest` can call. */
export async function listWorkflowTools(manifest: string): Promise<WorkflowTool[]> {
  const { body } = await workflowsFetch<{ items?: WorkflowTool[] }>(
    `/-/tools?${new URLSearchParams({ manifest })}`,
  );
  return body.items ?? [];
}

/** GET /workflows/{id}/runs → newest first, each with its steps' statuses. */
export async function listWorkflowRuns(id: string, limit = 50): Promise<WorkflowRunSummary[]> {
  const { body } = await workflowsFetch<{ items?: WorkflowRunSummary[] }>(
    `/${encodeURIComponent(id)}/runs?limit=${limit}`,
  );
  return body.items ?? [];
}

/** GET /workflows/{id}/runs/{run_id} → every step's state. Polled while the run is live. */
export async function getWorkflowRun(id: string, runId: string): Promise<WorkflowRun> {
  const { body } = await workflowsFetch<WorkflowRun>(
    `/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}`,
  );
  return body;
}

/**
 * GET /workflows/{id}/runs/{run_id}/steps/{step_id}/thread → the snapshot of the step's child
 * run, as `GET /chat/sessions/{id}` answers one. Read here because no chat route can address a
 * step's thread; a 404 is a step with no thread yet.
 */
export async function getWorkflowStepThread(
  id: string,
  runId: string,
  stepId: string,
): Promise<SessionSnapshot> {
  const { body } = await workflowsFetch<SessionSnapshot>(
    `/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepId)}/thread`,
  );
  return body;
}

/**
 * GET /workflows/{id}/runs/{run_id}/stream → each new version of the run's record, handed to
 * `onRun` as it lands. `after` is the version already held: the stream starts past it.
 *
 * Resolves `true` once the run is over (the stream's `[DONE]`), `false` if the connection ended
 * first, so the caller reconnects from the last version it saw. A refusal throws the
 * `WorkflowRouteError` a read would; an error the harness reports mid-stream throws its message.
 */
export async function watchWorkflowRun(
  id: string,
  runId: string,
  {
    after,
    signal,
    onRun,
  }: { after?: number | null; signal: AbortSignal; onRun: (run: WorkflowRun) => void },
): Promise<boolean> {
  const res = await apiFetch(
    `/api/workflows/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}/stream`,
    { signal, headers: after == null ? {} : { 'last-event-id': String(after) } },
  );
  if (!res.ok) throw await workflowRefusal(res);
  let failed: string | null = null;
  const finished = await readSseStream(res, (ev) => {
    if (ev.event === 'workflow_run') onRun(ev.data as unknown as WorkflowRun);
    else if (ev.event === 'on_error') failed = String(ev.data.message ?? 'the run stream failed');
  });
  if (failed) throw new Error(failed);
  return finished;
}

/**
 * POST /workflows/{id}/runs → start a run on `revision` (the one the caller is looking at: a
 * co-author's save since is a 412 `workflow_changed`, not a run of something unseen).
 */
export async function startWorkflowRun(
  id: string,
  inputs: Record<string, unknown>,
  revision: string,
): Promise<WorkflowRun> {
  const { body } = await workflowsFetch<WorkflowRun>(`/${encodeURIComponent(id)}/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ inputs, revision }),
  });
  return body;
}

/** POST /workflows/{id}/runs/{run_id}/cancel → `cancelling` until what is in flight stops. */
export async function cancelWorkflowRun(id: string, runId: string): Promise<WorkflowRun> {
  const { body } = await workflowsFetch<WorkflowRun>(
    `/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}/cancel`,
    { method: 'POST' },
  );
  return body;
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

// --- Web Push (/push) ---
//
// Every route needs `approvals:read`, the scope the approval frames need: a subscription is a
// standing request to be told when a run is waiting on a person. A 503 means the deployment
// has no VAPID key and does not push at all, which is not an error to report.

/** GET /push/vapid-public-key → the key a browser subscribes with, or `null` when push is off. */
export async function getPushPublicKey(): Promise<string | null> {
  const res = await apiFetch('/api/push/vapid-public-key');
  if (res.status === 503) return null;
  if (!res.ok) throw new Error(`push key: ${res.status}`);
  const body = (await res.json()) as { public_key?: string };
  return body.public_key ?? null;
}

/** POST /push/subscriptions → register (or refresh) this browser. Idempotent on the endpoint. */
export async function subscribePush(subscription: PushSubscriptionJSON): Promise<void> {
  const res = await apiFetch('/api/push/subscriptions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(subscription),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`push subscribe: ${res.status} ${detail.slice(0, 200)}`);
  }
}

/** DELETE /push/subscriptions → forget this browser. Answered even when push is off. */
export async function unsubscribePush(endpoint: string): Promise<void> {
  const res = await apiFetch('/api/push/subscriptions', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  });
  if (!res.ok) throw new Error(`push unsubscribe: ${res.status}`);
}
