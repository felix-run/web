// @vitest-environment happy-dom

import { flattenPlan, type Plan, PlanChangedError, type PlanWire } from '@felix/client';
import { TooltipProvider } from '@felix/ui/tooltip';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Editing an agent's plan by hand, in the instrument's Plans tab. The save is based on the
 * version read; a plan the agent moved meanwhile stops at a choice — its version, or this one
 * over it — and a plan a person edited says so on the transcript's plan card.
 */

const updatePlan = vi.fn();
vi.mock('@/api', () => ({ updatePlan: (...a: unknown[]) => updatePlan(...a) }));

afterEach(cleanup);
beforeEach(() => updatePlan.mockReset());

const wire = (over: Partial<PlanWire> = {}): PlanWire => ({
  id: 'p1',
  tenant_id: 'default',
  manifest_id: 'deep',
  thread_id: 'default:t1',
  created_at: 1,
  updated_at: 10,
  plan: { title: 'Ship', status: 'active', steps: [{ id: '1', title: 'Write', status: 'done' }] },
  ...over,
});

async function editor(plan: Plan = flattenPlan(wire())) {
  const { PlanEditor } = await import('../src/components/inspector/plan-editor');
  const onSaved = vi.fn();
  render(<PlanEditor plan={plan} onSaved={onSaved} onCancel={() => {}} />);
  return onSaved;
}

describe('the plan editor', () => {
  it('saves the steps it shows, based on the version it read', async () => {
    updatePlan.mockResolvedValue({
      plan: flattenPlan(wire({ updated_at: 11 })),
      agentTold: 'recorded',
    });
    const onSaved = await editor();
    fireEvent.change(screen.getByLabelText('Step 1'), { target: { value: 'Write it again' } });
    // The status is the shared select now, not a native one: its list is the app's, not the OS's.
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Step 1 status' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('option', { name: 'pending' }));
    fireEvent.click(screen.getByRole('button', { name: /Add step/ }));
    fireEvent.change(screen.getByLabelText('Step 2'), { target: { value: 'Test it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(updatePlan).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({
        title: 'Ship',
        steps: [
          { id: '1', title: 'Write it again', status: 'pending', note: undefined },
          { id: '2', title: 'Test it', status: 'pending' },
        ],
      }),
      10,
    );
  });

  it('stops at a choice when the agent moved the plan, and saves over it only when asked', async () => {
    const current = flattenPlan(
      wire({
        updated_at: 12,
        plan: { title: 'Ship', steps: [{ id: '1', title: 'Write', status: 'in_progress' }] },
      }),
    );
    updatePlan
      .mockRejectedValueOnce(new PlanChangedError(current))
      .mockResolvedValueOnce({ plan: current, agentTold: 'queued' });
    const onSaved = await editor();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/agent changed this plan while you were editing/)).toBeTruthy();
    // Save is held until the conflict is resolved one way or the other.
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save mine over it' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(updatePlan.mock.calls[1]?.[2]).toBe(12);
  });

  it('loads the agent’s version instead, when that is the choice', async () => {
    const current = flattenPlan(
      wire({
        updated_at: 12,
        plan: { title: 'Ship', steps: [{ id: '1', title: 'Agent wrote this', status: 'done' }] },
      }),
    );
    updatePlan.mockRejectedValueOnce(new PlanChangedError(current));
    await editor();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Load its version' }));
    expect((screen.getByLabelText('Step 1') as HTMLInputElement).value).toBe('Agent wrote this');
  });
});

describe('an edited plan, in the transcript', () => {
  it('says so on the plan card', async () => {
    const { Message } = await import('../src/components/chat/message');
    const output = JSON.stringify({
      id: 'p1',
      plan: {
        title: 'Ship',
        steps: [{ id: '1', title: 'Write', status: 'done' }],
        edited: { by: 'blake', at: 5 },
      },
    });
    render(
      <TooltipProvider>
        <Message
          turn={{
            id: 'a',
            role: 'assistant',
            content: '',
            tools: [{ name: 'plan_get', done: true, output }],
          }}
        />
      </TooltipProvider>,
    );
    expect(screen.getByText('edited').getAttribute('title')).toContain('Edited by blake');
  });

  it('draws the harness’s note as an edit to the plan, with nothing to open', async () => {
    const { Message } = await import('../src/components/chat/message');
    render(
      <TooltipProvider>
        <Message
          turn={{
            id: 'n',
            role: 'note',
            content: 'The operator edited your plan `p1` directly…',
            note: {
              role: 'user',
              inContext: true,
              workspaceEdit: { path: 'p1', op: 'write', plan: true },
            },
          }}
        />
      </TooltipProvider>,
    );
    expect(document.body.textContent).toContain('You edited the plan');
    expect(screen.queryByRole('button', { name: /p1/ })).toBeNull();
  });
});
