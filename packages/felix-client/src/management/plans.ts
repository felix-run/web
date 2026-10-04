/** Agent-authored plans (`GET /plans`, `DELETE /plans/{id}`). */

import type { FelixHttp } from '../http';
import { threadSuffix } from '../session-log';

/**
 * `pending` is the harness's own default and `done` is what `plan_update_step`
 * writes when the model names no status. Every other value here is one the model
 * may pass through unchecked — the harness stores the string as given — so this
 * is the set worth styling, not the set that can arrive. `STEP_TONE` falls back.
 */
export type PlanStepStatus = 'pending' | 'in_progress' | 'done' | 'skipped' | 'failed';

/**
 * One step of an agent-authored plan.
 *
 * `plan_create` writes `{id, title, status}` and `plan_update_step` may add
 * `note`. The client asked for `description` and `result`, which no plan tool has
 * ever written.
 */
export interface PlanStep {
  id: string;
  title: string;
  /** One of `PlanStepStatus` in practice; widened because the model supplies it. */
  status: string;
  note?: string;
}

/** The blob a plan row carries — written by `plan_create`, opaque to the harness. */
export interface PlanBody {
  title?: string;
  goal?: string;
  status?: string;
  steps?: PlanStep[];
}

/**
 * One row from GET /plans exactly as it arrives.
 *
 * The row is metadata plus an opaque `plan` blob; the title and the steps live
 * *inside* it. Declared flat, `p.steps` was `undefined` and the Plans section
 * threw a TypeError on `p.steps.filter` for any row at all — never seen only
 * because plans exist solely under the deep pattern, so the panel is always
 * empty. `listPlans` flattens the blob; `Plan` is the result.
 */
export interface PlanWire {
  id: string;
  tenant_id: string;
  manifest_id: string;
  /**
   * The conversation the plan was written in, as `{tenant}:{suffix}`; `''` for a plan
   * written outside a chat (`felix-run/felix#463`). **Absent** from a harness older
   * than that, which is also one that ignores `?thread_id=` — so its presence on a row
   * is the only evidence a thread-filtered list was actually filtered.
   */
  thread_id?: string;
  created_at: number;
  updated_at: number;
  expires_at?: number | null;
  plan: PlanBody;
}

/** A plan row as the app consumes it, with the blob flattened out. */
export interface Plan {
  id: string;
  tenant_id: string;
  manifest_id: string;
  /** The thread's suffix, `''` for none, `undefined` when the harness does not say. */
  thread_id?: string;
  title: string;
  steps: PlanStep[];
  created_at: number;
  updated_at: number;
}

/** A wire plan row as the panel consumes it: blob hoisted, steps always an array. */
export function flattenPlan(row: PlanWire): Plan {
  const plan = row.plan ?? {};
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    manifest_id: row.manifest_id,
    // Normalised to the suffix every client holds, as approvals' is.
    ...(typeof row.thread_id === 'string'
      ? { thread_id: row.thread_id ? threadSuffix(row.thread_id) : '' }
      : {}),
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
 * GET /plans → plan/step progress (populated by the `deep` pattern).
 *
 * The row is metadata plus an opaque `plan` blob, and the title and steps live
 * inside it; flattening here is what lets the panel read `p.steps` at all. The
 * response carries the rows twice, as `plans` and as `items` — the same doubled
 * shape `/approvals` returns — so both names are read rather than betting on one.
 */

/**
 * Whether a list fetched with `threadId` may be described as that thread's plans.
 *
 * A non-empty list must prove it: every row names that thread, which an older harness
 * that ignored the filter cannot do. An empty one needs no proof — "no plans on this
 * thread" is true on either harness, since an older one returning nothing has no plans
 * anywhere.
 */
export function isThreadScoped(plans: readonly Plan[], threadId: string): boolean {
  return plans.every((p) => p.thread_id === threadId);
}

export function createPlansClient(http: FelixHttp) {
  const { chatFetch } = http;

  /**
   * `threadId` (the suffix) asks for one conversation's plans. A harness older than
   * `felix-run/felix#463` ignores the parameter and answers for the whole tenant, so a
   * caller that wants to *say* "this thread" checks `isThreadScoped` on the result
   * rather than trusting that it asked.
   */
  async function listPlans(limit = 25, opts: { threadId?: string } = {}): Promise<Plan[]> {
    const query = new URLSearchParams({ limit: String(limit) });
    if (opts.threadId !== undefined) query.set('thread_id', opts.threadId);
    const res = await chatFetch(`/plans?${query}`);
    if (!res.ok) throw new Error(`plans: ${res.status}`);
    const body = (await res.json()) as { plans?: PlanWire[]; items?: PlanWire[] };
    return (body.plans ?? body.items ?? []).map(flattenPlan);
  }

  /**
   * DELETE /plans/{plan_id} → drop a plan the agent left behind.
   *
   * The list route already carries the whole plan document, so there is nothing
   * `GET /plans/{id}` could add to this panel and it stays uncalled. `PUT` stays
   * uncalled too, deliberately: the body is the agent-authored plan blob, and a
   * hand-edited one is a plan the agent did not write claiming that it did.
   *
   * Deleting is different — it is the plans equivalent of forgetting a memory, a
   * way to clear a stale or wrong plan without a database console.
   */
  async function deletePlan(planId: string): Promise<void> {
    const res = await chatFetch(`/plans/${encodeURIComponent(planId)}`, { method: 'DELETE' });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`plans/delete: ${res.status} ${detail.slice(0, 200)}`);
    }
  }

  return {
    listPlans,
    deletePlan,
  };
}
