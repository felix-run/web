import { describe, expect, it, vi } from 'vitest';
import { listPlans } from '../src/api';

/**
 * The plans client, and the blob it exists to flatten.
 *
 * A `/plans` row is metadata plus an opaque `plan` object; the title and the
 * steps live inside it. `Plan` declared them flat, so `p.steps` was `undefined`
 * and the Inspector's Plans section threw a TypeError on `p.steps.filter` for any
 * row at all. It was never seen because plans are written only by the `deep`
 * pattern's tools, so the panel is empty on every ordinary thread — a crash
 * waiting on a feature rather than a crash anyone met.
 *
 * The step shape was wrong in the same direction: `plan_create` writes
 * `{id, title, status}` and `plan_update_step` may add `note`, while the client
 * asked for `description` and `result`, which nothing has ever written.
 */

function stub(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
  );
}

const row = (plan: Record<string, unknown>) => ({
  id: 'p1',
  tenant_id: 'default',
  manifest_id: 'deep',
  created_at: 1787634970831,
  updated_at: 1787634999999,
  expires_at: null,
  plan,
});

describe('plans client', () => {
  it('hoists title and steps out of the plan blob', async () => {
    stub({
      plans: [
        row({
          title: 'Ship the rollout',
          goal: 'ship it',
          status: 'active',
          steps: [
            { id: '1', title: 'Draft the plan', status: 'done' },
            { id: '2', title: 'Review it', status: 'pending' },
          ],
        }),
      ],
    });
    const [plan] = await listPlans();
    expect(plan?.title).toBe('Ship the rollout');
    expect(plan?.steps.map((s) => s.title)).toEqual(['Draft the plan', 'Review it']);
    expect(plan?.steps[0]?.status).toBe('done');
  });

  it('gives every row a steps array, so the panel can filter it', async () => {
    stub({ plans: [row({ title: 'No steps yet' }), row({})] });
    const plans = await listPlans();
    expect(plans.map((p) => p.steps)).toEqual([[], []]);
    // The crash was `p.steps.filter` on undefined; this is that call.
    expect(() => plans.map((p) => p.steps.filter((s) => s.status === 'done'))).not.toThrow();
  });

  it('names an untitled plan rather than rendering an empty heading', async () => {
    stub({ plans: [row({ steps: [] })] });
    const [plan] = await listPlans();
    expect(plan?.title).toBe('Untitled plan');
  });

  it('carries a step note through', async () => {
    stub({
      plans: [row({ steps: [{ id: '1', title: 'Draft', status: 'done', note: 'took two' }] })],
    });
    const [plan] = await listPlans();
    expect(plan?.steps[0]?.note).toBe('took two');
  });

  it('reads the items alias, since the route sends the rows under both names', async () => {
    stub({ items: [row({ title: 'From items' })] });
    const [plan] = await listPlans();
    expect(plan?.title).toBe('From items');
  });

  it('defaults a step id when the model omits one', async () => {
    stub({ plans: [row({ steps: [{ title: 'Nameless', status: 'pending' }] })] });
    const [plan] = await listPlans();
    expect(plan?.steps[0]?.id).toBe('1');
  });
});
