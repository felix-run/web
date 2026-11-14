import type { PlanState, StepState } from '@felix/client';
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@felix/ui/trace';
import {
  CheckCircle2Icon,
  CircleDashedIcon,
  CircleIcon,
  CircleXIcon,
  ListChecksIcon,
} from 'lucide-react';
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
 * A Trace row (`@felix/ui/trace`), like reasoning and the tool calls beside it:
 * the line is the title and the count (`3 of 7 done`), because that is the glance,
 * and it shimmers while the run is live and steps remain. Open, the goal, then the
 * steps as a list with the state as an icon *and* the agent's own status word,
 * never the colour alone. Open by default while any step is still to do.
 *
 * It used to be a card whose header wrapped the count under the goal at 390px.
 * One line cannot wrap, so the goal moved inside, and the title truncates before
 * the count does.
 */
export function PlanCard({ plan, live }: { plan: PlanState; live: boolean }) {
  const done = plan.steps.filter((s) => s.state === 'done').length;
  const open = done < plan.steps.length;
  const title = plan.title || 'Plan';
  return (
    <TraceCollapsible defaultOpen={open} data-plan-id={plan.id} className="text-sm">
      <TraceCollapsibleTrigger>
        <TraceLine status={live && open ? 'running' : undefined}>
          <TraceIcon>
            <ListChecksIcon />
          </TraceIcon>
          <TraceTitle data-plan-heading className="font-medium text-foreground">
            {title}
          </TraceTitle>
          <TraceDescription className="font-mono text-xs text-muted-foreground">
            {done} of {plan.steps.length} done
          </TraceDescription>
          {plan.edited && (
            // A person changed this plan by hand (felix-run/felix#605): said where the plan is
            // drawn, so steps the agent did not write never read as the agent's.
            <span
              className="shrink-0 rounded-full border border-border/60 px-1.5 text-xs text-muted-foreground"
              title={`Edited by ${plan.edited.by || 'a person'} · ${new Date(plan.edited.at).toLocaleString()}`}
            >
              edited
            </span>
          )}
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        {plan.goal && plan.goal !== plan.title ? (
          <p data-plan-goal className="mb-1.5 text-xs">
            {plan.goal}
          </p>
        ) : null}
        <ol className="space-y-1.5">
          {plan.steps.map((step, index) => {
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
                    {/* A step can arrive with no title at all; its number still says
                        which one it is. */}
                    {step.title || `Step ${index + 1}`}
                  </span>
                  {step.note ? <p className="text-xs text-muted-foreground">{step.note}</p> : null}
                </div>
                <span className={cn('shrink-0 font-mono text-xs', tone)}>{step.status}</span>
              </li>
            );
          })}
        </ol>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
