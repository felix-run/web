import type { AgentSkill } from '@felix/client';
import { describe, expect, it } from 'vitest';
import { runnableCommands } from '../src/components/chat/slash-commands';

const skill = (over: Partial<AgentSkill>) =>
  ({
    name: 'notes',
    description: 'Draft notes',
    has_body: true,
    model_invocable: true,
    declared: true,
    source: 'library',
    user_invocable: true,
    ...over,
  }) as AgentSkill;

describe('what a person can run as /name', () => {
  it('adds the skills a person may run after the prompts, with their hint', () => {
    expect(
      runnableCommands(
        [{ name: 'review' }],
        [skill({ argument_hint: '<tag>' }), skill({ name: 'hidden', user_invocable: false })],
      ),
    ).toEqual([
      { name: 'review' },
      { name: 'notes', description: 'Draft notes', argumentHint: '<tag>' },
    ]);
  });

  it('gives a shared name to the prompt, which the harness expands first', () => {
    expect(runnableCommands([{ name: 'notes', description: 'The prompt' }], [skill({})])).toEqual([
      { name: 'notes', description: 'The prompt' },
    ]);
  });

  it('offers no skill from a harness that does not say who may run it', () => {
    const { user_invocable: _, ...older } = skill({});
    expect(runnableCommands([], [older])).toEqual([]);
  });
});
