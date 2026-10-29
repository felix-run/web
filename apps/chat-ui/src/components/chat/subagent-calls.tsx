import type { SubagentCall } from '@felix/client';
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@felix/ui/trace';
import { BanIcon, CheckIcon, CircleAlertIcon, LoaderIcon } from 'lucide-react';
import { classifyToolResult } from '@/types';

/** How many of a child's calls are drawn before the earlier ones fold into one line. */
export const SUBAGENT_CALLS_SHOWN = 5;

/**
 * What a foreground child agent is doing, under its `task` card: one Trace line per call it
 * made (`subagent_tool` frames, `SubagentRun.calls`), the newest last. Before it, the card said
 * "researcher working" for as long as the child took, with nothing to tell a child making
 * progress from one stuck on its first call.
 *
 * Live only, like the frames: a reload rebuilds the card from the log, which holds the `task`
 * call and not the child's, so the lines are gone and the card reads as it always did. A call
 * that failed reads so in the failure colour; a denial stays neutral, as on a card.
 *
 * `targetOf` is the card's own summary of a call's arguments (`toolTarget`), passed in so the
 * line names a call exactly as a card for it would.
 */
export function SubagentCalls({
  calls,
  targetOf,
}: {
  calls: SubagentCall[];
  targetOf: (name: string, input: unknown) => string | null;
}) {
  const earlier = calls.slice(0, Math.max(0, calls.length - SUBAGENT_CALLS_SHOWN));
  const shown = calls.slice(earlier.length);
  const line = (call: SubagentCall) => (
    <SubagentCallLine key={call.callId} call={call} target={targetOf(call.name, call.input)} />
  );
  return (
    <Trace
      data-slot="subagent-calls"
      className="gap-1 border-t border-border/60 px-3.5 py-2"
      aria-label="The child agent's calls"
    >
      {earlier.length > 0 && (
        <TraceCollapsible>
          <TraceCollapsibleTrigger>
            <TraceLine className="text-xs">
              <TraceTitle>
                {earlier.length} earlier {earlier.length === 1 ? 'call' : 'calls'}
              </TraceTitle>
            </TraceLine>
          </TraceCollapsibleTrigger>
          <TraceCollapsibleContent className="mt-1 flex flex-col gap-1">
            {earlier.map(line)}
          </TraceCollapsibleContent>
        </TraceCollapsible>
      )}
      {shown.map(line)}
    </Trace>
  );
}

function SubagentCallLine({ call, target }: { call: SubagentCall; target: string | null }) {
  const issue = call.done ? classifyToolResult(call.name, call.result) : null;
  const broken = issue !== null && issue.kind !== 'denied';
  return (
    <TraceLine
      data-slot="subagent-call"
      status={!call.done ? 'running' : broken ? 'error' : undefined}
      className="text-xs"
    >
      <TraceIcon>
        {!call.done ? (
          <LoaderIcon className="size-3.5 motion-safe:animate-spin" />
        ) : issue?.kind === 'denied' || issue?.kind === 'refused' ? (
          <BanIcon className="size-3.5" />
        ) : broken ? (
          <CircleAlertIcon className="size-3.5" />
        ) : (
          <CheckIcon className="size-3.5 text-state-done" />
        )}
      </TraceIcon>
      <TraceTitle className="font-mono">{call.name}</TraceTitle>
      {target && (
        <TraceDescription className="min-w-0 shrink truncate" title={target}>
          {target}
        </TraceDescription>
      )}
      {issue && <TraceDescription>{issue.label}</TraceDescription>}
    </TraceLine>
  );
}
