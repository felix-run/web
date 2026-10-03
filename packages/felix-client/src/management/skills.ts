/**
 * The tenant skill library (`/skill-library`): every skill an agent drafted
 * (`create_skill`, `update_skill`) or an operator saved, each version's review
 * record, and the verbs that move a version between draft, published and
 * archived.
 *
 * Not `/skills/{manifest}`, which answers "what can this manifest's model
 * reach". This answers "what is in the library, and what is waiting on a
 * person". Collection-wide reads sit under `/-/` (`/-/review`, `/-/policy`)
 * because `-` can never be a skill name, so every name stays addressable.
 *
 * Reads need `skills:read`; anything that changes the library needs
 * `skills:write`. A 403 is therefore a narrow key, not a missing skill — the
 * same distinction `describeError` draws for every other surface.
 *
 * **Refusals are structured, so they are thrown structured.** Every other
 * module here throws `` `${route}: ${status}` `` and lets `describeError` turn
 * the status into copy, which is right when the status is the whole story. Here
 * it is not: a 409 is `parent_changed` (someone saved a newer version — offer a
 * merge) or `version_conflict` or `skill_exists`, and a 422 is either a bundle
 * that will never validate (with `issues`) or a publish the gate refused (with
 * `reasons`). Those need different screens, so `SkillLibraryError` carries the
 * parsed body. Its `message` still starts `skill-library: <status>`, so
 * `describeError` keeps working for a caller that only wants a sentence.
 *
 * **Every text field is someone else's writing.** Descriptions, reasons,
 * decision notes and file bodies are agent- or operator-written, and the
 * harness secret-redacts them on the way out, so `[REDACTED]` can appear in any
 * of them. A renderer treats all of it as untrusted text.
 */

import type { FelixHttp } from '../http';

/** The harness's global request-body cap (`CORE_BODY_LIMIT_BYTES`), 1 MiB. */
export const REQUEST_BODY_LIMIT_BYTES = 1024 * 1024;

export type SkillStatus = 'draft' | 'published' | 'archived';
export type SkillSource = 'agent' | 'operator';
export type SecurityStatus = 'pass' | 'advisory' | 'fail';
export type SecuritySeverity = 'low' | 'medium' | 'high' | 'critical';
export type SkillBump = 'patch' | 'minor' | 'major';

export interface ReviewCheck {
  id: string;
  label: string;
  passed: boolean;
  message: string;
  weight: number;
}

export interface SkillSecurityIssue {
  severity: SecuritySeverity;
  path: string;
  message: string;
  rule_id?: string | null;
}

export interface BundleIssue {
  path: string;
  message: string;
}

/** A skill's newest version, as the listing shows it. */
export interface SkillVersionHead {
  version: string;
  status: SkillStatus;
  source: SkillSource;
  quality_score: number;
  security_status: SecurityStatus;
  created_at: number;
}

export interface SkillSummary {
  name: string;
  live_version: string | null;
  latest: SkillVersionHead | null;
  pending_drafts: number;
  /**
   * An operator upload exists under this name at a key a manifest ref reads: an
   * unpinned ref gets the library's live version, while a ref pinning the
   * upload's version still gets the upload. Worth saying wherever it is set.
   */
  shadows_operator_upload: boolean;
  created_by: string;
  created_at: number;
  updated_at: number;
}

export interface SkillPage<T> {
  items: T[];
  /**
   * Pass back as `cursor`; null on the last page. The listing filters a page
   * after reading it, so a page can be short — even empty — and still have a
   * next one. Follow it until null.
   */
  next_cursor: string | null;
}

/** One version's review record, without its review detail or files. */
export interface SkillVersion {
  name: string;
  version: string;
  parent_version: string | null;
  status: SkillStatus;
  source: SkillSource;
  author: string;
  origin_manifest_id: string | null;
  session_id: string | null;
  reason: string;
  description: string;
  quality_score: number;
  security_status: SecurityStatus;
  decided_by: string | null;
  decision_note: string | null;
  created_at: number;
  decided_at: number | null;
  published_at: number | null;
}

export interface SkillFileMeta {
  path: string;
  sha256: string;
  size: number;
}

export interface SkillVersionDetail extends SkillVersion {
  review_checks: ReviewCheck[];
  security_issues: SkillSecurityIssue[];
  files: SkillFileMeta[];
  shadows_operator_upload: boolean;
}

export interface SkillDetail {
  name: string;
  live_version: string | null;
  created_by: string;
  created_at: number;
  updated_at: number;
  shadows_operator_upload: boolean;
  /** Newest first. */
  versions: SkillVersion[];
}

export interface ReviewQueueItem extends SkillVersion {
  /** The skill's live version, to diff the draft against; null when nothing is live. */
  live_version: string | null;
}

export interface SkillFile {
  path: string;
  /** `base64` for a binary asset under `assets/`; `utf-8` text otherwise, secret-redacted. */
  encoding: 'utf-8' | 'base64';
  content_type: string;
  content: string;
  sha256: string;
  size: number;
}

/** What a publish of a version's bytes would be decided on today. Changes nothing. */
export interface SkillPreview {
  name: string;
  version: string;
  status: SkillStatus;
  valid: boolean;
  validation_issues: BundleIssue[];
  quality_score: number | null;
  review_checks: ReviewCheck[];
  security_status: SecurityStatus | null;
  security_issues: SkillSecurityIssue[];
  /**
   * Whether the gate would let these bytes through — not whether the version's
   * state allows a publish: only a draft publishes, and only a once-published
   * version rolls back.
   */
  policy_passes: boolean;
  reasons: string[];
}

export interface SkillPolicy {
  min_quality: number;
  block_on_advisory: boolean;
  security_fail_blocks: boolean;
  source: string;
}

/** Every refusal the library sends. */
export interface SkillRefusal {
  error: string;
  message: string;
  issues?: BundleIssue[] | null;
  reasons?: string[] | null;
}

export interface SkillWriteResult extends SkillVersionDetail {
  published: boolean;
  /**
   * Why the publish asked for in the same request did not happen, or null. The
   * draft is saved either way.
   */
  publish_blocked: SkillRefusal | null;
}

export interface SkillArchived {
  name: string;
  live_version: string | null;
}

export interface SkillBundleWrite {
  files: Record<string, string>;
  reason?: string;
  publish?: boolean;
}

export interface SkillVersionWrite extends SkillBundleWrite {
  /** The newest version the editor loaded. A newer one saved since is a 409 `parent_changed`. */
  parent_version: string;
  /** An explicit version; else the newest bumped by `bump` (default patch). Not both. */
  version?: string;
  bump?: SkillBump;
}

/**
 * A refusal from the library, with its parsed body.
 *
 * `code` is the harness's stable string (`parent_changed`, `publish_blocked`,
 * `invalid_bundle`, …) or `payload_too_large` for the 413 the body-limit
 * middleware answers before the route ever runs.
 */
export class SkillLibraryError extends Error {
  readonly status: number;
  readonly code: string;
  readonly refusal: SkillRefusal | null;

  constructor(route: string, status: number, refusal: SkillRefusal | null, raw = '') {
    const code = refusal?.error ?? 'error';
    const said = refusal?.message ?? raw.slice(0, 200);
    super(`${route}: ${status} ${code}${said ? `: ${said}` : ''}`);
    this.name = 'SkillLibraryError';
    this.status = status;
    this.code = code;
    this.refusal = refusal;
  }
}

export function isSkillLibraryError(err: unknown): err is SkillLibraryError {
  return err instanceof SkillLibraryError;
}

/** The two refusals that mean "the library moved on under you": reload or merge. */
export function isStaleWrite(err: unknown): err is SkillLibraryError {
  return (
    isSkillLibraryError(err) && (err.code === 'parent_changed' || err.code === 'version_conflict')
  );
}

const encoder = new TextEncoder();

/**
 * A request body's size, measured as the harness measures it — bytes of the
 * serialised JSON. Base64 assets and escaped text make that larger than the
 * files' own sizes, so the files' total is not a substitute.
 */
export function requestBodyBytes(body: unknown): number {
  return encoder.encode(JSON.stringify(body)).length;
}

function tooLarge(route: string, bytes: number): SkillLibraryError {
  const mib = (n: number) => `${(n / (1024 * 1024)).toFixed(2)} MiB`;
  return new SkillLibraryError(route, 413, {
    error: 'payload_too_large',
    message:
      `This save is ${mib(bytes)} as sent, and the harness refuses any request over ` +
      `${mib(REQUEST_BODY_LIMIT_BYTES)}. Remove or shrink a large file (base64 assets ` +
      'grow by a third on the wire) and save again.',
  });
}

/** The harness's skill-name rule: lowercase words joined by single hyphens, at most 64. */
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION_RE = /^\d+\.\d+\.\d+$/;

/**
 * A name, version or path the client refused to put in a URL. Nothing the
 * harness would accept fails these checks, so one reaching here came from a
 * link, a tool result or a typo — and a `..` segment that reached `fetch` would
 * be normalised into a different route entirely.
 */
function badAddress(what: string, value: string): SkillLibraryError {
  return new SkillLibraryError('skill-library', 400, {
    error: 'invalid_address',
    message: `${JSON.stringify(value.slice(0, 80))} is not a valid skill ${what}`,
  });
}

function nameSegment(name: string): string {
  if (name.length > 64 || !SKILL_NAME_RE.test(name)) throw badAddress('name', name);
  return name;
}

function versionSegment(version: string): string {
  if (version.length > 32 || !VERSION_RE.test(version)) throw badAddress('version', version);
  return version;
}

/** Path segments encoded one at a time, so a bundle path keeps its slashes and never climbs. */
function encodePath(path: string): string {
  const segments = path.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..') || path.includes('\\')) {
    throw badAddress('file path', path);
  }
  return segments.map(encodeURIComponent).join('/');
}

/** Whether `name` is one the library could hold — for a caller deciding before it asks. */
export function isSkillName(name: string): boolean {
  return name.length <= 64 && SKILL_NAME_RE.test(name);
}

async function refusalOf(route: string, res: Response): Promise<SkillLibraryError> {
  const raw = await res.text().catch(() => '');
  let refusal: SkillRefusal | null = null;
  try {
    const parsed = JSON.parse(raw) as Partial<SkillRefusal> & { detail?: unknown };
    if (typeof parsed.error === 'string') {
      refusal = {
        error: parsed.error,
        message:
          typeof parsed.message === 'string'
            ? parsed.message
            : parsed.error === 'payload_too_large'
              ? `The harness refused a request over ${REQUEST_BODY_LIMIT_BYTES / (1024 * 1024)} MiB.`
              : parsed.error,
        issues: parsed.issues ?? null,
        reasons: parsed.reasons ?? null,
      };
    } else if (parsed.detail !== undefined) {
      // FastAPI's own 422 for a body that failed the request model.
      refusal = { error: 'invalid_request', message: JSON.stringify(parsed.detail).slice(0, 400) };
    }
  } catch {
    // Not JSON: a proxy's page, or nothing. The raw text goes in the message.
  }
  return new SkillLibraryError(route, res.status, refusal, raw);
}

export function createSkillLibraryClient(http: FelixHttp) {
  const { chatFetch } = http;

  async function read<T>(route: string, res: Response): Promise<T> {
    if (!res.ok) throw await refusalOf(route, res);
    return (await res.json()) as T;
  }

  /** GET /skill-library → one page of skills by name. */
  async function listLibrarySkills(
    opts: {
      status?: 'live' | 'draft' | 'archived';
      source?: SkillSource;
      limit?: number;
      cursor?: string | null;
    } = {},
  ): Promise<SkillPage<SkillSummary>> {
    const q = new URLSearchParams();
    if (opts.status) q.set('status', opts.status);
    if (opts.source) q.set('source', opts.source);
    q.set('limit', String(Math.min(100, Math.max(1, opts.limit ?? 50))));
    if (opts.cursor) q.set('cursor', opts.cursor);
    const page = await read<SkillPage<SkillSummary>>(
      'skill-library',
      await chatFetch(`/skill-library?${q}`),
    );
    return { items: page.items ?? [], next_cursor: page.next_cursor ?? null };
  }

  /** GET /skill-library/-/review → drafts across every skill, oldest first. */
  async function listSkillReviewQueue(
    opts: { limit?: number; cursor?: string | null } = {},
  ): Promise<SkillPage<ReviewQueueItem>> {
    const q = new URLSearchParams();
    q.set('limit', String(Math.min(100, Math.max(1, opts.limit ?? 50))));
    if (opts.cursor) q.set('cursor', opts.cursor);
    const page = await read<SkillPage<ReviewQueueItem>>(
      'skill-library/review',
      await chatFetch(`/skill-library/-/review?${q}`),
    );
    return { items: page.items ?? [], next_cursor: page.next_cursor ?? null };
  }

  /** GET /skill-library/-/policy → the gate every publish and rollback passes. */
  async function getSkillPublishPolicy(): Promise<SkillPolicy> {
    return read('skill-library/policy', await chatFetch('/skill-library/-/policy'));
  }

  /** GET /skill-library/{name} → the skill and every version, newest first. */
  async function getLibrarySkill(name: string): Promise<SkillDetail> {
    return read('skill-library/skill', await chatFetch(`/skill-library/${nameSegment(name)}`));
  }

  /** GET /skill-library/{name}/versions/{v} → review record, checks, issues, file digests. */
  async function getSkillVersion(name: string, version: string): Promise<SkillVersionDetail> {
    return read(
      'skill-library/version',
      await chatFetch(`/skill-library/${nameSegment(name)}/versions/${versionSegment(version)}`),
    );
  }

  /** GET …/files/{path} → one file, checked against its saved digest. */
  async function getSkillFile(name: string, version: string, path: string): Promise<SkillFile> {
    return read(
      'skill-library/file',
      await chatFetch(
        `/skill-library/${nameSegment(name)}/versions/${versionSegment(version)}/files/${encodePath(path)}`,
      ),
    );
  }

  /** GET …/preview → re-run review, the scan and the policy on the stored bytes. Read-only. */
  async function previewSkillVersion(name: string, version: string): Promise<SkillPreview> {
    return read(
      'skill-library/preview',
      await chatFetch(
        `/skill-library/${nameSegment(name)}/versions/${versionSegment(version)}/preview`,
      ),
    );
  }

  /**
   * Every file of a version, as the `path → content` record the editor and
   * the save both use. Binary assets stay base64, as the save expects them.
   *
   * Fetched a few at a time: a bundle holds up to 200 files, and two hundred
   * requests at once is a burst the rate limiter answers with 429.
   */
  async function readSkillBundle(
    name: string,
    version: string,
    known?: SkillFileMeta[],
  ): Promise<{ files: Record<string, string>; meta: SkillFile[] }> {
    const listed = known ?? (await getSkillVersion(name, version)).files;
    const meta: SkillFile[] = new Array(listed.length);
    let next = 0;
    const worker = async () => {
      while (next < listed.length) {
        const i = next++;
        const entry = listed[i];
        if (entry) meta[i] = await getSkillFile(name, version, entry.path);
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, listed.length) }, worker));
    return { files: Object.fromEntries(meta.map((f) => [f.path, f.content])), meta };
  }

  /**
   * The serialised body of a write, or the refusal it would get. Measured
   * before sending: the 413 the harness answers says nothing about how far over
   * the save was, and a refused 4 MiB upload is a wasted 4 MiB.
   *
   * Each write still passes its own path literal and `method` to `chatFetch`,
   * because that literal is what `check-api-drift` reads; a shared helper taking
   * the path as a variable would silently drop these routes from the check.
   */
  function sized(route: string, body: unknown): RequestInit {
    const bytes = requestBodyBytes(body);
    if (bytes > REQUEST_BODY_LIMIT_BYTES) throw tooLarge(route, bytes);
    return { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  }

  /** POST /skill-library → a new skill as an operator draft (0.1.0); 409 `skill_exists` if taken. */
  async function createLibrarySkill(input: SkillBundleWrite): Promise<SkillWriteResult> {
    const init = sized('skill-library/create', {
      files: input.files,
      reason: input.reason ?? '',
      publish: input.publish ?? false,
    });
    return read(
      'skill-library/create',
      await chatFetch('/skill-library', { method: 'POST', ...init }),
    );
  }

  /** PUT /skill-library/{name}/versions → a new version edited from `parent_version`. */
  async function saveSkillVersion(
    name: string,
    input: SkillVersionWrite,
  ): Promise<SkillWriteResult> {
    const body: Record<string, unknown> = {
      files: input.files,
      parent_version: input.parent_version,
      reason: input.reason ?? '',
      publish: input.publish ?? false,
    };
    // One way to number the version: the harness refuses both at once.
    if (input.version) body.version = input.version;
    else if (input.bump) body.bump = input.bump;
    const init = sized('skill-library/save', body);
    return read(
      'skill-library/save',
      await chatFetch(`/skill-library/${nameSegment(name)}/versions`, {
        method: 'PUT',
        ...init,
      }),
    );
  }

  /** POST …/publish → the draft goes live; 422 `publish_blocked` with the gate's reasons. */
  async function publishSkillVersion(name: string, version: string): Promise<SkillVersion> {
    return read(
      'skill-library/publish',
      await chatFetch(
        `/skill-library/${nameSegment(name)}/versions/${versionSegment(version)}/publish`,
        { method: 'POST' },
      ),
    );
  }

  /** POST …/rollback → a once-live version live again, through the same gate. */
  async function rollbackSkillVersion(name: string, version: string): Promise<SkillVersion> {
    return read(
      'skill-library/rollback',
      await chatFetch(
        `/skill-library/${nameSegment(name)}/versions/${versionSegment(version)}/rollback`,
        { method: 'POST' },
      ),
    );
  }

  /** POST …/reject → archive a draft unpublished, recording why. The note is required. */
  async function rejectSkillVersion(
    name: string,
    version: string,
    note: string,
  ): Promise<SkillVersion> {
    return read(
      'skill-library/reject',
      await chatFetch(
        `/skill-library/${nameSegment(name)}/versions/${versionSegment(version)}/reject`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ note }),
        },
      ),
    );
  }

  /** DELETE /skill-library/{name} → out of every catalog; versions kept, and a rollback restores one. */
  async function archiveLibrarySkill(name: string): Promise<SkillArchived> {
    return read(
      'skill-library/archive',
      await chatFetch(`/skill-library/${nameSegment(name)}`, { method: 'DELETE' }),
    );
  }

  return {
    listLibrarySkills,
    listSkillReviewQueue,
    getSkillPublishPolicy,
    getLibrarySkill,
    getSkillVersion,
    getSkillFile,
    previewSkillVersion,
    readSkillBundle,
    createLibrarySkill,
    saveSkillVersion,
    publishSkillVersion,
    rollbackSkillVersion,
    rejectSkillVersion,
    archiveLibrarySkill,
  };
}
