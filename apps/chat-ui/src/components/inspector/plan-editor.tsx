import { describeError, type Plan, PlanChangedError, type PlanStep } from '@felix/client';
import { Button } from '@felix/ui/button';
import { Input } from '@felix/ui/input';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { updatePlan } from '@/api';

/** The statuses a person picks from; the agent may write others, which are kept as sent. */
const STATUSES = ['pending', 'in_progress', 'done', 'skipped', 'failed'] as const;

/**
 * Edit an agent's plan by hand: its title, and each step's title and status.
 *
 * The save is based on the version read (`expected_updated_at`), because the agent updates
 * step statuses while a run is live; a plan that moved since stops at a choice — take the
 * agent's version, or save this one over it — and never overwrites by itself. The harness
 * marks the plan edited and tells the agent (felix-run/felix#605), and the toast says how.
 */
export function PlanEditor({
  plan,
  onSaved,
  onCancel,
}: {
  plan: Plan;
  onSaved: (saved: Plan) => void;
  onCancel: () => void;
}) {
  const [base, setBase] = useState(plan);
  const [title, setTitle] = useState(plan.title);
  const [steps, setSteps] = useState<PlanStep[]>(plan.steps.map((s) => ({ ...s })));
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<Plan | null | undefined>(undefined);
  const [failure, setFailure] = useState<string | null>(null);

  const setStep = (i: number, patch: Partial<PlanStep>) =>
    setSteps((was) => was.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  /** Start over from `next`: the agent's version, after a conflict. */
  const adopt = (next: Plan) => {
    setBase(next);
    setTitle(next.title);
    setSteps(next.steps.map((s) => ({ ...s })));
    setConflict(undefined);
  };

  async function save(expected: number) {
    setBusy(true);
    setFailure(null);
    try {
      const clean = steps
        .filter((s) => s.title.trim())
        .map((s) => ({ ...s, title: s.title.trim() }));
      const { plan: saved, agentTold } = await updatePlan(
        base.id,
        { ...base.body, title: title.trim() || base.title, steps: clean },
        expected,
      );
      toast.message('Plan saved', { description: toldLine(agentTold) });
      onSaved(saved);
    } catch (err) {
      if (err instanceof PlanChangedError) setConflict(err.current);
      else setFailure(describeError(err, 'save the plan').message);
    } finally {
      setBusy(false);
    }
  }

  const nextId = () => String(Math.max(0, ...steps.map((s) => Number(s.id) || 0)) + 1);

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save(base.updated_at);
      }}
    >
      <Input
        aria-label="Plan title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="h-8 text-xs"
      />
      <ol className="space-y-1.5">
        {steps.map((s, i) => (
          <li key={s.id} className="flex items-center gap-1.5">
            <Input
              aria-label={`Step ${i + 1}`}
              value={s.title}
              onChange={(e) => setStep(i, { title: e.target.value })}
              className="h-8 min-w-0 flex-1 text-xs"
            />
            <select
              aria-label={`Step ${i + 1} status`}
              value={s.status}
              onChange={(e) => setStep(i, { status: e.target.value })}
              className="h-8 rounded-md border border-input bg-transparent px-1.5 font-mono text-xs"
            >
              {/* An agent's own status word stays choosable, so opening the editor changes nothing. */}
              {[...new Set([...STATUSES, s.status])].map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8 shrink-0"
              aria-label={`Remove step ${i + 1}`}
              onClick={() => setSteps((was) => was.filter((_, j) => j !== i))}
            >
              <Trash2Icon className="size-3.5" />
            </Button>
          </li>
        ))}
      </ol>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => setSteps((was) => [...was, { id: nextId(), title: '', status: 'pending' }])}
      >
        <PlusIcon className="size-3.5" /> Add step
      </Button>

      {conflict !== undefined && (
        <div
          role="alert"
          className="space-y-1.5 rounded-md border border-state-blocked/40 p-2 text-xs"
        >
          <p>
            {conflict
              ? 'The agent changed this plan while you were editing it.'
              : 'This plan was deleted while you were editing it.'}
          </p>
          {conflict && (
            <div className="flex flex-wrap gap-1.5">
              <Button type="button" size="sm" variant="outline" onClick={() => adopt(conflict)}>
                Load its version
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void save(conflict.updated_at)}
              >
                Save mine over it
              </Button>
            </div>
          )}
        </div>
      )}
      {failure && (
        <p role="alert" className="text-xs text-state-failed">
          {failure}
        </p>
      )}

      <div className="flex gap-1.5">
        <Button type="submit" size="sm" disabled={busy || conflict !== undefined}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** What the save did with the agent, from the harness's answer. */
function toldLine(told: 'queued' | 'recorded' | null | undefined): string {
  if (told === 'queued') return 'The agent reads it before its next step.';
  if (told === 'recorded') return 'The agent will read it on its next turn.';
  if (told === null) return 'It belongs to no conversation, so no agent was told.';
  return "This harness doesn't tell the agent; it sees the change when it next reads the plan.";
}
