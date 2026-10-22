/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShellValue } from '../src/shell-context';

/**
 * `/harness/skills` describes an agent from the harness's own answer (`GET /skills/{manifest}`),
 * for whichever agent is picked — not the chat agent's last `list_skills` report, which said
 * nothing about any other agent, and not only the names its manifest declares. The facts a
 * transcript cannot show are the ones pinned: never offered to the model, supplied by the host
 * rather than asked for, and declared with no body.
 */

afterEach(cleanup);
beforeEach(() => {
  vi.resetModules();
});

const skill = (over: Record<string, unknown>) => ({
  name: 'changelog',
  description: 'Write the changelog entry for a PR.',
  version: '2',
  active: false,
  has_body: true,
  model_invocable: true,
  declared: true,
  source: 'library',
  ...over,
});

async function mount(api: Record<string, unknown> = {}) {
  const mocks = {
    listAgentSkills: vi.fn().mockResolvedValue({
      manifest: 'cowork',
      declared_only: false,
      items: [
        skill({ name: 'changelog', active: true }),
        skill({ name: 'pdf', declared: false, source: 'bundled' }),
        skill({ name: 'secret-sauce', model_invocable: false }),
        skill({ name: 'ghost', has_body: false, description: '' }),
      ],
      active: ['changelog'],
    }),
    getAgentSkill: vi.fn().mockResolvedValue({
      ...skill({}),
      filename: 'SKILL.md',
      metadata: {},
      body: '# Changelog\nOne line per change.',
    }),
    recentSkillActivations: vi.fn().mockResolvedValue([
      {
        ts: Date.now() - 120_000,
        skill: 'changelog',
        action: 'activate',
        library: 'org',
        thread_id: 'default:thread-a',
        tool_call_id: 'c1',
        status: 'ok',
      },
      {
        ts: Date.now() - 60_000,
        skill: 'nope',
        action: 'activate',
        library: '',
        thread_id: '',
        tool_call_id: 'c2',
        status: 'unknown_skill',
      },
    ]),
    ...api,
  };
  vi.doMock('../src/api', () => mocks);
  const { AgentSkills } = await import('../src/components/harness/agent-skills');
  const { ShellProvider } = await import('../src/shell-context');
  const shell = {
    threads: [
      { id: 'thread-a', title: 'Release notes', manifest: 'cowork', updatedAt: 1, named: true },
    ],
  } as unknown as ShellValue;
  render(
    <MemoryRouter>
      <ShellProvider value={shell}>
        <AgentSkills agent="cowork" />
      </ShellProvider>
    </MemoryRouter>,
  );
  await waitFor(() =>
    expect(screen.getByRole('list', { name: 'Skills cowork can reach' })).toBeTruthy(),
  );
  return mocks;
}

const row = (name: string) => {
  const li = screen
    .getAllByRole('listitem')
    .find((el) => el.dataset.slot === 'agent-skill' && el.textContent?.includes(name));
  if (!li) throw new Error(`no row for ${name}`);
  return li;
};

describe('an agent’s skills, from the harness', () => {
  it('asks for the agent on the page, and counts what is active', async () => {
    const { listAgentSkills } = await mount();
    expect(listAgentSkills).toHaveBeenCalledWith('cowork');
    expect(screen.getByText(/4 skills, 1 active\./)).toBeTruthy();
  });

  it('says what a transcript cannot: host-supplied, never offered, and no body', async () => {
    await mount();
    expect(within(row('changelog')).getByText('active')).toBeTruthy();
    expect(within(row('pdf')).getByText('from the host')).toBeTruthy();
    expect(within(row('secret-sauce')).getByText('never offered to the model')).toBeTruthy();
    expect(within(row('ghost')).getByText(/no body/)).toBeTruthy();
    // Off the defaults only: a declared, offered skill with a body says none of them.
    expect(within(row('changelog')).queryByText('from the host')).toBeNull();
  });

  it('opens a skill onto the instructions the model would be handed, read once', async () => {
    const { getAgentSkill } = await mount();
    const toggle = within(row('changelog')).getByRole('button', { name: /changelog/ });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(await screen.findByText(/One line per change\./)).toBeTruthy();
    expect(getAgentSkill).toHaveBeenCalledWith('cowork', 'changelog');
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(getAgentSkill).toHaveBeenCalledTimes(1);
  });

  it('lists recent activations, linking the thread by its title and naming a skill that does not exist', async () => {
    await mount();
    const link = await screen.findByRole('link', { name: 'Release notes' });
    expect(link.getAttribute('href')).toBe('/t/thread-a');
    expect(screen.getByText('no such skill')).toBeTruthy();
  });
});
