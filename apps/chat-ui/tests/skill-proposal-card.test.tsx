// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Tool } from '../src/components/chat/tool';
import { parseSkillCall } from '../src/lib/skill-calls';
import { fakeHarness, fileBody, mountWithProviders, SKILL_MD, versionRow } from './skill-fixtures';

/**
 * The card a `create_skill` / `update_skill` result becomes in the transcript.
 *
 * Every state here is one where the wrong card would mislead: Approve on a
 * draft already decided elsewhere, "done" on a call that saved nothing, a
 * button that 403s forever for a key without `skills:write`. Each is driven
 * through the real tool card and a fake harness at `fetch`, and the decision
 * is asserted at the wire — the verb and path a click sends.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const saved = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    status: 'draft',
    name: 'roll-dice',
    version: '0.1.1',
    quality_score: 72,
    security_status: 'pass',
    review_hint: 'To raise the quality score: Body should be at least 100 characters',
    ...over,
  });

function tool(output: string, name = 'update_skill', input: unknown = {}) {
  return {
    id: 't1',
    name,
    input: {
      name: 'roll-dice',
      parent_version: '0.1.0',
      reason: 'Clearer steps',
      ...(input as object),
    },
    output,
    done: true,
  };
}

function skillDetail(versions: Record<string, unknown>[], live: string | null = '0.1.0') {
  return {
    name: 'roll-dice',
    live_version: live,
    created_by: 'quick',
    created_at: 1,
    updated_at: 2,
    shadows_operator_upload: false,
    versions,
  };
}

describe('parseSkillCall', () => {
  it('reads a saved draft and a refusal, and ignores every other tool', () => {
    expect(parseSkillCall('update_skill', saved())).toMatchObject({
      kind: 'saved',
      version: '0.1.1',
    });
    expect(
      parseSkillCall(
        'update_skill',
        '{"error":"parent_changed","name":"a","expected":"1","current":"2"}',
      ),
    ).toMatchObject({ kind: 'refused', error: 'parent_changed', current: '2' });
    expect(parseSkillCall('read_file', saved())).toBeNull();
    expect(parseSkillCall('create_skill', 'not json')).toBeNull();
  });
});

describe('SkillProposalCard', () => {
  it('offers a pending draft for decision, and Approve publishes that version', async () => {
    const h = fakeHarness((req) => {
      if (req.method === 'GET' && req.path === '/skill-library/roll-dice') {
        return {
          body: skillDetail([
            versionRow({ version: '0.1.1', parent_version: '0.1.0' }),
            versionRow({ version: '0.1.0', status: 'published', published_at: 1 }),
          ]),
        };
      }
      if (req.method === 'POST' && req.path.endsWith('/publish')) {
        return { body: versionRow({ version: '0.1.1', status: 'published' }) };
      }
      return undefined;
    });
    mountWithProviders(<Tool tool={tool(saved()) as never} />);

    await screen.findByText('draft');
    expect(screen.getByText('Clearer steps')).toBeTruthy();
    expect(document.body.textContent).toContain('edited from');
    // Offered only once the library has said the draft is still a draft.
    fireEvent.click(await screen.findByRole('button', { name: 'Approve 0.1.1' }));
    // Armed, naming what goes live and what it replaces.
    expect(screen.getByText(/roll-dice 0\.1\.1 goes live, replacing live 0\.1\.0/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve 0.1.1' }));
    await waitFor(() =>
      expect(
        h.requests.some(
          (r) =>
            r.method === 'POST' && r.path === '/skill-library/roll-dice/versions/0.1.1/publish',
        ),
      ).toBe(true),
    );
  });

  it('shows the parent diff on request, reading both SKILL.md files', async () => {
    const h = fakeHarness((req) => {
      if (req.path === '/skill-library/roll-dice') {
        return {
          body: skillDetail([
            versionRow({ version: '0.1.1' }),
            versionRow({ version: '0.1.0', status: 'published' }),
          ]),
        };
      }
      if (req.path === '/skill-library/roll-dice/versions/0.1.0/files/SKILL.md') {
        return { body: fileBody('SKILL.md', SKILL_MD('roll-dice', 'old line\n')) };
      }
      if (req.path === '/skill-library/roll-dice/versions/0.1.1/files/SKILL.md') {
        return { body: fileBody('SKILL.md', SKILL_MD('roll-dice', 'new line\n')) };
      }
      return undefined;
    });
    mountWithProviders(<Tool tool={tool(saved()) as never} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Diff against 0.1.0' }));
    expect(await screen.findByText('new line')).toBeTruthy();
    expect(screen.getByText('old line')).toBeTruthy();
    expect(h.requests.filter((r) => r.path.includes('/files/'))).toHaveLength(2);
  });

  it('does not offer Approve for a draft decided since, whatever the result said', async () => {
    fakeHarness((req) =>
      req.path === '/skill-library/roll-dice'
        ? {
            body: skillDetail(
              [
                versionRow({
                  version: '0.1.1',
                  status: 'archived',
                  decided_at: 5,
                  decided_by: 'ops',
                }),
              ],
              null,
            ),
          }
        : undefined,
    );
    mountWithProviders(<Tool tool={tool(saved()) as never} />);
    await screen.findByText('rejected');
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Open in library/ }).getAttribute('href')).toBe(
      '/harness/skills?skill=roll-dice&v=0.1.1&tab=versions',
    );
  });

  it('falls back to the link, and says why, when the key lacks skills:write', async () => {
    fakeHarness((req) => {
      if (req.path === '/skill-library/roll-dice') {
        return { body: skillDetail([versionRow({ version: '0.1.1' })]) };
      }
      if (req.path.endsWith('/publish')) {
        return { status: 403, body: { error: 'forbidden', message: 'missing scope skills:write' } };
      }
      return undefined;
    });
    mountWithProviders(<Tool tool={tool(saved()) as never} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve 0.1.1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve 0.1.1' }));
    expect(await screen.findByText(/approving or rejecting needs skills:write/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Open in library/ })).toBeTruthy();
  });

  it('says a stale update saved nothing, naming both versions', async () => {
    fakeHarness(() => undefined);
    mountWithProviders(
      <Tool
        tool={
          tool(
            JSON.stringify({
              error: 'parent_changed',
              name: 'roll-dice',
              expected: '0.1.0',
              current: '0.1.2',
            }),
          ) as never
        }
      />,
    );
    const card = (await screen.findByText('not saved')).closest('div.rounded-xl') as HTMLElement;
    expect(within(card).getByText(/was saved since\. Nothing was saved/)).toBeTruthy();
    expect(card.textContent).toContain('0.1.0');
    expect(card.textContent).toContain('0.1.2');
    expect(within(card).queryByRole('button', { name: /Approve/ })).toBeNull();
  });

  it('reports a refused publish as a draft with the gate reasons', async () => {
    fakeHarness((req) =>
      req.path === '/skill-library/roll-dice'
        ? { body: skillDetail([versionRow({ version: '0.1.1' })]) }
        : undefined,
    );
    mountWithProviders(
      <Tool
        tool={
          tool(saved({ publish_blocked: ['quality 40 is below 60'] }), 'create_skill', {}) as never
        }
      />,
    );
    expect(await screen.findByText('quality 40 is below 60')).toBeTruthy();
    expect(screen.getByText(/the gate refused/)).toBeTruthy();
  });

  it('keeps to the result, and says so, when the library cannot be read', async () => {
    fakeHarness(() => ({ status: 500, body: { error: 'boom', message: 'down' } }));
    mountWithProviders(<Tool tool={tool(saved()) as never} />);
    expect(await screen.findByText(/as saved; the library could not be read/)).toBeTruthy();
    expect(screen.getByText('draft')).toBeTruthy();
  });
});
