import { useShell } from '@/shell-context';

/**
 * Starter prompts for the empty thread, chosen by the agent the first message
 * goes to so each one exercises something that manifest can actually do.
 *
 * Keyed by manifest name, which is the only thing the client knows about an
 * agent before a run reports its tools; an agent with no set of its own gets
 * the general one. Clicking sends the prompt as written — it is shown in full
 * on hover, so nothing reaches the model that the operator could not read.
 */
type Starter = { title: string; prompt: string };

const BY_MANIFEST: Record<string, Starter[]> = {
  cowork: [
    {
      title: 'List the workspace',
      prompt: 'List the top-level files and folders in the workspace.',
    },
    {
      title: 'Find TODOs',
      prompt: 'Search the workspace for TODO and summarize the matches by file.',
    },
    {
      title: 'Write a note',
      prompt:
        'Create notes/todo.md with three short tasks for today, then read the file back to confirm it.',
    },
    {
      title: 'Draft a README',
      prompt:
        'Read the workspace, draft a one-paragraph README for it, and write it to README.md (I will approve the write).',
    },
  ],
  quick: [
    {
      title: 'Calculate',
      prompt: 'What is 17.5% of 2,340, and what is that as a monthly amount over a year?',
    },
    {
      title: 'Summarize Felix',
      prompt: 'In two sentences, what is Felix and who is it for?',
    },
    {
      title: 'Draft a reply',
      prompt: 'Draft a short, polite reply declining a meeting that conflicts with a deadline.',
    },
  ],
  deep: [
    {
      title: 'Plan a rollout',
      prompt:
        'Plan a multi-step rollout of a public API behind a chat UI. Include risks and validation steps.',
    },
    {
      title: 'Research a comparison',
      prompt:
        'Compare Docker Compose and Kubernetes for running a small self-hosted agent API. Cite sources.',
    },
    {
      title: 'Design an eval set',
      prompt: 'Propose five golden eval prompts for a general-purpose agent and how to judge each.',
    },
  ],
  support: [
    {
      title: 'Troubleshoot a stream',
      prompt:
        'My chat stream returns 500 only for some agents. Walk me through diagnosing it step by step.',
    },
    {
      title: 'How do approvals work?',
      prompt: 'How do tool approvals work in Felix, and what happens if nobody answers one?',
    },
    {
      title: 'Search the docs',
      prompt: 'Search the docs for how durable runs are resumed after a disconnect.',
    },
  ],
  'oss-only': [
    {
      title: 'Pick a local model',
      prompt: 'Recommend an open model size for coding help on a 16GB laptop and explain why.',
    },
    {
      title: 'Speed up local inference',
      prompt: 'Give three practical tips for when a local LLM feels too slow for interactive chat.',
    },
  ],
};

const FALLBACK: Starter[] = [
  { title: 'What can you do?', prompt: 'What can you do, and which tools do you have access to?' },
  {
    title: 'Summarize Felix',
    prompt: 'In two sentences, what is Felix and who is it for?',
  },
];

export function startersFor(manifest: string): Starter[] {
  return BY_MANIFEST[manifest] ?? FALLBACK;
}

export function StarterPrompts({ manifest }: { manifest: string }) {
  const { send, streaming } = useShell();
  const starters = startersFor(manifest);

  return (
    <div className="mt-4">
      <h3 id="starter-prompts-title" className="text-xs text-muted-foreground">
        Try
      </h3>
      <ul aria-labelledby="starter-prompts-title" className="mt-1.5 flex flex-wrap gap-1.5">
        {starters.map((s) => (
          <li key={`${manifest}-${s.title}`}>
            <button
              type="button"
              title={s.prompt}
              disabled={streaming}
              onClick={() => send(s.prompt)}
              className="rounded-md border border-border px-2.5 py-1 text-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
            >
              {s.title}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
