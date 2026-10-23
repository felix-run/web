import { describe, expect, it } from 'bun:test';
import type { ChatEngine, FelixClient } from '@felix/client';
import type { Spill } from '../src/artifacts';
import { type CommandContext, HELP, runCommand } from '../src/commands';
import type { Config } from '../src/config';
import { skillReport, skillsOverview } from '../src/skill-report';
import type { ThreadStore } from '../src/threads';

/**
 * `/skills`, `/skill <name>` and `/artifact <n>`: the commands that hand a body to the pager.
 * Driven through `runCommand` over a stubbed context, because the app's own `show` suspends the
 * renderer and runs `$PAGER`, which a test must not.
 */

const version = (over: Record<string, unknown> = {}) => ({
  name: 'invoice-triage',
  version: '0.1.0',
  parent_version: null,
  status: 'draft',
  source: 'agent',
  author: 'contributor',
  origin_manifest_id: 'contributor',
  session_id: null,
  reason: '',
  description: '',
  quality_score: 72,
  security_status: 'pass',
  decided_by: null,
  decision_note: null,
  created_at: 1_791_745_729_666,
  decided_at: null,
  published_at: null,
  ...over,
});

const summary = (name: string, over: Record<string, unknown> = {}) => ({
  name,
  live_version: null,
  latest: null,
  pending_drafts: 0,
  shadows_operator_upload: false,
  created_by: 'ops',
  created_at: 1,
  updated_at: 2,
  ...over,
});

function context(client: Partial<FelixClient>, spills: Spill[] = []) {
  const shown: { body: string; name: string }[] = [];
  const notices: (string | null)[] = [];
  const errors: string[] = [];
  const written = new Map<string, string>();
  const ctx = {
    client: client as FelixClient,
    engine: { setError: (e: string) => errors.push(e) } as unknown as ChatEngine,
    store: {} as ThreadStore,
    config: { origin: 'http://felix.test' } as unknown as Config,
    root: '/work',
    manifest: 'quick',
    setManifest: () => {},
    setNotice: (t: string | null) => notices.push(t),
    threadId: () => 't1',
    threads: () => [],
    hits: { current: [] },
    selectThread: () => {},
    refreshThreads: async () => {},
    hydrate: async () => {},
    branches: () => new Map(),
    newThread: () => {},
    exit: () => {},
    starters: () => [],
    outputStyles: () => ({ styles: [], fallback: null }),
    outputStyle: { current: null },
    fill: () => {},
    spills: () => spills,
    show: (body: string, name: string) => shown.push({ body, name }),
    fs: {
      exists: (p: string) => written.has(p) || p === '/work/taken.txt',
      write: (p: string, body: string) => written.set(p, body),
    },
  } satisfies CommandContext;
  return { ctx, shown, notices, errors, written };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('/skills', () => {
  it('pages the review queue and the skills in use', async () => {
    const t = context({
      listSkillReviewQueue: async () => ({
        items: [
          { ...version({ name: 'pdf', source: 'import', reason: 'try it' }), live_version: null },
        ],
        next_cursor: null,
      }),
      listLibrarySkills: async () => ({
        items: [
          summary('pdf', { pending_drafts: 1 }),
          summary('invoice-triage', { live_version: '1.0.0' }),
          summary('retired'),
        ],
        next_cursor: null,
      }),
    } as unknown as Partial<FelixClient>);
    runCommand(t.ctx, '/skills');
    await settle();

    expect(t.shown).toHaveLength(1);
    const { body, name } = t.shown[0] as { body: string; name: string };
    expect(name).toBe('skills.txt');
    expect(body).toContain('Waiting for review (1)');
    expect(body).toContain('pdf 0.1.0');
    expect(body).toContain('reason: try it');
    expect(body).toContain('In use (2)');
    expect(body).toContain('invoice-triage  live 1.0.0');
    expect(body).toContain('1 archived');
    expect(body).not.toMatch(/^\s+retired/m);
  });

  it('says the library could not be read, rather than paging nothing', async () => {
    const t = context({
      listSkillReviewQueue: async () => {
        throw new Error('skill-library/review: 403 forbidden');
      },
      listLibrarySkills: async () => ({ items: [], next_cursor: null }),
    } as unknown as Partial<FelixClient>);
    runCommand(t.ctx, '/skills');
    await settle();
    expect(t.shown).toHaveLength(0);
    expect(t.errors).toHaveLength(1);
  });
});

describe('/skill <name>', () => {
  it('pages the versions and the gate’s verdict on the newest draft', async () => {
    const asked: string[] = [];
    const t = context({
      getLibrarySkill: async (name: string) => ({
        name,
        live_version: '0.1.0',
        created_by: 'ops',
        created_at: 1,
        updated_at: 2,
        shadows_operator_upload: false,
        versions: [
          version({ version: '0.1.1', parent_version: '0.1.0' }),
          version({ status: 'published', decided_by: 'ops' }),
        ],
        upstream: null,
      }),
      previewSkillVersion: async (name: string, v: string) => {
        asked.push(`${name}@${v}`);
        return {
          name,
          version: v,
          status: 'draft',
          valid: true,
          validation_issues: [],
          quality_score: 40,
          review_checks: [
            { id: 'license', label: 'License', passed: false, message: 'Add a license', weight: 1 },
          ],
          security_status: 'pass',
          security_issues: [],
          policy_passes: false,
          reasons: ['quality 40 < 60.'],
        };
      },
    } as unknown as Partial<FelixClient>);
    runCommand(t.ctx, '/skill invoice-triage');
    await settle();
    await settle();

    expect(asked).toEqual(['invoice-triage@0.1.1']);
    const body = (t.shown[0] as { body: string }).body;
    expect(body).toContain('SKILL invoice-triage');
    expect(body).toContain('live 0.1.0');
    expect(body).toMatch(/0\.1\.1\s+draft/);
    expect(body).toMatch(/0\.1\.0\s+published .* published by ops/);
    expect(body).toContain('The gate on 0.1.1: would refuse it');
    expect(body).toContain('- quality 40 < 60.');
    expect(body).toContain('License: Add a license');
  });

  it('asks for a name', () => {
    const t = context({});
    runCommand(t.ctx, '/skill');
    expect(t.notices).toEqual(['usage: /skill <name> — /skills lists them']);
  });
});

describe('/artifact <n>', () => {
  const spill = {
    handle: 1,
    ref: {
      manifestId: 'quick',
      artifactId: 'a'.repeat(32),
      chars: 48_000,
      spilledAt: 1,
      preview: '',
    },
    tool: {},
  } as unknown as Spill;
  const client = {
    getArtifact: async () => ({
      artifact_id: 'a',
      manifest_id: 'quick',
      chars: 3,
      content: 'all of it',
    }),
  } as unknown as Partial<FelixClient>;

  it('pages the full text behind a handle', async () => {
    const t = context(client, [spill]);
    runCommand(t.ctx, '/artifact 1');
    await settle();
    expect(t.shown).toEqual([{ body: 'all of it', name: 'artifact-1.txt' }]);
  });

  it('writes it to a file when one is named, and never over an existing one', async () => {
    const t = context(client, [spill]);
    runCommand(t.ctx, '/artifact 1 out.txt');
    await settle();
    expect(t.written.get('/work/out.txt')).toBe('all of it');
    runCommand(t.ctx, '/artifact 1 taken.txt');
    await settle();
    expect(t.notices.at(-1)).toBe('taken.txt exists; not overwriting it');
  });

  it('says what a handle can be, and when there are none', () => {
    const none = context(client, []);
    runCommand(none.ctx, '/artifact 1');
    expect(none.notices).toEqual(['nothing in this thread was spilled to an artifact']);
    const one = context(client, [spill]);
    runCommand(one.ctx, '/artifact 7');
    expect(one.notices).toEqual(['usage: /artifact <n>, n from 1 to 1 — the [aN] on a tool card']);
  });
});

describe('the help', () => {
  it('names the new commands', () => {
    expect(HELP).toContain('/skills /skill <name>');
  });

  it('fits eighty columns, since a notice wraps a long row flush left', () => {
    for (const line of HELP.split('\n')) expect(line.length).toBeLessThanOrEqual(80);
  });

  it('names every command the switch handles', async () => {
    const source = await Bun.file(new URL('../src/commands.ts', import.meta.url)).text();
    const cases = [...source.matchAll(/^ {4}case '([a-z]+)':/gm)].map((m) => m[1]);
    expect(cases.length).toBeGreaterThan(20);
    for (const name of cases) expect(HELP).toMatch(new RegExp(`/${name}\\b`));
  });
});

describe('the reports', () => {
  it('say an empty library plainly', () => {
    const body = skillsOverview([], []);
    expect(body).toContain('nothing is waiting');
    expect(body).toContain('no skill is live or waiting');
  });

  it('say whether an imported skill’s source moved', () => {
    const body = skillReport(
      {
        name: 'pdf',
        live_version: null,
        created_by: 'ops',
        created_at: 1,
        updated_at: 2,
        shadows_operator_upload: false,
        versions: [
          version({
            source: 'import',
            origin_source: 'github:acme/skills/pdf',
            origin_ref: 'main',
            origin_commit: 'dbd4588f9e10',
          }),
        ] as never,
        upstream: { update_available: true, checked_at: 1_791_745_729 } as never,
      },
      null,
    );
    expect(body).toContain('import · github:acme/skills/pdf at main (dbd4588)');
    expect(body).toContain('Its source has moved on since');
  });
});
