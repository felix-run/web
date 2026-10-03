/**
 * The skill library's quality loop (`/skill-library` feedback, evaluations and
 * the tenant's publish policy) — the half of the operator surface that decides
 * whether a version is any *good*, where `skills.ts` decides what is live.
 *
 * - **Feedback** is filed by a person (here) or by an agent, and waits as
 *   `pending` until someone accepts or rejects it. Accepting with `improve`
 *   queues an AI rewrite the worker runs into a *draft* — it never publishes.
 * - **Evaluations** answer each scenario with and without the skill, score
 *   both 0-100 with a judge, and report the uplift. The worker runs them within
 *   a minute of being queued; nothing here can run one faster.
 * - **The policy** is the publish gate. The deployment's settings are a floor a
 *   tenant can raise and never lower.
 *
 * Refusals are `SkillLibraryError`, as in `skills.ts`, and every URL segment is
 * checked the same way before it is built. Every text field — a feedback body,
 * a patch, a judge's reason, an error — is someone else's writing, redacted by
 * the harness, and is rendered as text.
 */

import type { FelixHttp } from '../http';
import {
  badAddress,
  nameSegment,
  refusalOf,
  type SkillPage,
  type SkillPolicy,
  type SkillPolicyValues,
  versionSegment,
} from './skills';

export type FeedbackStatus = 'pending' | 'accepted' | 'rejected' | 'applied' | 'failed';
export type FeedbackSource = 'human' | 'agent';
export type EvalStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export type ScenarioSource = 'bundle' | 'generated' | 'default';

export interface SkillFeedback {
  id: string;
  name: string;
  target_version: string;
  source: FeedbackSource;
  /** The manifest id for an agent's feedback, the principal for a person's. */
  author: string;
  principal: string | null;
  body: string;
  suggested_patch: string | null;
  /**
   * `pending` until a person decides. `accepted` with `improve` waits for the
   * worker, which moves it to `applied` (with `result_version`, a draft) or
   * `failed` (with `error`). `accepted` without `improve` and `rejected` are final.
   */
  status: FeedbackStatus;
  improve: boolean;
  result_version: string | null;
  model: string | null;
  error: string | null;
  created_at: number;
  claimed_at: number | null;
  heartbeat_at: number | null;
  /** Times the worker took the improvement; it fails `attempts_exhausted` after 3. */
  attempts: number;
  decided_at: number | null;
  decided_by: string | null;
  decision_note: string | null;
}

export interface EvalScenario {
  name: string;
  prompt: string;
  criteria: string;
}

export interface EvalScenarioResult {
  name: string;
  baseline_score: number;
  with_skill_score: number;
  uplift: number;
  baseline_reason: string;
  with_skill_reason: string;
}

export interface SkillEval {
  id: string;
  name: string;
  version: string;
  status: EvalStatus;
  /** Where the scenarios came from; null until it runs. */
  scenario_source: ScenarioSource | null;
  scenarios: EvalScenario[];
  /** 0-100 from the judge; null until it has succeeded. */
  baseline_score: number | null;
  with_skill_score: number | null;
  uplift: number | null;
  results: EvalScenarioResult[];
  model: string | null;
  judge_model: string | null;
  error: string | null;
  requested_by: string;
  created_at: number;
  started_at: number | null;
  heartbeat_at: number | null;
  attempts: number;
  finished_at: number | null;
  /**
   * Whether this evaluation can satisfy `require_eval` / `min_eval_uplift`:
   * only a succeeded one can, and for an agent's version only one on the
   * bundle's own `evals/` scenarios. `gate_note` says why not.
   */
  counts_for_gate: boolean;
  gate_note: string;
}

/** The fields of a policy PATCH. Only `min_eval_uplift` takes null (no floor). */
export type SkillPolicyPatch = Partial<Omit<SkillPolicyValues, 'min_eval_uplift'>> & {
  min_eval_uplift?: number | null;
};

const ROW_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function idSegment(id: string): string {
  if (!ROW_ID_RE.test(id)) throw badAddress('row id', id);
  return id;
}

const JSON_HEADERS = { 'content-type': 'application/json' };

export function createSkillQualityClient(http: FelixHttp) {
  const { chatFetch } = http;

  async function read<T>(route: string, res: Response): Promise<T> {
    if (!res.ok) throw await refusalOf(route, res);
    return (await res.json()) as T;
  }

  const page = <T>(p: SkillPage<T>): SkillPage<T> => ({
    items: p.items ?? [],
    next_cursor: p.next_cursor ?? null,
  });

  /** GET /skill-library/-/policy → the gate every publish and rollback passes. */
  async function getSkillPublishPolicy(): Promise<SkillPolicy> {
    return read('skill-library/policy', await chatFetch('/skill-library/-/policy'));
  }

  /**
   * PATCH /skill-library/-/policy → set the tenant's own fields; returns the
   * policy in force, which a looser value does not loosen. A field left out
   * keeps its value; `min_eval_uplift: null` removes the tenant's floor, and a
   * null anywhere else is refused here rather than sent to be refused (422).
   */
  async function updateSkillPublishPolicy(patch: SkillPolicyPatch): Promise<SkillPolicy> {
    const body: Record<string, unknown> = {};
    for (const key of ['min_quality', 'block_on_advisory', 'require_eval'] as const) {
      const value = patch[key];
      if (value === null) throw badAddress(`policy field ${key}`, 'null');
      if (value !== undefined) body[key] = value;
    }
    if (patch.min_eval_uplift !== undefined) body.min_eval_uplift = patch.min_eval_uplift;
    return read(
      'skill-library/policy',
      await chatFetch('/skill-library/-/policy', {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      }),
    );
  }

  /** DELETE /skill-library/-/policy → drop the tenant's policy; the settings alone decide. */
  async function resetSkillPublishPolicy(): Promise<SkillPolicy> {
    return read(
      'skill-library/policy',
      await chatFetch('/skill-library/-/policy', { method: 'DELETE' }),
    );
  }

  /** GET /skill-library/-/feedback → feedback across skills in one status, oldest first. */
  async function listFeedbackInbox(
    opts: { status?: FeedbackStatus; limit?: number; cursor?: string | null } = {},
  ): Promise<SkillPage<SkillFeedback>> {
    const q = new URLSearchParams({ status: opts.status ?? 'pending' });
    q.set('limit', String(Math.min(100, Math.max(1, opts.limit ?? 50))));
    if (opts.cursor) q.set('cursor', opts.cursor);
    return page(
      await read<SkillPage<SkillFeedback>>(
        'skill-library/feedback',
        await chatFetch(`/skill-library/-/feedback?${q}`),
      ),
    );
  }

  /** GET /skill-library/{name}/feedback → one skill's feedback, newest first. */
  async function listSkillFeedback(
    name: string,
    opts: { status?: FeedbackStatus; limit?: number; cursor?: string | null } = {},
  ): Promise<SkillPage<SkillFeedback>> {
    const q = new URLSearchParams();
    if (opts.status) q.set('status', opts.status);
    q.set('limit', String(Math.min(100, Math.max(1, opts.limit ?? 50))));
    if (opts.cursor) q.set('cursor', opts.cursor);
    return page(
      await read<SkillPage<SkillFeedback>>(
        'skill-library/feedback',
        await chatFetch(`/skill-library/${nameSegment(name)}/feedback?${q}`),
      ),
    );
  }

  /** POST /skill-library/{name}/feedback → file feedback as the caller, on a version or the live one. */
  async function submitSkillFeedback(
    name: string,
    input: { body: string; suggested_patch?: string | null; target_version?: string | null },
  ): Promise<SkillFeedback> {
    const body: Record<string, unknown> = { body: input.body };
    if (input.suggested_patch) body.suggested_patch = input.suggested_patch;
    if (input.target_version) body.target_version = versionSegment(input.target_version);
    return read(
      'skill-library/feedback',
      await chatFetch(`/skill-library/${nameSegment(name)}/feedback`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      }),
    );
  }

  /**
   * POST /skill-library/-/feedback/{id}/accept → accept pending feedback. With
   * `improve` (the default) the worker rewrites the skill into a draft. 409
   * `feedback_conflict` when it was already decided.
   */
  async function acceptSkillFeedback(
    id: string,
    opts: { improve?: boolean; note?: string } = {},
  ): Promise<SkillFeedback> {
    const body: Record<string, unknown> = { improve: opts.improve ?? true };
    if (opts.note) body.note = opts.note;
    return read(
      'skill-library/feedback/accept',
      await chatFetch(`/skill-library/-/feedback/${idSegment(id)}/accept`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      }),
    );
  }

  /** POST /skill-library/-/feedback/{id}/reject → reject pending feedback with a note. */
  async function rejectSkillFeedback(id: string, note: string): Promise<SkillFeedback> {
    return read(
      'skill-library/feedback/reject',
      await chatFetch(`/skill-library/-/feedback/${idSegment(id)}/reject`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ note }),
      }),
    );
  }

  /**
   * POST …/versions/{v}/eval → queue an evaluation (202). 409 `eval_in_progress`
   * while one is queued or running; 429 `skill_jobs_cap_reached` past the caps.
   */
  async function queueSkillEval(name: string, version: string): Promise<SkillEval> {
    return read(
      'skill-library/eval',
      await chatFetch(
        `/skill-library/${nameSegment(name)}/versions/${versionSegment(version)}/eval`,
        {
          method: 'POST',
        },
      ),
    );
  }

  /** GET /skill-library/{name}/evals → evaluations, newest first, optionally of one version. */
  async function listSkillEvals(
    name: string,
    opts: { version?: string; limit?: number; cursor?: string | null } = {},
  ): Promise<SkillPage<SkillEval>> {
    const q = new URLSearchParams();
    if (opts.version) q.set('version', versionSegment(opts.version));
    q.set('limit', String(Math.min(100, Math.max(1, opts.limit ?? 50))));
    if (opts.cursor) q.set('cursor', opts.cursor);
    return page(
      await read<SkillPage<SkillEval>>(
        'skill-library/evals',
        await chatFetch(`/skill-library/${nameSegment(name)}/evals?${q}`),
      ),
    );
  }

  /** GET /skill-library/{name}/evals/{id} → one evaluation, with each scenario and the judge's reasons. */
  async function getSkillEval(name: string, id: string): Promise<SkillEval> {
    return read(
      'skill-library/eval',
      await chatFetch(`/skill-library/${nameSegment(name)}/evals/${idSegment(id)}`),
    );
  }

  return {
    getSkillPublishPolicy,
    updateSkillPublishPolicy,
    resetSkillPublishPolicy,
    listFeedbackInbox,
    listSkillFeedback,
    submitSkillFeedback,
    acceptSkillFeedback,
    rejectSkillFeedback,
    queueSkillEval,
    listSkillEvals,
    getSkillEval,
  };
}
