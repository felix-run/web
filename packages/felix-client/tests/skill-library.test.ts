import { describe, expect, it } from 'vitest';
import { describeError } from '../src/errors';
import {
  isStaleWrite,
  REQUEST_BODY_LIMIT_BYTES,
  SkillLibraryError,
} from '../src/management/skills';
import { createFelixClient } from '../src/transport';

/**
 * The skill library client, at the wire.
 *
 * What these pin is the part a type cannot: the path and verb each call sends,
 * the body's exact keys (the harness's request models are `extra=forbid`, so a
 * stray key is a 422), and that a refusal comes back *parsed* — a 409 that is
 * `parent_changed` must be distinguishable from one that is `skill_exists`,
 * because one offers a merge and the other a rename.
 */

interface Call {
  url: string;
  method: string;
  body: unknown;
}

function stub(answer: (call: Call) => { status?: number; body: unknown }) {
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

describe('skill library reads', () => {
  it('builds harness-relative paths, encoding names, versions and each path segment', async () => {
    const { calls, client } = stub(() => ({ body: { items: [], next_cursor: null, files: [] } }));
    await client.listLibrarySkills({ status: 'draft', source: 'agent', limit: 500, cursor: 'abc' });
    await client.listSkillReviewQueue();
    await client.getSkillPublishPolicy();
    await client.getLibrarySkill('roll-dice');
    await client.getSkillVersion('roll-dice', '0.1.0');
    await client.getSkillFile('roll-dice', '0.1.0', 'references/a b.md');
    await client.previewSkillVersion('roll-dice', '0.1.0');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      // The limit is clamped to the harness's 100 rather than sent as a 422.
      'GET http://h/skill-library?status=draft&source=agent&limit=100&cursor=abc',
      'GET http://h/skill-library/-/review?limit=50',
      'GET http://h/skill-library/-/policy',
      'GET http://h/skill-library/roll-dice',
      'GET http://h/skill-library/roll-dice/versions/0.1.0',
      'GET http://h/skill-library/roll-dice/versions/0.1.0/files/references/a%20b.md',
      'GET http://h/skill-library/roll-dice/versions/0.1.0/preview',
    ]);
  });

  it('keeps an empty page that still has a next one', async () => {
    const { client } = stub(() => ({ body: { items: [], next_cursor: 'm' } }));
    expect(await client.listLibrarySkills({ status: 'live' })).toEqual({
      items: [],
      next_cursor: 'm',
    });
  });

  it('reads a whole bundle, each file once, keeping base64 assets as sent', async () => {
    const { calls, client } = stub((call) => {
      if (call.url.endsWith('/versions/1.0.0')) {
        return {
          body: {
            files: [
              { path: 'SKILL.md', sha256: 'a', size: 1 },
              { path: 'assets/logo.png', sha256: 'b', size: 4 },
            ],
          },
        };
      }
      const path = decodeURIComponent(call.url.split('/files/')[1] ?? '');
      return {
        body: {
          path,
          encoding: path.endsWith('.png') ? 'base64' : 'utf-8',
          content: path.endsWith('.png') ? 'iVBORw==' : '# hi',
          content_type: 'x',
          sha256: 'x',
          size: 1,
        },
      };
    });
    const bundle = await client.readSkillBundle('s', '1.0.0');
    expect(bundle.files).toEqual({ 'SKILL.md': '# hi', 'assets/logo.png': 'iVBORw==' });
    expect(calls.filter((c) => c.url.includes('/files/'))).toHaveLength(2);
  });
});

describe('skill library writes', () => {
  it('sends exactly the request models keys, and one way to number a version', async () => {
    const { calls, client } = stub(() => ({ status: 201, body: { name: 's', version: '0.1.1' } }));
    await client.createLibrarySkill({ files: { 'SKILL.md': 'x' } });
    await client.saveSkillVersion('s', {
      files: { 'SKILL.md': 'y' },
      parent_version: '0.1.0',
      bump: 'minor',
      reason: 'tighten',
      publish: true,
    });
    await client.saveSkillVersion('s', {
      files: { 'SKILL.md': 'z' },
      parent_version: '0.1.0',
      version: '2.0.0',
      bump: 'patch',
    });
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      [
        'POST',
        'http://h/skill-library',
        { files: { 'SKILL.md': 'x' }, reason: '', publish: false },
      ],
      [
        'PUT',
        'http://h/skill-library/s/versions',
        {
          files: { 'SKILL.md': 'y' },
          parent_version: '0.1.0',
          reason: 'tighten',
          publish: true,
          bump: 'minor',
        },
      ],
      [
        'PUT',
        'http://h/skill-library/s/versions',
        {
          files: { 'SKILL.md': 'z' },
          parent_version: '0.1.0',
          reason: '',
          publish: false,
          version: '2.0.0',
        },
      ],
    ]);
  });

  it('publishes, rolls back and rejects with a note, by POST', async () => {
    const { calls, client } = stub(() => ({ body: { name: 's', version: '1.0.0' } }));
    await client.publishSkillVersion('s', '1.0.0');
    await client.rollbackSkillVersion('s', '0.9.0');
    await client.rejectSkillVersion('s', '1.0.1', 'too vague');
    await client.archiveLibrarySkill('s');
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ['POST', 'http://h/skill-library/s/versions/1.0.0/publish', undefined],
      ['POST', 'http://h/skill-library/s/versions/0.9.0/rollback', undefined],
      ['POST', 'http://h/skill-library/s/versions/1.0.1/reject', { note: 'too vague' }],
      ['DELETE', 'http://h/skill-library/s', undefined],
    ]);
  });

  it('refuses an oversized save before sending it, and says by how much', async () => {
    const { calls, client } = stub(() => ({ body: {} }));
    const big = 'x'.repeat(REQUEST_BODY_LIMIT_BYTES);
    const err = await client
      .saveSkillVersion('s', { files: { 'SKILL.md': big }, parent_version: '0.1.0' })
      .catch((e: unknown) => e);
    expect(calls).toHaveLength(0);
    expect(err).toBeInstanceOf(SkillLibraryError);
    expect((err as SkillLibraryError).code).toBe('payload_too_large');
    expect((err as SkillLibraryError).refusal?.message).toMatch(/1\.00 MiB/);
  });

  it('names the harness 413 too, when a body slips past the client check', async () => {
    const { client } = stub(() => ({ status: 413, body: { error: 'payload_too_large' } }));
    const err = (await client
      .createLibrarySkill({ files: { 'SKILL.md': 'x' } })
      .catch((e: unknown) => e)) as SkillLibraryError;
    expect(err.status).toBe(413);
    expect(err.refusal?.message).toContain('1 MiB');
  });
});

describe('refusals', () => {
  it('parses a stale save into a merge-or-reload case, distinct from a name clash', async () => {
    const { client } = stub((call) =>
      call.method === 'PUT'
        ? { status: 409, body: { error: 'parent_changed', message: 'newest is 0.1.2' } }
        : { status: 409, body: { error: 'skill_exists', message: 'taken' } },
    );
    const stale = await client
      .saveSkillVersion('s', { files: {}, parent_version: '0.1.0' })
      .catch((e: unknown) => e);
    const clash = await client.createLibrarySkill({ files: {} }).catch((e: unknown) => e);
    expect(isStaleWrite(stale)).toBe(true);
    expect(isStaleWrite(clash)).toBe(false);
    expect((clash as SkillLibraryError).code).toBe('skill_exists');
  });

  it('keeps the gate reasons and the bundle issues', async () => {
    const { client } = stub((call) =>
      call.url.endsWith('/publish')
        ? {
            status: 422,
            body: { error: 'publish_blocked', message: 'no', reasons: ['quality 40 < 60'] },
          }
        : {
            status: 422,
            body: {
              error: 'invalid_bundle',
              message: 'bad',
              issues: [{ path: 'lib/x', message: 'unexpected file path' }],
            },
          },
    );
    const blocked = (await client
      .publishSkillVersion('s', '1.0.0')
      .catch((e: unknown) => e)) as SkillLibraryError;
    const invalid = (await client
      .createLibrarySkill({ files: {} })
      .catch((e: unknown) => e)) as SkillLibraryError;
    expect(blocked.refusal?.reasons).toEqual(['quality 40 < 60']);
    expect(invalid.refusal?.issues).toEqual([{ path: 'lib/x', message: 'unexpected file path' }]);
  });

  it('still reads as a status to describeError, so a 403 says the key is too narrow', async () => {
    const { client } = stub(() => ({
      status: 403,
      body: { error: 'forbidden', message: 'missing scope skills:write' },
    }));
    const err = await client.publishSkillVersion('s', '1.0.0').catch((e: unknown) => e);
    expect(describeError(err, 'publish this skill').message).toContain('needs a broader scope');
  });
});

describe('addresses', () => {
  it('refuses a name, version or path that could not be a library address, before fetching', async () => {
    const { calls, client } = stub(() => ({ body: {} }));
    const attempts = [
      client.getLibrarySkill('../audit'),
      client.getLibrarySkill('Bad Name'),
      client.getSkillVersion('ok', '1.0'),
      client.publishSkillVersion('ok', '1.0.0/../../x'),
      client.getSkillFile('ok', '1.0.0', 'references/../../../audit'),
      client.getSkillFile('ok', '1.0.0', 'references//x.md'),
    ];
    for (const attempt of attempts) {
      const err = await attempt.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SkillLibraryError);
      expect((err as SkillLibraryError).code).toBe('invalid_address');
    }
    expect(calls).toHaveLength(0);
  });
});
