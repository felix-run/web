import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@felix/ui/trace';
import { LayersIcon } from 'lucide-react';
import { summarizeRun } from '@/lib/tool-run';
import type { ToolCall } from '@/types';
import { isShellCall, Tool } from './tool';

/**
 * Consecutive routine calls folded into one Trace line — `Read 3 files, ran 2 commands` —
 * that opens to their cards. Ten `read_file` cards in a row were ten screens of chrome around
 * the one thing a reader wanted, which was what the agent did and not how. Only calls
 * `isRoutineCall` passes are folded, so a failure, a denial, an image or anything waiting on a
 * person is never inside one; debug draws every card and folds nothing.
 *
 * `members` carries each call's segment position, which keys its card: the same call keeps its
 * key whether it is drawn alone or inside a run.
 */
export function ToolRun({ members }: { members: { tool: ToolCall; at: number }[] }) {
  const summary = summarizeRun(
    members.map(({ tool }) => ({ name: tool.name, shell: isShellCall(tool) })),
  );
  return (
    <TraceCollapsible data-slot="tool-run" className="text-sm">
      <TraceCollapsibleTrigger>
        <TraceLine>
          <TraceIcon>
            <LayersIcon />
          </TraceIcon>
          <TraceTitle>{summary}</TraceTitle>
          <TraceDescription className="text-muted-foreground">
            {members.length} calls
          </TraceDescription>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="space-y-2 text-foreground">
        {members.map(({ tool, at }) => (
          <Tool key={`segment-${at}`} tool={tool} />
        ))}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
