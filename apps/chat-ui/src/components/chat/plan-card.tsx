import { CheckCircle2Icon, CircleDashedIcon, CircleIcon, CircleXIcon } from 'lucide-react';
import {
  Plan,
  PlanContent,
  PlanDescription,
  PlanHeader,
  PlanTitle,
  PlanTrigger,
} from '@/components/ai-elements/plan';
import type { PlanState, StepState } from '@/lib/plan-calls';
import { cn } from '@/lib/utils';

const STEP: Record<StepState, { Icon: typeof CircleIcon; tone: string }> = {
  done: { Icon: CheckCircle2Icon, tone: 'text-state-done' },
  running: { Icon: CircleDashedIcon, tone: 'text-state-running' },
  failed: { Icon: CircleXIcon, tone: 'text-state-failed' },
  pending: { Icon: CircleIcon, tone: 'text-muted-foreground' },
};

/**
 * The agent's plan, in the turn that made or moved it.
 *
 * It was visible only in the instrument's Plans tab, which reads `/plans` —
 * tenant-wide, newest first — so on a busy harness the plan on screen was not
 * necessarily this thread's. This one is read off the turn's own `plan_*` calls.
 *
 * The header's value is the count (`3 of 7 done`), because that is the glance;
 * the steps are a list with the state as an icon *and* the agent's own status
 * word, never the colour alone. Open by default while any step is still to do.
 */
export function PlanCard({ plan, live }: { plan: PlanState; live: boolean }) {
  const done = plan.steps.filter((s) => s.state === 'done').length;
  const open = done < plan.steps.length;
  return (
    <Plan
      defaultOpen={open}
      className="gap-0 rounded-xl border-border/60 bg-transparent py-0 text-sm"
      data-plan-id={plan.id}
    >
      <PlanHeader className="flex items-center gap-2 px-3 py-2">
        <div className="min-w-0 flex-1">
          <PlanTitle className="truncate text-sm font-medium">{plan.title || 'Plan'}</PlanTitle>
          {plan.goal && plan.goal !== plan.title ? (
            <PlanDescription className="mt-0.5 text-xs text-muted-foreground">
              {plan.goal}
            </PlanDescription>
          ) : null}
        </div>
        <span
          className={cn(
            'shrink-0 font-mono text-xs tabular-nums text-muted-foreground',
            live && open && 'shimmer shimmer-color-foreground',
          )}
        >
          {done} of {plan.steps.length} done
        </span>
        <PlanTrigger className="size-7 shrink-0" />
      </PlanHeader>
      <PlanContent className="border-t border-border/50 px-3 py-2">
        <ol className="space-y-1.5">
          {plan.steps.map((step) => {
            const { Icon, tone } = STEP[step.state];
            return (
              <li key={step.id} className="flex items-start gap-2">
                <Icon aria-hidden className={cn('mt-0.5 size-3.5 shrink-0', tone)} />
                <div className="min-w-0 flex-1">
                  <span
                    className={cn(
                      step.state === 'done' ? 'text-muted-foreground' : 'text-foreground',
                    )}
                  >
                    {step.title}
                  </span>
                  {step.note ? <p className="text-xs text-muted-foreground">{step.note}</p> : null}
                </div>
                <span className={cn('shrink-0 font-mono text-xs', tone)}>{step.status}</span>
              </li>
            );
          })}
        </ol>
      </PlanContent>
    </Plan>
  );
}
