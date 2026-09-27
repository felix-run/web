import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@felix/ui/select';
import { useSearchParams } from 'react-router';
import { useShell } from '@/shell-context';

/**
 * The agent `/harness` is looking at.
 *
 * Skills, Eval, Agent and the Jobs form all act on *an* agent, and they used to
 * read the one the chat composer had picked — a global set on another address,
 * shown here only as 11px of mono on one nav row. Inspecting or evaluating a
 * second agent meant going back to Chat and changing what the conversation talks
 * to. So the harness has its own: `?agent=` in the address, defaulting to the
 * chat's until the operator picks another, and never writing back to it.
 */
export function useHarnessAgent(): {
  agent: string;
  /** Whether this is the chat's agent — the one a thread's `list_skills` describes. */
  isChatAgent: boolean;
  setAgent: (next: string) => void;
  /** `?agent=…` when one is chosen, for links that must keep it. */
  search: string;
} {
  const { manifest } = useShell();
  const [params, setParams] = useSearchParams();
  const chosen = params.get('agent');
  const agent = chosen || manifest;
  return {
    agent,
    isChatAgent: agent === manifest,
    // `replace`: choosing whom to look at is not a place Back should step through.
    // Choosing the chat's own agent clears the param, so the page follows the
    // chat again rather than pinning a name that happened to match.
    setAgent: (next) => {
      const nextParams = new URLSearchParams(params);
      if (next === manifest) nextParams.delete('agent');
      else nextParams.set('agent', next);
      setParams(nextParams, { replace: true });
    },
    search: chosen ? `?agent=${encodeURIComponent(chosen)}` : '',
  };
}

/**
 * The params a page wants, plus the `agent` the address already carries.
 *
 * Memory, Corpus and the Ledger write their own view into the query string, and
 * each built it from scratch — which would silently drop `?agent=` the moment a
 * view changed and put the page back on the chat's agent.
 */
export function keepAgent(
  current: URLSearchParams,
  next: URLSearchParams | Record<string, string>,
): URLSearchParams {
  const out = new URLSearchParams(next);
  const agent = current.get('agent');
  if (agent) out.set('agent', agent);
  return out;
}

/** The picker, at the top of the nav so it reads as governing every page below it. */
export function HarnessAgentPicker() {
  const { manifestOptions } = useShell();
  const { agent, isChatAgent, setAgent } = useHarnessAgent();
  const options = manifestOptions.includes(agent) ? manifestOptions : [agent, ...manifestOptions];
  return (
    <div className="px-2.5 pt-1 pb-2">
      <label
        htmlFor="harness-agent"
        className="mb-1 block text-xs font-medium text-muted-foreground"
      >
        Agent
      </label>
      <Select value={agent} onValueChange={setAgent}>
        <SelectTrigger
          id="harness-agent"
          size="sm"
          aria-describedby="harness-agent-help"
          className="h-8 w-full font-mono text-sm"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((m) => (
            <SelectItem key={m} value={m} className="font-mono text-sm">
              {m}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {/* Said, because the two can differ and only one of them is the chat's. */}
      <p id="harness-agent-help" className="mt-1 text-xs text-muted-foreground">
        {isChatAgent ? 'The one Chat is talking to.' : 'Not the one Chat is talking to.'}
      </p>
    </div>
  );
}
