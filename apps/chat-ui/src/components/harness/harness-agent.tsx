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

/** Provider model by manifest name, from `/v1/models`. */
export function modelsById(
  entries: ReadonlyArray<{ id: string; providerModel?: string }>,
): Map<string, string | undefined> {
  return new Map(entries.map((e) => [e.id, e.providerModel]));
}

/**
 * One manifest in a pick list: its name, and under it the provider model it runs
 * on — the one thing the harness says about a manifest that its name does not.
 * `cowork` and `cowork-fast` read the same until one shows it runs on a
 * different model, which is what choosing *which agent to look at* or *which to
 * import* turns on. The same two lines the Chat picker draws, so a manifest
 * looks the same wherever it is picked.
 *
 * `textValue` keeps typeahead on the name, which should not depend on the model.
 * No model line when the harness reports none: `/v1/models` sends `null` when
 * the model *is* the name, and repeating the name would say nothing.
 */
export function ManifestItem({ id, providerModel }: { id: string; providerModel?: string }) {
  return (
    <SelectItem value={id} textValue={id} className="text-sm">
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-mono font-medium">{id}</span>
        {providerModel && (
          <span className="font-mono text-xs wrap-anywhere text-muted-foreground">
            {providerModel}
          </span>
        )}
      </span>
    </SelectItem>
  );
}

/**
 * The picker, in the header of each page it scopes — Skills, Eval, Agent — and
 * nowhere else.
 *
 * It headed the whole nav, where it read as filtering every page below it;
 * Memory, Corpus, the Ledger and the Manifests and Jobs lists are tenant-wide
 * and ignored it, so Usage listed every agent's spend under a picker reading
 * `cowork`. A control belongs on the things it changes.
 *
 * `labelledBy` names it by the page heading where the heading already says
 * "Agent" — a second visible "Agent" beside it would be the same word twice.
 */
export function HarnessAgentPicker({ labelledBy }: { labelledBy?: string }) {
  const { manifestOptions, manifestEntries } = useShell();
  const providerModels = modelsById(manifestEntries);
  const { agent, isChatAgent, setAgent } = useHarnessAgent();
  const options = manifestOptions.includes(agent) ? manifestOptions : [agent, ...manifestOptions];
  return (
    <div className="flex items-center gap-2">
      {!labelledBy && (
        <label htmlFor="harness-agent" className="text-xs font-medium text-muted-foreground">
          Agent
        </label>
      )}
      <Select value={agent} onValueChange={setAgent}>
        <SelectTrigger
          id="harness-agent"
          size="sm"
          aria-labelledby={labelledBy}
          aria-describedby="harness-agent-help"
          className="h-8 w-40 font-mono text-sm"
        >
          {/* The name alone: the item's children now carry the model line too. */}
          <SelectValue>{agent}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((m) => (
            <ManifestItem key={m} id={m} providerModel={providerModels.get(m)} />
          ))}
        </SelectContent>
      </Select>
      {/* Said, because the two can differ and only one of them is the chat's.
          Visible only when they do; the sentence is always there for a reader. */}
      <span
        id="harness-agent-help"
        className={isChatAgent ? 'sr-only' : 'text-xs text-muted-foreground'}
      >
        {isChatAgent ? 'The agent Chat is talking to.' : 'not Chat’s'}
      </span>
    </div>
  );
}
