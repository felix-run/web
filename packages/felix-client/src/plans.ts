import type { ToolCall } from './turns';

/**
 * Plans, read off the transcript.
 *
 * The harness's `deep` pattern plans through three tools — `plan_create`,
 * `plan_update_step`, `plan_get` — and each answers with the whole plan:
 * `{"id", "plan": {title, goal, steps: [{id, title, status, note?}], status}}`
 * (`felix/patterns/plan_tools.py`). So the transcript already carries every state a
 * plan went through, attributed to the thread by construction — which `/plans`
 * is not: it is tenant-wide, with no thread on a row.
 */
export const PLAN_TOOLS = new Set(['plan_create', 'plan_update_step', 'plan_get']);

export type StepState = 'done' | 'running' | 'failed' | 'pending';

export interface PlanCallStep {
  id: string;
  title: string;
  state: StepState;
  /** The status as the agent wrote it — free-form, so the word is shown as sent. */
  status: string;
  note?: string;
}

export interface PlanState {
  id: string;
  title: string;
  goal: string;
  steps: PlanCallStep[];
}

/** The agent writes statuses freely; these are the spellings it uses for each state. */
function stateOf(status: string): StepState {
  const s = status.toLowerCase().replace(/[\s-]+/g, '_');
  if (['done', 'complete', 'completed', 'finished', 'success', 'succeeded'].includes(s))
    return 'done';
  if (['in_progress', 'running', 'active', 'started', 'doing', 'working'].includes(s))
    return 'running';
  if (['failed', 'error', 'blocked', 'cancelled', 'canceled', 'skipped'].includes(s))
    return 'failed';
  return 'pending';
}

/** A plan tool's result, or null for any other call, one still running, or one that failed. */
export function planFromCall(tool: ToolCall): PlanState | null {
  if (!PLAN_TOOLS.has(tool.name) || !tool.done) return null;
  let v: unknown = tool.output;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (typeof v !== 'object' || v === null) return null;
  const o = v as { id?: unknown; plan?: unknown };
  const plan = o.plan as { title?: unknown; goal?: unknown; steps?: unknown } | undefined;
  if (typeof o.id !== 'string' || !plan || typeof plan !== 'object') return null;
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  return {
    id: o.id,
    title: typeof plan.title === 'string' ? plan.title : '',
    goal: typeof plan.goal === 'string' ? plan.goal : '',
    steps: steps.flatMap((raw, i) => {
      if (typeof raw !== 'object' || raw === null) return [];
      const s = raw as { id?: unknown; title?: unknown; status?: unknown; note?: unknown };
      const status = typeof s.status === 'string' ? s.status : 'pending';
      return [
        {
          id: String(s.id ?? i + 1),
          title: typeof s.title === 'string' ? s.title : '',
          state: stateOf(status),
          status,
          ...(typeof s.note === 'string' && s.note ? { note: s.note } : {}),
        },
      ];
    }),
  };
}

/**
 * Step titles as the agent *sent* them to `plan_create`, by step id.
 *
 * The harness stores a step's title from `title` or `text` only, and a model
 * that writes `description` (or `name`) gets every step stored with an empty
 * title — measured on :8080 on 2026-10-03, where all three steps of a `deep` run's
 * plan came back `"title": ""`. The words are still in the call's arguments, so
 * they are read from there when the stored title is empty.
 */
function sentTitles(tool: ToolCall): Map<string, string> {
  const out = new Map<string, string>();
  const steps = (tool.input as { steps?: unknown } | undefined)?.steps;
  if (!Array.isArray(steps)) return out;
  steps.forEach((raw, i) => {
    const s = typeof raw === 'string' ? { title: raw } : (raw as Record<string, unknown> | null);
    if (!s) return;
    const title = [s.title, s.text, s.description, s.name].find(
      (v): v is string => typeof v === 'string' && v.trim() !== '',
    );
    if (title) out.set(String(s.id ?? i + 1), title);
  });
  return out;
}

/**
 * For one turn: the newest state of each plan, and which tool calls the plan card
 * stands in for. The card goes where the plan first appears and shows its newest
 * state, so it does not jump down the turn as steps check off; the calls after
 * the first are what it summarises.
 */
export function plansInTurn(tools: readonly ToolCall[] | undefined): {
  latest: Map<string, PlanState>;
  /** Index of the call each plan's card is drawn at. */
  anchorOf: Map<number, string>;
  /** Calls the card replaces. */
  folded: Set<number>;
} {
  const latest = new Map<string, PlanState>();
  const anchorOf = new Map<number, string>();
  const folded = new Set<number>();
  const titles = new Map<string, Map<string, string>>();
  (tools ?? []).forEach((tool, i) => {
    const plan = planFromCall(tool);
    if (!plan) return;
    if (tool.name === 'plan_create') titles.set(plan.id, sentTitles(tool));
    const sent = titles.get(plan.id);
    if (sent) {
      for (const step of plan.steps) if (!step.title) step.title = sent.get(step.id) ?? '';
    }
    if (!latest.has(plan.id)) anchorOf.set(i, plan.id);
    else folded.add(i);
    latest.set(plan.id, plan);
  });
  return { latest, anchorOf, folded };
}
