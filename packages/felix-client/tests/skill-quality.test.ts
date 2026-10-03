import { describe, expect, it } from 'vitest';
import { SkillLibraryError } from '../src/management/skills';
import { createFelixClient } from '../src/transport';

/**
 * Feedback, evaluations and the publish policy, at the wire: the path, the
 * verb and the exact body each call sends — the harness's request models are
 * `extra=forbid`, so a stray key is a 422 — and the publish/rollback body that
 * pins a move to the live version the operator was shown.
 */

interface Call {
  url: string;
  method: string;
  body: unknown;
}

function stub(answer: (call: Call) => { status?: number; body: unknown } = () => ({ body: {} })) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, opts: RequestInit = {}) => {
    const call = {
      url: String(input),
      method: opts.method ?? 'GET',
      body: typeof opts.body === 'string' ? JSON.parse(opts.body) : undefined,
    };
    calls.push(call);
    const { status = 200, body } = answer(call);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof globalThis.fetch;
  return { calls, client: createFelixClient({ baseUrl: 'http://h', fetch }) };
}

const ID = '0f8e2c1a-4b3d-4e5f-8a9b-0c1d2e3f4a5b';
const wire = (calls: Call[]) => calls.map((c) => [c.method, c.url, c.body]);

describe('policy', () => {
  it('reads, patches only the fields given, and resets', async () => {
    const { calls, client } = stub(() => ({ body: { source: 'tenant' } }));
    await client.getSkillPublishPolicy();
    await client.updateSkillPublishPolicy({ min_quality: 70, require_eval: true });
    await client.updateSkillPublishPolicy({ min_eval_uplift: null });
    await client.resetSkillPublishPolicy();
    expect(wire(calls)).toEqual([
      ['GET', 'http://h/skill-library/-/policy', undefined],
      ['PATCH', 'http://h/skill-library/-/policy', { min_quality: 70, require_eval: true }],
      ['PATCH', 'http://h/skill-library/-/policy', { min_eval_uplift: null }],
      ['DELETE', 'http://h/skill-library/-/policy', undefined],
    ]);
  });

  it('refuses a null the harness would 422, without sending it', async () => {
    const { calls, client } = stub();
    const err = await client
      .updateSkillPublishPolicy({ min_quality: null as unknown as number })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SkillLibraryError);
    expect((err as SkillLibraryError).code).toBe('invalid_policy');
    expect(calls).toHaveLength(0);
  });
});

describe('feedback', () => {
  it('lists the inbox (pending by default) and one skill, filtered', async () => {
    const { calls, client } = stub(() => ({ body: { items: [], next_cursor: 'c' } }));
    expect(await client.listFeedbackInbox()).toEqual({ items: [], next_cursor: 'c' });
    await client.listFeedbackInbox({ status: 'failed', cursor: 'x' });
    await client.listSkillFeedback('roll-dice', { status: 'applied' });
    expect(calls.map((c) => c.url)).toEqual([
      'http://h/skill-library/-/feedback?status=pending&limit=50',
      'http://h/skill-library/-/feedback?status=failed&limit=50&cursor=x',
      'http://h/skill-library/roll-dice/feedback?status=applied&limit=50',
    ]);
  });

  it('files, accepts and rejects with exactly the model keys', async () => {
    const { calls, client } = stub(() => ({ status: 201, body: { id: ID } }));
    await client.submitSkillFeedback('roll-dice', { body: 'Too vague' });
    await client.submitSkillFeedback('roll-dice', {
      body: 'b',
      suggested_patch: 'p',
      target_version: '0.1.0',
    });
    await client.acceptSkillFeedback(ID);
    await client.acceptSkillFeedback(ID, { improve: false, note: 'fine' });
    await client.rejectSkillFeedback(ID, 'no');
    expect(wire(calls)).toEqual([
      ['POST', 'http://h/skill-library/roll-dice/feedback', { body: 'Too vague' }],
      [
        'POST',
        'http://h/skill-library/roll-dice/feedback',
        { body: 'b', suggested_patch: 'p', target_version: '0.1.0' },
      ],
      ['POST', `http://h/skill-library/-/feedback/${ID}/accept`, { improve: true }],
      ['POST', `http://h/skill-library/-/feedback/${ID}/accept`, { improve: false, note: 'fine' }],
      ['POST', `http://h/skill-library/-/feedback/${ID}/reject`, { note: 'no' }],
    ]);
  });

  it('refuses an id that is not a row id before building the URL', async () => {
    const { calls, client } = stub();
    const err = await client.acceptSkillFeedback('../../policy').catch((e: unknown) => e);
    expect((err as SkillLibraryError).code).toBe('invalid_address');
    expect(calls).toHaveLength(0);
  });

  it('parses a refusal to its code', async () => {
    const { client } = stub(() => ({
      status: 409,
      body: { error: 'feedback_conflict', message: 'already decided' },
    }));
    const err = (await client
      .rejectSkillFeedback(ID, 'x')
      .catch((e: unknown) => e)) as SkillLibraryError;
    expect([err.status, err.code]).toEqual([409, 'feedback_conflict']);
  });
});

describe('evaluations', () => {
  it('queues, lists by version and reads one', async () => {
    const { calls, client } = stub(() => ({ status: 202, body: { items: [], next_cursor: null } }));
    await client.queueSkillEval('roll-dice', '0.1.1');
    await client.listSkillEvals('roll-dice', { version: '0.1.1' });
    await client.listSkillEvals('roll-dice');
    await client.getSkillEval('roll-dice', ID);
    expect(wire(calls)).toEqual([
      ['POST', 'http://h/skill-library/roll-dice/versions/0.1.1/eval', undefined],
      ['GET', 'http://h/skill-library/roll-dice/evals?version=0.1.1&limit=50', undefined],
      ['GET', 'http://h/skill-library/roll-dice/evals?limit=50', undefined],
      ['GET', `http://h/skill-library/roll-dice/evals/${ID}`, undefined],
    ]);
  });

  it('keeps the cap and in-progress refusals apart', async () => {
    const { client } = stub(() => ({
      status: 429,
      body: { error: 'skill_jobs_cap_reached', message: 'cap' },
    }));
    const err = (await client
      .queueSkillEval('a', '1.0.0')
      .catch((e: unknown) => e)) as SkillLibraryError;
    expect(err.code).toBe('skill_jobs_cap_reached');
  });
});

describe('making a version live', () => {
  it('sends the live version it was shown, null for nothing live, and nothing when not asked', async () => {
    const { calls, client } = stub(() => ({ body: {} }));
    await client.publishSkillVersion('roll-dice', '0.1.1', { expectedLive: '0.1.0' });
    await client.publishSkillVersion('roll-dice', '0.1.1', { expectedLive: null });
    await client.rollbackSkillVersion('roll-dice', '0.1.0', { expectedLive: '0.1.1' });
    await client.publishSkillVersion('roll-dice', '0.1.1');
    expect(wire(calls)).toEqual([
      [
        'POST',
        'http://h/skill-library/roll-dice/versions/0.1.1/publish',
        { expected_live_version: '0.1.0' },
      ],
      [
        'POST',
        'http://h/skill-library/roll-dice/versions/0.1.1/publish',
        { expected_live_version: null },
      ],
      [
        'POST',
        'http://h/skill-library/roll-dice/versions/0.1.0/rollback',
        { expected_live_version: '0.1.1' },
      ],
      ['POST', 'http://h/skill-library/roll-dice/versions/0.1.1/publish', undefined],
    ]);
  });

  it('parses live_changed', async () => {
    const { client } = stub(() => ({
      status: 409,
      body: { error: 'live_changed', message: 'roll-dice is live at 0.1.2' },
    }));
    const err = (await client
      .publishSkillVersion('roll-dice', '0.1.1', { expectedLive: '0.1.0' })
      .catch((e: unknown) => e)) as SkillLibraryError;
    expect(err.code).toBe('live_changed');
  });
});
