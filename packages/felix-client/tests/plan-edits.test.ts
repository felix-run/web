import { describe, expect, it } from 'vitest';
import { flattenPlan, PlanChangedError, type PlanWire } from '../src/management/plans';
import { planFromCall } from '../src/plans';
import { createFelixClient } from '../src/transport';
import { describeWorkspaceEdit, workspaceEditOf } from '../src/workspace-edits';

/**
 * Editing an agent's plan by hand (`PUT /plans/{id}`, felix-run/felix#605): the save is based
 * on the version read, a plan that moved is a choice and not an overwrite, the harness's mark
 * is read back everywhere a plan is drawn, and its note to the agent reads as a plan.
 */

const row = (over: Partial<PlanWire> = {}): PlanWire => ({
  id: 'p1',
  tenant_id: 'default',
  manifest_id: 'deep',
  thread_id: 'default:t1',
  created_at: 1,
  updated_at: 10,
  plan: {
    title: 'Ship',
    goal: 'g',
    status: 'active',
    steps: [{ id: '1', title: 'Write', status: 'done' }],
  },
  ...over,
});

function serve(status: number, body: unknown) {
  const sent: Array<{ url: string; method?: string; body: unknown }> = [];
  const fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    sent.push({ url: String(input), method: init.method, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof globalThis.fetch;
  return { sent, client: createFelixClient({ baseUrl: '/api', headers: () => ({}), fetch }) };
}

describe('updatePlan', () => {
  it('sends the plan based on the version read, never the harness’s own mark', async () => {
    const { sent, client } = serve(200, {
      ...row({ updated_at: 11, plan: { ...row().plan, edited: { by: 'blake', at: 5 } } }),
      agent_told: 'recorded',
    });
    const { plan, agentTold } = await client.updatePlan(
      'p1',
      { ...row().plan, edited: { by: 'someone', at: 1 } },
      10,
    );
    expect(sent[0]).toMatchObject({ url: '/api/plans/p1', method: 'PUT' });
    expect(sent[0]?.body).toEqual({
      plan: { title: 'Ship', goal: 'g', status: 'active', steps: row().plan.steps },
      expected_updated_at: 10,
    });
    expect(plan.edited).toEqual({ by: 'blake', at: 5 });
    expect(agentTold).toBe('recorded');
  });

  it('says nothing about telling the agent on a harness that does not', async () => {
    const { client } = serve(200, row({ updated_at: 11 }));
    expect((await client.updatePlan('p1', row().plan, 10)).agentTold).toBeUndefined();
  });

  it('turns a plan that moved into the error carrying the current plan', async () => {
    const { client } = serve(409, {
      detail: { error: 'plan_changed', current: row({ updated_at: 12 }) },
    });
    const err = await client.updatePlan('p1', row().plan, 10).catch((e) => e);
    expect(err).toBeInstanceOf(PlanChangedError);
    expect((err as PlanChangedError).current?.updated_at).toBe(12);
  });
});

describe('the edited mark', () => {
  it('is read off a stored plan and off a plan tool’s answer', () => {
    const edited = { by: 'blake', at: 5 };
    expect(flattenPlan(row({ plan: { ...row().plan, edited } })).edited).toEqual(edited);
    expect(flattenPlan(row()).edited).toBeUndefined();
    const fromTool = planFromCall({
      name: 'plan_get',
      done: true,
      output: JSON.stringify({ id: 'p1', plan: { ...row().plan, edited } }),
    });
    expect(fromTool?.edited).toEqual(edited);
  });

  it('reads the harness’s note as a plan, not a file', () => {
    const edit = workspaceEditOf({ path: 'p1', op: 'write', kind: 'plan' });
    expect(edit).toMatchObject({ path: 'p1', plan: true });
    expect(edit && describeWorkspaceEdit(edit)).toBe('You edited the plan p1.');
  });
});
