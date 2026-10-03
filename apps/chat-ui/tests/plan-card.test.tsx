// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Message } from '../src/components/chat/message';
import { planFromCall, plansInTurn } from '../src/lib/plan-calls';
import type { ToolCall, Turn } from '../src/types';

/**
 * The agent's plan, drawn in the turn from its own `plan_*` calls. Each call
 * answers with the whole plan (`felix/patterns/plan_tools.py`), so the newest
 * answer is the plan's state; the card sits where the plan first appeared.
 */

afterEach(cleanup);

const planOut = (steps: Array<[string, string]>) =>
  JSON.stringify({
    id: 'p1',
    plan: {
      title: 'Migrate billing',
      goal: 'Move cents to a bigint column',
      steps: steps.map(([title, status], i) => ({ id: String(i + 1), title, status })),
      status: 'active',
    },
  });

const call = (name: string, output: string): ToolCall => ({ name, input: {}, output, done: true });

describe('plans in a turn', () => {
  it('reads the plan off a plan tool and maps free-form statuses to states', () => {
    const plan = planFromCall(
      call(
        'plan_update_step',
        planOut([
          ['Add column', 'Done'],
          ['Backfill', 'in progress'],
          ['Swap', 'todo'],
        ]),
      ),
    );
    expect(plan?.steps.map((s) => s.state)).toEqual(['done', 'running', 'pending']);
    expect(planFromCall(call('read_file', planOut([])))).toBeNull();
    expect(planFromCall(call('plan_get', 'error: plan not found: p1'))).toBeNull();
  });

  it('anchors the card at the first call and folds the later ones', () => {
    const tools = [
      call('plan_create', planOut([['Add column', 'pending']])),
      call('read_file', '{}'),
      call('plan_update_step', planOut([['Add column', 'done']])),
    ];
    const { anchorOf, folded, latest } = plansInTurn(tools);
    expect([...anchorOf]).toEqual([[0, 'p1']]);
    expect([...folded]).toEqual([2]);
    expect(latest.get('p1')?.steps[0]?.state).toBe('done');
  });

  it('draws one card with the newest state, in words as well as icons', () => {
    const turn: Turn = {
      id: 'a1',
      role: 'assistant',
      content: '',
      tools: [
        call(
          'plan_create',
          planOut([
            ['Add column', 'pending'],
            ['Backfill', 'pending'],
          ]),
        ),
        call(
          'plan_update_step',
          planOut([
            ['Add column', 'done'],
            ['Backfill', 'in_progress'],
          ]),
        ),
      ],
    };
    render(
      <TooltipProvider>
        <Message turn={turn} />
      </TooltipProvider>,
    );
    expect(document.querySelectorAll('[data-plan-id="p1"]')).toHaveLength(1);
    expect(screen.getByText('1 of 2 done')).toBeTruthy();
    expect(screen.getByText('in_progress')).toBeTruthy();
    // The two plan calls are what the card stands for, so neither draws a tool card.
    expect(screen.queryByText('plan_update_step')).toBeNull();
  });

  it('recovers step titles the harness dropped, from what plan_create was sent', () => {
    // Measured on :8080: the model sent `description`, the harness stored `title: ""`.
    const create: ToolCall = {
      name: 'plan_create',
      input: {
        steps: [
          { id: 's1', description: 'Collect merged PRs' },
          { id: 's2', description: 'Draft notes' },
        ],
      },
      output: JSON.stringify({
        id: 'p9',
        plan: {
          title: 'Ship',
          steps: [
            { id: 's1', title: '', status: 'pending' },
            { id: 's2', title: '', status: 'pending' },
          ],
        },
      }),
      done: true,
    };
    const update: ToolCall = {
      name: 'plan_update_step',
      input: { plan_id: 'p9', step_id: 's1', status: 'done' },
      output: JSON.stringify({
        id: 'p9',
        plan: {
          title: 'Ship',
          steps: [
            { id: 's1', title: '', status: 'done' },
            { id: 's2', title: '', status: 'pending' },
          ],
        },
      }),
      done: true,
    };
    const plan = plansInTurn([create, update]).latest.get('p9');
    expect(plan?.steps.map((s) => s.title)).toEqual(['Collect merged PRs', 'Draft notes']);
  });
});
